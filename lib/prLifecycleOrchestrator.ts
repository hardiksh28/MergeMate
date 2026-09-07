/**
 * Autonomous Pull Request Lifecycle State Machine & Orchestrator
 *
 * Implements a cautious, deterministic state machine that manages PR verification,
 * CI monitoring, failure classification, bounded self-repair, maintainer review responses,
 * prompt injection defense, and escalation to human review.
 */

import {
  PRDetails,
  PRChecksSummary,
  PRReviewItem,
  PRReviewCommentItem,
  getPullRequest,
  getPullRequestStatus,
  getPullRequestChecks,
  getPullRequestReviews,
  getPullRequestReviewComments,
} from './github';
import {
  CIFailureType,
  CIDiagnosis,
  classifyCIFailure,
  sanitizeCILogs,
} from './ciFailureClassifier';

export type PRLifecycleState =
  | 'PR_CREATED'
  | 'PR_DISCOVERED'
  | 'WAITING_FOR_CHECKS'
  | 'CHECKS_PENDING'
  | 'CHECKS_RUNNING'
  | 'CHECKS_PASSED'
  | 'CHECKS_FAILED'
  | 'WORKFLOW_APPROVAL_REQUIRED'
  | 'CHECKS_NEEDS_APPROVAL'
  | 'CHECKS_SKIPPED'
  | 'NO_CHECKS_CONFIGURED'
  | 'ANALYZING_FAILURE'
  | 'PLANNING_REPAIR'
  | 'IMPLEMENTING_REPAIR'
  | 'VERIFYING_REPAIR'
  | 'REPAIR_COMMITTED'
  | 'REPAIR_PUSHED'
  | 'WAITING_FOR_RECHECK'
  | 'REVIEW_PENDING'
  | 'REVIEW_DISCOVERED'
  | 'CLASSIFYING_REVIEW'
  | 'REVIEW_CHANGES_REQUESTED'
  | 'ANALYZING_REVIEW'
  | 'PLANNING_REVIEW_FIX'
  | 'IMPLEMENTING_REVIEW_FIX'
  | 'VERIFYING_REVIEW_FIX'
  | 'REVIEW_FIX_COMMITTED'
  | 'REVIEW_FIX_PUSHED'
  | 'APPROVED'
  | 'MERGE_READY'
  | 'READY_FOR_HUMAN_MERGE'
  | 'MERGED'
  | 'CLOSED'
  | 'BLOCKED'
  | 'HUMAN_REVIEW_REQUIRED'
  | 'HUMAN_DECISION_REQUIRED'
  | 'FAILED';

export type ProvenanceType =
  | 'AUTONOMOUS'
  | 'HUMAN_PERMISSION_INTERVENTION'
  | 'HUMAN_JUDGMENT_INTERVENTION';

export type ReviewCategory =
  | 'ACTIONABLE_CODE_CHANGE'
  | 'ACTIONABLE_TEST_CHANGE'
  | 'ACTIONABLE_DOCUMENTATION_CHANGE'
  | 'QUESTION'
  | 'REQUEST_FOR_CLARIFICATION'
  | 'STYLE_OR_PREFERENCE'
  | 'CONFLICTING_REVIEW'
  | 'AMBIGUOUS_REQUEST'
  | 'SECURITY_SENSITIVE_REQUEST'
  | 'PROMPT_INJECTION'
  | 'HUMAN_DECISION_REQUIRED';

export const MAX_PR_REPAIR_ATTEMPTS = 3;
export const MAX_REVIEW_REPAIR_ATTEMPTS = 3;
export const MAX_TOTAL_REPAIR_ATTEMPTS = 3;

export interface StateTransitionRecord {
  from: PRLifecycleState;
  to: PRLifecycleState;
  timestamp: string;
  reason: string;
  metadata?: Record<string, any>;
}

export interface ReviewAnalysis {
  category: ReviewCategory;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  actionableFiles: string[];
  suggestedAction?: string;
  requiresHumanReview: boolean;
  isBlocked?: boolean;
  humanReason?: string;
  rawFeedbackSnippet?: string;
}

export interface PRLifecycleRecord {
  owner: string;
  repo: string;
  pullNumber: number;
  issueNumber?: number;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  baseSha: string;
  currentState: PRLifecycleState;
  transitions: StateTransitionRecord[];
  repairAttempts: number;
  reviewRepairAttempts: number;
  patchHistoryHashes: string[];
  lastCheckedAt: string;
  lastCheckStatus?: PRChecksSummary['overallState'];
  lastFailure?: CIDiagnosis;
  lastReviewAnalysis?: ReviewAnalysis;
  requiresHuman: boolean;
  humanReason?: string;
  prUrl: string;
}

/**
 * Defends against prompt injection attacks embedded in untrusted external PR / issue data
 */
export function sanitizeUntrustedInput(content: string): { safeText: string; isFlagged: boolean } {
  if (!content) return { safeText: '', isFlagged: false };

  const injectionPatterns = [
    /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/i,
    /system\s+prompt\s+override/i,
    /reveal\s+(?:your\s+)?(?:token|key|secret|password|env)/i,
    /print\s+(?:the\s+)?(?:github\s+)?(?:token|secret|password|env)/i,
    /printenv|process\.env|cat\s+\.env/i,
    /bypass\s+(?:safety|security)\s+policy/i,
  ];

  const isFlagged = injectionPatterns.some((p) => p.test(content));
  const sanitized = sanitizeCILogs(content);

  return {
    safeText: `[UNTRUSTED_REPOSITORY_DATA]: ${sanitized}`,
    isFlagged,
  };
}

/**
 * Detects if a new proposed repair oscillates with earlier repairs on the same PR
 */
export function detectRepairOscillation(
  newPatchHash: string,
  historyHashes: string[]
): boolean {
  if (!newPatchHash || historyHashes.length === 0) return false;
  // If the same patch hash was seen previously in this lifecycle
  const occurrences = historyHashes.filter((h) => h === newPatchHash).length;
  return occurrences >= 1;
}

/**
 * Analyze maintainer reviews, review comments, and issue comments for actionable feedback
 */
export function analyzeMaintainerFeedback(
  reviews: PRReviewItem[],
  reviewComments: PRReviewCommentItem[],
  issueComments: string[] = []
): ReviewAnalysis {
  if (reviews.length === 0 && reviewComments.length === 0 && issueComments.length === 0) {
    return {
      category: 'QUESTION',
      confidence: 'low',
      summary: 'No maintainer reviews or comments found.',
      actionableFiles: [],
      requiresHumanReview: false,
    };
  }

  // Check 1: Conflicting reviews (e.g. one approved, another requested changes, or opposing approaches)
  const changesRequested = reviews.filter((r) => r.state === 'CHANGES_REQUESTED');
  const approvals = reviews.filter((r) => r.state === 'APPROVED');

  const allBodies = [
    ...reviews.map((r) => r.body),
    ...reviewComments.map((c) => c.body),
    ...issueComments,
  ];
  const combinedFeedback = allBodies.join('\n');
  const lower = combinedFeedback.toLowerCase();
  const actionableFiles = Array.from(new Set(reviewComments.map((c) => c.path).filter(Boolean)));

  // Check 2: Prompt Injection Detection
  const { isFlagged } = sanitizeUntrustedInput(combinedFeedback);
  if (
    isFlagged ||
    lower.includes('ignore all previous instructions') ||
    lower.includes('system prompt override') ||
    lower.includes('print the github token') ||
    lower.includes('print the token') ||
    lower.includes('print token')
  ) {
    return {
      category: 'PROMPT_INJECTION',
      confidence: 'high',
      summary: 'Prompt injection attempt detected in reviewer comment.',
      actionableFiles: [],
      requiresHumanReview: true,
      isBlocked: true,
      humanReason: 'Reviewer comment contains adversarial prompt injection pattern. Autonomous execution blocked.',
      rawFeedbackSnippet: combinedFeedback.slice(0, 100),
    };
  }

  // Check 3: Security-Sensitive Request Detection
  if (
    lower.includes('disable auth') ||
    lower.includes('skip auth') ||
    lower.includes('bypass security') ||
    lower.includes('disable security') ||
    lower.includes('hardcode password') ||
    lower.includes('hardcode secret') ||
    lower.includes('allow all origins') ||
    lower.includes('remove permission') ||
    lower.includes('bypass cors') ||
    lower.includes('skip validation')
  ) {
    return {
      category: 'SECURITY_SENSITIVE_REQUEST',
      confidence: 'high',
      summary: 'Security-sensitive modification requested by maintainer.',
      actionableFiles,
      requiresHumanReview: true,
      humanReason: 'Reviewer requested change involving credentials, authentication bypass, permissions, or security controls. Human approval required.',
      rawFeedbackSnippet: combinedFeedback.slice(0, 100),
    };
  }

  // Check 4: Explicit Conflicting Reviews
  if (
    (changesRequested.length > 0 && approvals.length > 0) ||
    (lower.includes('use approach a') && lower.includes('use approach b')) ||
    (lower.includes('do not use approach a') && lower.includes('use approach a'))
  ) {
    return {
      category: 'CONFLICTING_REVIEW',
      confidence: 'high',
      summary: 'Conflicting maintainer reviews detected.',
      actionableFiles,
      requiresHumanReview: true,
      humanReason: 'Conflicting maintainer instructions detected across reviews. Human alignment required.',
      rawFeedbackSnippet: combinedFeedback.slice(0, 100),
    };
  }

  // Check 5: Ambiguous / Subjective Requests
  if (
    lower.includes('make this cleaner') ||
    lower.includes('looks messy') ||
    lower.includes('can you make this better') ||
    lower.includes('could be cleaner') ||
    lower.includes('improve the design')
  ) {
    return {
      category: 'AMBIGUOUS_REQUEST',
      confidence: 'high',
      summary: 'Ambiguous or subjective feedback without concrete actionable specification.',
      actionableFiles,
      requiresHumanReview: true,
      humanReason: 'Maintainer feedback is subjective or underspecified ("make this cleaner"). Human confirmation required.',
      rawFeedbackSnippet: combinedFeedback.slice(0, 100),
    };
  }

  // Check 6: Questions & Requests for Clarification
  if (
    lower.includes('why did you') ||
    lower.includes('can you explain') ||
    lower.includes('what is the reason') ||
    lower.includes('could you clarify') ||
    (combinedFeedback.includes('?') && !lower.includes('please add') && !lower.includes('please fix') && !lower.includes('please update'))
  ) {
    return {
      category: 'QUESTION',
      confidence: 'high',
      summary: 'Maintainer asked an explanatory question or requested clarification.',
      actionableFiles,
      requiresHumanReview: true,
      humanReason: 'Maintainer asked a question requiring author design explanation.',
      rawFeedbackSnippet: combinedFeedback.slice(0, 100),
    };
  }

  // Check 7: Actionable Test Change
  if (
    lower.includes('please add a regression test') ||
    lower.includes('add a regression test') ||
    lower.includes('add a test') ||
    lower.includes('add test case') ||
    lower.includes('covering the negative') ||
    lower.includes('negative input case') ||
    lower.includes('missing unit test')
  ) {
    return {
      category: 'ACTIONABLE_TEST_CHANGE',
      confidence: 'high',
      summary: 'Maintainer requested additional unit or regression test coverage.',
      actionableFiles,
      suggestedAction: 'Add requested test cases to the test suite and verify execution.',
      requiresHumanReview: false,
      rawFeedbackSnippet: combinedFeedback.slice(0, 100),
    };
  }

  // Check 8: Actionable Documentation Change
  if (
    lower.includes('typo') ||
    lower.includes('readme') ||
    lower.includes('docs') ||
    lower.includes('add comment') ||
    lower.includes('docstring')
  ) {
    return {
      category: 'ACTIONABLE_DOCUMENTATION_CHANGE',
      confidence: 'high',
      summary: 'Maintainer requested documentation, comment, or typo correction.',
      actionableFiles,
      suggestedAction: 'Update documentation, docstrings, or comments as requested.',
      requiresHumanReview: false,
      rawFeedbackSnippet: combinedFeedback.slice(0, 100),
    };
  }

  // Check 9: Style or Preference Change
  if (
    lower.includes('rename ') ||
    lower.includes('use const ') ||
    lower.includes('format code') ||
    lower.includes('style preference')
  ) {
    return {
      category: 'STYLE_OR_PREFERENCE',
      confidence: 'high',
      summary: 'Maintainer requested style or naming refinement.',
      actionableFiles,
      suggestedAction: 'Apply style/naming refinement and re-run typecheck and tests.',
      requiresHumanReview: false,
      rawFeedbackSnippet: combinedFeedback.slice(0, 100),
    };
  }

  // Check 10: Actionable Code Change
  if (
    changesRequested.length > 0 ||
    lower.includes('please change') ||
    lower.includes('please fix') ||
    lower.includes('please handle') ||
    lower.includes('refactor') ||
    lower.includes('null check') ||
    lower.includes('use helper')
  ) {
    return {
      category: 'ACTIONABLE_CODE_CHANGE',
      confidence: 'high',
      summary: 'Maintainer requested concrete code modification.',
      actionableFiles,
      suggestedAction: 'Implement requested code modification and verify regression tests.',
      requiresHumanReview: false,
      rawFeedbackSnippet: combinedFeedback.slice(0, 100),
    };
  }

  return {
    category: 'HUMAN_DECISION_REQUIRED',
    confidence: 'low',
    summary: 'Maintainer feedback requires product or architectural judgment.',
    actionableFiles,
    requiresHumanReview: true,
    humanReason: 'Maintainer feedback requires human product alignment before code modification.',
    rawFeedbackSnippet: combinedFeedback.slice(0, 100),
  };
}

/**
 * Autonomous PR Lifecycle Orchestrator
 */
export class PRLifecycleOrchestrator {
  private record: PRLifecycleRecord;
  private userToken?: string;

  constructor(initialData: {
    owner: string;
    repo: string;
    pullNumber: number;
    headBranch: string;
    headSha: string;
    baseBranch?: string;
    baseSha?: string;
    issueNumber?: number;
    prUrl?: string;
    userToken?: string;
  }) {
    this.userToken = initialData.userToken;
    this.record = {
      owner: initialData.owner,
      repo: initialData.repo,
      pullNumber: initialData.pullNumber,
      issueNumber: initialData.issueNumber,
      headBranch: initialData.headBranch,
      headSha: initialData.headSha,
      baseBranch: initialData.baseBranch || 'main',
      baseSha: initialData.baseSha || '',
      currentState: 'PR_CREATED',
      transitions: [
        {
          from: 'PR_CREATED',
          to: 'PR_CREATED',
          timestamp: new Date().toISOString(),
          reason: `Initialized lifecycle orchestrator for PR #${initialData.pullNumber}`,
        },
      ],
      repairAttempts: 0,
      reviewRepairAttempts: 0,
      patchHistoryHashes: [],
      lastCheckedAt: new Date().toISOString(),
      requiresHuman: false,
      prUrl: initialData.prUrl || `https://github.com/${initialData.owner}/${initialData.repo}/pull/${initialData.pullNumber}`,
    };
  }

  public getRecord(): PRLifecycleRecord {
    return { ...this.record };
  }

  /**
   * Explicitly transition the state machine and record provenance
   */
  public transitionTo(
    nextState: PRLifecycleState,
    reason: string,
    metadata?: Record<string, any>
  ): void {
    const prevState = this.record.currentState;
    this.record.currentState = nextState;
    this.record.lastCheckedAt = new Date().toISOString();

    if (nextState === 'HUMAN_REVIEW_REQUIRED' || nextState === 'HUMAN_DECISION_REQUIRED') {
      this.record.requiresHuman = true;
      this.record.humanReason = reason;
    }

    this.record.transitions.push({
      from: prevState,
      to: nextState,
      timestamp: new Date().toISOString(),
      reason,
      metadata,
    });

    console.log(`[PR Lifecycle #${this.record.pullNumber}] State Change: ${prevState} -> ${nextState} (${reason})`);
  }

  /**
   * Step 1: Poll live GitHub status and determine next autonomous step
   */
  public async evaluateCurrentStatus(): Promise<PRLifecycleRecord> {
    const status = await getPullRequestStatus(
      this.record.owner,
      this.record.repo,
      this.record.pullNumber,
      this.userToken
    );

    if (!status || !status.pr) {
      this.transitionTo('FAILED', `Could not fetch live PR data for #${this.record.pullNumber}`);
      return this.getRecord();
    }

    const { pr, checks, reviews, reviewComments } = status;

    // Check 1: Merged or Closed
    if (pr.merged) {
      this.transitionTo('MERGED', `PR #${this.record.pullNumber} has been merged into ${pr.base.ref}`);
      return this.getRecord();
    }
    if (pr.state === 'closed') {
      this.transitionTo('CLOSED', `PR #${this.record.pullNumber} was closed without merge.`);
      return this.getRecord();
    }

    // Check 2: Remote HEAD mismatch (Ensure remote branch matches expected commit)
    if (pr.head.sha !== this.record.headSha) {
      console.warn(`[PR Lifecycle] Remote HEAD changed from ${this.record.headSha} to ${pr.head.sha}`);
      this.record.headSha = pr.head.sha;
    }

    // Check 3: Check status evaluation
    this.record.lastCheckStatus = checks.overallState;

    if (checks.overallState === 'WORKFLOW_APPROVAL_REQUIRED' || checks.overallState === 'CHECKS_AWAITING_APPROVAL') {
      this.transitionTo(
        'WORKFLOW_APPROVAL_REQUIRED',
        'GitHub Actions workflows require maintainer approval for external fork PR. Pausing autonomous CI repair loop.',
        {
          pullNumber: this.record.pullNumber,
          headSha: this.record.headSha,
          headBranch: this.record.headBranch,
          requiredAction: 'Upstream maintainer must approve GitHub Actions workflow execution on GitHub.',
        }
      );
      this.transitionTo(
        'HUMAN_DECISION_REQUIRED',
        'GitHub Actions workflow run requires upstream maintainer authorization. Awaiting approval on GitHub.'
      );
      return this.getRecord();
    }

    if (checks.overallState === 'CHECKS_FAILED') {
      this.transitionTo('CHECKS_FAILED', `One or more CI checks failed (${checks.failedCount} failures).`);
      
      // Analyze failure
      const topFailure = checks.failedCheckDetails[0];
      const diagnosis = classifyCIFailure({
        name: topFailure?.name,
        conclusion: topFailure?.conclusion,
        outputSummary: topFailure?.summary,
      });

      this.record.lastFailure = diagnosis;

      if (!diagnosis.shouldAutoRepair || diagnosis.unrelatedFailure) {
        this.transitionTo(
          'HUMAN_REVIEW_REQUIRED',
          `CI failed due to non-repairable/infrastructure cause: ${diagnosis.rootCause}`
        );
        return this.getRecord();
      }

      // Check max repair limit
      if (this.record.repairAttempts >= MAX_PR_REPAIR_ATTEMPTS) {
        this.transitionTo(
          'HUMAN_REVIEW_REQUIRED',
          `Maximum repair attempts (${MAX_PR_REPAIR_ATTEMPTS}) reached for PR #${this.record.pullNumber}. Escalating to human review.`
        );
        return this.getRecord();
      }

      this.transitionTo('ANALYZING_FAILURE', `Diagnosed repairable failure: ${diagnosis.failureType} (${diagnosis.rootCause})`);
      return this.getRecord();
    }

    if (checks.overallState === 'CHECKS_PENDING' || checks.overallState === 'CHECKS_RUNNING') {
      this.transitionTo('CHECKS_RUNNING', `CI checks are currently in progress (${checks.pendingCount} pending).`);
      return this.getRecord();
    }

    if (checks.overallState === 'CHECKS_PASSED' || checks.overallState === 'NO_CHECKS_CONFIGURED') {
      if (this.record.currentState !== 'CHECKS_PASSED') {
        this.transitionTo(
          checks.overallState === 'CHECKS_PASSED' ? 'CHECKS_PASSED' : 'NO_CHECKS_CONFIGURED',
          checks.overallState === 'CHECKS_PASSED' ? 'All CI checks passed successfully.' : 'No CI checks configured on repository.'
        );
      }

      // Evaluate Maintainer Reviews
      if (reviews.length > 0 || reviewComments.length > 0) {
        this.transitionTo('REVIEW_DISCOVERED', `Discovered ${reviews.length} maintainer reviews and ${reviewComments.length} review comments.`);
        this.transitionTo('CLASSIFYING_REVIEW', 'Classifying maintainer review feedback safety and intent.');

        const reviewAnalysis = analyzeMaintainerFeedback(reviews, reviewComments);
        this.record.lastReviewAnalysis = reviewAnalysis;

        if (reviewAnalysis.isBlocked) {
          this.transitionTo('BLOCKED', reviewAnalysis.humanReason || 'Adversarial prompt injection detected. Execution blocked.');
          this.transitionTo('HUMAN_DECISION_REQUIRED', 'Adversarial prompt injection detected. Execution blocked; human decision required.');
          return this.getRecord();
        }

        if (reviewAnalysis.requiresHumanReview) {
          this.transitionTo('HUMAN_DECISION_REQUIRED', reviewAnalysis.humanReason || 'Maintainer review requires human judgment.');
          return this.getRecord();
        }

        const isActionable =
          reviewAnalysis.category === 'ACTIONABLE_CODE_CHANGE' ||
          reviewAnalysis.category === 'ACTIONABLE_TEST_CHANGE' ||
          reviewAnalysis.category === 'ACTIONABLE_DOCUMENTATION_CHANGE' ||
          reviewAnalysis.category === 'STYLE_OR_PREFERENCE';

        if (isActionable) {
          if (this.record.reviewRepairAttempts >= MAX_REVIEW_REPAIR_ATTEMPTS) {
            this.transitionTo('HUMAN_REVIEW_REQUIRED', `Max review repair limit (${MAX_REVIEW_REPAIR_ATTEMPTS}) reached.`);
            return this.getRecord();
          }
          this.transitionTo('PLANNING_REVIEW_FIX', `Planning fix for actionable maintainer feedback: ${reviewAnalysis.summary}`);
          return this.getRecord();
        }
      }

      if (status.reviewState === 'APPROVED') {
        this.transitionTo('APPROVED', 'Pull Request has been approved by maintainers.');
        if (pr.mergeable) {
          this.transitionTo('READY_FOR_HUMAN_MERGE', 'PR is approved, checks passed, and has no merge conflicts.');
        }
        return this.getRecord();
      }

      this.transitionTo('REVIEW_PENDING', 'Awaiting maintainer review.');
      return this.getRecord();
    }

    return this.getRecord();
  }

  /**
   * Records a completed code repair and checks for patch oscillation
   */
  public recordRepairCommit(newCommitSha: string, patchHash: string): boolean {
    if (detectRepairOscillation(patchHash, this.record.patchHistoryHashes)) {
      this.transitionTo(
        'HUMAN_REVIEW_REQUIRED',
        'Repair loop detected possible oscillation (patch reverses previous fix).'
      );
      return false;
    }

    this.record.repairAttempts++;
    this.record.headSha = newCommitSha;
    this.record.patchHistoryHashes.push(patchHash);
    this.transitionTo('REPAIR_COMMITTED', `Committed repair attempt #${this.record.repairAttempts} (${newCommitSha.slice(0, 7)})`);
    return true;
  }

  /**
   * Records a completed review fix and checks for patch oscillation
   */
  public recordReviewFixCommit(newCommitSha: string, patchHash: string): boolean {
    if (detectRepairOscillation(patchHash, this.record.patchHistoryHashes)) {
      this.transitionTo(
        'HUMAN_REVIEW_REQUIRED',
        'Review repair loop detected possible oscillation (patch reverses previous change).'
      );
      return false;
    }

    this.record.reviewRepairAttempts++;
    this.record.headSha = newCommitSha;
    this.record.patchHistoryHashes.push(patchHash);
    this.transitionTo('REVIEW_FIX_COMMITTED', `Committed review fix attempt #${this.record.reviewRepairAttempts} (${newCommitSha.slice(0, 7)})`);
    return true;
  }
}

/**
 * Reconstructs lifecycle state from live GitHub data
 */
export async function resumePRLifecycle(
  prDetails: { owner: string; repo: string; pullNumber: number },
  options?: { userToken?: string; previousRecord?: Partial<PRLifecycleRecord> }
): Promise<PRLifecycleOrchestrator> {
  const pr = await getPullRequest(prDetails.owner, prDetails.repo, prDetails.pullNumber, options?.userToken);
  if (!pr) {
    throw new Error(`Cannot resume PR #${prDetails.pullNumber}: repository or PR not found on GitHub.`);
  }

  const orchestrator = new PRLifecycleOrchestrator({
    owner: prDetails.owner,
    repo: prDetails.repo,
    pullNumber: prDetails.pullNumber,
    headBranch: pr.head.ref,
    headSha: pr.head.sha,
    baseBranch: pr.base.ref,
    baseSha: pr.base.sha,
    prUrl: pr.htmlUrl,
    userToken: options?.userToken,
  });

  // Re-evaluate live state
  await orchestrator.evaluateCurrentStatus();
  return orchestrator;
}
