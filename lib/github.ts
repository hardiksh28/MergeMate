import { Octokit } from '@octokit/rest';

export interface SearchIssueOptions {
  query?: string;
  techStack?: string[]; // e.g. ['React', 'TypeScript', 'Node.js', 'MongoDB']
  company?: string;
  repo?: string;
  issueType?: 'bug' | 'feature' | 'documentation' | 'test' | 'all';
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'all';
  limit?: number;
  userToken?: string;
}

export interface IssueScoreBreakdown {
  score: number; // 0 to 100
  confidence: 'high' | 'medium' | 'low';
  estimatedSolvability: 'high' | 'medium' | 'low';
  difficultyTier: 'beginner' | 'intermediate' | 'advanced';
  positiveSignals: string[];
  negativeSignals: string[];
}

export interface IssueValidationResult {
  isValid: boolean;
  reason?: string;
  statusCode?: number;
  isPullRequest?: boolean;
  isClosed?: boolean;
  hasAssignees?: boolean;
  isArchivedRepo?: boolean;
  hasActivePr?: boolean;
  activePrUrl?: string;
  activePrNumber?: number;
  issueData?: any;
  repoData?: any;
  scoreBreakdown?: IssueScoreBreakdown;
}

export interface GitHubIssueItem {
  id: number;
  number: number;
  title: string;
  body: string;
  url: string;
  html_url: string;
  state: string;
  comments_count: number;
  created_at: string;
  updated_at: string;
  owner: string;
  repo: string;
  repo_full_name: string;
  labels: string[];
  tech_stack: string[];
  score?: number;
  confidence?: 'high' | 'medium' | 'low';
  estimated_solvability?: 'high' | 'medium' | 'low';
  difficulty_tier?: 'beginner' | 'intermediate' | 'advanced';
  score_reasons?: string[];
  is_unassigned?: boolean;
}

export interface SpecificIssueTarget {
  owner: string;
  repo: string;
  issueNumber: number;
  rawUrl?: string;
}

export interface RepoStructureInfo {
  owner: string;
  repo: string;
  defaultBranch: string;
  primaryLanguage: string;
  fileTree: string[];
  configFiles: string[];
  hasTypeScript: boolean;
  packageJson?: any;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  availableScripts: Record<string, string>;
  hasTests: boolean;
  testFramework?: string;
  dependencies: Record<string, string>;
}

export interface SecurityScanResult {
  isSafe: boolean;
  issues: string[];
}

export interface FilePatchOperation {
  filePath: string;
  operation: 'create' | 'modify' | 'delete';
  content: string;
  previousContent?: string;
}

export interface DiffValidationResult {
  isValid: boolean;
  linesAdded: number;
  linesDeleted: number;
  totalLinesChanged: number;
  diffSummary: string;
  errors?: string[];
}

export interface MultiFileDiffValidationResult {
  isValid: boolean;
  filesChanged: number;
  totalLinesAdded: number;
  totalLinesDeleted: number;
  totalLinesChanged: number;
  diffSummary: string;
  fileDetails: { filePath: string; linesAdded: number; linesDeleted: number }[];
  errors: string[];
}

export interface CreatePROptions {
  owner: string;
  repo: string;
  issueNumber: number;
  generatedCode?: string;
  filePath?: string;
  multiFileChanges?: FilePatchOperation[];
  commitMessage?: string;
  prTitle?: string;
  prBody?: string;
  userToken?: string;
}

export interface PRResult {
  success: boolean;
  reason?: string;
  prUrl?: string;
  prNumber?: number;
  branchName?: string;
  forkOwner?: string;
  message: string;
  simulated?: boolean;
  diffPreview?: string;
}

/**
 * Get an initialized Octokit client
 */
export function getOctokit(customToken?: string): Octokit {
  const token = customToken || process.env.GITHUB_TOKEN;
  if (token && !token.includes('your_github_token')) {
    return new Octokit({ auth: token });
  }
  return new Octokit();
}

/**
 * Structured GitHub permission report.
 * SECURITY CONTRACT: The credential value is NEVER included in this result.
 * The token is accessed exclusively through the Octokit in-memory client.
 */
export interface GitHubPermissionReport {
  authenticated: boolean;
  login: string | null;
  tokenPresent: boolean;
  canReadPublicRepos: boolean;
  canCreateFork: boolean | 'unknown';
  canPushOwnRepo: boolean | 'unknown';
  canCreateExternalPR: boolean | 'unknown';
  error?: string;
}

/**
 * Safely probe GitHub permissions using in-memory credentials only.
 * NEVER logs, returns, or exposes the raw token value.
 * Performs real API calls to determine capability boundaries.
 */
export async function checkGitHubPermissions(): Promise<GitHubPermissionReport> {
  const tokenPresent =
    Boolean(process.env.GITHUB_TOKEN) &&
    !process.env.GITHUB_TOKEN!.includes('your_github_token');

  if (!tokenPresent) {
    return {
      authenticated: false,
      login: null,
      tokenPresent: false,
      canReadPublicRepos: false,
      canCreateFork: 'unknown',
      canPushOwnRepo: 'unknown',
      canCreateExternalPR: 'unknown',
    };
  }

  // Token is held by Octokit — never assigned to a variable that could be logged.
  const octokit = getOctokit();

  try {
    // Probe 1: Authentication + login (no credential in response)
    const userRes = await octokit.rest.users.getAuthenticated();
    const login = userRes.data.login;

    // Probe 2: Public repo read (non-destructive)
    let canReadPublicRepos = false;
    try {
      await octokit.rest.repos.get({ owner: 'github', repo: 'gitignore' });
      canReadPublicRepos = true;
    } catch {
      canReadPublicRepos = false;
    }

    // Probe 3: Push access to own repos (check via repo permissions field, no write)
    let canPushOwnRepo: boolean | 'unknown' = 'unknown';
    try {
      const ownRepos = await octokit.rest.repos.listForAuthenticatedUser({
        type: 'owner',
        per_page: 1,
      });
      if (ownRepos.data.length > 0) {
        canPushOwnRepo = ownRepos.data[0].permissions?.push === true;
      }
    } catch {
      canPushOwnRepo = 'unknown';
    }

    // Probe 4: Fork capability — check via rate-limited dry-run against a known small repo.
    // We do NOT actually fork. We check the token's scope by looking at response headers
    // on a GET request which reveals what scopes are active.
    let canCreateFork: boolean | 'unknown' = 'unknown';
    try {
      const repoCheck = await octokit.request('GET /repos/{owner}/{repo}', {
        owner: 'github',
        repo: 'gitignore',
      });
      // Fine-grained PATs won't have x-oauth-scopes; classic PATs expose scopes there.
      // If the token can read the repo, we know at minimum public read works.
      // Fork permission can only be confirmed by attempting it; we mark 'unknown' for fine-grained.
      const rawHeaders = repoCheck.headers as Record<string, string>;
      const scopes = (rawHeaders['x-oauth-scopes'] || '').split(',').map((s: string) => s.trim());
      if (scopes.includes('public_repo') || scopes.includes('repo')) {
        canCreateFork = true;
      } else if (scopes.length > 0 && scopes[0] !== '') {
        // Classic PAT with explicit scopes but not public_repo
        canCreateFork = false;
      } else {
        // Fine-grained PAT — scopes not advertised; cannot confirm without attempting
        canCreateFork = 'unknown';
      }
    } catch {
      canCreateFork = 'unknown';
    }

    const canCreateExternalPR: boolean | 'unknown' =
      canCreateFork === true ? true : canCreateFork === false ? false : 'unknown';

    return {
      authenticated: true,
      login,
      tokenPresent: true,
      canReadPublicRepos,
      canCreateFork,
      canPushOwnRepo,
      canCreateExternalPR,
    };
  } catch (err: any) {
    return {
      authenticated: false,
      login: null,
      tokenPresent: true,
      canReadPublicRepos: false,
      canCreateFork: 'unknown',
      canPushOwnRepo: 'unknown',
      canCreateExternalPR: 'unknown',
      error: err?.message || 'GitHub API authentication failed',
    };
  }
}

/**
 * Parse specific issue targets from user inputs
 */
export function parseIssueTarget(input: string): SpecificIssueTarget | null {
  if (!input || typeof input !== 'string') return null;

  // 1. Full URL pattern: https://github.com/owner/repo/issues/123
  const urlMatch = input.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\/issues\/(\d+)/i);
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      issueNumber: parseInt(urlMatch[3], 10),
      rawUrl: urlMatch[0],
    };
  }

  // 2. Shorthand pattern: owner/repo#123
  const shorthandMatch = input.match(/\b([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)#(\d+)\b/i);
  if (shorthandMatch) {
    return {
      owner: shorthandMatch[1],
      repo: shorthandMatch[2],
      issueNumber: parseInt(shorthandMatch[3], 10),
      rawUrl: `https://github.com/${shorthandMatch[1]}/${shorthandMatch[2]}/issues/${shorthandMatch[3]}`,
    };
  }

  // 3. Spaced pattern: owner/repo issue 123
  const spacedMatch = input.match(/\b([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)\s+(?:issue|issues|#)\s*(\d+)\b/i);
  if (spacedMatch) {
    return {
      owner: spacedMatch[1],
      repo: spacedMatch[2],
      issueNumber: parseInt(spacedMatch[3], 10),
      rawUrl: `https://github.com/${spacedMatch[1]}/${spacedMatch[2]}/issues/${spacedMatch[3]}`,
    };
  }

  return null;
}

/**
 * Robust Security Scanner: Scans generated code diffs before branch/PR creation
 * Ensures NO secrets, API keys, database connection strings, or .env files are committed.
 */
export function scanDiffForSecurityRisks(filePath: string, content: string): SecurityScanResult {
  const issues: string[] = [];

  // Check 1: Sensitive file paths
  const sensitiveFiles = [
    '.env',
    '.env.local',
    '.env.production',
    '.env.development',
    'id_rsa',
    'id_ed25519',
    '.npmrc',
    '.pypirc',
    'credentials.json',
    'service-account.json',
  ];
  if (sensitiveFiles.some(f => filePath.toLowerCase().endsWith(f))) {
    issues.push(`Refusing to commit sensitive credential file: ${filePath}`);
  }

  // Check 2: Comprehensive leaked credentials & token patterns
  const tokenPatterns = [
    { name: 'GitHub Personal Access Token', regex: /ghp_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]{50,}/ },
    { name: 'Google / Gemini API Key', regex: /AIzaSy[a-zA-Z0-9_-]{33}/ },
    { name: 'OpenAI Secret Key', regex: /sk-[a-zA-Z0-9_-]{32,}/ },
    { name: 'AWS Access Key ID', regex: /AKIA[0-9A-Z]{16}/ },
    { name: 'Private Key Header', regex: /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PRIVATE)? KEY-----/ },
    { name: 'Database Connection String with Password', regex: /(?:mongodb(\+srv)?|postgres(ql)?|mysql|redis):\/\/[a-zA-Z0-9_]+:[^@\s]+@[^\s'"]+/i },
    { name: 'Hardcoded Secret Assignment', regex: /(?:secret|password|auth_token|apiKey|api_key|private_key)\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}['"]/i },
  ];

  tokenPatterns.forEach(({ name, regex }) => {
    if (regex.test(content)) {
      issues.push(`Detected potential credential leak: ${name}`);
    }
  });

  return {
    isSafe: issues.length === 0,
    issues,
  };
}

/**
 * Validates the Final Diff before PR submission
 * Ensures change is reasonable, not empty, and free of merge conflict markers.
 */
export function validateFinalDiff(
  originalContent: string | undefined,
  patchedContent: string,
  filePath: string
): DiffValidationResult {
  const errors: string[] = [];

  // Check 1: Conflict markers
  if (patchedContent.includes('<<<<<<<') || patchedContent.includes('>>>>>>>') || patchedContent.includes('=======')) {
    errors.push('Patched file contains Git merge conflict markers.');
  }

  const origLines = originalContent ? originalContent.split('\n') : [];
  const patchLines = patchedContent.split('\n');

  // Calculate rough diff stats
  const origSet = new Set(origLines);
  const patchSet = new Set(patchLines);

  const linesAdded = patchLines.filter(l => !origSet.has(l)).length;
  const linesDeleted = origLines.filter(l => !patchSet.has(l)).length;
  const totalLinesChanged = linesAdded + linesDeleted;

  // Check 2: Empty change
  if (originalContent && originalContent.trim() === patchedContent.trim()) {
    errors.push('The generated patch does not introduce any code changes.');
  }

  // Check 3: Suspiciously massive change (> 350 lines changed for a non-doc file)
  const isDoc = filePath.endsWith('.md') || filePath.endsWith('.txt');
  if (!isDoc && totalLinesChanged > 350) {
    errors.push(`Patch changes ${totalLinesChanged} lines, which exceeds the safety threshold of 350 lines for autonomous fixes.`);
  }

  return {
    isValid: errors.length === 0,
    linesAdded,
    linesDeleted,
    totalLinesChanged,
    diffSummary: `+${linesAdded} / -${linesDeleted} lines in ${filePath}`,
    errors,
  };
}

/**
 * Validates a multi-file patch set before commit/PR
 */
export function validateMultiFileDiffSet(changes: FilePatchOperation[]): MultiFileDiffValidationResult {
  const errors: string[] = [];
  const fileDetails: { filePath: string; linesAdded: number; linesDeleted: number }[] = [];
  let totalLinesAdded = 0;
  let totalLinesDeleted = 0;

  if (!changes || changes.length === 0) {
    return {
      isValid: false,
      filesChanged: 0,
      totalLinesAdded: 0,
      totalLinesDeleted: 0,
      totalLinesChanged: 0,
      diffSummary: '0 files changed',
      fileDetails: [],
      errors: ['No file changes provided in patch set.'],
    };
  }

  const seenPaths = new Set<string>();

  for (const change of changes) {
    const { filePath, content, previousContent } = change;

    // Check 1: Path traversal protection
    if (filePath.includes('..') || filePath.startsWith('/') || filePath.startsWith('\\')) {
      errors.push(`Unsafe file path detected (path traversal attempt): ${filePath}`);
    }

    // Check 2: Duplicate modifications
    if (seenPaths.has(filePath)) {
      errors.push(`Duplicate modification targeting ${filePath} in single changeset.`);
    }
    seenPaths.add(filePath);

    // Check 3: Conflict markers
    if (content && (content.includes('<<<<<<<') || content.includes('>>>>>>>') || content.includes('======='))) {
      errors.push(`File ${filePath} contains Git merge conflict markers.`);
    }

    // Check 4: Security scan
    const secScan = scanDiffForSecurityRisks(filePath, content || '');
    if (!secScan.isSafe) {
      errors.push(`Security violation in ${filePath}: ${secScan.issues.join('; ')}`);
    }

    // Line stats
    const origLines = previousContent ? previousContent.split('\n') : [];
    const patchLines = content ? content.split('\n') : [];
    const origSet = new Set(origLines);
    const patchSet = new Set(patchLines);

    const added = patchLines.filter(l => !origSet.has(l)).length;
    const deleted = origLines.filter(l => !patchSet.has(l)).length;

    totalLinesAdded += added;
    totalLinesDeleted += deleted;
    fileDetails.push({ filePath, linesAdded: added, linesDeleted: deleted });
  }

  const totalLinesChanged = totalLinesAdded + totalLinesDeleted;
  const isTooLarge = totalLinesChanged > 800;
  if (isTooLarge) {
    errors.push(`Multi-file changeset modifies ${totalLinesChanged} lines, which exceeds the safety threshold of 800 lines.`);
  }

  return {
    isValid: errors.length === 0,
    filesChanged: changes.length,
    totalLinesAdded,
    totalLinesDeleted,
    totalLinesChanged,
    diffSummary: `${changes.length} files changed (+${totalLinesAdded} / -${totalLinesDeleted} lines)`,
    fileDetails,
    errors,
  };
}

/**
 * Deterministic Candidate Scoring Engine
 */
export function scoreIssueCandidate(
  issueData: any,
  repoData?: any,
  targetTechStack?: string[]
): IssueScoreBreakdown {
  let score = 50;
  const positiveSignals: string[] = [];
  const negativeSignals: string[] = [];

  const labels = (issueData.labels || []).map((l: any) =>
    (typeof l === 'string' ? l : l.name || '').toLowerCase()
  );
  const title = (issueData.title || '').toLowerCase();
  const body = (issueData.body || '').toLowerCase();
  const combinedText = `${title} ${body}`;

  // 1. Difficulty & Beginner signals
  let difficultyTier: 'beginner' | 'intermediate' | 'advanced' = 'intermediate';
  if (labels.some((l: string) => l.includes('good first issue') || l.includes('good-first-issue') || l.includes('starter') || l.includes('beginner') || l.includes('easy'))) {
    score += 25;
    difficultyTier = 'beginner';
    positiveSignals.push('Beginner-friendly label ("good first issue") (+25)');
  } else if (labels.some((l: string) => l.includes('help wanted') || l.includes('help-wanted') || l.includes('up-for-grabs'))) {
    score += 15;
    positiveSignals.push('Community contribution label ("help wanted") (+15)');
  } else if (labels.some((l: string) => l.includes('complex') || l.includes('hard') || l.includes('architecture') || l.includes('breaking'))) {
    difficultyTier = 'advanced';
    score -= 10;
    negativeSignals.push('Advanced/architectural complexity label (-10)');
  }

  // 2. Actionable bug or documentation label
  if (labels.some((l: string) => l.includes('bug') || l.includes('fix') || l.includes('documentation') || l.includes('docs') || l.includes('types') || l.includes('typo'))) {
    score += 10;
    positiveSignals.push('Clear bug fix or documentation improvement (+10)');
  }

  // 3. Description quality & code snippets
  const bodyLen = (issueData.body || '').trim().length;
  if (bodyLen >= 80 && bodyLen <= 4000) {
    score += 10;
    positiveSignals.push('Detailed, well-structured description (+10)');
  } else if (bodyLen < 30) {
    score -= 20;
    negativeSignals.push('Extremely short/vague description (-20)');
  }

  if (body.includes('```') || body.includes('reproduce') || body.includes('error:') || body.includes('expected:')) {
    score += 10;
    positiveSignals.push('Contains code block or reproduction steps (+10)');
  }

  // 4. Update recency
  const updatedAt = new Date(issueData.updated_at || issueData.created_at || Date.now()).getTime();
  const daysSinceUpdate = (Date.now() - updatedAt) / (1000 * 60 * 60 * 24);

  if (daysSinceUpdate <= 14) {
    score += 15;
    positiveSignals.push('Recently active in the last 14 days (+15)');
  } else if (daysSinceUpdate <= 45) {
    score += 10;
    positiveSignals.push('Active in the last 45 days (+10)');
  } else if (daysSinceUpdate > 180) {
    score -= 20;
    negativeSignals.push('Stale issue (inactive for > 6 months) (-20)');
  }

  // 5. Discussion complexity & comment count
  const comments = Number(issueData.comments || issueData.comments_count || 0);
  if (comments <= 5) {
    score += 10;
    positiveSignals.push('Low discussion noise / clean candidate (+10)');
  } else if (comments > 20) {
    score -= 15;
    negativeSignals.push('High discussion volume / complex debate (-15)');
  }

  // 6. Actionable verbs in title
  const actionableVerbs = ['fix', 'add', 'resolve', 'type', 'handle', 'support', 'update', 'remove', 'export', 'implement', 'clean'];
  if (actionableVerbs.some(verb => title.split(/\s+/).includes(verb))) {
    score += 10;
    positiveSignals.push('Actionable title with clear verb (+10)');
  }

  // 7. Tech Stack match
  const defaultStack = targetTechStack && targetTechStack.length > 0
    ? targetTechStack
    : ['React', 'TypeScript', 'Node.js', 'MongoDB'];

  let matchedTechCount = 0;
  defaultStack.forEach((tech) => {
    const t = tech.toLowerCase();
    if (combinedText.includes(t) || (repoData?.language && repoData.language.toLowerCase().includes(t))) {
      matchedTechCount++;
    }
  });

  if (matchedTechCount > 0) {
    const techBoost = Math.min(matchedTechCount * 5, 15);
    score += techBoost;
    positiveSignals.push(`Matches target tech stack (${matchedTechCount} tags matched) (+${techBoost})`);
  }

  // 8. Maintainer-only filter
  const maintainerKeywords = ['release', 'deploy', 'publish npm', 'security advisory', 'cve-', 'bump version', 'ci pipeline', 'triage'];
  if (maintainerKeywords.some(k => title.includes(k))) {
    score -= 30;
    negativeSignals.push('Requires repository maintainer permissions or release privileges (-30)');
  }

  const finalScore = Math.max(5, Math.min(100, score));

  let confidence: 'high' | 'medium' | 'low' = 'low';
  let estimatedSolvability: 'high' | 'medium' | 'low' = 'low';

  if (finalScore >= 75) {
    confidence = 'high';
    estimatedSolvability = 'high';
  } else if (finalScore >= 50) {
    confidence = 'medium';
    estimatedSolvability = 'medium';
  }

  return {
    score: finalScore,
    confidence,
    estimatedSolvability,
    difficultyTier,
    positiveSignals,
    negativeSignals,
  };
}

/**
 * Deterministic Issue Validation Layer
 */
export async function validateIssueCandidate(
  owner: string,
  repo: string,
  issueNumber: number,
  options?: { userToken?: string; octokitInstance?: Octokit; targetTechStack?: string[] }
): Promise<IssueValidationResult> {
  const octokit = options?.octokitInstance || getOctokit(options?.userToken);

  try {
    // 1. Fetch live issue from GitHub API
    const issueRes = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });
    const issueData = issueRes.data;

    // Check if issue is actually a Pull Request
    if (issueData.pull_request || (issueData as any).html_url?.includes('/pull/')) {
      return {
        isValid: false,
        reason: 'IS_PULL_REQUEST',
        isPullRequest: true,
        statusCode: 200,
        issueData,
      };
    }

    // Check if issue is closed
    if (issueData.state !== 'open' || issueData.state_reason === 'completed' || issueData.state_reason === 'not_planned') {
      return {
        isValid: false,
        reason: 'ISSUE_CLOSED',
        isClosed: true,
        statusCode: 200,
        issueData,
      };
    }

    // Check assignees
    const hasAssignee = Boolean(
      issueData.assignee ||
      (issueData.assignees && issueData.assignees.length > 0)
    );
    if (hasAssignee) {
      return {
        isValid: false,
        reason: 'HAS_ASSIGNEES',
        hasAssignees: true,
        statusCode: 200,
        issueData,
      };
    }

    // 2. Fetch repository details
    let repoData: any = null;
    try {
      const repoRes = await octokit.rest.repos.get({ owner, repo });
      repoData = repoRes.data;
      if (repoData.archived || repoData.disabled) {
        return {
          isValid: false,
          reason: 'REPO_ARCHIVED',
          isArchivedRepo: true,
          statusCode: 200,
          issueData,
          repoData,
        };
      }
    } catch (repoErr: any) {
      console.warn(`[GitHub Validation] Could not fetch repository status for ${owner}/${repo}:`, repoErr?.message);
    }

    // 3. Detect existing active Pull Requests
    try {
      const prSearchQuery = `type:pr is:open repo:${owner}/${repo} ${issueNumber}`;
      const prSearchResults = await octokit.rest.search.issuesAndPullRequests({
        q: prSearchQuery,
        per_page: 5,
      });

      const activeLinkedPR = (prSearchResults.data.items || []).find((prItem: any) => {
        if (!prItem.pull_request) return false;
        if (prItem.state !== 'open') return false;

        const prText = `${prItem.title} ${prItem.body || ''}`.toLowerCase();
        const issueRefPattern = new RegExp(`(#${issueNumber}\\b|issues/${issueNumber}\\b|fix(es)?\\s+#?${issueNumber}\\b|close(s)?\\s+#?${issueNumber}\\b|resolve(s)?\\s+#?${issueNumber}\\b)`, 'i');
        return issueRefPattern.test(prText);
      });

      if (activeLinkedPR) {
        return {
          isValid: false,
          reason: 'ACTIVE_PR_EXISTS',
          hasActivePr: true,
          activePrUrl: activeLinkedPR.html_url,
          activePrNumber: activeLinkedPR.number,
          statusCode: 200,
          issueData,
          repoData,
        };
      }
    } catch (prSearchErr: any) {
      console.warn(`[GitHub Validation] Active PR check skipped:`, prSearchErr?.message);
    }

    // 4. Compute candidate quality score
    const scoreBreakdown = scoreIssueCandidate(issueData, repoData, options?.targetTechStack);

    return {
      isValid: true,
      statusCode: 200,
      issueData,
      repoData,
      scoreBreakdown,
    };
  } catch (error: any) {
    const status = error?.status || error?.statusCode || 500;
    const msg = error?.message || String(error);

    if (status === 404) {
      return { isValid: false, reason: 'ISSUE_NOT_FOUND', statusCode: 404 };
    }
    if (status === 410) {
      return { isValid: false, reason: 'ISSUE_GONE', statusCode: 410 };
    }
    if (status === 403) {
      return { isValid: false, reason: 'RATE_LIMITED_OR_FORBIDDEN', statusCode: 403 };
    }
    if (status === 401) {
      return { isValid: false, reason: 'AUTH_FAILED', statusCode: 401 };
    }

    return {
      isValid: false,
      reason: `API_ERROR: ${msg}`,
      statusCode: status,
    };
  }
}

/**
 * Direct Specific Issue Fetch & Validation
 */
export async function fetchAndValidateSpecificIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  options?: { userToken?: string; octokitInstance?: Octokit } | string
): Promise<{ issue: GitHubIssueItem | null; validation: IssueValidationResult }> {
  const token = typeof options === 'string' ? options : options?.userToken;
  const octokitInstance = typeof options === 'object' ? options?.octokitInstance : undefined;
  const validation = await validateIssueCandidate(owner, repo, issueNumber, { userToken: token, octokitInstance });
  if (!validation.isValid || !validation.issueData) {
    return { issue: null, validation };
  }

  const issueData = validation.issueData;
  const labelNames = (issueData.labels || []).map((l: any) => (typeof l === 'string' ? l : l.name || ''));
  const scoreInfo = validation.scoreBreakdown || scoreIssueCandidate(issueData, validation.repoData);

  const titleAndBody = `${issueData.title} ${issueData.body || ''}`.toLowerCase();
  const detectedTech: string[] = [];
  if (titleAndBody.includes('react') || titleAndBody.includes('jsx') || titleAndBody.includes('tsx')) detectedTech.push('React');
  if (titleAndBody.includes('typescript') || titleAndBody.includes('ts')) detectedTech.push('TypeScript');
  if (titleAndBody.includes('node') || titleAndBody.includes('express') || titleAndBody.includes('backend')) detectedTech.push('Node.js');
  if (titleAndBody.includes('mongo') || titleAndBody.includes('mongoose')) detectedTech.push('MongoDB');
  if (detectedTech.length === 0) detectedTech.push('TypeScript', 'React');

  const issue: GitHubIssueItem = {
    id: issueData.id,
    number: issueData.number,
    title: issueData.title,
    body: issueData.body || 'No description provided.',
    url: issueData.url,
    html_url: issueData.html_url,
    state: 'open',
    comments_count: issueData.comments || 0,
    created_at: issueData.created_at,
    updated_at: issueData.updated_at,
    owner,
    repo,
    repo_full_name: `${owner}/${repo}`,
    labels: labelNames,
    tech_stack: detectedTech,
    score: scoreInfo.score,
    confidence: scoreInfo.confidence,
    estimated_solvability: scoreInfo.estimatedSolvability,
    difficulty_tier: scoreInfo.difficultyTier,
    score_reasons: scoreInfo.positiveSignals,
    is_unassigned: true,
  };

  return { issue, validation };
}

/**
 * Generalized GitHub Issue Search
 */
export async function searchIssues(options: SearchIssueOptions): Promise<GitHubIssueItem[]> {
  const octokit = getOctokit(options.userToken);
  const limit = options.limit || 8;

  let queryString = `is:issue state:open archived:false no:assignee`;

  if (options.repo) {
    queryString += ` repo:${options.repo}`;
  } else if (options.company) {
    queryString += ` org:${options.company}`;
  }

  // GitHub Search silently returns ZERO results (not an error) once a query
  // exceeds its cap of ~5 combined AND/OR/NOT operators — every clause below
  // is kept to at most one OR (2 alternatives) so the worst case (difficulty
  // + issueType + tech, all active at once) stays safely under that limit.
  if (options.difficulty === 'beginner') {
    queryString += ` (label:"good first issue" OR label:"help wanted")`;
  } else if (options.difficulty === 'intermediate') {
    queryString += ` (label:"help wanted" OR label:"bug")`;
  } else if (options.difficulty === 'advanced') {
    queryString += ` (label:"complex" OR label:"architecture")`;
  }

  if (options.issueType === 'bug') {
    queryString += ` label:bug`;
  } else if (options.issueType === 'documentation') {
    queryString += ` label:documentation`;
  } else if (options.issueType === 'test') {
    queryString += ` label:test`;
  } else if (options.issueType === 'feature') {
    queryString += ` label:enhancement`;
  }

  if (options.query) {
    queryString += ` ${options.query}`;
  } else {
    // GitHub's search ANDs space-separated bare terms, so joining tech names
    // with plain spaces required an issue to mention ALL of them at once —
    // almost never true — which silently starved every search down to zero
    // results. OR-group them instead: match issues touching ANY one of them.
    // Capped to 2 terms (1 OR) to stay under the operator limit above.
    const stack = options.techStack && options.techStack.length > 0
      ? options.techStack
      : ['React', 'TypeScript'];
    queryString += ` (${stack.slice(0, 2).map((t) => `"${t}"`).join(' OR ')})`;
  }

  queryString += ` stars:>30`;

  try {
    const searchRes = await octokit.rest.search.issuesAndPullRequests({
      q: queryString,
      sort: 'updated',
      order: 'desc',
      per_page: Math.min(limit * 3, 30),
    });

    const rawItems = searchRes.data.items || [];
    const validatedCandidates: GitHubIssueItem[] = [];

    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i];
      const repoParts = item.repository_url.split('/');
      const repo = repoParts.pop() || '';
      const owner = repoParts.pop() || '';

      if (!owner || !repo || !item.number) continue;

      // Each candidate triggers 2-3 follow-up API calls (issue/repo lookups,
      // an active-PR search). Firing all of them back-to-back for up to ~30
      // raw candidates reliably trips GitHub's secondary abuse rate limiter
      // (a separate, much stricter limiter than the documented per-hour
      // quota) — a brief pause between candidates keeps this well clear of it.
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, 400));

      const validation = await validateIssueCandidate(owner, repo, item.number, {
        octokitInstance: octokit,
        targetTechStack: options.techStack,
      });

      if (!validation.isValid) continue;

      const issueData = validation.issueData || item;
      const labelNames = (issueData.labels || []).map((l: any) => (typeof l === 'string' ? l : l.name || ''));
      const titleAndBody = `${issueData.title} ${issueData.body || ''}`.toLowerCase();
      
      const detectedTech: string[] = [];
      if (titleAndBody.includes('react') || titleAndBody.includes('jsx') || titleAndBody.includes('tsx')) detectedTech.push('React');
      if (titleAndBody.includes('typescript') || titleAndBody.includes('ts')) detectedTech.push('TypeScript');
      if (titleAndBody.includes('node') || titleAndBody.includes('express') || titleAndBody.includes('backend')) detectedTech.push('Node.js');
      if (titleAndBody.includes('mongo') || titleAndBody.includes('mongoose')) detectedTech.push('MongoDB');
      if (detectedTech.length === 0) detectedTech.push('TypeScript', 'React');

      const scoreInfo = validation.scoreBreakdown || scoreIssueCandidate(issueData, validation.repoData, options.techStack);

      validatedCandidates.push({
        id: issueData.id || item.id,
        number: issueData.number || item.number,
        title: issueData.title || item.title,
        body: issueData.body ? issueData.body.substring(0, 300) + '...' : 'No description provided.',
        url: issueData.url || item.url,
        html_url: issueData.html_url || item.html_url,
        state: 'open',
        comments_count: issueData.comments || item.comments || 0,
        created_at: issueData.created_at || item.created_at,
        updated_at: issueData.updated_at || item.updated_at,
        owner,
        repo,
        repo_full_name: `${owner}/${repo}`,
        labels: labelNames,
        tech_stack: Array.from(new Set(detectedTech)),
        score: scoreInfo.score,
        confidence: scoreInfo.confidence,
        estimated_solvability: scoreInfo.estimatedSolvability,
        difficulty_tier: scoreInfo.difficultyTier,
        score_reasons: scoreInfo.positiveSignals,
        is_unassigned: true,
      });
    }

    validatedCandidates.sort((a, b) => (b.score || 0) - (a.score || 0));

    if (validatedCandidates.length === 0) {
      return getFallbackIssues(options.query || '');
    }

    return validatedCandidates.slice(0, limit);
  } catch (error: any) {
    console.error('[GitHub API] Issue search error:', error?.message || error);
    return getFallbackIssues(options.query || '');
  }
}

/**
 * Retrieve specific file content from GitHub repository
 */
export async function getFileContent(
  owner: string,
  repo: string,
  filePath: string,
  ref?: string,
  userToken?: string
): Promise<{ path: string; content: string; sha?: string } | null> {
  const octokit = getOctokit(userToken);
  try {
    const res: any = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: filePath,
      ref,
    });

    if (res.data && res.data.content) {
      const decoded = Buffer.from(res.data.content, 'base64').toString('utf-8');
      return {
        path: filePath,
        content: decoded,
        sha: res.data.sha,
      };
    }
    return null;
  } catch (error: any) {
    console.warn(`[GitHub Repo] Could not retrieve file ${filePath} in ${owner}/${repo}:`, error?.message);
    return null;
  }
}

/**
 * Search code within target repository
 */
export async function searchCodeInRepo(
  owner: string,
  repo: string,
  query: string,
  userToken?: string
): Promise<{ path: string; html_url: string }[]> {
  const octokit = getOctokit(userToken);
  try {
    const res = await octokit.rest.search.code({
      q: `${query} repo:${owner}/${repo}`,
      per_page: 5,
    });
    return (res.data.items || []).map((item: any) => ({
      path: item.path,
      html_url: item.html_url,
    }));
  } catch (error: any) {
    console.warn(`[GitHub Code Search] Search failed for '${query}' in ${owner}/${repo}:`, error?.message);
    return [];
  }
}

/**
 * Progressive Repository Structure Explorer
 */
export async function getRepoStructure(
  owner: string,
  repo: string,
  userToken?: string
): Promise<RepoStructureInfo> {
  const octokit = getOctokit(userToken);
  try {
    const repoInfo = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoInfo.data.default_branch || 'main';

    let fileTree: string[] = [];
    try {
      const treeRes = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: defaultBranch,
        recursive: 'true',
      });
      fileTree = (treeRes.data.tree || [])
        .filter((item: any) => item.type === 'blob' && !item.path.includes('node_modules') && !item.path.includes('.git/'))
        .map((item: any) => item.path);
    } catch {
      fileTree = ['src/index.ts', 'src/App.tsx', 'package.json', 'README.md'];
    }

    // Try reading package.json
    let packageJson: any = null;
    let dependencies: Record<string, string> = {};
    let availableScripts: Record<string, string> = {};
    const pkgFile = await getFileContent(owner, repo, 'package.json', defaultBranch, userToken);
    if (pkgFile?.content) {
      try {
        packageJson = JSON.parse(pkgFile.content);
        dependencies = {
          ...(packageJson.dependencies || {}),
          ...(packageJson.devDependencies || {}),
        };
        availableScripts = packageJson.scripts || {};
      } catch {}
    }

    // Detect package manager
    let packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' = 'npm';
    if (fileTree.includes('pnpm-lock.yaml')) packageManager = 'pnpm';
    else if (fileTree.includes('yarn.lock')) packageManager = 'yarn';
    else if (fileTree.includes('bun.lockb')) packageManager = 'bun';

    // Detect test framework
    const hasTests = fileTree.some(f => f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'));
    let testFramework = 'none';
    if (dependencies['jest'] || dependencies['@types/jest']) testFramework = 'jest';
    else if (dependencies['vitest']) testFramework = 'vitest';
    else if (dependencies['mocha']) testFramework = 'mocha';
    else if (hasTests) testFramework = 'generic';

    // Detect language and configs
    const primaryLanguage = repoInfo.data.language || 'TypeScript';
    const configFiles = fileTree.filter(f => 
      f.includes('tsconfig') || f.includes('.eslintrc') || f.includes('eslint.config') ||
      f.includes('jest.config') || f.includes('vitest.config') || f.includes('pyproject.toml') ||
      f.includes('Cargo.toml') || f.includes('go.mod') || f.includes('webpack.config') || f.includes('vite.config')
    );
    const hasTypeScript = fileTree.some(f => f.endsWith('.ts') || f.endsWith('.tsx') || f.includes('tsconfig'));

    return {
      owner,
      repo,
      defaultBranch,
      primaryLanguage,
      fileTree: fileTree.slice(0, 50),
      configFiles,
      hasTypeScript,
      packageJson,
      packageManager,
      availableScripts,
      hasTests,
      testFramework,
      dependencies,
    };
  } catch (error: any) {
    console.warn(`[GitHub Repo Explorer] Error reading structure for ${owner}/${repo}:`, error?.message);
    return {
      owner,
      repo,
      defaultBranch: 'main',
      primaryLanguage: 'TypeScript',
      fileTree: ['src/index.ts', 'src/App.tsx', 'package.json', 'README.md'],
      configFiles: ['tsconfig.json'],
      hasTypeScript: true,
      packageManager: 'npm',
      availableScripts: { test: 'jest' },
      hasTests: true,
      testFramework: 'jest',
      dependencies: { typescript: '^5.0.0', react: '^18.0.0' },
    };
  }
}

/**
 * Fetch issue details and repository file tree
 */
export async function getIssueDetails(owner: string, repo: string, issueNumber: number, userToken?: string) {
  const octokit = getOctokit(userToken);
  try {
    const issueRes = await octokit.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    const structure = await getRepoStructure(owner, repo, userToken);

    return {
      issue: {
        number: issueRes.data.number,
        title: issueRes.data.title,
        body: issueRes.data.body,
        html_url: issueRes.data.html_url,
        owner,
        repo,
      },
      relevantFiles: structure.fileTree.slice(0, 30),
      repoStructure: structure,
    };
  } catch (error: any) {
    console.warn(`[GitHub API] Failed to fetch live issue details for ${owner}/${repo}#${issueNumber}:`, error?.message);
    return {
      issue: {
        number: issueNumber,
        title: `Fix issue #${issueNumber} in ${repo}`,
        body: `Automated fix targeting open issue #${issueNumber} in ${owner}/${repo}.`,
        html_url: `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
        owner,
        repo,
      },
      relevantFiles: ['src/index.ts', 'src/App.tsx', 'lib/server.ts', 'models/schema.ts'],
    };
  }
}

/**
 * Polls GitHub API until a newly created fork repository is fully initialized
 */
async function waitForForkReady(
  octokit: Octokit,
  forkOwner: string,
  repo: string,
  maxAttempts: number = 10,
  intervalMs: number = 3000
): Promise<boolean> {
  console.log(`[GitHub Engine] Polling for fork initialization: ${forkOwner}/${repo}...`);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const forkRepo = await octokit.rest.repos.get({
        owner: forkOwner,
        repo: repo,
      });
      if (forkRepo.data && forkRepo.data.id) {
        console.log(`[GitHub Engine] Fork ${forkOwner}/${repo} is ready! (attempt ${attempt})`);
        return true;
      }
    } catch (err: any) {
      console.log(`[GitHub Engine] Fork pending... attempt ${attempt}/${maxAttempts} (${err?.message || 'not ready'})`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/**
 * Cross-repository Pull Request engine with Mandatory Pre-PR Security, Diff, and Validation Gates
 */
export async function createPR(options: CreatePROptions): Promise<PRResult> {
  const { owner: upstreamOwner, repo: upstreamRepo, issueNumber, generatedCode } = options;
  const token = options.userToken || process.env.GITHUB_TOKEN;
  const filePath = options.filePath || 'README.md';
  const commitMessage = options.commitMessage || `fix: resolve issue #${issueNumber} with AI patch`;
  const prTitle = options.prTitle || `fix: resolve issue #${issueNumber} (MergeMate AI)`;
  const prBody = options.prBody || `## MergeMate Autonomous Cross-Repo PR\n\nResolves issue #${issueNumber} in ${upstreamOwner}/${upstreamRepo}.\n\n### Changes Included:\n- Fixed ${filePath}\n- Applied refactoring and test improvements.\n\n*Created via MergeMate Fork Workflow.*`;

  const multiChanges: FilePatchOperation[] = options.multiFileChanges && options.multiFileChanges.length > 0
    ? options.multiFileChanges
    : [{ filePath: options.filePath || 'README.md', operation: 'modify', content: options.generatedCode || '' }];

  // STEP 0A: Multi-File Security & Diff Validation
  const multiValidation = validateMultiFileDiffSet(multiChanges);
  if (!multiValidation.isValid) {
    console.error(`[GitHub Engine] Multi-file validation failed:`, multiValidation.errors);
    return {
      success: false,
      reason: 'SECURITY_OR_DIFF_VIOLATION',
      message: `Pull Request cancelled due to validation policy: ${multiValidation.errors.join('; ')}`,
      simulated: false,
    };
  }

  // Demo / Simulated mode when token is omitted
  if (!token || token.includes('your_github_token')) {
    const mockBranch = `mergemate/fix-issue-${issueNumber}-${Date.now().toString().slice(-4)}`;
    return {
      success: true,
      simulated: true,
      branchName: mockBranch,
      forkOwner: 'demo-bot',
      prUrl: `https://github.com/${upstreamOwner}/${upstreamRepo}/pull/new/${mockBranch}`,
      message: `[Demo Mode] GitHub Token not configured. Simulated Fork PR generated for ${upstreamOwner}/${upstreamRepo}#${issueNumber} (${multiChanges.length} files).`,
      diffPreview: multiChanges.map(c => `--- a/${c.filePath}\n+++ b/${c.filePath}\n${(c.content || '').slice(0, 200)}...`).join('\n\n'),
    };
  }

  const octokit = new Octokit({ auth: token });

  // STEP 0B: Mandatory Final Pre-PR Validation
  console.log(`[GitHub Engine] Running pre-PR validation check for ${upstreamOwner}/${upstreamRepo}#${issueNumber}...`);
  const preValidation = await validateIssueCandidate(upstreamOwner, upstreamRepo, issueNumber, {
    octokitInstance: octokit,
  });

  if (!preValidation.isValid) {
    console.warn(`[GitHub Engine] Pre-PR validation FAILED for ${upstreamOwner}/${upstreamRepo}#${issueNumber}: ${preValidation.reason}`);
    let userMsg = `Pull Request cancelled: Issue #${issueNumber} failed pre-flight verification (${preValidation.reason}).`;
    if (preValidation.isClosed) {
      userMsg = `Pull Request cancelled: Issue #${issueNumber} was closed or completed before PR creation.`;
    } else if (preValidation.hasAssignees) {
      userMsg = `Pull Request cancelled: Issue #${issueNumber} has been assigned to another contributor.`;
    } else if (preValidation.isPullRequest) {
      userMsg = `Pull Request cancelled: Target #${issueNumber} is a pull request, not an issue.`;
    } else if (preValidation.hasActivePr) {
      userMsg = `Pull Request cancelled: An active Pull Request (#${preValidation.activePrNumber}) is already addressing issue #${issueNumber}.`;
    } else if (preValidation.isArchivedRepo) {
      userMsg = `Pull Request cancelled: Repository ${upstreamOwner}/${upstreamRepo} is archived or disabled.`;
    }

    return {
      success: false,
      reason: preValidation.reason || 'ISSUE_NO_LONGER_AVAILABLE',
      message: userMsg,
      simulated: false,
    };
  }

  try {
    // Step 1: Retrieve authenticated user's username
    const userRes = await octokit.rest.users.getAuthenticated();
    const authenticatedUser = userRes.data.login;
    console.log(`[GitHub Engine] Authenticated as GitHub user: ${authenticatedUser}`);

    // Fetch upstream repo details to get default branch name
    const upstreamRepoData = await octokit.rest.repos.get({
      owner: upstreamOwner,
      repo: upstreamRepo,
    });
    const defaultBranch = upstreamRepoData.data.default_branch || 'main';

    // Fetch default branch head commit SHA from upstream
    const upstreamRefData = await octokit.rest.git.getRef({
      owner: upstreamOwner,
      repo: upstreamRepo,
      ref: `heads/${defaultBranch}`,
    });
    const latestCommitSha = upstreamRefData.data.object.sha;

    // Step 2: Create Fork on authenticated user account (if target is not already owned by user)
    let forkOwner = authenticatedUser;
    if (upstreamOwner.toLowerCase() !== authenticatedUser.toLowerCase()) {
      console.log(`[GitHub Engine] Creating fork of ${upstreamOwner}/${upstreamRepo} to ${authenticatedUser}...`);
      try {
        await octokit.rest.repos.createFork({
          owner: upstreamOwner,
          repo: upstreamRepo,
        });
        await waitForForkReady(octokit, authenticatedUser, upstreamRepo);
      } catch (forkErr: any) {
        console.warn(`[GitHub Engine] Fork creation notice (${forkErr?.message}). Proceeding with direct branch / patch workflow...`);
        forkOwner = authenticatedUser;
      }
    } else {
      console.log(`[GitHub Engine] Target repository is owned by user ${authenticatedUser}, using direct branch.`);
    }

    // Step 4: Create new branch on the forked repository
    const sanitizedTitleSlug = prTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 25).replace(/^-|-$/g, '');
    const branchName = `mergemate/fix-${issueNumber}-${sanitizedTitleSlug || 'patch'}-${Date.now().toString().slice(-4)}`;
    console.log(`[GitHub Engine] Creating branch ${branchName} on fork ${forkOwner}/${upstreamRepo}...`);
    
    try {
      await octokit.rest.git.createRef({
        owner: forkOwner,
        repo: upstreamRepo,
        ref: `refs/heads/${branchName}`,
        sha: latestCommitSha,
      });
    } catch (refErr: any) {
      const forkRef = await octokit.rest.git.getRef({
        owner: forkOwner,
        repo: upstreamRepo,
        ref: `heads/${defaultBranch}`,
      });
      await octokit.rest.git.createRef({
        owner: forkOwner,
        repo: upstreamRepo,
        ref: `refs/heads/${branchName}`,
        sha: forkRef.data.object.sha,
      });
    }

    // Step 5: Commit all multi-file changes to the branch on the fork
    for (const change of multiChanges) {
      let existingFileSha: string | undefined = undefined;
      try {
        const fileData: any = await octokit.rest.repos.getContent({
          owner: forkOwner,
          repo: upstreamRepo,
          path: change.filePath,
          ref: branchName,
        });
        existingFileSha = fileData.data.sha;
      } catch {
        // File does not exist on fork; will create new file
      }

      console.log(`[GitHub Engine] Committing patch for ${change.filePath} on ${forkOwner}/${upstreamRepo}:${branchName}...`);
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: forkOwner,
        repo: upstreamRepo,
        path: change.filePath,
        message: `${commitMessage} (${change.filePath})`,
        content: Buffer.from(change.content).toString('base64'),
        branch: branchName,
        sha: existingFileSha,
      });
    }

    // Step 6: Create Cross-Repo Pull Request targeting upstream repository
    const headRef = `${forkOwner}:${branchName}`;
    console.log(`[GitHub Engine] Opening PR on ${upstreamOwner}/${upstreamRepo} from ${headRef}...`);

    const prRes = await octokit.rest.pulls.create({
      owner: upstreamOwner,
      repo: upstreamRepo,
      title: prTitle,
      body: prBody,
      head: headRef,
      base: defaultBranch,
    });

    return {
      success: true,
      simulated: false,
      prUrl: prRes.data.html_url,
      prNumber: prRes.data.number,
      branchName,
      forkOwner,
      message: `Cross-Repo PR #${prRes.data.number} successfully created on ${upstreamOwner}/${upstreamRepo} from fork ${headRef}!`,
      diffPreview: multiChanges.map(c => `--- a/${c.filePath}\n+++ b/${c.filePath}\n${(c.content || '').slice(0, 300)}`).join('\n\n'),
    };
  } catch (error: any) {
    console.error('[GitHub Fork PR Error]', error?.message || error);
    const mockBranch = `mergemate/fix-issue-${issueNumber}`;
    return {
      success: false,
      reason: error?.status === 404 ? 'RESOURCE_NOT_FOUND' : error?.status === 403 ? 'PERMISSION_DENIED' : 'PR_CREATION_FAILED',
      simulated: true,
      branchName: mockBranch,
      forkOwner: 'user',
      prUrl: `https://github.com/${upstreamOwner}/${upstreamRepo}/issues/${issueNumber}`,
      message: `Failed to open PR via Fork: ${error?.message || 'Access Error'}. Code fix generated successfully!`,
      diffPreview: `--- a/${filePath}\n+++ b/${filePath}\n${generatedCode}`,
    };
  }
}

/**
 * Fallback realistic curated issues
 */
function getFallbackIssues(query: string): GitHubIssueItem[] {
  const baseIssues: GitHubIssueItem[] = [
    {
      id: 101,
      number: 4892,
      title: 'Fix TypeScript strict null check in Auth Context provider',
      body: 'When user logs out, authState.user causes runtime undefined error in React 18 strict mode. Needs optional chaining fix.',
      url: 'https://github.com/vercel/next.js/issues/4892',
      html_url: 'https://github.com/vercel/next.js/issues/4892',
      state: 'open',
      comments_count: 5,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner: 'vercel',
      repo: 'next.js',
      repo_full_name: 'vercel/next.js',
      labels: ['good first issue', 'TypeScript', 'React'],
      tech_stack: ['React', 'TypeScript'],
      score: 95,
      confidence: 'high',
      estimated_solvability: 'high',
      difficulty_tier: 'beginner',
      score_reasons: ['Labeled "good first issue" (+25)', 'Clear bug fix (+10)', 'Active in last 14 days (+15)', 'Unassigned (+10)'],
      is_unassigned: true,
    },
    {
      id: 102,
      number: 1420,
      title: 'Add MongoDB aggregation pipeline error logging for timeout queries',
      body: 'Node.js driver query timing out without returning detailed Mongoose schema stacktrace. Add retry logger wrapper.',
      url: 'https://github.com/mongodb/node-mongodb-native/issues/1420',
      html_url: 'https://github.com/mongodb/node-mongodb-native/issues/1420',
      state: 'open',
      comments_count: 4,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner: 'mongodb',
      repo: 'node-mongodb-native',
      repo_full_name: 'mongodb/node-mongodb-native',
      labels: ['help wanted', 'Node.js', 'MongoDB'],
      tech_stack: ['Node.js', 'MongoDB'],
      score: 88,
      confidence: 'high',
      estimated_solvability: 'high',
      difficulty_tier: 'intermediate',
      score_reasons: ['Labeled "help wanted" (+15)', 'Detailed description (+10)', 'Low discussion noise (+10)', 'Unassigned (+10)'],
      is_unassigned: true,
    },
    {
      id: 103,
      number: 8931,
      title: 'Optimize React component re-renders in dynamic dashboard charts',
      body: 'Chart canvas re-renders on every mouse move state update. Wrap data transformer in useMemo and memoize callbacks.',
      url: 'https://github.com/facebook/react/issues/8931',
      html_url: 'https://github.com/facebook/react/issues/8931',
      state: 'open',
      comments_count: 3,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner: 'facebook',
      repo: 'react',
      repo_full_name: 'facebook/react',
      labels: ['good first issue', 'React', 'TypeScript'],
      tech_stack: ['React', 'TypeScript'],
      score: 92,
      confidence: 'high',
      estimated_solvability: 'high',
      difficulty_tier: 'beginner',
      score_reasons: ['Labeled "good first issue" (+25)', 'Actionable title (+10)', 'Clean description (+10)', 'Unassigned (+10)'],
      is_unassigned: true,
    },
    {
      id: 104,
      number: 2311,
      title: 'Implement Node.js rate limiter middleware for GraphQL endpoints',
      body: 'Add token bucket rate limit algorithm using Redis/in-memory cache for Express Node server.',
      url: 'https://github.com/expressjs/express/issues/2311',
      html_url: 'https://github.com/expressjs/express/issues/2311',
      state: 'open',
      comments_count: 2,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      owner: 'expressjs',
      repo: 'express',
      repo_full_name: 'expressjs/express',
      labels: ['good first issue', 'Node.js', 'Backend'],
      tech_stack: ['Node.js', 'TypeScript'],
      score: 90,
      confidence: 'high',
      estimated_solvability: 'high',
      difficulty_tier: 'intermediate',
      score_reasons: ['Labeled "good first issue" (+25)', 'Low discussion noise (+10)', 'Actionable verb (+10)', 'Unassigned (+10)'],
      is_unassigned: true,
    },
  ];

  if (!query) return baseIssues;
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const matches = baseIssues.filter(i => {
    const text = `${i.title} ${i.repo} ${i.tech_stack.join(' ')} ${i.labels.join(' ')}`.toLowerCase();
    return words.some(w => text.includes(w));
  });
  return matches.length > 0 ? matches : baseIssues;
}

// ==========================================
// PR LIFECYCLE & LIVE INSPECTION API EXTENSIONS
// ==========================================

export interface PRDetails {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  merged: boolean;
  mergeable: boolean | null;
  mergeableState: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  head: {
    ref: string;
    sha: string;
    repo: { owner: string; name: string; fullName: string };
  };
  base: {
    ref: string;
    sha: string;
    repo: { owner: string; name: string; fullName: string };
  };
  user: {
    login: string;
    id: number;
  };
}

export interface PRFileChange {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

export interface PRReviewItem {
  id: number;
  user: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  body: string;
  submittedAt: string;
  commitId: string;
}

export interface PRReviewCommentItem {
  id: number;
  user: string;
  body: string;
  path: string;
  position: number | null;
  line: number | null;
  commitId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PRCheckRun {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | 'skipped' | 'stale' | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string | null;
  detailsUrl?: string | null;
  output?: {
    title: string | null;
    summary: string | null;
    text: string | null;
  };
}

export interface PRCommitStatusItem {
  context: string;
  state: 'pending' | 'success' | 'failure' | 'error';
  description: string | null;
  targetUrl: string | null;
}

export interface PRChecksSummary {
  overallState: 'NO_CHECKS_CONFIGURED' | 'WORKFLOW_APPROVAL_REQUIRED' | 'CHECKS_PENDING' | 'CHECKS_RUNNING' | 'CHECKS_PASSED' | 'CHECKS_FAILED' | 'CHECKS_AWAITING_APPROVAL' | 'CHECKS_SKIPPED';
  totalChecks: number;
  passedCount: number;
  failedCount: number;
  pendingCount: number;
  needsApprovalCount: number;
  checkRuns: PRCheckRun[];
  statuses: PRCommitStatusItem[];
  failedCheckDetails: { name: string; conclusion: string; url?: string; summary?: string }[];
}

/**
 * Fetch detailed live Pull Request data
 */
export async function getPullRequest(
  owner: string,
  repo: string,
  pullNumber: number,
  userToken?: string
): Promise<PRDetails | null> {
  const octokit = getOctokit(userToken);
  try {
    const res = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });
    const data = res.data;
    return {
      number: data.number,
      title: data.title,
      body: data.body || '',
      state: data.merged ? 'merged' : (data.state as 'open' | 'closed'),
      merged: Boolean(data.merged),
      mergeable: data.mergeable,
      mergeableState: data.mergeable_state || 'unknown',
      htmlUrl: data.html_url,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      closedAt: data.closed_at,
      mergedAt: data.merged_at,
      head: {
        ref: data.head.ref,
        sha: data.head.sha,
        repo: {
          owner: data.head.repo?.owner?.login || '',
          name: data.head.repo?.name || '',
          fullName: data.head.repo?.full_name || '',
        },
      },
      base: {
        ref: data.base.ref,
        sha: data.base.sha,
        repo: {
          owner: data.base.repo?.owner?.login || '',
          name: data.base.repo?.name || '',
          fullName: data.base.repo?.full_name || '',
        },
      },
      user: {
        login: data.user?.login || 'unknown',
        id: data.user?.id || 0,
      },
    };
  } catch (err: any) {
    console.warn(`[GitHub PR API] Error fetching PR ${owner}/${repo}#${pullNumber}:`, err?.message);
    return null;
  }
}

/**
 * Fetch files changed in a Pull Request
 */
export async function getPullRequestFiles(
  owner: string,
  repo: string,
  pullNumber: number,
  userToken?: string
): Promise<PRFileChange[]> {
  const octokit = getOctokit(userToken);
  try {
    const res = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });
    return (res.data || []).map((f: any) => ({
      filename: f.filename,
      status: f.status as any,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch,
    }));
  } catch (err: any) {
    console.warn(`[GitHub PR API] Error listing files for PR ${owner}/${repo}#${pullNumber}:`, err?.message);
    return [];
  }
}

/**
 * Fetch commits in a Pull Request
 */
export async function getPullRequestCommits(
  owner: string,
  repo: string,
  pullNumber: number,
  userToken?: string
): Promise<{ sha: string; message: string; author: string; date: string }[]> {
  const octokit = getOctokit(userToken);
  try {
    const res = await octokit.rest.pulls.listCommits({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });
    return (res.data || []).map((c: any) => ({
      sha: c.sha,
      message: c.commit?.message || '',
      author: c.commit?.author?.name || c.author?.login || 'unknown',
      date: c.commit?.author?.date || '',
    }));
  } catch (err: any) {
    console.warn(`[GitHub PR API] Error listing commits for PR ${owner}/${repo}#${pullNumber}:`, err?.message);
    return [];
  }
}

/**
 * Fetch reviews on a Pull Request
 */
export async function getPullRequestReviews(
  owner: string,
  repo: string,
  pullNumber: number,
  userToken?: string
): Promise<PRReviewItem[]> {
  const octokit = getOctokit(userToken);
  try {
    const res = await octokit.rest.pulls.listReviews({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });
    return (res.data || []).map((r: any) => ({
      id: r.id,
      user: r.user?.login || 'unknown',
      state: r.state as any,
      body: r.body || '',
      submittedAt: r.submitted_at || '',
      commitId: r.commit_id || '',
    }));
  } catch (err: any) {
    console.warn(`[GitHub PR API] Error listing reviews for PR ${owner}/${repo}#${pullNumber}:`, err?.message);
    return [];
  }
}

/**
 * Fetch review line comments on a Pull Request
 */
export async function getPullRequestReviewComments(
  owner: string,
  repo: string,
  pullNumber: number,
  userToken?: string
): Promise<PRReviewCommentItem[]> {
  const octokit = getOctokit(userToken);
  try {
    const res = await octokit.rest.pulls.listReviewComments({
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,
    });
    return (res.data || []).map((c: any) => ({
      id: c.id,
      user: c.user?.login || 'unknown',
      body: c.body || '',
      path: c.path || '',
      position: c.position,
      line: c.line || c.original_line || null,
      commitId: c.commit_id || '',
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    }));
  } catch (err: any) {
    console.warn(`[GitHub PR API] Error listing review comments for PR ${owner}/${repo}#${pullNumber}:`, err?.message);
    return [];
  }
}

/**
 * Fetch general issue/PR conversation comments
 */
export async function getPullRequestComments(
  owner: string,
  repo: string,
  pullNumber: number,
  userToken?: string
): Promise<{ id: number; user: string; body: string; createdAt: string }[]> {
  const octokit = getOctokit(userToken);
  try {
    const res = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100,
    });
    return (res.data || []).map((c: any) => ({
      id: c.id,
      user: c.user?.login || 'unknown',
      body: c.body || '',
      createdAt: c.created_at,
    }));
  } catch (err: any) {
    console.warn(`[GitHub PR API] Error listing issue comments for PR ${owner}/${repo}#${pullNumber}:`, err?.message);
    return [];
  }
}

/**
 * Fetch and classify all check runs & commit statuses for a ref
 */
export async function getPullRequestChecks(
  owner: string,
  repo: string,
  ref: string,
  userToken?: string
): Promise<PRChecksSummary> {
  const octokit = getOctokit(userToken);
  try {
    const [checkRunsRes, statusesRes, workflowRunsRes] = await Promise.all([
      octokit.rest.checks.listForRef({ owner, repo, ref, per_page: 100 }).catch(() => ({ data: { total_count: 0, check_runs: [] } })),
      octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref }).catch(() => ({ data: { state: 'pending', total_count: 0, statuses: [] } })),
      octokit.rest.actions.listWorkflowRunsForRepo({ owner, repo, head_sha: ref }).catch(() => ({ data: { total_count: 0, workflow_runs: [] } })),
    ]);

    const checkRuns: PRCheckRun[] = (checkRunsRes.data.check_runs || []).map((cr: any) => ({
      id: cr.id,
      name: cr.name,
      status: cr.status as any,
      conclusion: cr.conclusion as any,
      startedAt: cr.started_at,
      completedAt: cr.completed_at,
      htmlUrl: cr.html_url,
      detailsUrl: cr.details_url,
      output: cr.output ? {
        title: cr.output.title,
        summary: cr.output.summary,
        text: cr.output.text,
      } : undefined,
    }));

    const statuses: PRCommitStatusItem[] = (statusesRes.data.statuses || []).map((st: any) => ({
      context: st.context,
      state: st.state as any,
      description: st.description,
      targetUrl: st.target_url,
    }));

    const workflowRuns = workflowRunsRes.data.workflow_runs || [];

    let passedCount = 0;
    let failedCount = 0;
    let pendingCount = 0;
    let needsApprovalCount = 0;
    const failedCheckDetails: { name: string; conclusion: string; url?: string; summary?: string }[] = [];

    // Analyze Check Runs
    for (const cr of checkRuns) {
      if (cr.status === 'queued' || cr.status === 'in_progress' || cr.status === 'pending' || cr.status === 'waiting') {
        pendingCount++;
      } else if (cr.conclusion === 'success' || cr.conclusion === 'neutral' || cr.conclusion === 'skipped') {
        passedCount++;
      } else if (cr.conclusion === 'action_required') {
        needsApprovalCount++;
      } else if (cr.conclusion === 'failure' || cr.conclusion === 'timed_out' || cr.conclusion === 'cancelled') {
        failedCount++;
        failedCheckDetails.push({
          name: cr.name,
          conclusion: cr.conclusion,
          url: cr.htmlUrl || cr.detailsUrl || undefined,
          summary: cr.output?.summary || cr.output?.title || undefined,
        });
      }
    }

    // Analyze Commit Statuses
    for (const st of statuses) {
      if (st.state === 'pending') {
        pendingCount++;
      } else if (st.state === 'success') {
        passedCount++;
      } else if (st.state === 'failure' || st.state === 'error') {
        failedCount++;
        failedCheckDetails.push({
          name: st.context,
          conclusion: st.state,
          url: st.targetUrl || undefined,
          summary: st.description || undefined,
        });
      }
    }

    // Analyze Workflow Runs (Crucial for fork PRs awaiting maintainer approval before check-runs generate)
    for (const wr of workflowRuns) {
      if (wr.conclusion === 'action_required' || wr.status === 'waiting') {
        needsApprovalCount++;
      } else if (checkRuns.length === 0 && statuses.length === 0) {
        if (wr.status === 'queued' || wr.status === 'in_progress' || wr.status === 'pending') {
          pendingCount++;
        } else if (wr.conclusion === 'success' || wr.conclusion === 'neutral' || wr.conclusion === 'skipped') {
          passedCount++;
        } else if (wr.conclusion === 'failure' || wr.conclusion === 'timed_out' || wr.conclusion === 'cancelled') {
          failedCount++;
          failedCheckDetails.push({
            name: wr.name || 'Workflow Run',
            conclusion: wr.conclusion,
            url: wr.html_url,
            summary: `Workflow ${wr.name} ended with ${wr.conclusion}`,
          });
        }
      }
    }

    const totalChecks = checkRuns.length + statuses.length + (checkRuns.length === 0 && statuses.length === 0 ? workflowRuns.length : (needsApprovalCount > 0 && checkRuns.length === 0 ? workflowRuns.length : 0));

    let overallState: PRChecksSummary['overallState'] = 'NO_CHECKS_CONFIGURED';
    if (needsApprovalCount > 0) {
      overallState = 'WORKFLOW_APPROVAL_REQUIRED';
    } else if (totalChecks === 0) {
      overallState = 'NO_CHECKS_CONFIGURED';
    } else if (failedCount > 0) {
      overallState = 'CHECKS_FAILED';
    } else if (pendingCount > 0) {
      overallState = checkRuns.some(c => c.status === 'in_progress') || workflowRuns.some((w: any) => w.status === 'in_progress') ? 'CHECKS_RUNNING' : 'CHECKS_PENDING';
    } else if (passedCount === totalChecks) {
      overallState = 'CHECKS_PASSED';
    } else {
      overallState = 'CHECKS_SKIPPED';
    }

    return {
      overallState,
      totalChecks,
      passedCount,
      failedCount,
      pendingCount,
      needsApprovalCount,
      checkRuns,
      statuses,
      failedCheckDetails,
    };
  } catch (err: any) {
    console.warn(`[GitHub Checks API] Error fetching checks for ${owner}/${repo}@${ref}:`, err?.message);
    return {
      overallState: 'NO_CHECKS_CONFIGURED',
      totalChecks: 0,
      passedCount: 0,
      failedCount: 0,
      pendingCount: 0,
      needsApprovalCount: 0,
      checkRuns: [],
      statuses: [],
      failedCheckDetails: [],
    };
  }
}

/**
 * Fetch GitHub Actions workflow runs for a repository/branch
 */
export async function getWorkflowRuns(
  owner: string,
  repo: string,
  branch?: string,
  userToken?: string
): Promise<any[]> {
  const octokit = getOctokit(userToken);
  try {
    const res = await octokit.rest.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      branch,
      per_page: 20,
    });
    return res.data.workflow_runs || [];
  } catch (err: any) {
    console.warn(`[GitHub Actions API] Error listing workflow runs for ${owner}/${repo}:`, err?.message);
    return [];
  }
}

/**
 * Fetch specific check run details
 */
export async function getCheckRunDetails(
  owner: string,
  repo: string,
  checkRunId: number,
  userToken?: string
): Promise<PRCheckRun | null> {
  const octokit = getOctokit(userToken);
  try {
    const res = await octokit.rest.checks.get({
      owner,
      repo,
      check_run_id: checkRunId,
    });
    const cr = res.data;
    return {
      id: cr.id,
      name: cr.name,
      status: cr.status as any,
      conclusion: cr.conclusion as any,
      startedAt: cr.started_at,
      completedAt: cr.completed_at,
      htmlUrl: cr.html_url,
      detailsUrl: cr.details_url,
      output: cr.output ? {
        title: cr.output.title,
        summary: cr.output.summary,
        text: cr.output.text,
      } : undefined,
    };
  } catch (err: any) {
    console.warn(`[GitHub Checks API] Error fetching check run ${checkRunId}:`, err?.message);
    return null;
  }
}

/**
 * Fetch workflow run log content
 */
export async function getWorkflowRunLogs(
  owner: string,
  repo: string,
  runId: number,
  userToken?: string
): Promise<string | null> {
  const octokit = getOctokit(userToken);
  try {
    const res = await octokit.rest.actions.downloadWorkflowRunLogs({
      owner,
      repo,
      run_id: runId,
    });
    return typeof res.data === 'string' ? res.data : Buffer.from(res.data as any).toString('utf-8');
  } catch (err: any) {
    console.warn(`[GitHub Actions API] Error fetching workflow logs for run ${runId}:`, err?.message);
    return null;
  }
}

/**
 * Aggregated live status for a Pull Request
 */
export async function getPullRequestStatus(
  owner: string,
  repo: string,
  pullNumber: number,
  userToken?: string
) {
  const pr = await getPullRequest(owner, repo, pullNumber, userToken);
  if (!pr) return null;

  const [files, commits, reviews, reviewComments, checks] = await Promise.all([
    getPullRequestFiles(owner, repo, pullNumber, userToken),
    getPullRequestCommits(owner, repo, pullNumber, userToken),
    getPullRequestReviews(owner, repo, pullNumber, userToken),
    getPullRequestReviewComments(owner, repo, pullNumber, userToken),
    getPullRequestChecks(owner, repo, pr.head.sha, userToken),
  ]);

  let reviewState: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' = 'PENDING';
  if (reviews.some(r => r.state === 'CHANGES_REQUESTED')) {
    reviewState = 'CHANGES_REQUESTED';
  } else if (reviews.some(r => r.state === 'APPROVED')) {
    reviewState = 'APPROVED';
  } else if (reviews.length > 0 || reviewComments.length > 0) {
    reviewState = 'COMMENTED';
  }

  return {
    pr,
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    files,
    commits,
    reviews,
    reviewComments,
    reviewState,
    checks,
    mergeable: pr.mergeable,
    isMerged: pr.merged,
    isOpen: pr.state === 'open',
  };
}

