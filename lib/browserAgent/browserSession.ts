/**
 * MergeMate Browser Agent — Session Lifecycle Manager
 * Owns the Playwright Chromium process for each browser-agent task. Every session
 * gets its own isolated, temporary persistent profile (never the user's real Chrome
 * profile). Handles crashes, disconnects, timeouts, duplicate session requests, and
 * guarantees cleanup so Chromium processes and temp profiles are never leaked.
 */

import { chromium, Browser, BrowserContext, Page, CDPSession } from 'playwright';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BrowserSessionOptions, BrowserSessionStatus } from './types';
import { pushActivityEvent } from './activityLog';

const PROFILE_ROOT = path.join(os.tmpdir(), 'mergemate-browser-sessions');
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };
const LAUNCH_TIMEOUT_MS = 30000;

export interface BrowserSessionHandle {
  sessionId: string;
  context: BrowserContext;
  page: Page;
  cdpSession: CDPSession | null;
  profileDir: string;
  status: BrowserSessionStatus;
  createdAt: string;
}

const activeSessions = new Map<string, BrowserSessionHandle>();

function nextSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getSession(sessionId: string): BrowserSessionHandle | undefined {
  return activeSessions.get(sessionId);
}

export function listSessions(): BrowserSessionHandle[] {
  return Array.from(activeSessions.values());
}

/**
 * Creates a new isolated browser session. If a sessionId is supplied and already
 * has a live session, the existing handle is returned instead of launching a
 * duplicate Chromium process.
 */
export async function createSession(options?: BrowserSessionOptions): Promise<BrowserSessionHandle> {
  const requestedId = options?.sessionId;
  if (requestedId) {
    const existing = activeSessions.get(requestedId);
    if (existing && (existing.status === 'READY' || existing.status === 'RUNNING')) {
      pushActivityEvent(requestedId, 'session_started', `Reusing existing live session ${requestedId} (duplicate request ignored).`, {
        status: 'skipped',
      });
      return existing;
    }
  }

  const sessionId = requestedId || nextSessionId();
  const profileDir = path.join(PROFILE_ROOT, sessionId);
  fs.mkdirSync(profileDir, { recursive: true });

  pushActivityEvent(sessionId, 'session_started', `Launching isolated Chromium profile for session ${sessionId}...`, {
    status: 'in_progress',
  });

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: options?.headless ?? (process.env.BROWSER_HEADLESS !== 'false'),
      viewport: {
        width: options?.viewportWidth || DEFAULT_VIEWPORT.width,
        height: options?.viewportHeight || DEFAULT_VIEWPORT.height,
      },
      timeout: LAUNCH_TIMEOUT_MS,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (err: any) {
    cleanupProfileDir(profileDir);
    pushActivityEvent(sessionId, 'session_crashed', `Failed to launch Chromium: ${err?.message || err}`, {
      status: 'failed',
      error: err?.message,
    });
    throw new Error(`Failed to launch browser session: ${err?.message || err}`);
  }

  const page = context.pages()[0] || (await context.newPage());

  const handle: BrowserSessionHandle = {
    sessionId,
    context,
    page,
    cdpSession: null,
    profileDir,
    status: 'READY',
    createdAt: new Date().toISOString(),
  };

  activeSessions.set(sessionId, handle);
  registerLifecycleHandlers(handle);

  pushActivityEvent(sessionId, 'session_ready', `Browser session ${sessionId} is ready (isolated profile, no user data).`, {
    status: 'completed',
  });

  return handle;
}

function registerLifecycleHandlers(handle: BrowserSessionHandle): void {
  const { sessionId, page, context } = handle;

  page.on('crash', () => {
    const current = activeSessions.get(sessionId);
    if (current) current.status = 'CRASHED';
    pushActivityEvent(sessionId, 'session_crashed', `Page crashed unexpectedly in session ${sessionId}.`, {
      status: 'failed',
    });
  });

  page.on('close', () => {
    const current = activeSessions.get(sessionId);
    if (current && current.status !== 'CLOSING' && current.status !== 'CLOSED') {
      current.status = 'DISCONNECTED';
      pushActivityEvent(sessionId, 'session_stopped', `Page closed unexpectedly for session ${sessionId}.`, {
        status: 'skipped',
      });
    }
  });

  context.on('close', () => {
    const current = activeSessions.get(sessionId);
    if (current && current.status !== 'CLOSING' && current.status !== 'CLOSED') {
      current.status = 'DISCONNECTED';
      pushActivityEvent(sessionId, 'session_stopped', `Browser context disconnected unexpectedly for session ${sessionId}.`, {
        status: 'skipped',
      });
      cleanupProfileDir(current.profileDir);
      activeSessions.delete(sessionId);
    }
  });
}

function cleanupProfileDir(profileDir: string): void {
  try {
    fs.rmSync(profileDir, { recursive: true, force: true });
  } catch (err: any) {
    console.warn(`[BrowserSession] Failed to remove temp profile ${profileDir}: ${err?.message}`);
  }
}

/**
 * Gracefully stops a session: closes the page/context, then deletes its
 * temporary profile directory so no browser data or process is leaked.
 */
export async function closeSession(sessionId: string, reason: string = 'Session stopped by user.'): Promise<void> {
  const handle = activeSessions.get(sessionId);
  if (!handle) return;

  handle.status = 'CLOSING';

  try {
    if (handle.cdpSession) {
      await handle.cdpSession.detach().catch(() => {});
    }
    await handle.context.close();
  } catch (err: any) {
    console.warn(`[BrowserSession] Error while closing session ${sessionId}: ${err?.message}`);
  } finally {
    handle.status = 'CLOSED';
    cleanupProfileDir(handle.profileDir);
    activeSessions.delete(sessionId);
    pushActivityEvent(sessionId, 'session_stopped', reason, { status: 'completed' });
  }
}

/**
 * Closes every active session. Called on process shutdown so no Chromium
 * process or temp profile survives the WebSocket server exiting.
 */
export async function closeAllSessions(): Promise<void> {
  const ids = Array.from(activeSessions.keys());
  await Promise.all(ids.map((id) => closeSession(id, 'Server shutting down; closing all sessions.')));
}

let shutdownHooksRegistered = false;
export function registerProcessShutdownHooks(): void {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;

  const shutdown = async () => {
    await closeAllSessions();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', () => {
    // Best-effort synchronous fallback; async close already ran on SIGINT/SIGTERM.
    activeSessions.forEach((handle) => {
      try {
        fs.rmSync(handle.profileDir, { recursive: true, force: true });
      } catch {}
    });
  });
}
