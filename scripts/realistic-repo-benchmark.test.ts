/**
 * MergeMate Real-World Multi-File Autonomous Engineering Benchmark
 * Evaluates the full end-to-end multi-file autonomous engineering loop:
 * - Multi-file discovery (types.ts, QueueProcessor.ts, QueueProcessor.test.ts)
 * - Coordinated patch generation & atomic application
 * - Path traversal & absolute path rejection
 * - Cross-file failure capture & self-healing repair
 * - Single atomic Git commit payload across all modified files
 */

import {
  parseIssueTarget,
  scanDiffForSecurityRisks,
  scoreIssueCandidate,
  validateIssueCandidate,
  fetchAndValidateSpecificIssue,
  validateFinalDiff,
  validateMultiFileDiffSet,
  FilePatchOperation,
  GitHubIssueItem,
} from '../lib/github';
import {
  runAutonomousAgentWorkflow,
  verifyCodeSyntaxAndTypes,
  findTargetedTestFiles,
  parseLocalImports,
  detectIneffectivePatch,
  evaluateFinalPRDecision,
  EngineeringPlan,
  MultiFilePatchSet,
  VerificationResult,
} from '../lib/agentOrchestrator';
import {
  isCommandSafe,
  sanitizeOutput,
  classifyExecutionFailure,
  buildVerificationPlan,
} from '../lib/safeExecutor';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Benchmark Assertion Failed: ${message}`);
  }
}

// Realistic Multi-File Repository Mock Factory
function createMultiFileRepositoryMock() {
  const fileSystem: Record<string, string> = {
    'package.json': JSON.stringify({
      name: 'async-queue-engine',
      version: '1.4.0',
      scripts: {
        test: 'vitest run',
        'test:unit': 'vitest run',
        lint: 'eslint src/',
        typecheck: 'tsc --noEmit',
        build: 'tsup src/index.ts',
      },
      dependencies: { debug: '^4.3.4' },
      devDependencies: { typescript: '^5.6.3', vitest: '^2.1.3', eslint: '^9.13.0' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: 5.4\n',
    'tsconfig.json': JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', strict: true },
    }),
    'src/index.ts': 'export * from "./QueueProcessor";\nexport * from "./types";\n',
    'src/types.ts': `
export interface Task<T = unknown> {
  id: string;
  payload: T;
  priority?: number;
}

export interface ProcessorOptions {
  timeoutMs?: number;
  concurrency?: number;
}
`,
    'src/QueueProcessor.ts': `
import { Task, ProcessorOptions } from './types';

export class QueueProcessor {
  private queue: Task[] = [];
  private options: ProcessorOptions;

  constructor(options: ProcessorOptions = {}) {
    this.options = options;
  }

  public enqueue(task: Task): void {
    if (!task.id) throw new Error("Task id is required");
    this.queue.push(task);
  }

  public async drain(): Promise<number> {
    if (this.queue.length === 0) {
      return 0;
    }
    let count = 0;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) count++;
    }
    return count;
  }
}
`,
    'src/QueueProcessor.test.ts': `
import { describe, it, expect } from 'vitest';
import { QueueProcessor } from './QueueProcessor';

describe('QueueProcessor', () => {
  it('handles empty queue without deadlocking', async () => {
    const q = new QueueProcessor();
    const count = await q.drain();
    expect(count).toBe(0);
  });

  it('drains enqueued tasks', async () => {
    const q = new QueueProcessor();
    q.enqueue({ id: '1', payload: 'data' });
    const count = await q.drain();
    expect(count).toBe(1);
  });
});
`,
  };

  const fileTree = Object.keys(fileSystem);

  const mockOctokit = {
    rest: {
      issues: {
        get: async ({ owner, repo, issue_number }: any) => ({
          data: {
            id: 42,
            number: issue_number || 42,
            title: 'Add optional timeout option to QueueProcessor and update types',
            body: 'Need to add timeoutMs to ProcessorOptions in types.ts and respect it in QueueProcessor.ts drain method.',
            state: 'open',
            state_reason: null,
            assignee: null,
            assignees: [],
            comments: 2,
            labels: [{ name: 'enhancement' }, { name: 'TypeScript' }],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            html_url: `https://github.com/${owner}/${repo}/issues/${issue_number || 42}`,
          },
        }),
      },
      repos: {
        get: async ({ owner, repo }: any) => ({
          data: {
            id: 8888,
            name: repo,
            owner: { login: owner },
            archived: false,
            disabled: false,
            default_branch: 'main',
            language: 'TypeScript',
          },
        }),
        getContent: async ({ owner, repo, path }: any) => {
          if (fileSystem[path]) {
            return {
              data: {
                path,
                content: Buffer.from(fileSystem[path]).toString('base64'),
                sha: 'blob-sha-12345',
              },
            };
          }
          const err: any = new Error(`File ${path} not found`);
          err.status = 404;
          throw err;
        },
      },
      git: {
        getTree: async () => ({
          data: {
            tree: fileTree.map(f => ({ type: 'blob', path: f })),
          },
        }),
      },
      search: {
        issuesAndPullRequests: async () => ({
          data: { total_count: 0, items: [] },
        }),
      },
    },
  } as any;

  return { fileSystem, fileTree, mockOctokit };
}

async function runMultiFileBenchmark() {
  console.log('\n===============================================================');
  console.log('🏆 MERGEMATE MULTI-FILE AUTONOMOUS ENGINEERING BENCHMARK');
  console.log('===============================================================\n');

  let passed = 0;
  const total = 10;

  // -------------------------------------------------------------
  // Test 1: Local Import Dependency Discovery
  // -------------------------------------------------------------
  try {
    console.log('Test 1: Local Import & Dependency Graph Discovery...');
    const { fileSystem, fileTree } = createMultiFileRepositoryMock();
    const imports = parseLocalImports(fileSystem['src/QueueProcessor.ts'], 'src/QueueProcessor.ts', fileTree);
    assert(imports.includes('src/types.ts'), 'Expected src/types.ts to be discovered via imports');

    console.log(`  ✅ Passed: Automatically traced local import from QueueProcessor.ts ➔ ${imports.join(', ')}`);
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 1 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 2: Multi-File Targeted Test Discovery
  // -------------------------------------------------------------
  try {
    console.log('Test 2: Multi-File Targeted Test Suite Discovery...');
    const { fileTree } = createMultiFileRepositoryMock();
    const tests = findTargetedTestFiles(['src/QueueProcessor.ts', 'src/types.ts'], fileTree);
    assert(tests.includes('src/QueueProcessor.test.ts'), 'Expected QueueProcessor.test.ts to be discovered');

    console.log(`  ✅ Passed: Discovered relevant test suites across target files: ${tests.join(', ')}`);
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 2 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 3: Multi-File Diff Validation (3-File Coordinated Patch)
  // -------------------------------------------------------------
  try {
    console.log('Test 3: Multi-File Diff Validation & Bounds Enforcement...');
    const changes: FilePatchOperation[] = [
      { filePath: 'src/types.ts', operation: 'modify', content: 'export interface ProcessorOptions { timeoutMs?: number; }', previousContent: 'export interface ProcessorOptions {}' },
      { filePath: 'src/QueueProcessor.ts', operation: 'modify', content: 'export class QueueProcessor { /* with timeout */ }', previousContent: 'export class QueueProcessor {}' },
      { filePath: 'src/QueueProcessor.test.ts', operation: 'modify', content: 'it("respects timeout", () => {});', previousContent: 'it("handles empty", () => {});' },
    ];

    const diffVal = validateMultiFileDiffSet(changes);
    assert(diffVal.isValid === true, 'Expected 3-file diff to be valid');
    assert(diffVal.filesChanged === 3, 'Expected 3 files changed');
    assert(diffVal.totalLinesAdded > 0, 'Expected lines added');

    console.log(`  ✅ Passed: Validated multi-file diff set (${diffVal.diffSummary})`);
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 3 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 4: Path Traversal & Absolute Path Protection
  // -------------------------------------------------------------
  try {
    console.log('Test 4: Path Traversal & Unsafe Path Rejection...');
    const unsafeChanges: FilePatchOperation[] = [
      { filePath: '../../etc/passwd', operation: 'modify', content: 'root:x:0:0:' },
      { filePath: '/var/log/system.log', operation: 'create', content: 'hacked' },
    ];

    const diffVal = validateMultiFileDiffSet(unsafeChanges);
    assert(diffVal.isValid === false, 'Expected path traversal to be rejected');
    assert(diffVal.errors.some(e => e.includes('Unsafe file path')), 'Expected unsafe file path error');

    console.log('  ✅ Passed: Blocked path traversal and absolute path modification attempts');
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 4 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 5: Secret Scanner Across Multi-File Changeset
  // -------------------------------------------------------------
  try {
    console.log('Test 5: Secret & Credential Scanner Across Multi-File Changeset...');
    const secretChanges: FilePatchOperation[] = [
      { filePath: 'src/types.ts', operation: 'modify', content: 'export const SAFE = true;' },
      { filePath: 'src/config.ts', operation: 'create', content: 'export const GITHUB_KEY = "ghp_123456789012345678901234567890123456";' },
    ];

    const diffVal = validateMultiFileDiffSet(secretChanges);
    assert(diffVal.isValid === false, 'Expected secret in multi-file changeset to be caught');
    assert(diffVal.errors.some(e => e.includes('Security violation in src/config.ts')), 'Expected security violation error');

    console.log('  ✅ Passed: Multi-file security scan caught leaked token in auxiliary file');
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 5 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 6: Cross-File AST Syntax Verification
  // -------------------------------------------------------------
  try {
    console.log('Test 6: Cross-File AST Syntax Verification...');
    const validFile1 = 'export interface Config { timeout: number; }';
    const brokenFile2 = 'export class Processor { constructor( { }'; // broken syntax

    const ast1 = verifyCodeSyntaxAndTypes(validFile1, 'src/types.ts');
    const ast2 = verifyCodeSyntaxAndTypes(brokenFile2, 'src/QueueProcessor.ts');

    assert(ast1.isValid === true, 'Expected valid file 1 to pass AST');
    assert(ast2.isValid === false, 'Expected broken file 2 to be caught by AST');

    console.log(`  ✅ Passed: AST verified valid types and caught broken syntax in dependent file (${ast2.errors[0]})`);
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 6 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 7: Full End-to-End Multi-File Workflow with Self-Healing Repair
  // -------------------------------------------------------------
  try {
    console.log('Test 7: Full Multi-File Workflow with Coordinated Self-Healing...');
    let attemptCounter = 0;
    const executedStates: string[] = [];

    const result = await runAutonomousAgentWorkflow({
      userInput: 'Fix issue in facebook/react for QueueProcessor timeout options and update types',
      executionMode: 'autonomous',
      mockCommandExecutor: async (cmd) => {
        attemptCounter++;
        // Attempt 1: Simulate cross-file test failure
        if (attemptCounter === 1) {
          return {
            command: cmd,
            exitCode: 1,
            stdout: 'FAIL src/QueueProcessor.test.ts\n● QueueProcessor › timeout\n  AssertionError: timeoutMs not defined on ProcessorOptions',
            stderr: '',
            durationMs: 90,
            timedOut: false,
            failureCategory: 'TEST_FAILURE',
          };
        }
        // Attempt 2: Both types.ts and QueueProcessor.ts repaired
        return {
          command: cmd,
          exitCode: 0,
          stdout: 'PASS src/QueueProcessor.test.ts (3 tests passed)\nTypecheck: 0 errors across 3 files',
          stderr: '',
          durationMs: 120,
          timedOut: false,
          failureCategory: 'NONE',
        };
      },
      onStepProgress: (step) => executedStates.push(step.state),
    });

    assert(result.success === true, 'Expected multi-file workflow to succeed');
    assert(result.verification.passed === true, 'Expected verification to pass');
    assert(result.patchSet.changes.length >= 2, `Expected >= 2 coordinated files in changeset, got ${result.patchSet.changes.length}`);
    assert(result.prResult !== null, 'Expected PR result to be generated');

    console.log(`  ✅ Passed: Coordinated multi-file repair fixed ${result.patchSet.changes.length} files on Attempt ${result.verification.attempt}`);
    console.log(`     States executed: ${executedStates.join(' ➔ ')}`);
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 7 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 8: Negative Control — Multi-File Failure Halts PR
  // -------------------------------------------------------------
  try {
    console.log('Test 8: Negative Control — Unresolvable Multi-File Bug Halts PR Creation...');
    const result = await runAutonomousAgentWorkflow({
      userInput: 'Fix issue in facebook/react for QueueProcessor timeout options and update types',
      executionMode: 'autonomous',
      mockCommandExecutor: async (cmd) => ({
        command: cmd,
        exitCode: 1,
        stdout: 'FAIL src/QueueProcessor.test.ts (AssertionError: cyclic interface failure)',
        stderr: '',
        durationMs: 90,
        timedOut: false,
        failureCategory: 'TEST_FAILURE',
      }),
    });

    assert(result.success === false, 'Expected workflow to fail after 3 attempts');
    assert(result.state === 'FAILED', `Expected state FAILED, got ${result.state}`);
    assert(result.prResult === null, 'Expected NO PR to be created for failing multi-file code');

    console.log('  ✅ Passed: Halted PR creation and reported honest failure when multi-file tests failed after max repairs');
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 8 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 9: Multi-File PR Body Verification Table
  // -------------------------------------------------------------
  try {
    console.log('Test 9: Multi-File PR Body Table & Summary Generation...');
    const result = await runAutonomousAgentWorkflow({
      userInput: 'Analyze issue #8931 in facebook/react for multi-file timeout update',
      executionMode: 'analyze',
    });

    assert(result.success === true, 'Expected analyze workflow to succeed');
    assert(result.plan !== null, 'Expected engineering plan');
    assert(result.targetFiles.length > 0, 'Expected target files in plan');

    console.log(`  ✅ Passed: Multi-file engineering plan constructed:`);
    console.log(`     - Target Files: ${result.targetFiles.join(', ')}`);
    console.log(`     - Strategy:     ${result.plan?.patchStrategy}`);
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 9 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 10: Atomic Application & Changeset Integrity
  // -------------------------------------------------------------
  try {
    console.log('Test 10: Atomic Changeset Integrity & Conflict Marker Rejection...');
    const changesWithConflict: FilePatchOperation[] = [
      { filePath: 'src/types.ts', operation: 'modify', content: 'export const SAFE = true;' },
      { filePath: 'src/QueueProcessor.ts', operation: 'modify', content: '<<<<<<< HEAD\nexport class Broken {}\n=======\nexport class Fixed {}\n>>>>>>> master' },
    ];

    const diffVal = validateMultiFileDiffSet(changesWithConflict);
    assert(diffVal.isValid === false, 'Expected changeset with merge conflict to be rejected');
    assert(diffVal.errors.some(e => e.includes('contains Git merge conflict markers')), 'Expected conflict marker error');

    console.log('  ✅ Passed: Rejected changeset containing conflict markers across multi-file tree');
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 10 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 11: Ineffective Patch & Dead State Detection
  // -------------------------------------------------------------
  try {
    console.log('Test 11: Ineffective Patch & Dead State Variable Detection...');
    const deadCodePatch = `
import React, { useState, useEffect, useRef } from 'react';

export default function MermaidDiagram() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false); // Declared but never read!

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setIsVisible(true);
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef} className="mermaid">graph LR; a-->b;</div>;
}
`;
    const check = detectIneffectivePatch(deadCodePatch, 'packages/docusaurus-theme-mermaid/src/Mermaid.tsx');
    assert(check.isEffective === false, 'Expected dead state isVisible to be flagged as ineffective');
    assert(check.issues.some(i => i.includes('isVisible')), 'Expected isVisible issue warning');

    console.log(`  ✅ Passed: Flagged ineffective patch (${check.issues[0]})`);
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 11 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 12: Browser-Dependent UI Bug Downgrades to NEEDS_HUMAN_REVIEW
  // -------------------------------------------------------------
  try {
    console.log('Test 12: Browser-Dependent UI/SVG Bug Downgrades to NEEDS_HUMAN_REVIEW...');
    const docusaurusIssue: GitHubIssueItem = {
      id: 8357,
      number: 8357,
      title: 'Mermaid in tabs. The arrows are not displayed in the second tab',
      body: 'Arrow markers disappear inside inactive TabItem containers.',
      url: 'https://github.com/facebook/docusaurus/issues/8357',
      html_url: 'https://github.com/facebook/docusaurus/issues/8357',
      state: 'open',
      comments_count: 8,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner: 'facebook',
      repo: 'docusaurus',
      repo_full_name: 'facebook/docusaurus',
      labels: ['bug'],
      tech_stack: ['TypeScript'],
      score: 100,
      confidence: 'high',
      estimated_solvability: 'high',
      difficulty_tier: 'intermediate',
      is_unassigned: true,
    };

    const docusaurusPlan: EngineeringPlan = {
      issueUnderstanding: 'Mermaid diagram arrow markers fail to render in hidden tabs',
      rootCauseHypothesis: 'Mermaid SVG marker IDs and bounding boxes fail when rendering in inactive tabs',
      filesToModify: [{ path: 'packages/docusaurus-theme-mermaid/src/Mermaid.tsx', purpose: 'Render fix', changes: 'Visibility check' }],
      filesToCreate: [],
      filesToDelete: [],
      targetFiles: ['packages/docusaurus-theme-mermaid/src/Mermaid.tsx'],
      targetedTestFiles: [],
      patchStrategy: 'Add visibility re-render',
      testStrategy: 'Static check only',
      potentialRisks: ['Browser layout verification required'],
    };

    const docusaurusPatches: MultiFilePatchSet = {
      changes: [{
        filePath: 'packages/docusaurus-theme-mermaid/src/Mermaid.tsx',
        operation: 'modify',
        content: 'export default function Mermaid() { return <div className="mermaid" />; }',
      }],
      summary: 'Mermaid patch',
    };

    const staticOnlyVerification: VerificationResult = {
      passed: true,
      attempt: 1,
      syntaxValid: true,
      typeCheckValid: true,
      testsPassed: true,
      securitySafe: true,
      diffValid: true,
      report: {
        targetedTests: 'skipped',
        fullTests: 'skipped',
        typecheck: 'passed',
        lint: 'skipped',
        build: 'skipped',
        preExistingFailures: [],
        newFailures: [],
        environmentLimitations: ['Browser environment unavailable'],
        commandsExecuted: [],
      },
      logs: ['Typecheck passed'],
    };

    const decision = evaluateFinalPRDecision(docusaurusIssue, docusaurusPlan, docusaurusPatches, staticOnlyVerification);
    assert(decision.finalDecision === 'SOLVABLE — NEEDS HUMAN REVIEW', `Expected NEEDS_HUMAN_REVIEW for browser bug, got ${decision.finalDecision}`);
    assert(decision.requiredVerificationLevel === 'BROWSER', `Expected BROWSER level, got ${decision.requiredVerificationLevel}`);

    console.log(`  ✅ Passed: Correctly downgraded browser-dependent bug to "${decision.finalDecision}"`);
    console.log(`     Reason: ${decision.decisionReason}`);
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 12 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 13: Behavioral Unit Verification Yields READY_FOR_PR
  // -------------------------------------------------------------
  try {
    console.log('Test 13: Behavioral Unit Verification Yields READY_FOR_PR...');
    const unitIssue: GitHubIssueItem = {
      id: 42,
      number: 42,
      title: 'QueueProcessor deadlocks on empty queue',
      body: 'QueueProcessor.drain() hangs when queue length is 0',
      url: 'https://github.com/engine/async-queue/issues/42',
      html_url: 'https://github.com/engine/async-queue/issues/42',
      state: 'open',
      comments_count: 2,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner: 'engine',
      repo: 'async-queue',
      repo_full_name: 'engine/async-queue',
      labels: ['bug'],
      tech_stack: ['TypeScript'],
      score: 95,
      confidence: 'high',
      estimated_solvability: 'high',
      difficulty_tier: 'beginner',
      is_unassigned: true,
    };

    const unitPlan: EngineeringPlan = {
      issueUnderstanding: 'Deadlock on empty queue',
      rootCauseHypothesis: 'Missing early return when queue length is 0',
      filesToModify: [{ path: 'src/QueueProcessor.ts', purpose: 'Fix deadlock', changes: 'Early return' }],
      filesToCreate: [],
      filesToDelete: [],
      targetFiles: ['src/QueueProcessor.ts', 'src/QueueProcessor.test.ts'],
      targetedTestFiles: ['src/QueueProcessor.test.ts'],
      patchStrategy: 'Early return guard',
      testStrategy: 'Vitest unit tests',
      potentialRisks: [],
    };

    const unitPatches: MultiFilePatchSet = {
      changes: [
        { filePath: 'src/QueueProcessor.ts', operation: 'modify', content: 'export class QueueProcessor { drain() { return 0; } }' },
        { filePath: 'src/QueueProcessor.test.ts', operation: 'modify', content: 'it("handles empty", () => {});' },
      ],
      summary: 'Fix deadlock',
    };

    const unitVerification: VerificationResult = {
      passed: true,
      attempt: 1,
      syntaxValid: true,
      typeCheckValid: true,
      testsPassed: true,
      securitySafe: true,
      diffValid: true,
      report: {
        targetedTests: 'passed',
        fullTests: 'passed',
        typecheck: 'passed',
        lint: 'passed',
        build: 'passed',
        preExistingFailures: [],
        newFailures: [],
        environmentLimitations: [],
        commandsExecuted: [],
      },
      logs: ['Unit tests passed'],
    };

    const decision = evaluateFinalPRDecision(unitIssue, unitPlan, unitPatches, unitVerification);
    assert(decision.finalDecision === 'SOLVABLE — READY FOR PR', `Expected READY_FOR_PR, got ${decision.finalDecision}`);
    assert(decision.bugFixVerified === true, 'Expected bugFixVerified to be true');

    console.log(`  ✅ Passed: Verified unit fix promoted to "${decision.finalDecision}" (${decision.decisionReason})`);
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 13 Failed:', e.message);
  }

  // -------------------------------------------------------------
  // Test 14: Failed Validation Yields NOT_SOLVABLE
  // -------------------------------------------------------------
  try {
    console.log('Test 14: Failed Validation Yields NOT_SOLVABLE...');
    const brokenVerification: VerificationResult = {
      passed: false,
      attempt: 3,
      syntaxValid: false,
      typeCheckValid: false,
      testsPassed: false,
      securitySafe: false,
      diffValid: false,
      report: {
        targetedTests: 'failed',
        fullTests: 'failed',
        typecheck: 'failed',
        lint: 'not_run',
        build: 'not_run',
        preExistingFailures: [],
        newFailures: [],
        environmentLimitations: [],
        commandsExecuted: [],
      },
      logs: ['Syntax error'],
    };

    const decision = evaluateFinalPRDecision(
      { id: 1, number: 1, title: 'Bug', body: '', url: '', html_url: '', state: 'open', comments_count: 0, created_at: '', updated_at: '', owner: 'o', repo: 'r', repo_full_name: 'o/r', labels: [], tech_stack: [] },
      { issueUnderstanding: '', rootCauseHypothesis: '', filesToModify: [], filesToCreate: [], filesToDelete: [], targetFiles: ['src/App.ts'], targetedTestFiles: [], patchStrategy: '', testStrategy: '', potentialRisks: [] },
      { changes: [{ filePath: 'src/App.ts', operation: 'modify', content: 'broken' }], summary: '' },
      brokenVerification
    );

    assert(decision.finalDecision === 'NOT SOLVABLE', `Expected NOT SOLVABLE, got ${decision.finalDecision}`);

    console.log(`  ✅ Passed: Correctly classified failed validation as "${decision.finalDecision}"`);
    passed++;
  } catch (e: any) {
    console.error('  ❌ Test 14 Failed:', e.message);
  }

  const finalTotal = 14;
  console.log('\n===============================================================');
  console.log(`📊 BENCHMARK & PR GATE RESULTS: ${passed}/${finalTotal} PASSED (${Math.round((passed / finalTotal) * 100)}%)`);
  console.log('===============================================================\n');

  if (passed !== finalTotal) {
    process.exit(1);
  }
}

runMultiFileBenchmark();
