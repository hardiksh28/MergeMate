/**
 * Bounded PR Monitor & Polling Engine for MergeMate Autonomous PR Engine
 *
 * Provides bounded polling with exponential backoff to observe GitHub Actions checks,
 * commit statuses, and maintainer reviews without exceeding API rate limits.
 */

import {
  PRChecksSummary,
  getPullRequestChecks,
  getPullRequestStatus,
} from './github';
import { PRLifecycleOrchestrator, PRLifecycleRecord } from './prLifecycleOrchestrator';

export interface MonitorOptions {
  userToken?: string;
  maxDurationMs?: number; // Default 15 minutes (900_000 ms)
  initialDelayMs?: number; // Default 10_000 ms
  maxDelayMs?: number; // Default 160_000 ms
  backoffMultiplier?: number; // Default 2.0
  onUpdate?: (record: PRLifecycleRecord) => void;
}

/**
 * Sleep helper for bounded delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls GitHub API until CI checks reach a terminal state (Passed, Failed, Needs Approval)
 * or until the timeout window expires.
 */
export async function waitForChecks(
  owner: string,
  repo: string,
  expectedHeadSha: string,
  options?: MonitorOptions
): Promise<PRChecksSummary> {
  const maxDuration = options?.maxDurationMs || 15 * 60 * 1000; // 15 min
  const startTime = Date.now();
  let delay = options?.initialDelayMs || 10_000;
  const maxDelay = options?.maxDelayMs || 160_000;
  const multiplier = options?.backoffMultiplier || 2.0;

  console.log(`[PR Monitor] Monitoring checks for ${owner}/${repo}@${expectedHeadSha.slice(0, 7)} (max duration ${maxDuration / 1000}s)...`);

  while (Date.now() - startTime < maxDuration) {
    const checks = await getPullRequestChecks(owner, repo, expectedHeadSha, options?.userToken);

    // Stale check safety: ensure we are inspecting results for the target SHA
    const isTerminalState =
      checks.overallState === 'CHECKS_PASSED' ||
      checks.overallState === 'CHECKS_FAILED' ||
      checks.overallState === 'CHECKS_AWAITING_APPROVAL' ||
      checks.overallState === 'NO_CHECKS_CONFIGURED' ||
      checks.overallState === 'CHECKS_SKIPPED';

    if (isTerminalState) {
      console.log(`[PR Monitor] Checks reached terminal state: ${checks.overallState}`);
      return checks;
    }

    console.log(`[PR Monitor] Checks status: ${checks.overallState} (${checks.pendingCount} pending). Waiting ${delay / 1000}s...`);
    await sleep(delay);
    delay = Math.min(delay * multiplier, maxDelay);
  }

  console.warn(`[PR Monitor] Monitoring window (${maxDuration / 1000}s) expired for ${owner}/${repo}@${expectedHeadSha.slice(0, 7)}`);
  return getPullRequestChecks(owner, repo, expectedHeadSha, options?.userToken);
}

/**
 * Full autonomous PR monitor cycle using the state machine
 */
export async function monitorPullRequest(
  orchestrator: PRLifecycleOrchestrator,
  options?: MonitorOptions
): Promise<PRLifecycleRecord> {
  const maxDuration = options?.maxDurationMs || 15 * 60 * 1000;
  const startTime = Date.now();
  let delay = options?.initialDelayMs || 10_000;
  const maxDelay = options?.maxDelayMs || 160_000;
  const multiplier = options?.backoffMultiplier || 2.0;

  while (Date.now() - startTime < maxDuration) {
    const record = await orchestrator.evaluateCurrentStatus();
    if (options?.onUpdate) {
      options.onUpdate(record);
    }

    // Stop if terminal state reached or human review required
    if (
      record.currentState === 'MERGED' ||
      record.currentState === 'CLOSED' ||
      record.currentState === 'HUMAN_REVIEW_REQUIRED' ||
      record.currentState === 'HUMAN_DECISION_REQUIRED' ||
      record.currentState === 'READY_FOR_HUMAN_MERGE' ||
      record.currentState === 'MERGE_READY' ||
      record.currentState === 'FAILED' ||
      record.currentState === 'APPROVED'
    ) {
      console.log(`[PR Monitor] Lifecycle reached stop state: ${record.currentState}`);
      return record;
    }

    await sleep(delay);
    delay = Math.min(delay * multiplier, maxDelay);
  }

  return orchestrator.getRecord();
}

/**
 * Fetch one-shot current PR state
 */
export async function getCurrentPRState(
  owner: string,
  repo: string,
  pullNumber: number,
  userToken?: string
) {
  return getPullRequestStatus(owner, repo, pullNumber, userToken);
}
