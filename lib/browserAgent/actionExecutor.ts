/**
 * MergeMate Browser Agent — Action Executor
 * Executes structured actions (click, type, select, scroll, navigate, wait,
 * screenshot) against a live page using Playwright's accessibility-oriented
 * locators (getByRole / getByText / getByLabel / getByPlaceholder) — never raw
 * pixel coordinates or computer-vision clicking. Validates actions up front,
 * re-inspects the page and retries a bounded number of times when a target
 * cannot be found, and reports a useful failure instead of looping forever.
 */

import { Locator, Page } from 'playwright';
import {
  ActionResult,
  ActionValidationResult,
  StructuredAction,
  MAX_ACTION_FIND_ATTEMPTS,
  DEFAULT_ACTION_TIMEOUT_MS,
  DEFAULT_NAVIGATION_TIMEOUT_MS,
  MAX_WAIT_MS,
} from './types';
import { inspectPage } from './pageInspector';
import { pushActivityEvent } from './activityLog';
import { evaluateActionSafety, raiseConfirmation, waitForConfirmation } from './confirmationGate';

const INTERACTIVE_ROLES = [
  'button',
  'link',
  'textbox',
  'searchbox',
  'checkbox',
  'radio',
  'combobox',
  'tab',
  'menuitem',
  'switch',
] as const;

/**
 * Validates a structured action's shape before any execution is attempted.
 */
export function validateAction(action: StructuredAction): ActionValidationResult {
  const errors: string[] = [];

  if (!action || typeof action !== 'object') {
    return { isValid: false, errors: ['Action payload must be an object.'] };
  }

  const validTypes = ['navigate', 'click', 'type', 'select', 'scroll', 'wait', 'screenshot', 'inspect'];
  if (!validTypes.includes(action.action)) {
    errors.push(`Unknown action type "${action.action}". Expected one of: ${validTypes.join(', ')}.`);
  }

  if (action.action === 'navigate' && !action.url) {
    errors.push('navigate action requires a "url" field.');
  }
  if (action.action === 'click' && !action.target) {
    errors.push('click action requires a "target" field (accessible name or visible text).');
  }
  if (action.action === 'type' && (!action.target || action.text === undefined)) {
    errors.push('type action requires "target" and "text" fields.');
  }
  if (action.action === 'select' && (!action.target || action.value === undefined)) {
    errors.push('select action requires "target" and "value" fields.');
  }
  if (action.action === 'scroll' && !action.direction) {
    errors.push('scroll action requires a "direction" field (up|down|left|right).');
  }

  if (action.url) {
    try {
      const parsed = new URL(action.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push(`Unsafe navigation protocol "${parsed.protocol}". Only http/https are allowed.`);
      }
    } catch {
      errors.push(`"${action.url}" is not a valid URL.`);
    }
  }

  return { isValid: errors.length === 0, errors };
}

/**
 * Resolves a structured target string to a live locator using accessibility
 * roles first, then progressively looser text-based fallbacks.
 */
async function resolveTargetLocator(page: Page, target: string): Promise<Locator | null> {
  for (const role of INTERACTIVE_ROLES) {
    const locator = page.getByRole(role, { name: target, exact: false }).first();
    if ((await locator.count()) > 0) return locator;
  }

  const byLabel = page.getByLabel(target, { exact: false }).first();
  if ((await byLabel.count()) > 0) return byLabel;

  const byPlaceholder = page.getByPlaceholder(target, { exact: false }).first();
  if ((await byPlaceholder.count()) > 0) return byPlaceholder;

  const byText = page.getByText(target, { exact: false }).first();
  if ((await byText.count()) > 0) return byText;

  return null;
}

/**
 * Finds a target element with a small bounded number of re-inspect-and-retry
 * attempts. Never loops indefinitely — after MAX_ACTION_FIND_ATTEMPTS it reports
 * a clear failure describing what was searched for.
 */
async function findElementWithRetry(
  page: Page,
  sessionId: string,
  target: string
): Promise<{ locator: Locator | null; attempts: number }> {
  let attempts = 0;

  for (attempts = 1; attempts <= MAX_ACTION_FIND_ATTEMPTS; attempts++) {
    const locator = await resolveTargetLocator(page, target);
    if (locator) return { locator, attempts };

    if (attempts < MAX_ACTION_FIND_ATTEMPTS) {
      pushActivityEvent(sessionId, 'retry', `Could not find "${target}" (attempt ${attempts}/${MAX_ACTION_FIND_ATTEMPTS}). Re-inspecting page and retrying...`, {
        target,
        status: 'in_progress',
      });
      await inspectPage(page).catch(() => null);
      await page.waitForTimeout(400);
    }
  }

  return { locator: null, attempts: MAX_ACTION_FIND_ATTEMPTS };
}

/**
 * Executes a single structured action against the given page, emitting
 * activity events at each stage and enforcing the human confirmation gate for
 * sensitive actions before they run.
 */
export async function executeAction(page: Page, sessionId: string, action: StructuredAction): Promise<ActionResult> {
  const validation = validateAction(action);
  if (!validation.isValid) {
    pushActivityEvent(sessionId, 'action_failed', `Rejected invalid action: ${validation.errors.join('; ')}`, {
      action: action.action,
      target: action.target,
      status: 'failed',
      error: validation.errors.join('; '),
    });
    return { success: false, action, message: 'Action failed validation.', error: validation.errors.join('; '), attempts: 0 };
  }

  const safety = evaluateActionSafety(action);
  if (safety.requiresConfirmation) {
    const request = raiseConfirmation(sessionId, action, safety.reason || 'Action requires human confirmation.');
    const approved = await waitForConfirmation(request.id);
    if (!approved) {
      pushActivityEvent(sessionId, 'action_failed', `Action denied or timed out: ${action.action} "${action.target || action.url || ''}".`, {
        action: action.action,
        target: action.target,
        status: 'failed',
      });
      return { success: false, action, message: 'Action denied by human confirmation gate.', attempts: 0 };
    }
  }

  const eventType = (action.action === 'navigate' ? 'navigation' : action.action) as any;
  pushActivityEvent(sessionId, eventType, describeAction(action), {
    action: action.action,
    target: action.target,
    status: 'in_progress',
  });

  try {
    switch (action.action) {
      case 'navigate':
        return await runNavigate(page, sessionId, action);
      case 'click':
        return await runClick(page, sessionId, action);
      case 'type':
        return await runType(page, sessionId, action);
      case 'select':
        return await runSelect(page, sessionId, action);
      case 'scroll':
        return await runScroll(page, sessionId, action);
      case 'wait':
        return await runWait(page, sessionId, action);
      case 'screenshot':
        return await runScreenshot(page, sessionId, action);
      case 'inspect':
        return await runInspect(page, sessionId, action);
      default:
        throw new Error(`Unhandled action type: ${action.action}`);
    }
  } catch (err: any) {
    const message = err?.message || String(err);
    pushActivityEvent(sessionId, 'action_failed', `Action "${action.action}" failed: ${message}`, {
      action: action.action,
      target: action.target,
      status: 'failed',
      error: message,
    });
    return { success: false, action, message: `Action failed: ${message}`, error: message, attempts: 1 };
  }
}

function describeAction(action: StructuredAction): string {
  switch (action.action) {
    case 'navigate':
      return `Opening ${action.url}...`;
    case 'click':
      return `Clicking "${action.target}"...`;
    case 'type':
      return `Typing into "${action.target}"...`;
    case 'select':
      return `Selecting "${action.value}" in "${action.target}"...`;
    case 'scroll':
      return `Scrolling ${action.direction}...`;
    case 'wait':
      return action.target ? `Waiting for "${action.target}" to appear...` : `Waiting ${action.timeoutMs || 1000}ms...`;
    case 'screenshot':
      return 'Capturing screenshot...';
    case 'inspect':
      return 'Inspecting page structure...';
    default:
      return `Running ${action.action}...`;
  }
}

async function runNavigate(page: Page, sessionId: string, action: StructuredAction): Promise<ActionResult> {
  await page.goto(action.url!, {
    waitUntil: 'domcontentloaded',
    timeout: action.timeoutMs || DEFAULT_NAVIGATION_TIMEOUT_MS,
  });
  const snapshot = await inspectPage(page);
  pushActivityEvent(sessionId, 'action_completed', `Opened ${action.url}.`, {
    action: action.action,
    target: action.url,
    status: 'completed',
  });
  return { success: true, action, message: `Navigated to ${action.url}.`, attempts: 1, snapshot };
}

async function runClick(page: Page, sessionId: string, action: StructuredAction): Promise<ActionResult> {
  const { locator, attempts } = await findElementWithRetry(page, sessionId, action.target!);
  if (!locator) {
    const message = `Could not find a clickable element matching "${action.target}" after ${attempts} attempts.`;
    pushActivityEvent(sessionId, 'action_failed', message, { action: action.action, target: action.target, status: 'failed' });
    return { success: false, action, message, attempts };
  }

  await locator.scrollIntoViewIfNeeded({ timeout: DEFAULT_ACTION_TIMEOUT_MS }).catch(() => {});
  await locator.click({ timeout: DEFAULT_ACTION_TIMEOUT_MS });

  pushActivityEvent(sessionId, 'action_completed', `Clicked "${action.target}".`, {
    action: action.action,
    target: action.target,
    status: 'completed',
  });
  return { success: true, action, message: `Clicked "${action.target}".`, attempts };
}

async function runType(page: Page, sessionId: string, action: StructuredAction): Promise<ActionResult> {
  const { locator, attempts } = await findElementWithRetry(page, sessionId, action.target!);
  if (!locator) {
    const message = `Could not find an input field matching "${action.target}" after ${attempts} attempts.`;
    pushActivityEvent(sessionId, 'action_failed', message, { action: action.action, target: action.target, status: 'failed' });
    return { success: false, action, message, attempts };
  }

  await locator.scrollIntoViewIfNeeded({ timeout: DEFAULT_ACTION_TIMEOUT_MS }).catch(() => {});
  await locator.fill(action.text || '', { timeout: DEFAULT_ACTION_TIMEOUT_MS });

  pushActivityEvent(sessionId, 'action_completed', `Typed into "${action.target}".`, {
    action: action.action,
    target: action.target,
    status: 'completed',
  });
  return { success: true, action, message: `Typed into "${action.target}".`, attempts };
}

async function runSelect(page: Page, sessionId: string, action: StructuredAction): Promise<ActionResult> {
  const { locator, attempts } = await findElementWithRetry(page, sessionId, action.target!);
  if (!locator) {
    const message = `Could not find a selectable element matching "${action.target}" after ${attempts} attempts.`;
    pushActivityEvent(sessionId, 'action_failed', message, { action: action.action, target: action.target, status: 'failed' });
    return { success: false, action, message, attempts };
  }

  await locator.scrollIntoViewIfNeeded({ timeout: DEFAULT_ACTION_TIMEOUT_MS }).catch(() => {});
  try {
    await locator.selectOption({ label: action.value! }, { timeout: DEFAULT_ACTION_TIMEOUT_MS });
  } catch {
    await locator.selectOption(action.value!, { timeout: DEFAULT_ACTION_TIMEOUT_MS });
  }

  pushActivityEvent(sessionId, 'action_completed', `Selected "${action.value}" in "${action.target}".`, {
    action: action.action,
    target: action.target,
    status: 'completed',
  });
  return { success: true, action, message: `Selected "${action.value}" in "${action.target}".`, attempts };
}

async function runScroll(page: Page, sessionId: string, action: StructuredAction): Promise<ActionResult> {
  const amount = action.amount || 500;
  const dx = action.direction === 'left' ? -amount : action.direction === 'right' ? amount : 0;
  const dy = action.direction === 'up' ? -amount : action.direction === 'down' ? amount : 0;

  await page.mouse.wheel(dx, dy);

  pushActivityEvent(sessionId, 'action_completed', `Scrolled ${action.direction}.`, {
    action: action.action,
    status: 'completed',
  });
  return { success: true, action, message: `Scrolled ${action.direction} by ${amount}px.`, attempts: 1 };
}

async function runWait(page: Page, sessionId: string, action: StructuredAction): Promise<ActionResult> {
  const timeoutMs = Math.min(action.timeoutMs || 1000, MAX_WAIT_MS);

  if (action.target) {
    const locator = page.getByText(action.target, { exact: false }).first();
    await locator.waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {
      throw new Error(`Timed out waiting for "${action.target}" to appear within ${timeoutMs}ms.`);
    });
  } else {
    await page.waitForTimeout(timeoutMs);
  }

  pushActivityEvent(sessionId, 'action_completed', action.target ? `"${action.target}" appeared.` : `Waited ${timeoutMs}ms.`, {
    action: action.action,
    target: action.target,
    status: 'completed',
  });
  return { success: true, action, message: 'Wait completed.', attempts: 1 };
}

async function runScreenshot(page: Page, sessionId: string, action: StructuredAction): Promise<ActionResult> {
  const buffer = await page.screenshot({ type: 'jpeg', quality: 80 });
  const screenshotBase64 = buffer.toString('base64');

  pushActivityEvent(sessionId, 'action_completed', 'Captured screenshot.', {
    action: action.action,
    status: 'completed',
  });
  return { success: true, action, message: 'Screenshot captured.', attempts: 1, screenshotBase64 };
}

async function runInspect(page: Page, sessionId: string, action: StructuredAction): Promise<ActionResult> {
  const snapshot = await inspectPage(page);
  pushActivityEvent(sessionId, 'inspection', `Inspected page: found ${snapshot.elements.length} interactive elements.`, {
    action: action.action,
    status: 'completed',
    details: { elementCount: snapshot.elements.length, url: snapshot.url },
  });
  return { success: true, action, message: `Inspected page (${snapshot.elements.length} elements).`, attempts: 1, snapshot };
}
