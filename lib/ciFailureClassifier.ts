/**
 * CI Failure Classifier & Log Analyzer for MergeMate Autonomous PR Engine
 *
 * Deterministically analyzes CI checks, annotations, and sanitized log outputs
 * to categorize failures into actionable code defects vs non-repairable infrastructure/network issues.
 */

export type CIFailureType =
  | 'CODE_FAILURE'
  | 'TEST_FAILURE'
  | 'TYPE_FAILURE'
  | 'LINT_FAILURE'
  | 'BUILD_FAILURE'
  | 'DEPENDENCY_FAILURE'
  | 'LOCKFILE_FAILURE'
  | 'ENVIRONMENT_FAILURE'
  | 'NETWORK_FAILURE'
  | 'PERMISSION_FAILURE'
  | 'FLAKY_TEST'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'SECURITY_FAILURE'
  | 'INFRASTRUCTURE_FAILURE'
  | 'UNKNOWN_FAILURE';

export interface ExtractedFailureContext {
  commandFailed?: string;
  errorMessages: string[];
  stackTraces: string[];
  failingTests: string[];
  fileLocations: { file: string; line?: number; column?: number }[];
  compilerDiagnostics: string[];
  sanitizedSummary: string;
}

export interface CIDiagnosis {
  failureType: CIFailureType;
  confidence: 'high' | 'medium' | 'low';
  rootCause: string;
  affectedFiles: string[];
  evidence: string[];
  suggestedFix?: string;
  unrelatedFailure: boolean;
  shouldAutoRepair: boolean;
  extractedContext?: ExtractedFailureContext;
}

/**
 * Redacts secret credentials, tokens, cookies, and keys from raw log streams
 */
export function sanitizeCILogs(log: string): string {
  if (!log) return '';

  let sanitized = log;

  // Patterns for credential redaction
  const secretPatterns = [
    /ghp_[a-zA-Z0-9]{36,}/g,
    /github_pat_[a-zA-Z0-9_]{50,}/g,
    /AIzaSy[a-zA-Z0-9_-]{33}/g,
    /sk-[a-zA-Z0-9_-]{32,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /bearer\s+[a-zA-Z0-9._~+/-]{15,}/gi,
    /authorization:\s*token\s+[^\s\r\n]+/gi,
    /password[:=]\s*["']?[^\s"'\r\n]+["']?/gi,
    /api[-_]?key[:=]\s*["']?[^\s"'\r\n]+["']?/gi,
    /token[:=]\s*["']?[^\s"'\r\n]+["']?/gi,
    /secret[:=]\s*["']?[^\s"'\r\n]+["']?/gi,
  ];

  for (const pattern of secretPatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED_SECRET]');
  }

  // Remove ANSI escape color codes
  sanitized = sanitized.replace(/\x1b\[[0-9;]*m/g, '');

  return sanitized;
}

/**
 * Extracts targeted error context, compiler diagnostics, and stack traces
 */
export function extractRelevantFailureContext(
  rawLog: string,
  options?: { maxLines?: number; changedFiles?: string[] }
): ExtractedFailureContext {
  const sanitized = sanitizeCILogs(rawLog || '');
  const lines = sanitized.split(/\r?\n/);
  const maxLines = options?.maxLines || 100;
  const changedFiles = options?.changedFiles || [];

  const errorMessages: string[] = [];
  const stackTraces: string[] = [];
  const failingTests: string[] = [];
  const fileLocations: { file: string; line?: number; column?: number }[] = [];
  const compilerDiagnostics: string[] = [];
  let commandFailed: string | undefined = undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Command failure detection
    if (trimmed.startsWith('npm ERR! code') || trimmed.includes('Command failed:') || trimmed.includes('Process completed with exit code')) {
      if (!commandFailed) commandFailed = trimmed;
      errorMessages.push(trimmed);
    }

    // Failing test detection (Vitest / Jest / Mocha / node:test)
    if (
      trimmed.startsWith('FAIL ') ||
      trimmed.startsWith('✖ ') ||
      trimmed.includes('failing tests:') ||
      trimmed.includes('AssertionError') ||
      trimmed.includes('Expected') && trimmed.includes('received')
    ) {
      if (trimmed.startsWith('FAIL ') || trimmed.startsWith('✖ ')) {
        failingTests.push(trimmed);
      }
      errorMessages.push(trimmed);
    }

    // Stack traces
    if (/^\s*at\s+.*\(?.*:\d+:\d+\)?/i.test(trimmed)) {
      stackTraces.push(trimmed);
    }

    // TypeScript / Compiler diagnostics (e.g. src/index.ts:12:5 - error TS2304)
    const tsMatch = line.match(/([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+):(\d+):(\d+)\s*-\s*error\s+(TS\d+):\s*(.+)/);
    if (tsMatch) {
      const [, file, lineNum, colNum, code, message] = tsMatch;
      compilerDiagnostics.push(`${file}:${lineNum}:${colNum} - ${code}: ${message}`);
      fileLocations.push({ file, line: Number(lineNum), column: Number(colNum) });
    }

    // ESLint diagnostics (e.g. /path/to/file.ts:10:5: error: 'x' is defined but never used)
    const lintMatch = line.match(/([a-zA-Z0-9_\-./\\]+\.[a-zA-Z0-9]+):(\d+):(\d+):\s*(error|warning)\s+(.+)/i);
    if (lintMatch) {
      const [, file, lineNum, colNum, severity, message] = lintMatch;
      compilerDiagnostics.push(`${file}:${lineNum}:${colNum} [${severity}] ${message}`);
      fileLocations.push({ file, line: Number(lineNum), column: Number(colNum) });
    }

    // Generic file matching against changed files
    for (const changedFile of changedFiles) {
      if (line.includes(changedFile)) {
        errorMessages.push(`[Referenced ${changedFile}]: ${trimmed}`);
      }
    }
  }

  // Generate bounded summary
  const summaryParts: string[] = [];
  if (commandFailed) summaryParts.push(`Command failure: ${commandFailed}`);
  if (failingTests.length > 0) summaryParts.push(`Failing tests:\n${failingTests.slice(0, 5).join('\n')}`);
  if (compilerDiagnostics.length > 0) summaryParts.push(`Compiler/Lint diagnostics:\n${compilerDiagnostics.slice(0, 5).join('\n')}`);
  if (errorMessages.length > 0 && summaryParts.length === 0) summaryParts.push(`Error lines:\n${errorMessages.slice(0, 8).join('\n')}`);

  return {
    commandFailed,
    errorMessages: errorMessages.slice(0, maxLines),
    stackTraces: stackTraces.slice(0, 20),
    failingTests,
    fileLocations,
    compilerDiagnostics,
    sanitizedSummary: summaryParts.join('\n\n') || sanitized.slice(0, 1000),
  };
}

/**
 * Deterministically classifies CI failures from Check data and logs
 */
export function classifyCIFailure(
  checkData: {
    name?: string;
    conclusion?: string;
    outputTitle?: string;
    outputSummary?: string;
    outputText?: string;
    exitCode?: number;
  },
  rawLog?: string,
  changedFiles?: string[]
): CIDiagnosis {
  const logContent = [
    checkData.name || '',
    checkData.outputTitle || '',
    checkData.outputSummary || '',
    checkData.outputText || '',
    rawLog || '',
  ].join('\n');

  const sanitized = sanitizeCILogs(logContent);
  const context = extractRelevantFailureContext(sanitized, { changedFiles });
  const lower = sanitized.toLowerCase();

  const evidence: string[] = [];
  let failureType: CIFailureType = 'UNKNOWN_FAILURE';
  let confidence: 'high' | 'medium' | 'low' = 'low';
  let rootCause = 'Unspecified CI check failure';
  let shouldAutoRepair = false;
  let unrelatedFailure = false;

  // 1. Timeout or Cancelled
  if (checkData.conclusion === 'timed_out' || lower.includes('the operation was timed out') || lower.includes('operation was aborted due to timeout') || lower.includes('timed out after')) {
    failureType = 'TIMEOUT';
    confidence = 'high';
    rootCause = 'CI workflow or job execution timed out';
    shouldAutoRepair = false;
    unrelatedFailure = false;
    evidence.push('Detected timeout signal in check conclusion or runner output');
  } else if (checkData.conclusion === 'cancelled' || lower.includes('workflow run was cancelled')) {
    failureType = 'CANCELLED';
    confidence = 'high';
    rootCause = 'CI workflow was explicitly cancelled';
    shouldAutoRepair = false;
    unrelatedFailure = true;
    evidence.push('Workflow run cancelled by user or newer commit');
  }

  // 2. Network & Dependency Failures (Non-code infrastructure)
  else if (
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('etimedout') ||
    lower.includes('getaddrinfo') ||
    lower.includes('registry.npmjs.org') && lower.includes('503') ||
    lower.includes('npm err! network') ||
    lower.includes('failed to fetch') && lower.includes('registry') ||
    lower.includes('npm registry unavailable')
  ) {
    failureType = 'NETWORK_FAILURE';
    confidence = 'high';
    rootCause = 'External network outage or package registry unreachable during CI';
    shouldAutoRepair = false;
    unrelatedFailure = true;
    evidence.push('Identified network/registry connection failure');
  }

  // 3. Permission & Authentication Failures
  else if (
    lower.includes('permission denied') ||
    lower.includes('eacces') ||
    lower.includes('http 403 forbidden') ||
    lower.includes('unauthorized') ||
    lower.includes('action_required') ||
    lower.includes('awaiting approval from a maintainer')
  ) {
    failureType = 'PERMISSION_FAILURE';
    confidence = 'high';
    rootCause = 'Permission denied or repository action awaiting collaborator approval';
    shouldAutoRepair = false;
    unrelatedFailure = true;
    evidence.push('Permission constraint / collaborator approval required');
  }

  // 4. Infrastructure & Runner Failures
  else if (
    lower.includes('runner died') ||
    lower.includes('lost communication with the server') ||
    lower.includes('no space left on device') ||
    lower.includes('enospc') ||
    lower.includes('failed to start container') ||
    lower.includes('docker daemon')
  ) {
    failureType = 'INFRASTRUCTURE_FAILURE';
    confidence = 'high';
    rootCause = 'GitHub Actions runner or virtual machine infrastructure crashed';
    shouldAutoRepair = false;
    unrelatedFailure = true;
    evidence.push('Runner or disk space infrastructure failure detected');
  }

  // 5. Lockfile / Dependency integrity Failures
  else if (
    lower.includes('err_pnpm_outdated_lockfile') ||
    lower.includes('npm err! code ebadengine') ||
    lower.includes('lockfile is out of sync') ||
    lower.includes('yarn.lock is out of date')
  ) {
    failureType = 'LOCKFILE_FAILURE';
    confidence = 'high';
    rootCause = 'Dependency lockfile is out of sync with package manifest';
    shouldAutoRepair = false; // Never silently mutate lockfile without human confirmation
    unrelatedFailure = false;
    evidence.push('Package lockfile synchronization error detected');
  }

  // 6. Type Check Failures
  else if (
    lower.includes('tsc --noemit') ||
    lower.includes('error ts') ||
    lower.includes('type error') ||
    lower.includes('cannot find name') ||
    lower.includes('is not assignable to type') ||
    lower.includes('property') && lower.includes('does not exist on type')
  ) {
    failureType = 'TYPE_FAILURE';
    confidence = 'high';
    rootCause = context.compilerDiagnostics[0] || 'TypeScript static type checking failed';
    shouldAutoRepair = true;
    unrelatedFailure = false;
    evidence.push(`Compiler diagnostic: ${context.compilerDiagnostics.slice(0, 3).join('; ') || 'TS error'}`);
  }

  // 7. Linter Failures
  else if (
    lower.includes('eslint') ||
    lower.includes('prettier') ||
    lower.includes('biome check') ||
    lower.includes('no-unused-vars') ||
    lower.includes('linting failed')
  ) {
    failureType = 'LINT_FAILURE';
    confidence = 'high';
    rootCause = context.compilerDiagnostics[0] || 'Linting or formatting verification failed';
    shouldAutoRepair = true;
    unrelatedFailure = false;
    evidence.push(`Lint violation: ${context.compilerDiagnostics.slice(0, 3).join('; ') || 'Lint rule error'}`);
  }

  // 8. Test Failures
  else if (
    context.failingTests.length > 0 ||
    lower.includes('assertionerror') ||
    lower.includes('expected') && lower.includes('received') ||
    lower.includes('test failed') ||
    lower.includes('vitest') && lower.includes('failed') ||
    lower.includes('jest') && lower.includes('failed')
  ) {
    failureType = 'TEST_FAILURE';
    confidence = 'high';
    rootCause = context.failingTests[0] || context.errorMessages[0] || 'Automated regression test failed';
    shouldAutoRepair = true;
    unrelatedFailure = false;
    evidence.push(`Failing test assertion: ${context.failingTests.slice(0, 3).join('; ') || 'Test assertion error'}`);
  }

  // 9. Build / Code Failures
  else if (
    lower.includes('build failed') ||
    lower.includes('syntaxerror') ||
    lower.includes('referenceerror') ||
    lower.includes('typeerror') ||
    lower.includes('cannot read properties') ||
    lower.includes('cannot read property') ||
    lower.includes('compilation failed')
  ) {
    failureType =
      lower.includes('cannot read properties') ||
      lower.includes('cannot read property') ||
      lower.includes('typeerror') ||
      lower.includes('referenceerror')
        ? 'CODE_FAILURE'
        : 'BUILD_FAILURE';
    confidence = 'high';
    rootCause = context.errorMessages[0] || 'Runtime code or build compilation failure';
    shouldAutoRepair = true;
    unrelatedFailure = false;
    evidence.push(`Runtime error: ${context.errorMessages.slice(0, 3).join('; ')}`);
  }

  // Extract affected files
  const affectedFilesSet = new Set<string>();
  for (const loc of context.fileLocations) {
    if (loc.file) affectedFilesSet.add(loc.file);
  }
  if (changedFiles) {
    for (const cf of changedFiles) {
      if (sanitized.includes(cf)) affectedFilesSet.add(cf);
    }
  }

  return {
    failureType,
    confidence,
    rootCause,
    affectedFiles: Array.from(affectedFilesSet),
    evidence,
    suggestedFix: shouldAutoRepair ? `Inspect ${Array.from(affectedFilesSet).join(', ') || 'modified source'} and apply targeted correction` : undefined,
    unrelatedFailure,
    shouldAutoRepair,
    extractedContext: context,
  };
}
