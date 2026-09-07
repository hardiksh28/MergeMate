/**
 * MergeMate Real Repository Acquisition & Execution Engine
 *
 * Provides real repository acquisition via filtered/sparse checkouts,
 * dependency closure analysis, workspace detection, environment integrity
 * classification, and diff verification.
 */

import * as fs from 'fs';
import * as path from 'path';
import { executeSafeCommand, CommandExecutionResult, sanitizeOutput } from './safeExecutor';

export type EnvironmentIntegrity =
  | 'REAL_REPOSITORY'
  | 'REAL_REPOSITORY_PARTIAL_CHECKOUT'
  | 'RECONSTRUCTED_ENVIRONMENT';

export interface RepositoryAcquisitionOptions {
  owner: string;
  repo: string;
  branch?: string;
  commitSha?: string;
  targetFiles?: string[];
  excludePatterns?: string[];
  maxCloneTimeoutMs?: number;
  useFallbackOnTimeout?: boolean;
  workspaceDir?: string;
}

export interface DependencyClosureResult {
  targetFiles: string[];
  localDependencies: string[];
  testInfrastructureFiles: string[];
  allRequiredFiles: string[];
  missingLocalFiles: string[];
}

export interface MonorepoWorkspaceConfig {
  isMonorepo: boolean;
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun';
  workspaceType?: 'pnpm-workspace' | 'npm-workspaces' | 'yarn-workspaces' | 'turborepo' | 'nx' | 'none';
  rootPackageJson: Record<string, unknown>;
  workspacePackages: { name: string; path: string }[];
  targetPackage?: { name: string; path: string };
}

export interface AcquisitionResult {
  integrity: EnvironmentIntegrity;
  acquisitionMethod: 'git-full' | 'git-sparse' | 'git-blobless' | 'api-tarball-filtered' | 'reconstructed';
  repoDir: string;
  filesMaterialized: string[];
  excludedPatterns: string[];
  elapsedTimeMs: number;
  isReadyForPR: boolean;
  error?: string;
}

export interface DiffIntegrityCheckResult {
  isMatch: boolean;
  testedDiff: string;
  committedDiff: string;
  discrepancies: string[];
}

/**
 * Standard media and large asset patterns excluded from partial checkouts
 */
export const DEFAULT_EXCLUDED_PATTERNS = [
  'public/images/**',
  'public/media/**',
  'public/videos/**',
  '**/*.png',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.gif',
  '**/*.mp4',
  '**/*.webm',
  '**/*.zip',
  '**/*.tar.gz',
  '**/*.pdf',
  'docs/**',
  '.github/workflows/**',
];

/**
 * Resolves local imports and builds a dependency closure starting from target files
 */
export function computeDependencyClosure(
  rootDir: string,
  targetFiles: string[],
  aliases: Record<string, string> = { '@/*': 'src/*' }
): DependencyClosureResult {
  const visited = new Set<string>();
  const localDependencies = new Set<string>();
  const testInfrastructureFiles = new Set<string>();
  const missingLocalFiles: string[] = [];

  const queue = [...targetFiles];

  // Helper to resolve an import path to an actual file
  function resolveImport(importingFile: string, importPath: string): string | null {
    // 1. Check aliases (e.g. @/components/common/forms)
    for (const [aliasPattern, targetPattern] of Object.entries(aliases)) {
      const aliasPrefix = aliasPattern.replace('/*', '');
      const targetPrefix = targetPattern.replace('/*', '');

      if (importPath.startsWith(aliasPrefix + '/')) {
        const relativeTarget = importPath.replace(aliasPrefix + '/', targetPrefix + '/');
        const resolved = tryExtensions(path.join(rootDir, relativeTarget));
        if (resolved) return path.relative(rootDir, resolved);
      }
    }

    // 2. Check relative imports (./ or ../)
    if (importPath.startsWith('.')) {
      const baseDir = path.dirname(path.join(rootDir, importingFile));
      const resolved = tryExtensions(path.join(baseDir, importPath));
      if (resolved) return path.relative(rootDir, resolved);
    }

    return null;
  }

  function tryExtensions(basePath: string): string | null {
    const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.json', '.module.css', '.css'];
    for (const ext of extensions) {
      const p = basePath + ext;
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }

    // Check directory index
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js']) {
      const p = path.join(basePath, 'index' + ext);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }

    return null;
  }

  // Scan files and traverse imports
  while (queue.length > 0) {
    const currentRelPath = queue.shift()!;
    if (visited.has(currentRelPath)) continue;
    visited.add(currentRelPath);

    const fullPath = path.join(rootDir, currentRelPath);
    if (!fs.existsSync(fullPath)) {
      missingLocalFiles.push(currentRelPath);
      continue;
    }

    if (!targetFiles.includes(currentRelPath)) {
      localDependencies.add(currentRelPath);
    }

    const content = fs.readFileSync(fullPath, 'utf-8');

    // Extract import and export statements
    const importRegex = /(?:import|export)\s+(?:(?:[\w*\s{},]*)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('.') || Object.keys(aliases).some((a) => importPath.startsWith(a.replace('/*', '')))) {
        const resolved = resolveImport(currentRelPath, importPath);
        if (resolved && !visited.has(resolved)) {
          queue.push(resolved);
        }
      }
    }
  }

  // Identify test infrastructure files
  const testInfraCandidates = [
    'vitest.config.ts',
    'vitest.config.mts',
    'vitest.setup.ts',
    'jest.config.js',
    'jest.config.ts',
    'jest.setup.js',
    'jest.setup.ts',
    'tsconfig.json',
    'package.json',
  ];

  for (const candidate of testInfraCandidates) {
    if (fs.existsSync(path.join(rootDir, candidate))) {
      testInfrastructureFiles.add(candidate);
    }
  }

  const allRequiredFiles = Array.from(
    new Set([...targetFiles, ...localDependencies, ...testInfrastructureFiles])
  );

  return {
    targetFiles,
    localDependencies: Array.from(localDependencies),
    testInfrastructureFiles: Array.from(testInfrastructureFiles),
    allRequiredFiles,
    missingLocalFiles,
  };
}

/**
 * Detects workspace / monorepo configuration
 */
export function detectMonorepoWorkspace(rootDir: string): MonorepoWorkspaceConfig {
  let packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun' = 'npm';
  let isMonorepo = false;
  let workspaceType: MonorepoWorkspaceConfig['workspaceType'] = 'none';
  const workspacePackages: { name: string; path: string }[] = [];

  const pkgJsonPath = path.join(rootDir, 'package.json');
  let rootPackageJson: Record<string, unknown> = {};

  if (fs.existsSync(pkgJsonPath)) {
    try {
      rootPackageJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
    } catch {
      rootPackageJson = {};
    }
  }

  if (fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml')) || fs.existsSync(path.join(rootDir, 'pnpm-workspace.yaml'))) {
    packageManager = 'pnpm';
    if (fs.existsSync(path.join(rootDir, 'pnpm-workspace.yaml'))) {
      isMonorepo = true;
      workspaceType = 'pnpm-workspace';
    }
  } else if (fs.existsSync(path.join(rootDir, 'yarn.lock'))) {
    packageManager = 'yarn';
  } else if (fs.existsSync(path.join(rootDir, 'bun.lockb')) || fs.existsSync(path.join(rootDir, 'bun.lock'))) {
    packageManager = 'bun';
  }

  if (rootPackageJson.workspaces) {
    isMonorepo = true;
    workspaceType = packageManager === 'yarn' ? 'yarn-workspaces' : 'npm-workspaces';
  }

  if (fs.existsSync(path.join(rootDir, 'turbo.json'))) {
    isMonorepo = true;
    workspaceType = 'turborepo';
  } else if (fs.existsSync(path.join(rootDir, 'nx.json'))) {
    isMonorepo = true;
    workspaceType = 'nx';
  }

  return {
    isMonorepo,
    packageManager,
    workspaceType,
    rootPackageJson,
    workspacePackages,
  };
}

/**
 * Validates whether an environment qualifies for PR readiness
 */
export function validateEnvironmentIntegrity(
  integrity: EnvironmentIntegrity,
  reconstructedFiles: string[] = []
): { isReadyForPR: boolean; classification: EnvironmentIntegrity; reason?: string } {
  if (reconstructedFiles.length > 0 || integrity === 'RECONSTRUCTED_ENVIRONMENT') {
    return {
      isReadyForPR: false,
      classification: 'RECONSTRUCTED_ENVIRONMENT',
      reason: `Reconstructed or synthetic files detected (${reconstructedFiles.join(', ')}). MergeMate policy requires verification against genuine repository code.`,
    };
  }

  if (integrity === 'REAL_REPOSITORY' || integrity === 'REAL_REPOSITORY_PARTIAL_CHECKOUT') {
    return {
      isReadyForPR: true,
      classification: integrity,
    };
  }

  return {
    isReadyForPR: false,
    classification: 'RECONSTRUCTED_ENVIRONMENT',
    reason: 'Unknown or unverified environment state',
  };
}

/**
 * Compares the tested patch against the committed/remote diff to guarantee diff integrity
 */
export function verifyDiffIntegrity(
  testedDiff: string,
  committedDiff: string
): DiffIntegrityCheckResult {
  const normalize = (diff: string) =>
    diff
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => !line.startsWith('index ') && !line.startsWith('@@') && line.length > 0)
      .join('\n');

  const normTested = normalize(testedDiff);
  const normCommitted = normalize(committedDiff);

  const isMatch = normTested === normCommitted;
  const discrepancies: string[] = [];

  if (!isMatch) {
    discrepancies.push('Tested code diff does not match committed git tree diff');
  }

  return {
    isMatch,
    testedDiff,
    committedDiff,
    discrepancies,
  };
}
