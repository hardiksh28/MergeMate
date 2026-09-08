/**
 * MergeMate Browser Agent — Generic AI Planning Loop
 *
 * Drives a live browser session toward an arbitrary natural-language goal:
 *
 *   observe (PageInspector via ActionExecutor's 'inspect')
 *     -> decide (ask the existing Gemini LLM for exactly one next action)
 *     -> act (ActionExecutor, unchanged — retries, ConfirmationGate, ActivityLog)
 *     -> observe again
 *     -> repeat until the LLM reports the task done, or a bound is hit
 *
 * This module is deliberately independent of GitHub and of the Coding Agent
 * pipeline (lib/agentOrchestrator.ts, lib/github.ts) — it knows nothing about
 * issues, repos, or pull requests. It only knows how to pursue a goal inside a
 * browser. It does not reimplement session management, streaming, inspection,
 * action execution, confirmation gating, or activity logging — it composes the
 * existing browserController on top of all of that.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { executeWithRotation } from '../geminiRotator';
import { browserController } from './browserController';
import { pushActivityEvent } from './activityLog';
import {
  BrowserAgentTaskOptions,
  BrowserAgentTaskResult,
  BrowserAgentTaskStepRecord,
  PageSnapshot,
  PlannerDecision,
  StructuredAction,
  DEFAULT_TASK_MAX_STEPS,
  HARD_CAP_TASK_STEPS,
  MAX_CONSECUTIVE_ACTION_FAILURES,
  MAX_PLANNER_PARSE_RETRIES,
} from './types';

// Gemini periodically sunsets pinned model versions outright (gemini-1.5-flash
// and even gemini-2.5-pro have both 404'd during development of this file).
// Lead with the "-latest" aliases Google maintains specifically to never
// break, then fall back to concrete versions as extra quota-diverse options —
// never hardcode a single pinned model name for this loop.
const PLANNER_MODEL_CANDIDATES = [
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-flash-lite-latest',
  'gemini-2.5-flash-lite',
  'gemini-pro-latest',
];

// Distinguishes errors worth retrying/falling back from ones that never will
// be (bad request, auth failure) — no point burning the step/time budget on those.
const MODEL_UNAVAILABLE_PATTERN = /404|not found|not supported/i;
const TRANSIENT_ERROR_PATTERN = /503|500|overloaded|unavailable|high demand|internal error|deadline exceeded/i;
// Gemini's free-tier quota is tracked per-model, not per-key — rotating API
// keys (handled by the shared geminiRotator) does nothing for this, since all
// configured keys typically belong to the same billed project. Falling back
// to a different model is what actually finds fresh quota.
const QUOTA_EXCEEDED_PATTERN = /429|quota exceeded|resource_exhausted|too many requests/i;
const MAX_TRANSIENT_RETRIES_PER_MODEL = 2;
const TRANSIENT_RETRY_BASE_DELAY_MS = 1200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PLANNER_ACTION_MENU = `
- {"action":"click","target":"<accessible name or visible text of the element>"}
- {"action":"type","target":"<accessible name or visible text of the input>","text":"<text to type>"}
- {"action":"select","target":"<accessible name or visible text of the dropdown>","value":"<visible option label>"}
- {"action":"scroll","direction":"up"|"down"|"left"|"right","amount":<pixels, e.g. 500>}
- {"action":"wait","target":"<text to wait for>","timeoutMs":<milliseconds, max 15000>}
- {"action":"navigate","url":"<absolute http(s) URL>"}
- {"action":"screenshot"}`.trim();

function describeElement(el: PageSnapshot['elements'][number]): string {
  const bits = [`${el.role} "${el.name}"`];
  if (el.value) bits.push(`value="${el.value}"`);
  if (el.checked !== undefined) bits.push(el.checked ? 'checked' : 'unchecked');
  if (el.disabled) bits.push('disabled');
  return bits.join(' ');
}

function buildPrompt(task: string, snapshot: PageSnapshot, history: BrowserAgentTaskStepRecord[]): string {
  const elementsList = snapshot.elements.length > 0
    ? snapshot.elements.map((el) => `- ${describeElement(el)}`).join('\n')
    : '(no interactive elements detected)';

  const historyList = history.length > 0
    ? history
        .map((h) => {
          const actionDesc = h.action
            ? `${h.action.action}${h.action.target ? ` "${h.action.target}"` : ''}${h.action.url ? ` ${h.action.url}` : ''}`
            : '(none)';
          return `Step ${h.step}: ${actionDesc} -> ${h.success ? 'SUCCEEDED' : 'FAILED'} (${h.message || ''})`;
        })
        .join('\n')
    : '(no steps taken yet)';

  return `You are a browser automation planner. You control a real web browser through a small, fixed set of structured actions. On each turn you must choose exactly ONE next action that makes progress toward the task, or declare the task complete.

TASK: "${task}"

AVAILABLE ACTIONS (choose exactly one, or declare done):
${PLANNER_ACTION_MENU}

CURRENT PAGE:
URL: ${snapshot.url}
Title: ${snapshot.title}
Visible text (truncated):
${snapshot.visibleText.slice(0, 1500) || '(empty)'}

INTERACTIVE ELEMENTS:
${elementsList}

STEP HISTORY (most recent last):
${historyList}

Respond with ONLY a single JSON object and nothing else — no markdown fences, no commentary. It must match exactly one of these three shapes:
{"done": false, "action": <one action object from the menu above>, "reasoning": "<one short sentence>"}
{"done": true, "success": true, "summary": "<one short sentence on what was accomplished>"}
{"done": true, "success": false, "summary": "<one short sentence on why the task cannot be completed on this page>"}

Rules:
- If the visible text or page state shows the task is already accomplished, return {"done": true, "success": true, ...} immediately.
- Only return {"done": true, "success": false, ...} once you are genuinely confident the task cannot be done here — e.g. a required element has already failed to be found after a retry (see step history), or the page fundamentally lacks the capability the task asks for. Do not give up after a single untried idea; a required element simply not being visible yet is not proof it doesn't exist.
- "target" must match the accessible name or visible text of an element actually listed above — never invent one.
- Do not repeat an action that already failed in the step history in the exact same way; try a different target or approach instead.
- Prefer the smallest, most specific next step over a large or speculative one.`;
}

function parsePlannerResponse(raw: string): PlannerDecision | null {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.done !== 'boolean') return null;
    if (parsed.done === false && (!parsed.action || typeof parsed.action.action !== 'string')) return null;
    return parsed as PlannerDecision;
  } catch {
    return null;
  }
}

async function generateWithModelFallback(genAI: GoogleGenerativeAI, prompt: string): Promise<string> {
  let lastError: any = null;

  for (const modelName of PLANNER_MODEL_CANDIDATES) {
    const model = genAI.getGenerativeModel({ model: modelName });

    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES_PER_MODEL; attempt++) {
      try {
        const res = await model.generateContent(prompt);
        return res.response.text();
      } catch (err: any) {
        lastError = err;
        const message = String(err?.message || err);
        const isTransient = TRANSIENT_ERROR_PATTERN.test(message);

        if (isTransient && attempt < MAX_TRANSIENT_RETRIES_PER_MODEL) {
          await sleep(TRANSIENT_RETRY_BASE_DELAY_MS * (attempt + 1));
          continue;
        }

        const isModelUnavailable = MODEL_UNAVAILABLE_PATTERN.test(message);
        const isQuotaExceeded = QUOTA_EXCEEDED_PATTERN.test(message);
        // Move on to the next candidate model for a retired/renamed model, a
        // still-overloaded one, or one whose per-model quota is exhausted;
        // anything else (auth, bad request) won't be fixed by switching
        // models, so surface it immediately.
        if (isModelUnavailable || isTransient || isQuotaExceeded) break;
        throw err;
      }
    }
  }

  throw lastError || new Error('All planner model candidates are unavailable.');
}

async function askPlanner(
  task: string,
  snapshot: PageSnapshot,
  history: BrowserAgentTaskStepRecord[],
  userKeys?: string[]
): Promise<PlannerDecision> {
  const prompt = buildPrompt(task, snapshot, history);

  let lastRaw = '';
  for (let attempt = 0; attempt <= MAX_PLANNER_PARSE_RETRIES; attempt++) {
    const effectivePrompt = attempt === 0
      ? prompt
      : `${prompt}\n\nYour previous response could not be parsed as valid JSON:\n${lastRaw}\n\nRespond again with ONLY the raw JSON object, no markdown fences, no extra text.`;

    const decision = await executeWithRotation(async (apiKey) => {
      const genAI = new GoogleGenerativeAI(apiKey);
      const text = await generateWithModelFallback(genAI, effectivePrompt);
      lastRaw = text;
      const parsed = parsePlannerResponse(text);
      if (!parsed) {
        throw new Error('PLANNER_PARSE_FAILURE');
      }
      return parsed;
    }, userKeys).catch((err: any) => {
      if (err?.message === 'PLANNER_PARSE_FAILURE') return null;
      throw err;
    });

    if (decision) return decision;
  }

  throw new Error(`Planner returned unparseable output after ${MAX_PLANNER_PARSE_RETRIES + 1} attempts: ${lastRaw.slice(0, 200)}`);
}

/**
 * Runs the generic observe -> decide -> act loop for a natural-language task
 * against an already-open browser session. Does not navigate anywhere on its
 * own unless the LLM itself chooses a 'navigate' action — callers that need a
 * specific starting page should navigate before calling this.
 */
export async function runBrowserAgentTask(
  sessionId: string,
  task: string,
  options?: BrowserAgentTaskOptions
): Promise<BrowserAgentTaskResult> {
  const maxSteps = Math.min(options?.maxSteps || DEFAULT_TASK_MAX_STEPS, HARD_CAP_TASK_STEPS);
  const userKeys = options?.userKeys;
  const isCancelled = options?.isCancelled || (() => false);

  const history: BrowserAgentTaskStepRecord[] = [];
  let consecutiveFailures = 0;

  pushActivityEvent(sessionId, 'task_started', `Starting autonomous task: "${task}" (max ${maxSteps} steps)`, {
    status: 'in_progress',
    details: { task, maxSteps },
  });

  for (let step = 1; step <= maxSteps; step++) {
    if (isCancelled()) {
      const message = `Task cancelled after ${step - 1} step(s).`;
      pushActivityEvent(sessionId, 'task_failed', message, { status: 'skipped', details: { task } });
      return { success: false, task, steps: history, summary: message };
    }

    // --- OBSERVE --- (reuses the existing ActionExecutor 'inspect' action,
    // which already pushes its own 'inspection' activity event)
    const inspectResult = await browserController.runAction(sessionId, { action: 'inspect' });
    if (!inspectResult.success || !inspectResult.snapshot) {
      const message = `Could not observe the page: ${inspectResult.error || inspectResult.message}`;
      pushActivityEvent(sessionId, 'task_failed', message, { status: 'failed', details: { task } });
      return { success: false, task, steps: history, summary: message };
    }
    const snapshot = inspectResult.snapshot;

    // --- DECIDE ---
    let decision: PlannerDecision;
    try {
      decision = await askPlanner(task, snapshot, history, userKeys);
    } catch (err: any) {
      const message = `Planner failed to produce a usable decision: ${err?.message || err}`;
      pushActivityEvent(sessionId, 'task_failed', message, { status: 'failed', details: { task } });
      return { success: false, task, steps: history, summary: message };
    }

    if (decision.done) {
      // decision.success defaults to true only for backward compatibility
      // with any decision object that omits it; the prompt always asks for
      // it explicitly when done === true.
      const succeeded = decision.success !== false;
      const summary = decision.summary || (succeeded ? 'Task completed.' : 'Planner determined the task cannot be completed.');

      if (succeeded) {
        pushActivityEvent(sessionId, 'task_completed', summary, { status: 'completed', details: { task, stepsTaken: step - 1 } });
      } else {
        pushActivityEvent(sessionId, 'task_failed', summary, { status: 'failed', details: { task, stepsTaken: step - 1 } });
      }
      return { success: succeeded, task, steps: history, summary };
    }

    const action = decision.action as StructuredAction;
    pushActivityEvent(sessionId, 'plan', `Step ${step}: ${decision.reasoning || 'Deciding next action...'} (next: ${action.action}${action.target ? ` "${action.target}"` : ''})`, {
      action: action.action,
      target: action.target,
      status: 'in_progress',
      details: { task, step, reasoning: decision.reasoning },
    });

    // --- ACT --- (the existing ActionExecutor: validation, retries,
    // ConfirmationGate, and its own activity events, completely unchanged)
    const actionResult = await browserController.runAction(sessionId, action);

    history.push({
      step,
      reasoning: decision.reasoning,
      action,
      success: actionResult.success,
      message: actionResult.message,
    });

    if (actionResult.success) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;

      const wasConfirmationDenial = /denied by human confirmation|denied or timed out/i.test(actionResult.message || '');
      if (wasConfirmationDenial) {
        const message = `Task stopped: a required action was denied by the human confirmation gate ("${action.action} ${action.target || action.url || ''}").`;
        pushActivityEvent(sessionId, 'task_failed', message, { status: 'failed', details: { task } });
        return { success: false, task, steps: history, summary: message };
      }

      if (consecutiveFailures >= MAX_CONSECUTIVE_ACTION_FAILURES) {
        const message = `Task stopped after ${consecutiveFailures} consecutive failed actions. Last error: ${actionResult.error || actionResult.message}`;
        pushActivityEvent(sessionId, 'task_failed', message, { status: 'failed', details: { task } });
        return { success: false, task, steps: history, summary: message };
      }
    }
  }

  const message = `Task did not complete within ${maxSteps} steps.`;
  pushActivityEvent(sessionId, 'task_failed', message, { status: 'failed', details: { task } });
  return { success: false, task, steps: history, summary: message };
}
