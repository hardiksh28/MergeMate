/**
 * Secure Authenticated Git Transport
 *
 * Enforces strict credential isolation for all Git CLI interactions:
 * - Credentials are NEVER interpolated into shell commands, command-line arguments, or process argv.
 * - Credentials are NEVER embedded into Git remote URLs or written to .git/config on disk.
 * - Authentication is delivered strictly via GIT_ASKPASS with isolated environment variables.
 * - All stdout, stderr, and exception messages are sanitized to prevent credential leakage.
 */

import { spawnSync, SpawnSyncOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface GitAuthOptions {
  token?: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface GitExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  args: string[];
}

/**
 * Sanitizes any raw string or error output, redacting GitHub tokens and auth headers
 */
export function redactGitOutput(text: string): string {
  if (!text) return '';
  return text
    .replace(/ghp_[a-zA-Z0-9]{36,}/g, '[REDACTED_GH_TOKEN]')
    .replace(/github_pat_[a-zA-Z0-9_]{50,}/g, '[REDACTED_GH_PAT]')
    .replace(/https:\/\/[^@\s/]+@github\.com/gi, 'https://github.com')
    .replace(/AUTHORIZATION:\s*(?:bearer|basic)\s+[^\s"']+/gi, 'AUTHORIZATION: [REDACTED]')
    .replace(/x-access-token:[^\s@/]+/gi, 'x-access-token:[REDACTED]');
}

/**
 * Creates or retrieves a minimal, cross-platform GIT_ASKPASS script
 * that retrieves the token from the private MERGEMATE_GIT_TOKEN environment variable.
 */
let cachedAskPassPath: string | null = null;

function getAskPassScriptPath(): string {
  if (cachedAskPassPath && fs.existsSync(cachedAskPassPath)) {
    return cachedAskPassPath;
  }

  const tmpDir = os.tmpdir();
  const scriptPath = path.join(tmpDir, `mergemate-askpass-${process.pid}.js`);

  // Simple node script that prints the token from env var
  const scriptContent = `#!/usr/bin/env node
const token = process.env.MERGEMATE_GIT_TOKEN || '';
process.stdout.write(token);
`;

  fs.writeFileSync(scriptPath, scriptContent, { mode: 0o700 });
  cachedAskPassPath = scriptPath;
  return scriptPath;
}

/**
 * Executes a Git command securely with direct argv arrays and credential isolation
 */
export function executeSecureGit(
  args: string[],
  options: GitAuthOptions = {}
): GitExecResult {
  const cwd = options.cwd || process.cwd();
  const token = options.token || process.env.GITHUB_TOKEN || '';

  // Prepare clean environment
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.env || {}),
    GIT_TERMINAL_PROMPT: '0', // Disallow interactive prompts
  };

  // If token is supplied, inject via GIT_ASKPASS
  if (token) {
    const askPassScript = getAskPassScriptPath();
    env.GIT_ASKPASS = process.execPath; // Run node
    env.GIT_ASKPASS_SCRIPT = askPassScript;
    env.MERGEMATE_GIT_TOKEN = token;
    env.SSH_ASKPASS = askPassScript;

    // Direct node invocation for askpass
    env.GIT_ASKPASS = askPassScript;
  }

  // Ensure no token is passed directly in args
  const sanitizedArgs = args.map((arg) => {
    if (token && arg.includes(token)) {
      throw new Error('SECURITY VIOLATION: Attempted to pass raw authentication token in Git CLI arguments.');
    }
    return arg;
  });

  const spawnOptions: SpawnSyncOptions = {
    cwd,
    env,
    encoding: 'utf8',
    timeout: options.timeoutMs || 120_000,
    maxBuffer: 20 * 1024 * 1024,
  };

  const result = spawnSync('git', sanitizedArgs, spawnOptions);

  const stdout = redactGitOutput(result.stdout?.toString() || '');
  const stderr = redactGitOutput(result.stderr?.toString() || '');
  const exitCode = result.status ?? (result.error ? 1 : 0);

  if (result.error) {
    const sanitizedErrorMsg = redactGitOutput(result.error.message);
    throw new Error(`Git command failed [git ${sanitizedArgs.join(' ')}]: ${sanitizedErrorMsg}`);
  }

  if (exitCode !== 0) {
    const sanitizedErrorMsg = redactGitOutput(stderr || stdout);
    const err = new Error(`Git command exited with code ${exitCode} [git ${sanitizedArgs.join(' ')}]: ${sanitizedErrorMsg}`);
    (err as any).exitCode = exitCode;
    (err as any).stdout = stdout;
    (err as any).stderr = stderr;
    throw err;
  }

  return {
    stdout,
    stderr,
    exitCode,
    args: sanitizedArgs,
  };
}

/**
 * Configure clean remote URL (never containing tokens)
 */
export function secureSetRemote(cwd: string, remoteName: string, repoUrl: string): void {
  // Clean URL of any user/token prefix
  const cleanUrl = repoUrl.replace(/https:\/\/[^@]+@github\.com/i, 'https://github.com');

  try {
    executeSecureGit(['remote', 'set-url', remoteName, cleanUrl], { cwd });
  } catch {
    executeSecureGit(['remote', 'add', remoteName, cleanUrl], { cwd });
  }
}

/**
 * Securely pushes a branch to remote without exposing credentials
 */
export function securePushBranch(
  cwd: string,
  remoteName: string,
  branchName: string,
  options: { token?: string; force?: boolean } = {}
): GitExecResult {
  const args = ['push', remoteName, branchName];
  if (options.force) {
    args.push('--force');
  }

  return executeSecureGit(args, {
    cwd,
    token: options.token,
  });
}

/**
 * Securely fetches a branch from remote
 */
export function secureFetchBranch(
  cwd: string,
  remoteName: string,
  branchName?: string,
  options: { token?: string } = {}
): GitExecResult {
  const args = ['fetch', remoteName];
  if (branchName) {
    args.push(branchName);
  }

  return executeSecureGit(args, {
    cwd,
    token: options.token,
  });
}

/**
 * Securely clones a repository to a target directory
 */
export function secureCloneRepo(
  repoUrl: string,
  targetDir: string,
  options: { token?: string; depth?: number } = {}
): GitExecResult {
  const cleanUrl = repoUrl.replace(/https:\/\/[^@]+@github\.com/i, 'https://github.com');
  const args = ['clone'];
  if (options.depth) {
    args.push('--depth', String(options.depth));
  }
  args.push(cleanUrl, targetDir);

  return executeSecureGit(args, {
    token: options.token,
  });
}
