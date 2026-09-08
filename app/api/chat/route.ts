import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { executeWithRotation, getRotationStatus } from '@/lib/geminiRotator';
import {
  searchIssues,
  fetchAndValidateSpecificIssue,
  getRepoStructure,
  getFileContent,
  searchCodeInRepo,
  getIssueDetails,
  createPR,
  parseIssueTarget,
} from '@/lib/github';
import { runAutonomousAgentWorkflow } from '@/lib/agentOrchestrator';

export const maxDuration = 60; // 60 seconds max duration for tool calls

const SYSTEM_PROMPT = `You are MergeMate, a General-Purpose Autonomous GitHub Coding Agent.
Your role is to understand user engineering instructions, explore target repositories, formulate structured plans, implement verified code changes, run automated checks, and submit real Pull Requests to GitHub.

Capabilities & Guidelines:
1. USER INTENTS:
   - Specific Issue Target: If the user provides a GitHub issue URL (e.g. 'https://github.com/vercel/next.js/issues/123') or 'owner/repo#123', call 'get_specific_issue'.
   - Search Request: If the user asks for issues by language (TypeScript, React, Node, MongoDB), difficulty, topic, or organization, call 'search_issues'.
   - Autonomous Workflow: You can run the entire engineering workflow directly using 'execute_autonomous_task'. If the user names a specific company/organization (e.g. "cal.com", "vercel", "supabase"), pass its actual GitHub org handle as the 'company' parameter (e.g. cal.com's GitHub org is "calcom", not "cal.com") so discovery is restricted to that org instead of a generic tech-stack search.
2. REPOSITORY UNDERSTANDING:
   - Before modifying code, inspect repository architecture via 'get_repository_structure'.
   - Retrieve relevant source files via 'get_file_content' or search symbols via 'search_repository_code'.
   - Never fabricate file paths or hallucinate contents.
3. ENGINEERING PLAN:
   - Formulate a clear plan: root cause, target files, patch strategy, and test plan.
4. CODE IMPLEMENTATION & SECURITY:
   - Write clean, production-ready code with null-guards and error handling.
   - NEVER commit secrets, API keys, passwords, or .env files.
5. PULL REQUESTS:
   - Call 'create_pull_request' to fork, create a branch, commit the patch, and open a cross-repository PR.
   - If pre-flight re-validation indicates the issue was closed or assigned, notify the user immediately.`;

const geminiTools = [
  {
    functionDeclarations: [
      {
        name: 'search_issues',
        description: 'Search GitHub for open, unassigned issues across any technology, organization, or difficulty tier.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Search keywords, e.g. "strict null check", "aggregation pipeline"' },
            techStack: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Target tech stacks: React, TypeScript, Node.js, MongoDB' },
            company: { type: 'STRING', description: 'GitHub organization or company name e.g. vercel, facebook, mongodb' },
            repo: { type: 'STRING', description: 'Specific repository e.g. facebook/react' },
            difficulty: { type: 'STRING', enum: ['beginner', 'intermediate', 'advanced', 'all'], description: 'Difficulty tier' },
            issueType: { type: 'STRING', enum: ['bug', 'feature', 'documentation', 'test', 'all'], description: 'Type of issue' },
          },
        },
      },
      {
        name: 'get_specific_issue',
        description: 'Directly fetch and live-validate a specific GitHub issue by owner, repo, and issue number or URL.',
        parameters: {
          type: 'OBJECT',
          properties: {
            owner: { type: 'STRING', description: 'Repository owner e.g. vercel' },
            repo: { type: 'STRING', description: 'Repository name e.g. next.js' },
            issueNumber: { type: 'NUMBER', description: 'Issue number e.g. 4892' },
          },
          required: ['owner', 'repo', 'issueNumber'],
        },
      },
      {
        name: 'get_repository_structure',
        description: 'Explore repository file tree, package.json dependencies, and test framework.',
        parameters: {
          type: 'OBJECT',
          properties: {
            owner: { type: 'STRING', description: 'Repository owner' },
            repo: { type: 'STRING', description: 'Repository name' },
          },
          required: ['owner', 'repo'],
        },
      },
      {
        name: 'get_file_content',
        description: 'Retrieve the exact file content of a file in a GitHub repository.',
        parameters: {
          type: 'OBJECT',
          properties: {
            owner: { type: 'STRING', description: 'Repository owner' },
            repo: { type: 'STRING', description: 'Repository name' },
            filePath: { type: 'STRING', description: 'File path in repository e.g. src/index.ts' },
          },
          required: ['owner', 'repo', 'filePath'],
        },
      },
      {
        name: 'search_repository_code',
        description: 'Search for symbols, function names, or keywords across a repository.',
        parameters: {
          type: 'OBJECT',
          properties: {
            owner: { type: 'STRING', description: 'Repository owner' },
            repo: { type: 'STRING', description: 'Repository name' },
            query: { type: 'STRING', description: 'Search term or symbol name' },
          },
          required: ['owner', 'repo', 'query'],
        },
      },
      {
        name: 'execute_autonomous_task',
        description: 'Run the end-to-end autonomous engineering agent workflow (Discovery -> Plan -> Code -> Verify -> PR).',
        parameters: {
          type: 'OBJECT',
          properties: {
            instruction: { type: 'STRING', description: 'Natural language task or issue URL' },
            executionMode: { type: 'STRING', enum: ['analyze', 'fix', 'pr', 'autonomous'], description: 'Target mode' },
            company: { type: 'STRING', description: 'GitHub organization/company to restrict issue discovery to, if the user named one (e.g. "calcom" for cal.com, "vercel", "facebook"). Use the org\'s actual GitHub handle, not a display name.' },
          },
          required: ['instruction'],
        },
      },
      {
        name: 'create_pull_request',
        description: 'Autonomously fork repository, create branch, commit AI code fix, and open cross-repo Pull Request on GitHub with pre-flight re-validation.',
        parameters: {
          type: 'OBJECT',
          properties: {
            owner: { type: 'STRING', description: 'Repository owner' },
            repo: { type: 'STRING', description: 'Repository name' },
            issueNumber: { type: 'NUMBER', description: 'Target issue number' },
            filePath: { type: 'STRING', description: 'File path to update or create' },
            generatedCode: { type: 'STRING', description: 'Complete updated code content' },
            commitMessage: { type: 'STRING', description: 'Git commit message' },
            prTitle: { type: 'STRING', description: 'Pull Request title' },
            prBody: { type: 'STRING', description: 'Pull Request description and changelog' },
          },
          required: ['owner', 'repo', 'issueNumber', 'generatedCode'],
        },
      },
    ],
  },
];

function inferExecutionMode(text: string): 'analyze' | 'fix' | 'autonomous' {
  const lower = text.toLowerCase();
  if (lower.includes('analyze')) return 'analyze';
  if (lower.includes('fix only')) return 'fix';
  return 'autonomous';
}

export async function POST(req: NextRequest) {
  let userToken = '';
  let userKeys: string[] = [];
  let messages: any[] = [];

  const body = await req.json();
  messages = body.messages || [];
  userToken = body.userToken || '';
  userKeys = body.userKeys || [];

  const latestUserMessage = messages[messages.length - 1]?.content || 'Hello';

  // Deterministic Fast Path: a pasted issue URL / owner/repo#123 shorthand is
  // routed straight into the workflow instead of asking Gemini's own tool
  // router to notice it — that routing is an LLM judgment call and can (and
  // did) misfire on paraphrased prompts, silently landing on an unrelated
  // repository. A regex match on the user's literal text can't misfire.
  const specificTarget = parseIssueTarget(latestUserMessage);

  const encoder = new TextEncoder();
  // ReadableStream invokes `start` synchronously during construction, so
  // controllerRef is always assigned before send()/close() can run.
  let controllerRef!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });

  const send = (obj: any) => {
    controllerRef.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
  };

  const runFallback = async (reason: any) => {
    console.warn('[Gemini Engine Fallback Triggered]', reason?.message || reason);
    const userText = messages[messages.length - 1]?.content || '';
    const toolExecutions: any[] = [];

    const agentResult = await runAutonomousAgentWorkflow({
      userInput: userText,
      userToken,
      executionMode: inferExecutionMode(userText),
      onStepProgress: (step) => send({ type: 'step', step }),
    });

    if (agentResult.prResult) {
      toolExecutions.push({
        toolName: 'create_pull_request',
        status: agentResult.prResult.success ? 'completed' : 'cancelled',
        data: agentResult.prResult,
      });
    } else if (agentResult.issue) {
      toolExecutions.push({
        toolName: 'search_issues',
        status: 'completed',
        data: [agentResult.issue],
      });
    }

    send({
      type: 'final',
      text: agentResult.summaryMessage,
      toolExecutions,
      agentExecutionSteps: agentResult.executionSteps,
      rotationStatus: getRotationStatus(userKeys),
    });
  };

  (async () => {
    try {
      if (specificTarget) {
        const agentResult = await runAutonomousAgentWorkflow({
          userInput: latestUserMessage,
          userToken,
          executionMode: inferExecutionMode(latestUserMessage),
          onStepProgress: (step) => send({ type: 'step', step }),
        });

        const toolExecutions: any[] = [];
        if (agentResult.prResult) {
          toolExecutions.push({
            toolName: 'create_pull_request',
            status: agentResult.prResult.success ? 'completed' : 'cancelled',
            data: agentResult.prResult,
          });
        } else if (agentResult.issue) {
          toolExecutions.push({
            toolName: 'search_issues',
            status: 'completed',
            data: [agentResult.issue],
          });
        }

        send({
          type: 'final',
          text: agentResult.summaryMessage,
          toolExecutions,
          agentExecutionSteps: agentResult.executionSteps,
          rotationStatus: getRotationStatus(userKeys),
        });
        return;
      }

      const result = await runGeminiToolRouting();
      send({ type: 'final', ...result });
    } catch (error: any) {
      try {
        await runFallback(error);
      } catch (fallbackError: any) {
        send({ type: 'error', error: fallbackError?.message || 'MergeMate engine failed.' });
      }
    } finally {
      controllerRef.close();
    }
  })();

  async function runGeminiToolRouting() {
    // Attempt primary Gemini API function calling
    return executeWithRotation(async (apiKey) => {
      const genAI = new GoogleGenerativeAI(apiKey);
      
      const priorMessages = messages.slice(0, -1);
      let formattedHistory: { role: 'user' | 'model'; parts: { text: string }[] }[] = [];

      const firstUserIndex = priorMessages.findIndex((m: any) => m.role === 'user');
      if (firstUserIndex !== -1) {
        const validPrior = priorMessages.slice(firstUserIndex);
        validPrior.forEach((m: any) => {
          const role: 'user' | 'model' = m.role === 'user' ? 'user' : 'model';
          const text = m.content || '';
          if (!text.trim()) return;

          if (formattedHistory.length > 0 && formattedHistory[formattedHistory.length - 1].role === role) {
            formattedHistory[formattedHistory.length - 1].parts[0].text += `\n${text}`;
          } else {
            formattedHistory.push({ role, parts: [{ text }] });
          }
        });

        if (formattedHistory.length > 0 && formattedHistory[formattedHistory.length - 1].role === 'user') {
          formattedHistory.pop();
        }
      }

      // Google periodically sunsets pinned model versions outright (all four
      // of the previous candidates here have 404'd). Lead with the "-latest"
      // aliases Google maintains specifically to never break.
      const candidateModels = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-pro-latest', 'gemini-2.5-flash-lite'];
      let response: any = null;
      let activeChat: any = null;
      let lastModelError: any = null;

      for (const modelName of candidateModels) {
        try {
          const model = genAI.getGenerativeModel({
            model: modelName,
            systemInstruction: SYSTEM_PROMPT,
            tools: geminiTools as any,
          });

          activeChat = model.startChat({ history: formattedHistory });
          response = await activeChat.sendMessage(latestUserMessage);
          if (response) {
            console.log(`[Gemini Engine] Successfully connected using model: ${modelName}`);
            break;
          }
        } catch (err: any) {
          lastModelError = err;
          console.warn(`[Gemini Model Fallback] Model ${modelName} returned: ${err?.message}`);
        }
      }

      if (!response || !activeChat) {
        throw lastModelError || new Error('All Gemini model fallbacks failed.');
      }

      let responseText = '';
      const toolExecutions: any[] = [];

      const functionCalls = response.response.functionCalls();

      if (functionCalls && functionCalls.length > 0) {
        for (const call of functionCalls) {
          const name = call.name;
          const args = call.args as Record<string, any>;
          console.log(`[Gemini Tool Executing] ${name}`, args);

          let toolOutput: any = null;

          if (name === 'search_issues') {
            const issues = await searchIssues({
              query: args.query,
              techStack: args.techStack,
              company: args.company,
              repo: args.repo,
              difficulty: args.difficulty,
              issueType: args.issueType,
              userToken,
            });
            toolOutput = { issuesCount: issues.length, issues };
            toolExecutions.push({
              toolName: 'search_issues',
              status: 'completed',
              data: issues,
            });
          } else if (name === 'get_specific_issue') {
            const { issue, validation } = await fetchAndValidateSpecificIssue(
              args.owner,
              args.repo,
              Number(args.issueNumber),
              userToken
            );
            toolOutput = { issue, validation };
            toolExecutions.push({
              toolName: 'get_specific_issue',
              status: validation.isValid ? 'completed' : 'failed',
              data: issue ? [issue] : validation,
            });
          } else if (name === 'get_repository_structure') {
            const structure = await getRepoStructure(args.owner, args.repo, userToken);
            toolOutput = structure;
            toolExecutions.push({
              toolName: 'get_repository_structure',
              status: 'completed',
              data: structure,
            });
          } else if (name === 'get_file_content') {
            const file = await getFileContent(args.owner, args.repo, args.filePath, undefined, userToken);
            toolOutput = file;
            toolExecutions.push({
              toolName: 'get_file_content',
              status: file ? 'completed' : 'failed',
              data: file,
            });
          } else if (name === 'search_repository_code') {
            const codeResults = await searchCodeInRepo(args.owner, args.repo, args.query, userToken);
            toolOutput = codeResults;
            toolExecutions.push({
              toolName: 'search_repository_code',
              status: 'completed',
              data: codeResults,
            });
          } else if (name === 'execute_autonomous_task') {
            const agentResult = await runAutonomousAgentWorkflow({
              userInput: args.instruction || latestUserMessage,
              userToken,
              executionMode: args.executionMode || 'autonomous',
              targetOrg: args.company || undefined,
              onStepProgress: (step) => send({ type: 'step', step }),
            });
            toolOutput = agentResult;
            toolExecutions.push({
              toolName: 'execute_autonomous_task',
              status: agentResult.success ? 'completed' : 'failed',
              data: agentResult,
            });
          } else if (name === 'create_pull_request') {
            const prResult = await createPR({
              owner: args.owner,
              repo: args.repo,
              issueNumber: Number(args.issueNumber),
              generatedCode: args.generatedCode,
              filePath: args.filePath || 'src/index.ts',
              commitMessage: args.commitMessage,
              prTitle: args.prTitle,
              prBody: args.prBody,
              userToken,
            });
            toolOutput = prResult;
            toolExecutions.push({
              toolName: 'create_pull_request',
              status: prResult.success ? 'completed' : 'cancelled',
              data: prResult,
            });
          }

          if (toolOutput) {
            response = await activeChat.sendMessage([
              {
                functionResponse: {
                  name,
                  response: toolOutput,
                },
              },
            ]);
          }
        }
      }

      responseText = response.response.text();
      const newInteractionId = `int_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      return {
        text: responseText,
        toolExecutions,
        interactionId: newInteractionId,
        rotationStatus: getRotationStatus(userKeys),
      };
    }, userKeys);
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    rotator: getRotationStatus(),
    githubConfigured: Boolean(process.env.GITHUB_TOKEN && !process.env.GITHUB_TOKEN.includes('your_github_token')),
  });
}
