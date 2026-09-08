/**
 * MergeMate Browser Agent — Shared Types
 * Defines the structured, Playwright-agnostic vocabulary shared across the browser
 * session manager, page inspector, action executor, screencast relay, confirmation
 * gate, activity log, and the WebSocket protocol that carries all of the above to
 * the frontend BrowserAgentPanel.
 */

export type BrowserActionType =
  | 'navigate'
  | 'click'
  | 'type'
  | 'select'
  | 'scroll'
  | 'wait'
  | 'screenshot'
  | 'inspect';

/**
 * A structured, DOM/accessibility-oriented action. Targets are accessible names
 * or visible text — never raw pixel coordinates.
 */
export interface StructuredAction {
  action: BrowserActionType;
  target?: string; // accessible name / visible text of the element to act on
  text?: string; // for 'type'
  value?: string; // for 'select' (option label or value)
  url?: string; // for 'navigate'
  direction?: 'up' | 'down' | 'left' | 'right'; // for 'scroll'
  amount?: number; // for 'scroll' (pixels)
  timeoutMs?: number; // for 'wait' or bounding any action
}

export interface ActionValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface PageElementDescriptor {
  ref: number;
  role: string;
  name: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  level?: number;
  boundingBox?: { x: number; y: number; width: number; height: number } | null;
}

export interface PageSnapshot {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  elements: PageElementDescriptor[];
  visibleText: string;
  timestamp: string;
}

export type BrowserSessionStatus =
  | 'CREATING'
  | 'READY'
  | 'RUNNING'
  | 'CRASHED'
  | 'DISCONNECTED'
  | 'CLOSING'
  | 'CLOSED';

export interface BrowserSessionOptions {
  sessionId?: string;
  headless?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface ActionResult {
  success: boolean;
  action: StructuredAction;
  message: string;
  error?: string;
  attempts: number;
  snapshot?: PageSnapshot;
  screenshotBase64?: string;
}

export type BrowserActionEventType =
  | 'session_started'
  | 'session_ready'
  | 'navigation'
  | 'inspection'
  | 'click'
  | 'type'
  | 'select'
  | 'scroll'
  | 'wait'
  | 'screenshot'
  | 'retry'
  | 'confirmation_required'
  | 'confirmation_resolved'
  | 'action_completed'
  | 'action_failed'
  | 'session_stopped'
  | 'session_crashed'
  | 'error'
  | 'task_started'
  | 'plan'
  | 'task_completed'
  | 'task_failed';

export type BrowserActionEventStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface BrowserActionEvent {
  id: string;
  sessionId: string;
  type: BrowserActionEventType;
  action?: BrowserActionType;
  target?: string;
  status: BrowserActionEventStatus;
  timestamp: string;
  message: string;
  details?: any;
  error?: string;
}

/**
 * A gate raised before executing an action MergeMate judges sensitive
 * (payments, account deletion, credential entry, etc). Execution pauses until a
 * human explicitly approves or denies it — mirrors the human-in-the-loop
 * philosophy of PRLifecycleOrchestrator's HUMAN_DECISION_REQUIRED states.
 */
export interface ConfirmationRequest {
  id: string;
  sessionId: string;
  reason: string;
  proposedAction: StructuredAction;
  createdAt: string;
}

export const MAX_ACTION_FIND_ATTEMPTS = 3;
export const DEFAULT_ACTION_TIMEOUT_MS = 10000;
export const DEFAULT_NAVIGATION_TIMEOUT_MS = 30000;
export const MAX_WAIT_MS = 15000;

/**
 * Generic AI Planning Loop — vocabulary
 * Deliberately GitHub-agnostic: this loop drives a browser toward any
 * natural-language goal via observe -> decide -> act -> repeat. It is a
 * separate concern from the Coding Agent's GitHub API pipeline.
 */
export type PlannerActionType = Exclude<BrowserActionType, 'inspect'>;

export interface PlannerAction {
  action: PlannerActionType;
  target?: string;
  text?: string;
  value?: string;
  url?: string;
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  timeoutMs?: number;
}

/**
 * The single JSON object the planner LLM must return each turn.
 * "done" alone is not "succeeded" — the planner can conclude the task is
 * genuinely impossible on this page (e.g. a required element doesn't exist)
 * and report that as done=true, success=false, mirroring the Coding Agent's
 * own SOLVABLE vs NOT SOLVABLE distinction (see evaluateFinalPRDecision).
 */
export interface PlannerDecision {
  done: boolean;
  success?: boolean; // meaningful only when done === true; defaults to true for backward compatibility
  action?: PlannerAction; // required when done === false
  reasoning?: string;
  summary?: string; // required when done === true
}

export interface BrowserAgentTaskStepRecord {
  step: number;
  reasoning?: string;
  action?: StructuredAction;
  success?: boolean;
  message?: string;
}

export interface BrowserAgentTaskOptions {
  maxSteps?: number;
  userKeys?: string[];
  isCancelled?: () => boolean;
}

export interface BrowserAgentTaskResult {
  success: boolean;
  task: string;
  steps: BrowserAgentTaskStepRecord[];
  summary: string;
}

export const DEFAULT_TASK_MAX_STEPS = 12;
export const HARD_CAP_TASK_STEPS = 20;
export const MAX_CONSECUTIVE_ACTION_FAILURES = 3;
export const MAX_PLANNER_PARSE_RETRIES = 1;
