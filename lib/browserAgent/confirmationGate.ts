/**
 * MergeMate Browser Agent — Confirmation Gate
 * Pauses execution before sensitive browser actions (payments, deletions,
 * credential entry, account changes) and requires an explicit human approval —
 * the browser-agent analogue of PRLifecycleOrchestrator's HUMAN_DECISION_REQUIRED
 * gate for maintainer feedback.
 */

import { ConfirmationRequest, StructuredAction } from './types';
import { pushActivityEvent } from './activityLog';

const SENSITIVE_TARGET_KEYWORDS = [
  'buy now',
  'purchase',
  'place order',
  'confirm order',
  'checkout',
  'pay now',
  'submit payment',
  'delete account',
  'delete',
  'remove account',
  'deactivate',
  'send money',
  'transfer funds',
  'confirm password',
  'wire transfer',
];

const SENSITIVE_FIELD_KEYWORDS = [
  'password',
  'credit card',
  'card number',
  'cvv',
  'ssn',
  'social security',
  'bank account',
  'routing number',
];

const pendingRequests = new Map<string, ConfirmationRequest>();
const pendingWaiters = new Map<string, { resolve: (approved: boolean) => void; timer: NodeJS.Timeout }>();

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes to give a human time to respond

function nextRequestId(): string {
  return `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Determines whether a proposed action should be paused for human confirmation.
 */
export function evaluateActionSafety(action: StructuredAction): { requiresConfirmation: boolean; reason?: string } {
  const target = (action.target || '').toLowerCase();
  const text = (action.text || '').toLowerCase();

  if (action.action === 'click') {
    const matched = SENSITIVE_TARGET_KEYWORDS.find((kw) => target.includes(kw));
    if (matched) {
      return { requiresConfirmation: true, reason: `Clicking "${action.target}" looks like a sensitive/irreversible action (matched "${matched}").` };
    }
  }

  if (action.action === 'type') {
    const matchedField = SENSITIVE_FIELD_KEYWORDS.find((kw) => target.includes(kw));
    if (matchedField) {
      return { requiresConfirmation: true, reason: `Typing into field "${action.target}" looks like a sensitive credential/financial field (matched "${matchedField}").` };
    }
  }

  if (action.action === 'navigate' && action.url) {
    const url = action.url.toLowerCase();
    if (url.startsWith('file://') || url.startsWith('chrome://') || url.startsWith('about:')) {
      return { requiresConfirmation: true, reason: `Navigation target "${action.url}" targets a local/privileged scheme.` };
    }
  }

  return { requiresConfirmation: false };
}

/**
 * Raises a confirmation request for a session and pushes a corresponding
 * activity event. Returns the pending request so the caller can await resolution.
 */
export function raiseConfirmation(sessionId: string, proposedAction: StructuredAction, reason: string): ConfirmationRequest {
  const request: ConfirmationRequest = {
    id: nextRequestId(),
    sessionId,
    reason,
    proposedAction,
    createdAt: new Date().toISOString(),
  };
  pendingRequests.set(request.id, request);

  pushActivityEvent(sessionId, 'confirmation_required', reason, {
    action: proposedAction.action,
    target: proposedAction.target,
    status: 'pending',
    details: { requestId: request.id, proposedAction },
  });

  return request;
}

export function getPendingConfirmation(requestId: string): ConfirmationRequest | undefined {
  return pendingRequests.get(requestId);
}

/**
 * Awaits human resolution of a confirmation request. Bounded by a timeout so an
 * abandoned browser tab can never hang the action executor forever — a timeout
 * resolves as "denied" and the pending request is cleared.
 */
export function waitForConfirmation(requestId: string, timeoutMs: number = DEFAULT_CONFIRMATION_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingWaiters.delete(requestId);
      const request = pendingRequests.get(requestId);
      if (request) {
        resolveConfirmation(requestId, false);
      }
      resolve(false);
    }, timeoutMs);

    pendingWaiters.set(requestId, { resolve, timer });
  });
}

export function getPendingConfirmationsForSession(sessionId: string): ConfirmationRequest[] {
  return Array.from(pendingRequests.values()).filter((r) => r.sessionId === sessionId);
}

/**
 * Resolves a pending confirmation. Returns false if the request id is unknown
 * (already resolved, expired, or never existed) so callers can report a clean error.
 */
export function resolveConfirmation(requestId: string, approved: boolean): ConfirmationRequest | null {
  const request = pendingRequests.get(requestId);
  if (!request) return null;

  pendingRequests.delete(requestId);

  const waiter = pendingWaiters.get(requestId);
  if (waiter) {
    clearTimeout(waiter.timer);
    pendingWaiters.delete(requestId);
    waiter.resolve(approved);
  }

  pushActivityEvent(request.sessionId, 'confirmation_resolved', approved
    ? `Human approved action: ${request.proposedAction.action} "${request.proposedAction.target || request.proposedAction.url || ''}".`
    : `Human denied action: ${request.proposedAction.action} "${request.proposedAction.target || request.proposedAction.url || ''}".`,
    {
      action: request.proposedAction.action,
      target: request.proposedAction.target,
      status: approved ? 'completed' : 'skipped',
      details: { requestId },
    }
  );

  return request;
}

export function clearSessionConfirmations(sessionId: string): void {
  Array.from(pendingRequests.entries()).forEach(([id, req]) => {
    if (req.sessionId === sessionId) {
      pendingRequests.delete(id);
      const waiter = pendingWaiters.get(id);
      if (waiter) {
        clearTimeout(waiter.timer);
        pendingWaiters.delete(id);
        waiter.resolve(false);
      }
    }
  });
}
