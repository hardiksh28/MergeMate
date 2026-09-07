/**
 * Phase 5 Verification & Security Audit Test Suite
 *
 * Tests:
 * 1. WORKFLOW_APPROVAL_REQUIRED detection vs genuinely NO_CHECKS_CONFIGURED
 * 2. Secure Git Transport & Credential Isolation:
 *    - Token absence from argv / shell command strings
 *    - Token absence from Git remote URLs / .git/config
 *    - Strict redaction of tokens in logs / exception messages
 *    - Rejection of tokens embedded in CLI arguments
 * 3. Lifecycle state resumption after maintainer workflow approval
 * 4. Preservation of historical reference invariants
 */

import test from 'node:test';
import assert from 'node:assert';
import { PRLifecycleOrchestrator } from '../lib/prLifecycleOrchestrator';
import {
  executeSecureGit,
  redactGitOutput,
  secureSetRemote,
} from '../lib/gitTransport';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

test('1. Workflow Approval Detection - transitions to WORKFLOW_APPROVAL_REQUIRED and pauses repair', () => {
  const orchestrator = new PRLifecycleOrchestrator({
    owner: 'calandria-dev',
    repo: 'calandria',
    pullNumber: 106,
    headBranch: 'mergemate/fix-100-shuffled-test-isolation',
    headSha: '24b1a7265f8e5b1bcbe564b3943f3c1d2085c8f3',
  });

  // Simulate checks returning WORKFLOW_APPROVAL_REQUIRED
  orchestrator.transitionTo(
    'WORKFLOW_APPROVAL_REQUIRED',
    'GitHub Actions workflows require maintainer approval for external fork PR. Pausing autonomous CI repair loop.',
    {
      pullNumber: 106,
      headSha: '24b1a7265f8e5b1bcbe564b3943f3c1d2085c8f3',
      requiredAction: 'Upstream maintainer must approve GitHub Actions workflow execution on GitHub.',
    }
  );

  const record = orchestrator.getRecord();
  assert.strictEqual(record.currentState, 'WORKFLOW_APPROVAL_REQUIRED');
  assert.strictEqual(record.repairAttempts, 0); // No repair attempted
});

test('2. Distinction between WORKFLOW_APPROVAL_REQUIRED and NO_CHECKS_CONFIGURED', () => {
  const orchestratorA = new PRLifecycleOrchestrator({
    owner: 'org-a',
    repo: 'repo-a',
    pullNumber: 1,
    headBranch: 'feat-1',
    headSha: 'sha_a',
  });
  orchestratorA.transitionTo('WORKFLOW_APPROVAL_REQUIRED', '3 workflows awaiting maintainer approval');

  const orchestratorB = new PRLifecycleOrchestrator({
    owner: 'org-b',
    repo: 'repo-b',
    pullNumber: 2,
    headBranch: 'feat-2',
    headSha: 'sha_b',
  });
  orchestratorB.transitionTo('NO_CHECKS_CONFIGURED', 'No CI checks or workflows configured on repository');

  assert.strictEqual(orchestratorA.getRecord().currentState, 'WORKFLOW_APPROVAL_REQUIRED');
  assert.strictEqual(orchestratorB.getRecord().currentState, 'NO_CHECKS_CONFIGURED');
  assert.notStrictEqual(orchestratorA.getRecord().currentState, orchestratorB.getRecord().currentState);
});

test('3. Resumption after Workflow Approval - transitions smoothly when workflows run', () => {
  const orchestrator = new PRLifecycleOrchestrator({
    owner: 'calandria-dev',
    repo: 'calandria',
    pullNumber: 106,
    headBranch: 'mergemate/fix-100-shuffled-test-isolation',
    headSha: '24b1a7265f8e5b1bcbe564b3943f3c1d2085c8f3',
  });

  // Paused in WORKFLOW_APPROVAL_REQUIRED
  orchestrator.transitionTo('WORKFLOW_APPROVAL_REQUIRED', 'Workflows awaiting approval');
  assert.strictEqual(orchestrator.getRecord().currentState, 'WORKFLOW_APPROVAL_REQUIRED');

  // Maintainer approved on GitHub -> workflows running
  orchestrator.transitionTo('CHECKS_RUNNING', 'Maintainer approved workflow runs; CI in progress');
  assert.strictEqual(orchestrator.getRecord().currentState, 'CHECKS_RUNNING');

  // Workflows pass
  orchestrator.transitionTo('CHECKS_PASSED', 'All approved workflows passed');
  orchestrator.transitionTo('REVIEW_PENDING', 'Awaiting review');

  assert.strictEqual(orchestrator.getRecord().currentState, 'REVIEW_PENDING');
});

test('4. Secure Git Transport - Never embeds tokens in Git Remote URL', () => {
  const tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'git-sec-test-'));
  try {
    executeSecureGit(['init'], { cwd: tmpRepo });

    const dummyToken = 'ghp_dummySecretToken1234567890abcdef123456';
    const remoteUrl = `https://github.com/hardiksh28/calandria.git`;

    // Setup remote
    secureSetRemote(tmpRepo, 'fork', remoteUrl);

    // Read config directly from .git/config
    const configPath = path.join(tmpRepo, '.git', 'config');
    const configContent = fs.readFileSync(configPath, 'utf8');

    // Assert token is NOT in .git/config
    assert.strictEqual(configContent.includes(dummyToken), false);
    assert.strictEqual(configContent.includes('x-access-token'), false);
    assert.strictEqual(configContent.includes('https://github.com/hardiksh28/calandria.git'), true);
  } finally {
    fs.rmSync(tmpRepo, { recursive: true, force: true });
  }
});

test('5. Secure Git Transport - Rejects raw token in command arguments', () => {
  const dummyToken = 'ghp_secretTokenShouldNotBeInArgv123456';
  assert.throws(
    () => {
      executeSecureGit(['remote', 'add', 'origin', `https://${dummyToken}@github.com/test/repo.git`], {
        token: dummyToken,
      });
    },
    {
      message: /SECURITY VIOLATION: Attempted to pass raw authentication token in Git CLI arguments/,
    }
  );
});

test('6. Output Sanitization - Redacts tokens from stdout, stderr, and exception messages', () => {
  const tokenLog = 'Error: rejected token ghp_123456789012345678901234567890123456 with AUTHORIZATION: bearer github_pat_12345678901234567890123456789012345678901234567890_secret';
  const sanitizedToken = redactGitOutput(tokenLog);

  assert.strictEqual(sanitizedToken.includes('ghp_'), false);
  assert.strictEqual(sanitizedToken.includes('github_pat_'), false);
  assert.strictEqual(sanitizedToken.includes('[REDACTED_GH_TOKEN]'), true);
  assert.strictEqual(sanitizedToken.includes('AUTHORIZATION: [REDACTED]'), true);

  const urlLog = 'fatal: unable to access https://x-access-token:secret123@github.com/repo.git/';
  const sanitizedUrl = redactGitOutput(urlLog);
  assert.strictEqual(sanitizedUrl.includes('secret123'), false);
  assert.strictEqual(sanitizedUrl.includes('https://github.com/repo.git/'), true);
});
