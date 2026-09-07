import { validateIssueCandidate, scoreIssueCandidate, createPR, IssueValidationResult } from '../lib/github';

// Helper assertion function
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
}

// Mock Octokit Factory
function createMockOctokit(config: {
  issueData?: any;
  repoData?: any;
  searchPrData?: any;
  issueErrorStatus?: number;
  repoErrorStatus?: number;
}) {
  return {
    rest: {
      issues: {
        get: async ({ owner, repo, issue_number }: any) => {
          if (config.issueErrorStatus) {
            const err: any = new Error(`HTTP ${config.issueErrorStatus}`);
            err.status = config.issueErrorStatus;
            throw err;
          }
          return {
            data: config.issueData || {
              id: 1001,
              number: issue_number,
              title: 'Fix TypeScript strict null check in Context Provider',
              body: 'When user logs out, undefined error thrown in StrictMode. ```const x = user?.id;```',
              state: 'open',
              state_reason: null,
              assignee: null,
              assignees: [],
              comments: 2,
              labels: [{ name: 'good first issue' }, { name: 'TypeScript' }],
              created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
              updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
              html_url: `https://github.com/${owner}/${repo}/issues/${issue_number}`,
            },
          };
        },
      },
      repos: {
        get: async ({ owner, repo }: any) => {
          if (config.repoErrorStatus) {
            const err: any = new Error(`HTTP ${config.repoErrorStatus}`);
            err.status = config.repoErrorStatus;
            throw err;
          }
          return {
            data: config.repoData || {
              id: 5001,
              name: repo,
              owner: { login: owner },
              archived: false,
              disabled: false,
              default_branch: 'main',
              language: 'TypeScript',
            },
          };
        },
      },
      search: {
        issuesAndPullRequests: async ({ q }: any) => {
          return {
            data: {
              total_count: (config.searchPrData || []).length,
              items: config.searchPrData || [],
            },
          };
        },
      },
    },
  } as any;
}

async function runTestSuite() {
  console.log('\n===============================================================');
  console.log('🧪 MERGEMATE DETERMINISTIC VALIDATION & SCORING TEST SUITE');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 10;

  // -------------------------------------------------------------
  // Test 1: Open issue -> accepted
  // -------------------------------------------------------------
  try {
    console.log('Test 1: Genuinely open, unassigned issue without competing PR...');
    const mockOctokit = createMockOctokit({
      issueData: {
        id: 101,
        number: 4892,
        title: 'Fix typo in React hook error message',
        body: 'The hook throws an error with a minor typo in production. ```const msg = "Invalid hook";```',
        state: 'open',
        state_reason: null,
        assignee: null,
        assignees: [],
        comments: 1,
        labels: [{ name: 'good first issue' }],
        updated_at: new Date().toISOString(),
      },
    });

    const result = await validateIssueCandidate('vercel', 'next.js', 4892, {
      octokitInstance: mockOctokit,
      targetTechStack: ['React', 'TypeScript'],
    });

    assert(result.isValid === true, 'Expected result.isValid to be true');
    assert(result.scoreBreakdown !== undefined, 'Expected score breakdown to be present');
    assert(result.scoreBreakdown!.score >= 70, 'Expected score >= 70');
    console.log(`  ✅ Passed: Issue accepted with score ${result.scoreBreakdown!.score}/100 (${result.scoreBreakdown!.confidence} confidence)`);
    passedTests++;
  } catch (e: any) {
    console.error(`  ❌ Failed Test 1:`, e.message);
  }

  // -------------------------------------------------------------
  // Test 2: Closed issue -> rejected
  // -------------------------------------------------------------
  try {
    console.log('Test 2: Closed issue...');
    const mockOctokit = createMockOctokit({
      issueData: {
        id: 102,
        number: 4893,
        title: 'Already resolved bug',
        body: 'This has already been resolved and merged.',
        state: 'closed',
        state_reason: 'completed',
        assignee: null,
        assignees: [],
      },
    });

    const result = await validateIssueCandidate('facebook', 'react', 4893, {
      octokitInstance: mockOctokit,
    });

    assert(result.isValid === false, 'Expected result.isValid to be false');
    assert(result.reason === 'ISSUE_CLOSED', `Expected reason 'ISSUE_CLOSED', got '${result.reason}'`);
    assert(result.isClosed === true, 'Expected result.isClosed to be true');
    console.log(`  ✅ Passed: Closed issue correctly rejected (${result.reason})`);
    passedTests++;
  } catch (e: any) {
    console.error(`  ❌ Failed Test 2:`, e.message);
  }

  // -------------------------------------------------------------
  // Test 3: Merged/closed PR appearing in search -> rejected
  // -------------------------------------------------------------
  try {
    console.log('Test 3: Merged/closed Pull Request appearing in search...');
    const mockOctokit = createMockOctokit({
      issueData: {
        id: 103,
        number: 500,
        title: 'feat: add support for node 20',
        body: 'Merged pull request for Node 20 support',
        state: 'closed',
        pull_request: {
          url: 'https://api.github.com/repos/nodejs/node/pulls/500',
          html_url: 'https://github.com/nodejs/node/pull/500',
          merged_at: '2025-01-01T00:00:00Z',
        },
      },
    });

    const result = await validateIssueCandidate('nodejs', 'node', 500, {
      octokitInstance: mockOctokit,
    });

    assert(result.isValid === false, 'Expected result.isValid to be false');
    assert(result.reason === 'IS_PULL_REQUEST', `Expected reason 'IS_PULL_REQUEST', got '${result.reason}'`);
    assert(result.isPullRequest === true, 'Expected isPullRequest to be true');
    console.log(`  ✅ Passed: Merged PR in search correctly rejected (${result.reason})`);
    passedTests++;
  } catch (e: any) {
    console.error(`  ❌ Failed Test 3:`, e.message);
  }

  // -------------------------------------------------------------
  // Test 4: Open PR appearing in search -> rejected
  // -------------------------------------------------------------
  try {
    console.log('Test 4: Open Pull Request appearing in search...');
    const mockOctokit = createMockOctokit({
      issueData: {
        id: 104,
        number: 501,
        title: 'fix: handle mongodb timeout properly',
        body: 'Draft PR for mongo timeout',
        state: 'open',
        pull_request: {
          url: 'https://api.github.com/repos/mongodb/node-mongodb-native/pulls/501',
          html_url: 'https://github.com/mongodb/node-mongodb-native/pull/501',
        },
      },
    });

    const result = await validateIssueCandidate('mongodb', 'node-mongodb-native', 501, {
      octokitInstance: mockOctokit,
    });

    assert(result.isValid === false, 'Expected result.isValid to be false');
    assert(result.reason === 'IS_PULL_REQUEST', `Expected reason 'IS_PULL_REQUEST', got '${result.reason}'`);
    console.log(`  ✅ Passed: Open PR in search correctly rejected (${result.reason})`);
    passedTests++;
  } catch (e: any) {
    console.error(`  ❌ Failed Test 4:`, e.message);
  }

  // -------------------------------------------------------------
  // Test 5: Open issue with assignee -> rejected
  // -------------------------------------------------------------
  try {
    console.log('Test 5: Open issue with an assignee...');
    const mockOctokit = createMockOctokit({
      issueData: {
        id: 105,
        number: 789,
        title: 'Refactor Express Router middleware',
        body: 'Router cleanup in express core',
        state: 'open',
        assignee: { login: 'dev-contributor' },
        assignees: [{ login: 'dev-contributor' }],
      },
    });

    const result = await validateIssueCandidate('expressjs', 'express', 789, {
      octokitInstance: mockOctokit,
    });

    assert(result.isValid === false, 'Expected result.isValid to be false');
    assert(result.reason === 'HAS_ASSIGNEES', `Expected reason 'HAS_ASSIGNEES', got '${result.reason}'`);
    assert(result.hasAssignees === true, 'Expected hasAssignees to be true');
    console.log(`  ✅ Passed: Assigned issue correctly rejected (${result.reason})`);
    passedTests++;
  } catch (e: any) {
    console.error(`  ❌ Failed Test 5:`, e.message);
  }

  // -------------------------------------------------------------
  // Test 6: Open issue with an active linked PR -> rejected
  // -------------------------------------------------------------
  try {
    console.log('Test 6: Open issue with an active competing PR...');
    const mockOctokit = createMockOctokit({
      issueData: {
        id: 106,
        number: 345,
        title: 'Fix memory leak in websocket listener',
        body: 'Detailed description of websocket leak',
        state: 'open',
        assignee: null,
        assignees: [],
      },
      searchPrData: [
        {
          id: 999,
          number: 346,
          title: 'fix: resolve memory leak in websocket listener (fixes #345)',
          body: 'This PR fixes #345 by cleaning up event listeners.',
          state: 'open',
          pull_request: { url: 'https://...' },
          html_url: 'https://github.com/org/repo/pull/346',
        },
      ],
    });

    const result = await validateIssueCandidate('org', 'repo', 345, {
      octokitInstance: mockOctokit,
    });

    assert(result.isValid === false, 'Expected result.isValid to be false');
    assert(result.reason === 'ACTIVE_PR_EXISTS', `Expected reason 'ACTIVE_PR_EXISTS', got '${result.reason}'`);
    assert(result.hasActivePr === true, 'Expected hasActivePr to be true');
    assert(result.activePrNumber === 346, `Expected active PR #346, got ${result.activePrNumber}`);
    console.log(`  ✅ Passed: Issue with active competing PR #346 rejected (${result.reason})`);
    passedTests++;
  } catch (e: any) {
    console.error(`  ❌ Failed Test 6:`, e.message);
  }

  // -------------------------------------------------------------
  // Test 7: Open issue with an old abandoned / closed PR -> accepted
  // -------------------------------------------------------------
  try {
    console.log('Test 7: Open issue with an old abandoned/closed PR...');
    const mockOctokit = createMockOctokit({
      issueData: {
        id: 107,
        number: 678,
        title: 'Add TypeScript types for config options',
        body: 'Need exported interfaces for config. ```export interface Config {}```',
        state: 'open',
        assignee: null,
        assignees: [],
        labels: [{ name: 'help wanted' }],
      },
      searchPrData: [
        {
          id: 888,
          number: 679,
          title: 'fix: attempted config types (fixes #678)',
          body: 'Abandoning this attempt.',
          state: 'closed', // PR is closed!
          pull_request: { url: 'https://...' },
        },
      ],
    });

    const result = await validateIssueCandidate('org', 'repo', 678, {
      octokitInstance: mockOctokit,
    });

    assert(result.isValid === true, 'Expected result.isValid to be true for closed past PRs');
    console.log(`  ✅ Passed: Issue with closed/abandoned past PR remains eligible`);
    passedTests++;
  } catch (e: any) {
    console.error(`  ❌ Failed Test 7:`, e.message);
  }

  // -------------------------------------------------------------
  // Test 8: Issue is open during search but becomes closed before PR creation -> PR cancelled
  // -------------------------------------------------------------
  try {
    console.log('Test 8: Pre-PR validation when issue is closed right before PR creation...');
    // Simulated live GitHub check returning 404 or closed issue
    const mockClosedOctokit = createMockOctokit({
      issueData: {
        id: 108,
        number: 999,
        title: 'Bug was closed by maintainer just now',
        body: 'Closing as resolved.',
        state: 'closed',
        state_reason: 'completed',
      },
    });

    // Directly test pre-PR validation check logic
    const preValidation = await validateIssueCandidate('vercel', 'next.js', 999, {
      octokitInstance: mockClosedOctokit,
    });

    assert(preValidation.isValid === false, 'Expected pre-PR validation to fail');
    assert(preValidation.isClosed === true, 'Expected isClosed to be true');
    console.log(`  ✅ Passed: Pre-flight check caught closed issue (${preValidation.reason})`);
    passedTests++;
  } catch (e: any) {
    console.error(`  ❌ Failed Test 8:`, e.message);
  }

  // -------------------------------------------------------------
  // Test 9: Archived repository -> rejected
  // -------------------------------------------------------------
  try {
    console.log('Test 9: Issue in an archived repository...');
    const mockOctokit = createMockOctokit({
      issueData: {
        id: 109,
        number: 123,
        title: 'Legacy issue in archived repo',
        body: 'Some old issue',
        state: 'open',
        assignee: null,
        assignees: [],
      },
      repoData: {
        id: 7001,
        name: 'old-repo',
        owner: { login: 'legacy-org' },
        archived: true, // Archived repo!
        disabled: false,
      },
    });

    const result = await validateIssueCandidate('legacy-org', 'old-repo', 123, {
      octokitInstance: mockOctokit,
    });

    assert(result.isValid === false, 'Expected result.isValid to be false');
    assert(result.reason === 'REPO_ARCHIVED', `Expected reason 'REPO_ARCHIVED', got '${result.reason}'`);
    assert(result.isArchivedRepo === true, 'Expected isArchivedRepo to be true');
    console.log(`  ✅ Passed: Archived repository correctly rejected (${result.reason})`);
    passedTests++;
  } catch (e: any) {
    console.error(`  ❌ Failed Test 9:`, e.message);
  }

  // -------------------------------------------------------------
  // Test 10: Valid beginner-friendly issue -> accepted and correctly scored
  // -------------------------------------------------------------
  try {
    console.log('Test 10: Valid beginner-friendly issue scoring breakdown...');
    const mockIssue = {
      id: 110,
      number: 4001,
      title: 'Fix React state initialization in MongoDB dashboard component',
      body: 'In React 18 strict mode, state initializes twice causing undefined array reference. Reproduction steps:\n```ts\nconst [data, setData] = useState([]);\n```\nExpected behavior: smooth mount without error.',
      state: 'open',
      assignee: null,
      assignees: [],
      comments: 2,
      labels: [{ name: 'good first issue' }, { name: 'bug' }, { name: 'React' }],
      updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const mockRepo = {
      name: 'dashboard-ui',
      language: 'TypeScript',
      archived: false,
    };

    const scoring = scoreIssueCandidate(mockIssue, mockRepo, ['React', 'TypeScript', 'MongoDB']);

    assert(scoring.score >= 80, `Expected score >= 80, got ${scoring.score}`);
    assert(scoring.confidence === 'high', `Expected confidence 'high', got ${scoring.confidence}`);
    assert(scoring.positiveSignals.length >= 3, `Expected at least 3 positive signals, got ${scoring.positiveSignals.length}`);
    
    console.log(`  ✅ Passed: Candidate scored ${scoring.score}/100 with '${scoring.confidence}' confidence.`);
    console.log(`     Positive signals: ${scoring.positiveSignals.join(' | ')}`);
    passedTests++;
  } catch (e: any) {
    console.error(`  ❌ Failed Test 10:`, e.message);
  }

  console.log('\n===============================================================');
  console.log(`📊 TEST RESULTS: ${passedTests}/${totalTests} PASSED (${Math.round((passedTests / totalTests) * 100)}%)`);
  console.log('===============================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTestSuite();
