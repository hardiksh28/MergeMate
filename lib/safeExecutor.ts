/**
 * MergeMate Safe Command Execution & Repository Verification Engine
 * Executes repository verification commands safely with timeout bounds,
 * output capturing, secret redaction, and error classification.
 */

import { exec, spawn, ExecOptions } from 'child_process';
import * as path from 'path';

export type FailureCategory =
  | 'NONE'
  | 'CODE_FAILURE'
  | 'TEST_FAILURE'
  | 'TYPE_FAILURE'
  | 'LINT_FAILURE'
  | 'BUILD_FAILURE'
  | 'DEPENDENCY_FAILURE'
  | 'ENVIRONMENT_FAILURE'
  | 'TIMEOUT'
  | 'SECURITY_VIOLATION'
  | 'UNKNOWN_FAILURE';

export interface CommandExecutionResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  failureCategory: FailureCategory;
  error?: string;
}

export interface SafeExecutorOptions {
  cwd?: string;
  timeoutMs?: number;
  maxBufferBytes?: number;
  env?: Record<string, string>;
  mockExecutor?: (command: string, cwd?: string) => Promise<CommandExecutionResult>;
}

export interface RepositoryVerificationReport {
  targetedTests: 'passed' | 'failed' | 'not_run' | 'skipped';
  fullTests: 'passed' | 'failed' | 'not_run' | 'skipped';
  typecheck: 'passed' | 'failed' | 'not_run' | 'skipped';
  lint: 'passed' | 'failed' | 'not_run' | 'skipped';
  build: 'passed' | 'failed' | 'not_run' | 'skipped';
  preExistingFailures: string[];
  newFailures: string[];
  environmentLimitations: string[];
  failureClassification?: FailureCategory;
  commandsExecuted: {
    stage: string;
    command: string;
    exitCode: number;
    durationMs: number;
    passed: boolean;
  }[];
}

/**
 * Checks command string against dangerous patterns to prevent destructive host operations.
 */
export function isCommandSafe(command: string): { isSafe: boolean; reason?: string } {
  if (!command || typeof command !== 'string') {
    return { isSafe: false, reason: 'Empty or invalid command' };
  }

  const trimmed = command.trim();

  // Block destructive filesystem commands
  const dangerousPatterns = [
    { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f\b/i, reason: 'Recursive force file deletion (rm -rf)' },
    { pattern: /\b(mkfs|dd\s+if=|fdisk|format)\b/i, reason: 'Disk formatting or raw partition writing' },
    { pattern: /\bsudo\b/i, reason: 'Privileged execution (sudo)' },
    { pattern: /\b(chmod\s+-R\s+777|chown)\b/i, reason: 'Dangerous filesystem permission alteration' },
    { pattern: /\b(curl|wget)\s+[^|]+\|\s*(ba)?sh\b/i, reason: 'Remote script piping to shell' },
    { pattern: />\s*\/dev\/(sd[a-z]|hd[a-z]|nvme)/i, reason: 'Raw block device redirection' },
    { pattern: /\b(:(){ :\|:& };:)\b/, reason: 'Fork bomb execution' },
    { pattern: /\b(shutdown|reboot|init\s+0)\b/i, reason: 'System power command' },
    { pattern: /(cat|head|tail|less|more|cp)\s+.*(\/etc\/(passwd|shadow|sudoers)|~\/\.ssh)/i, reason: 'Sensitive system file read attempt' },
  ];

  for (const { pattern, reason } of dangerousPatterns) {
    if (pattern.test(trimmed)) {
      return { isSafe: false, reason };
    }
  }

  return { isSafe: true };
}

/**
 * Redacts tokens, passwords, and sensitive keys from command output
 */
export function sanitizeOutput(output: string): string {
  if (!output) return '';
  return output
    .replace(/(?:ghp_[a-zA-Z0-9]{36,}|github_pat_[a-zA-Z0-9_]{50,})/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/AIzaSy[a-zA-Z0-9_-]{33}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/sk-[a-zA-Z0-9_-]{32,}/g, '[REDACTED_OPENAI_KEY]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]')
    .replace(/(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[a-zA-Z0-9_]+:[^@\s]+@[^\s'"]+/gi, '[REDACTED_DB_URI]');
}

/**
 * Classifies command execution failure output into standard categories
 */
export function classifyExecutionFailure(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
  timedOut: boolean
): FailureCategory {
  if (exitCode === 0 && !timedOut) {
    return 'NONE';
  }

  if (timedOut) {
    return 'TIMEOUT';
  }

  const combined = `${stdout}\n${stderr}`.toLowerCase();

  // Environment / Tooling Missing
  if (
    combined.includes('command not found') ||
    combined.includes('is not recognized as an internal or external command') ||
    combined.includes('enoent') ||
    combined.includes('spawn') && combined.includes('enoent') ||
    combined.includes('no such file or directory') && (combined.includes('node') || combined.includes('npm') || combined.includes('pnpm') || combined.includes('yarn') || combined.includes('bun'))
  ) {
    return 'ENVIRONMENT_FAILURE';
  }

  // Missing dependencies / modules
  if (
    combined.includes('cannot find module') ||
    combined.includes('err_module_not_found') ||
    combined.includes('module not found') ||
    combined.includes('please run npm install') ||
    combined.includes('please run pnpm install') ||
    combined.includes('please run yarn install')
  ) {
    return 'DEPENDENCY_FAILURE';
  }

  // TypeScript / Typecheck failure
  if (
    command.includes('tsc') ||
    command.includes('typecheck') ||
    command.includes('type-check') ||
    combined.includes('ts2304') ||
    combined.includes('ts2322') ||
    combined.includes('ts2339') ||
    combined.includes('ts2345') ||
    combined.includes('type error')
  ) {
    return 'TYPE_FAILURE';
  }

  // Lint failure
  if (
    command.includes('eslint') ||
    command.includes('lint') ||
    combined.includes('eslint') && combined.includes('error')
  ) {
    return 'LINT_FAILURE';
  }

  // Build failure
  if (
    command.includes('build') ||
    combined.includes('build error') ||
    combined.includes('compilation error') ||
    combined.includes('next build failed')
  ) {
    return 'BUILD_FAILURE';
  }

  // Test failure
  if (
    command.includes('test') ||
    command.includes('jest') ||
    command.includes('vitest') ||
    command.includes('mocha') ||
    combined.includes('failing') ||
    combined.includes('failed') ||
    combined.includes('assertionerror') ||
    combined.includes('expect(') ||
    combined.includes('test suite failed')
  ) {
    return 'TEST_FAILURE';
  }

  return 'CODE_FAILURE';
}

/**
 * Executes a verification command safely with timeout, sanitized env, and bounded output.
 * SECURITY: Credentials must NEVER be passed in the command string. Commands are shell
 * invocations like `npm test` — credentials are injected via the env object only.
 */
export async function executeSafeCommand(
  command: string,
  options?: SafeExecutorOptions
): Promise<CommandExecutionResult> {
  // Defense-in-depth: reject command strings that contain known credential patterns
  const credentialLeak =
    /ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{30,}|AIzaSy[a-zA-Z0-9_-]{25,}|sk-[a-zA-Z0-9_-]{25,}|AKIA[0-9A-Z]{16}/.test(
      command
    );
  if (credentialLeak) {
    return {
      command: '[COMMAND REDACTED — contained credential pattern]',
      exitCode: 126,
      stdout: '',
      stderr: 'SECURITY VIOLATION: Command string contains a credential pattern. Refused to execute.',
      durationMs: 0,
      timedOut: false,
      failureCategory: 'SECURITY_VIOLATION',
      error: 'SECURITY VIOLATION: credential detected in command string',
    };
  }

  const safety = isCommandSafe(command);
  if (!safety.isSafe) {
    return {
      command,
      exitCode: 126,
      stdout: '',
      stderr: `Command blocked by MergeMate Safety Policy: ${safety.reason}`,
      durationMs: 0,
      timedOut: false,
      failureCategory: 'SECURITY_VIOLATION',
      error: safety.reason,
    };
  }

  if (options?.mockExecutor) {
    return options.mockExecutor(command, options.cwd);
  }

  const timeoutMs = options?.timeoutMs || 45000;
  const maxBuffer = options?.maxBufferBytes || 1024 * 1024 * 2; // 2MB
  const cwd = options?.cwd || process.cwd();

  // Create sanitized environment (stripping sensitive API keys from child process)
  const safeEnv: Record<string, string> = {
    ...process.env,
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    NODE_ENV: 'test',
    CI: 'true',
    ...(options?.env || {}),
  };

  // Remove secret keys so they cannot be extracted by test scripts
  delete safeEnv.GITHUB_TOKEN;
  delete safeEnv.GEMINI_API_KEY;
  delete safeEnv.GEMINI_KEY_1;
  delete safeEnv.GEMINI_KEY_2;
  delete safeEnv.GEMINI_KEY_3;
  delete safeEnv.GEMINI_KEY_4;
  delete safeEnv.GEMINI_KEY_5;

  const startTime = Date.now();

  return new Promise<CommandExecutionResult>((resolve) => {
    let timedOut = false;

    const child = exec(
      command,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer,
        env: safeEnv as NodeJS.ProcessEnv,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startTime;
        const sanitizedStdout = sanitizeOutput(stdout || '');
        const sanitizedStderr = sanitizeOutput(stderr || (error ? error.message : ''));
        const exitCode = error ? (error.code ? Number(error.code) : 1) : 0;

        if (error && (error as any).killed && (error as any).signal === 'SIGTERM') {
          timedOut = true;
        }

        const failureCategory = classifyExecutionFailure(
          command,
          exitCode,
          sanitizedStdout,
          sanitizedStderr,
          timedOut
        );

        resolve({
          command: sanitizeOutput(command), // Defense-in-depth: redact any credential that leaked into command string
          exitCode,
          stdout: sanitizedStdout,
          stderr: sanitizedStderr,
          durationMs,
          timedOut,
          failureCategory,
          error: error ? sanitizeOutput(error.message) : undefined,
        });
      }
    );
  });
}

/**
 * Builds project verification commands based on package manager and available scripts
 */
export function buildVerificationPlan(config: {
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  availableScripts: Record<string, string>;
  hasTypeScript: boolean;
  hasTests: boolean;
  targetTestFile?: string;
  testFramework?: string;
}): {
  targetedTestCmd?: string;
  fullTestCmd?: string;
  typecheckCmd?: string;
  lintCmd?: string;
  buildCmd?: string;
} {
  const pm = config.packageManager || 'npm';
  const scripts = config.availableScripts || {};

  // 1. Targeted Test command
  let targetedTestCmd: string | undefined = undefined;
  if (config.targetTestFile) {
    if (config.testFramework === 'vitest') {
      targetedTestCmd = pm === 'npm' ? `npx vitest run ${config.targetTestFile}` : `${pm} vitest run ${config.targetTestFile}`;
    } else if (config.testFramework === 'jest') {
      targetedTestCmd = pm === 'npm' ? `npx jest ${config.targetTestFile} --ci --colors=false` : `${pm} jest ${config.targetTestFile} --ci --colors=false`;
    } else if (scripts.test) {
      targetedTestCmd = pm === 'npm' ? `npm test -- ${config.targetTestFile}` : `${pm} test ${config.targetTestFile}`;
    }
  }

  // 2. Full Test command
  let fullTestCmd: string | undefined = undefined;
  if (scripts['test:unit']) {
    fullTestCmd = pm === 'npm' ? 'npm run test:unit' : `${pm} test:unit`;
  } else if (scripts.test && !scripts.test.includes('no test specified')) {
    fullTestCmd = pm === 'npm' ? 'npm test' : `${pm} test`;
  } else if (config.testFramework === 'vitest') {
    fullTestCmd = pm === 'npm' ? 'npx vitest run' : `${pm} vitest run`;
  } else if (config.testFramework === 'jest') {
    fullTestCmd = pm === 'npm' ? 'npx jest --ci' : `${pm} jest --ci`;
  }

  // 3. Typecheck command
  let typecheckCmd: string | undefined = undefined;
  if (scripts.typecheck) {
    typecheckCmd = pm === 'npm' ? 'npm run typecheck' : `${pm} typecheck`;
  } else if (scripts['type-check']) {
    typecheckCmd = pm === 'npm' ? 'npm run type-check' : `${pm} type-check`;
  } else if (config.hasTypeScript) {
    typecheckCmd = 'npx tsc --noEmit';
  }

  // 4. Lint command
  let lintCmd: string | undefined = undefined;
  if (scripts.lint) {
    lintCmd = pm === 'npm' ? 'npm run lint' : `${pm} lint`;
  } else if (scripts.check) {
    lintCmd = pm === 'npm' ? 'npm run check' : `${pm} check`;
  }

  // 5. Build command
  let buildCmd: string | undefined = undefined;
  if (scripts.build) {
    buildCmd = pm === 'npm' ? 'npm run build' : `${pm} build`;
  }

  return {
    targetedTestCmd,
    fullTestCmd,
    typecheckCmd,
    lintCmd,
    buildCmd,
  };
}
