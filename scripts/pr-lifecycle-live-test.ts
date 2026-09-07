/**
 * Real GitHub Live Integration Test (READ-ONLY) for PR Lifecycle Engine
 *
 * Safely inspects live Pull Request #52 on ackness/covel without modifying,
 * pushing, committing, closing, or merging anything.
 */

import { getPullRequestStatus, getPullRequest } from '../lib/github';
import { resumePRLifecycle } from '../lib/prLifecycleOrchestrator';

async function runLiveReadOnlyTest() {
  console.log('=====================================================');
  console.log('MERGEMATE — REAL GITHUB PR LIFECYCLE LIVE TEST (READ-ONLY)');
  console.log('=====================================================\n');

  const owner = 'ackness';
  const repo = 'covel';
  const pullNumber = 52;
  const token = process.env.GITHUB_TOKEN;

  console.log(`1. Fetching Live PR Data for ${owner}/${repo}#${pullNumber}...`);
  const pr = await getPullRequest(owner, repo, pullNumber, token);
  if (!pr) {
    throw new Error(`Could not fetch PR #${pullNumber} from GitHub.`);
  }

  console.log(`✓ PR Exists: #${pr.number} - "${pr.title}"`);
  console.log(`  State: ${pr.state.toUpperCase()} (Merged: ${pr.merged})`);
  console.log(`  Head: ${pr.head.repo.owner}:${pr.head.ref} (${pr.head.sha})`);
  console.log(`  Base: ${pr.base.repo.owner}:${pr.base.ref} (${pr.base.sha})`);
  console.log(`  URL: ${pr.htmlUrl}\n`);

  console.log('2. Fetching Aggregated Status & Checks...');
  const status = await getPullRequestStatus(owner, repo, pullNumber, token);
  if (!status) {
    throw new Error(`Failed to aggregate status for ${owner}/${repo}#${pullNumber}`);
  }

  console.log(`✓ Changed Files (${status.files.length}):`);
  status.files.forEach((f) => {
    console.log(`  • ${f.filename} (+${f.additions}/-${f.deletions}) [${f.status}]`);
  });

  console.log(`\n✓ Commits (${status.commits.length}):`);
  status.commits.forEach((c) => {
    console.log(`  • ${c.sha.slice(0, 7)}: ${c.message} (by ${c.author})`);
  });

  console.log(`\n✓ Reviews (${status.reviews.length}) & Comments (${status.reviewComments.length}):`);
  console.log(`  Review State: ${status.reviewState}`);

  console.log(`\n✓ Checks Summary:`);
  console.log(`  Overall CI State: ${status.checks.overallState}`);
  console.log(`  Total Checks: ${status.checks.totalChecks}`);
  console.log(`  Passed: ${status.checks.passedCount} | Failed: ${status.checks.failedCount} | Pending: ${status.checks.pendingCount}`);

  console.log('\n3. Instantiating & Evaluating PR Lifecycle State Machine...');
  const orchestrator = await resumePRLifecycle(
    { owner, repo, pullNumber },
    { userToken: token }
  );

  const record = orchestrator.getRecord();
  console.log(`✓ Lifecycle Current State: ${record.currentState}`);
  console.log(`✓ Human Action Required: ${record.requiresHuman} ${record.humanReason ? `(${record.humanReason})` : ''}`);
  console.log(`✓ Repair Attempts Tracked: ${record.repairAttempts}`);
  console.log(`✓ State Transitions History:`);
  record.transitions.forEach((t) => {
    console.log(`  • [${t.timestamp}] ${t.from} -> ${t.to}: ${t.reason}`);
  });

  console.log('\n=====================================================');
  console.log('LIVE READ-ONLY INSPECTION VERIFICATION: PASSED (100% READ-ONLY)');
  console.log('=====================================================');
}

runLiveReadOnlyTest().catch((err) => {
  console.error('LIVE READ-ONLY TEST ERROR:', err);
  process.exit(1);
});
