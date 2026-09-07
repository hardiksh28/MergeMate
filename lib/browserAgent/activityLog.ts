/**
 * MergeMate Browser Agent — Activity Timeline
 * Equivalent of the AgentExecutionStep/pushStep convention used by the coding
 * agent (see lib/agentOrchestrator.ts), adapted for live browser sessions.
 * Keeps a bounded in-memory event log per session and fans events out to any
 * subscribers (the WebSocket server relays them to the frontend timeline).
 */

import {
  BrowserActionEvent,
  BrowserActionEventStatus,
  BrowserActionEventType,
  BrowserActionType,
} from './types';

const MAX_EVENTS_PER_SESSION = 500;

type EventListener = (event: BrowserActionEvent) => void;

const sessionLogs = new Map<string, BrowserActionEvent[]>();
const sessionListeners = new Map<string, Set<EventListener>>();

function nextEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Records a new activity event for a session and notifies subscribers.
 */
export function pushActivityEvent(
  sessionId: string,
  type: BrowserActionEventType,
  message: string,
  options?: {
    action?: BrowserActionType;
    target?: string;
    status?: BrowserActionEventStatus;
    details?: any;
    error?: string;
  }
): BrowserActionEvent {
  const event: BrowserActionEvent = {
    id: nextEventId(),
    sessionId,
    type,
    action: options?.action,
    target: options?.target,
    status: options?.status || 'completed',
    timestamp: new Date().toISOString(),
    message,
    details: options?.details,
    error: options?.error,
  };

  const log = sessionLogs.get(sessionId) || [];
  log.push(event);
  if (log.length > MAX_EVENTS_PER_SESSION) {
    log.splice(0, log.length - MAX_EVENTS_PER_SESSION);
  }
  sessionLogs.set(sessionId, log);

  console.log(`[BrowserAgent Activity #${sessionId}] ${type}: ${message}`);

  const listeners = sessionListeners.get(sessionId);
  if (listeners) {
    listeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err: any) {
        console.warn(`[BrowserAgent Activity #${sessionId}] Listener error: ${err?.message}`);
      }
    });
  }

  return event;
}

export function getActivityLog(sessionId: string): BrowserActionEvent[] {
  return [...(sessionLogs.get(sessionId) || [])];
}

export function clearActivityLog(sessionId: string): void {
  sessionLogs.delete(sessionId);
  sessionListeners.delete(sessionId);
}

/**
 * Subscribes to live activity events for a session. Returns an unsubscribe function.
 */
export function subscribeToActivity(sessionId: string, listener: EventListener): () => void {
  let listeners = sessionListeners.get(sessionId);
  if (!listeners) {
    listeners = new Set();
    sessionListeners.set(sessionId, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners?.delete(listener);
  };
}
