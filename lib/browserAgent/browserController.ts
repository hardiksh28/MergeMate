/**
 * MergeMate Browser Agent — Browser Controller
 * The single public entry point for driving a browser session. Everything else
 * in MergeMate (the WebSocket server today, an AI planning loop eventually)
 * talks to this module only — it never imports Playwright directly. Internally
 * it composes browserSession, pageInspector, actionExecutor, screencast,
 * confirmationGate, and activityLog.
 *
 * This keeps the eventual architecture cleanly separated from the existing
 * Coding Agent -> GitHub API pipeline (lib/agentOrchestrator.ts, lib/github.ts):
 *
 *   Browser Agent -> BrowserController -> Playwright -> Chromium -> Live Stream -> UI
 */

import {
  BrowserActionEvent,
  BrowserSessionOptions,
  BrowserSessionStatus,
  ConfirmationRequest,
  PageSnapshot,
  StructuredAction,
  ActionResult,
} from './types';
import {
  createSession,
  closeSession,
  getSession,
  registerProcessShutdownHooks,
} from './browserSession';
import { inspectPage } from './pageInspector';
import { executeAction } from './actionExecutor';
import { startScreencast, ScreencastFrame, ScreencastHandle } from './screencast';
import { resolveConfirmation, getPendingConfirmationsForSession } from './confirmationGate';
import { getActivityLog, subscribeToActivity, clearActivityLog } from './activityLog';

export interface BrowserController {
  startSession(options?: BrowserSessionOptions): Promise<{ sessionId: string; status: BrowserSessionStatus }>;
  stopSession(sessionId: string): Promise<void>;
  navigate(sessionId: string, url: string): Promise<ActionResult>;
  inspect(sessionId: string): Promise<PageSnapshot>;
  click(sessionId: string, target: string): Promise<ActionResult>;
  type(sessionId: string, target: string, text: string): Promise<ActionResult>;
  select(sessionId: string, target: string, value: string): Promise<ActionResult>;
  scroll(sessionId: string, direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<ActionResult>;
  wait(sessionId: string, options: { timeoutMs?: number; target?: string }): Promise<ActionResult>;
  screenshot(sessionId: string): Promise<string>;
  runAction(sessionId: string, action: StructuredAction): Promise<ActionResult>;
  resolveConfirmation(requestId: string, approved: boolean): boolean;
  getPendingConfirmations(sessionId: string): ConfirmationRequest[];
  getActivity(sessionId: string): BrowserActionEvent[];
  onActivity(sessionId: string, listener: (event: BrowserActionEvent) => void): () => void;
  startStream(sessionId: string, onFrame: (frame: ScreencastFrame) => void): Promise<() => Promise<void>>;
}

const activeStreams = new Map<string, ScreencastHandle>();

function requireSession(sessionId: string) {
  const handle = getSession(sessionId);
  if (!handle) {
    throw new Error(`No active browser session found for id "${sessionId}". It may have crashed, disconnected, or already been stopped.`);
  }
  return handle;
}

class PlaywrightBrowserController implements BrowserController {
  constructor() {
    registerProcessShutdownHooks();
  }

  async startSession(options?: BrowserSessionOptions) {
    const handle = await createSession(options);
    return { sessionId: handle.sessionId, status: handle.status };
  }

  async stopSession(sessionId: string): Promise<void> {
    const stream = activeStreams.get(sessionId);
    if (stream) {
      await stream.stop().catch(() => {});
      activeStreams.delete(sessionId);
    }
    await closeSession(sessionId);
    clearActivityLog(sessionId);
  }

  async navigate(sessionId: string, url: string): Promise<ActionResult> {
    return this.runAction(sessionId, { action: 'navigate', url });
  }

  async inspect(sessionId: string): Promise<PageSnapshot> {
    const handle = requireSession(sessionId);
    return inspectPage(handle.page);
  }

  async click(sessionId: string, target: string): Promise<ActionResult> {
    return this.runAction(sessionId, { action: 'click', target });
  }

  async type(sessionId: string, target: string, text: string): Promise<ActionResult> {
    return this.runAction(sessionId, { action: 'type', target, text });
  }

  async select(sessionId: string, target: string, value: string): Promise<ActionResult> {
    return this.runAction(sessionId, { action: 'select', target, value });
  }

  async scroll(sessionId: string, direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<ActionResult> {
    return this.runAction(sessionId, { action: 'scroll', direction, amount });
  }

  async wait(sessionId: string, options: { timeoutMs?: number; target?: string }): Promise<ActionResult> {
    return this.runAction(sessionId, { action: 'wait', timeoutMs: options.timeoutMs, target: options.target });
  }

  async screenshot(sessionId: string): Promise<string> {
    const result = await this.runAction(sessionId, { action: 'screenshot' });
    if (!result.success || !result.screenshotBase64) {
      throw new Error(result.error || 'Failed to capture screenshot.');
    }
    return result.screenshotBase64;
  }

  async runAction(sessionId: string, action: StructuredAction): Promise<ActionResult> {
    const handle = requireSession(sessionId);
    return executeAction(handle.page, sessionId, action);
  }

  resolveConfirmation(requestId: string, approved: boolean): boolean {
    return resolveConfirmation(requestId, approved) !== null;
  }

  getPendingConfirmations(sessionId: string): ConfirmationRequest[] {
    return getPendingConfirmationsForSession(sessionId);
  }

  getActivity(sessionId: string): BrowserActionEvent[] {
    return getActivityLog(sessionId);
  }

  onActivity(sessionId: string, listener: (event: BrowserActionEvent) => void): () => void {
    return subscribeToActivity(sessionId, listener);
  }

  async startStream(sessionId: string, onFrame: (frame: ScreencastFrame) => void): Promise<() => Promise<void>> {
    const existing = activeStreams.get(sessionId);
    if (existing) {
      await existing.stop().catch(() => {});
      activeStreams.delete(sessionId);
    }

    const handle = requireSession(sessionId);
    const streamHandle = await startScreencast(handle.page, sessionId, onFrame);
    handle.cdpSession = streamHandle.cdpSession;
    activeStreams.set(sessionId, streamHandle);

    return async () => {
      await streamHandle.stop().catch(() => {});
      activeStreams.delete(sessionId);
    };
  }
}

export const browserController: BrowserController = new PlaywrightBrowserController();
export type { ScreencastFrame } from './screencast';
export * from './types';
