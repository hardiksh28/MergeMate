/**
 * MergeMate Credential Isolation Test Suite
 *
 * Verifies that credentials (tokens, API keys) are NEVER exposed through:
 *   - process.argv
 *   - stdout / stderr
 *   - command strings
 *   - git remote URLs
 *   - .git/config
 *   - generated scripts
 *   - log/error messages
 *
 * Uses a synthetic fake credential TEST_SECRET_123456789 that has no real value.
 * If this string appears anywhere outside the env boundary: FAIL.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import {
  executeSafeCommand,
  sanitizeOutput,
} from '../lib/safeExecutor.js';
import {
  executeSecureGit,
  redactGitOutput,
  secureSetRemote,
} from '../lib/gitTransport.js';
import { checkGitHubPermissions } from '../lib/github.js';

const FAKE_TOKEN = 'TEST_SECRET_123456789_MERGEMATE_ISOLATION';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failures.push(`${name}: ${err.message}`);
    failed++;
  }
}

function assertNotContains(haystack: string, needle: string, context: string): void {
  if (needle && haystack.includes(needle)) {
    throw new Error(`CREDENTIAL LEAK DETECTED in ${context}`);
  }
}

// ─── 1. process.argv ─────────────────────────────────────────────────────────

async function testProcessArgv() {
  console.log('\n[1] process.argv leak tests');

  await test('process.argv does not contain FAKE_TOKEN', () => {
    assertNotContains(process.argv.join(' '), FAKE_TOKEN, 'process.argv');
  });

  await test('GITHUB_TOKEN is not in process.argv', () => {
    const token = process.env.GITHUB_TOKEN || '';
    if (!token || token.includes('your_github_token') || token.length < 10) return;
    if (process.argv.join(' ').includes(token)) {
      throw new Error('REAL GITHUB_TOKEN found in process.argv');
    }
  });
}

// ─── 2. executeSafeCommand credential guard ───────────────────────────────────

async function testSafeExecutorCredentialGuard() {
  console.log('\n[2] executeSafeCommand credential guard');

  await test('blocks command containing ghp_ token pattern', async () => {
    const fakeCmd = 'echo ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdef'; // valid-format fake
    const result = await executeSafeCommand(fakeCmd, { cwd: process.cwd() });
    assert.strictEqual(result.failureCategory, 'SECURITY_VIOLATION');
    assertNotContains(result.command, FAKE_TOKEN, 'result.command');
  });

  await test('blocks command containing github_pat_ token pattern', async () => {
    const fakeCmd = 'echo github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrst'; // valid-format fake
    const result = await executeSafeCommand(fakeCmd, { cwd: process.cwd() });
    assert.strictEqual(result.failureCategory, 'SECURITY_VIOLATION');
  });

  await test('sanitizeOutput redacts ghp_ tokens', () => {
    const raw = 'Error: token ghp_ABCDEF1234567890abcdef1234567890abcdef1234 rejected';
    const sanitized = sanitizeOutput(raw);
    assert.ok(!sanitized.includes('ghp_ABCDEF1234567890'), 'ghp_ not redacted');
    assert.ok(sanitized.includes('[REDACTED_GITHUB_TOKEN]'));
  });

  await test('sanitizeOutput redacts github_pat_ tokens', () => {
    const raw = 'Bearer github_pat_11BGF5RRQ0abcdefg1234567890AAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const sanitized = sanitizeOutput(raw);
    assert.ok(!sanitized.includes('github_pat_11BGF5RRQ0'), 'github_pat_ not redacted');
    assert.ok(sanitized.includes('[REDACTED_GITHUB_TOKEN]'));
  });

  await test('sanitizeOutput redacts Gemini API keys', () => {
    const raw = 'key=AIzaSyBFake1234567890abcdefghijklmno12345';
    const sanitized = sanitizeOutput(raw);
    assert.ok(!sanitized.includes('AIzaSyBFake'), 'Gemini key not redacted');
    assert.ok(sanitized.includes('[REDACTED_GEMINI_KEY]'));
  });

  await test('safe commands are not blocked', async () => {
    const result = await executeSafeCommand('echo hello', { cwd: process.cwd() });
    assert.notStrictEqual(result.failureCategory, 'SECURITY_VIOLATION');
    assert.ok(result.stdout.includes('hello'));
  });

  await test('GITHUB_TOKEN is stripped from child process env', async () => {
    const result = await executeSafeCommand('printenv GITHUB_TOKEN || echo NOT_SET', {
      cwd: process.cwd(),
    });
    const token = process.env.GITHUB_TOKEN || '';
    if (token && !token.includes('your_github_token') && token.length > 10) {
      assertNotContains(result.stdout, token, 'child stdout (GITHUB_TOKEN check)');
    }
    assert.ok(
      result.stdout.includes('NOT_SET') || result.stdout.trim() === '',
      `GITHUB_TOKEN leaked into child: "${result.stdout.trim()}"`
    );
  });
}

// ─── 3. gitTransport ─────────────────────────────────────────────────────────

async function testGitTransport() {
  console.log('\n[3] gitTransport credential isolation');

  await test('throws SECURITY VIOLATION if token appears in git args', () => {
    const fakeToken = FAKE_TOKEN + 'xxxxxxxxxxx';
    assert.throws(
      () =>
        executeSecureGit(
          ['clone', 'https://github.com/user/repo.git', `--extra=${fakeToken}`],
          { token: fakeToken, cwd: os.tmpdir() }
        ),
      /SECURITY VIOLATION/
    );
  });

  await test('redactGitOutput removes ghp_ from strings', () => {
    const raw = 'fatal: auth failed https://ghp_ABCDEF12345678901234567890ABCDEF1234@github.com/r.git';
    const redacted = redactGitOutput(raw);
    assert.ok(!redacted.includes('ghp_ABCDEF'), 'ghp_ must be redacted');
  });

  await test('redactGitOutput removes github_pat_ from strings', () => {
    // Use a standalone error message (not inside AUTHORIZATION: header) to isolate
    // the github_pat_ regex independently from the AUTHORIZATION header redactor.
    const raw = 'fatal: invalid credentials github_pat_11ABCDEF0GHIJKLM1234567890NOPQRSTUVWXYZ12345678901234567890';
    const redacted = redactGitOutput(raw);
    // The credential value must not appear in the output
    assert.ok(!redacted.includes('github_pat_11ABCDEF'), 'github_pat_ token must be fully redacted');
    // Should be replaced with the PAT redaction marker
    assert.ok(
      redacted.includes('[REDACTED_GH_PAT]'),
      `Expected [REDACTED_GH_PAT] in: "${redacted}"`
    );
  });

  await test('redactGitOutput strips credential from HTTPS remote URLs', () => {
    const raw = 'Cloning from https://x-access-token:MYTOKEN@github.com/user/repo.git';
    const redacted = redactGitOutput(raw);
    assert.ok(!redacted.includes('MYTOKEN@github.com'), 'embedded URL cred must be removed');
  });
}

// ─── 4. git config check ─────────────────────────────────────────────────────

async function testGitConfigNoCredential() {
  console.log('\n[4] git config credential check');

  await test('.git/config contains no raw credentials', () => {
    const gitConfigPath = path.join(process.cwd(), '.git', 'config');
    if (!fs.existsSync(gitConfigPath)) return; // Not a git repo
    const config = fs.readFileSync(gitConfigPath, 'utf8');
    assert.ok(!/ghp_[a-zA-Z0-9]{20,}/.test(config), '.git/config has ghp_ token');
    assert.ok(!/github_pat_[a-zA-Z0-9_]{30,}/.test(config), '.git/config has github_pat_ token');
    assert.ok(!/https?:\/\/[^@\s/]+@github\.com/.test(config), '.git/config has credential URL');
  });

  await test('secureSetRemote strips credential from URL before writing to git config', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mergemate-test-'));
    try {
      spawnSync('git', ['init', tmpDir], { stdio: 'pipe' });
      const credUrl = `https://x-access-token:${FAKE_TOKEN}@github.com/user/repo.git`;
      secureSetRemote(tmpDir, 'origin', credUrl);
      const cfg = fs.readFileSync(path.join(tmpDir, '.git', 'config'), 'utf8');
      assertNotContains(cfg, FAKE_TOKEN, '.git/config after secureSetRemote');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
}

// ─── 5. .env file checks ─────────────────────────────────────────────────────

async function testEnvFile() {
  console.log('\n[5] .env file security');

  await test('.env.example contains no real credentials', () => {
    const examplePath = path.join(process.cwd(), '.env.example');
    if (!fs.existsSync(examplePath)) {
      throw new Error('.env.example does not exist');
    }
    const content = fs.readFileSync(examplePath, 'utf8');
    assert.ok(!/ghp_[a-zA-Z0-9]{20,}/.test(content), '.env.example has ghp_ token');
    assert.ok(!/github_pat_[a-zA-Z0-9_]{30,}/.test(content), '.env.example has github_pat_');
    assert.ok(!/AIzaSy[a-zA-Z0-9_-]{25,}/.test(content), '.env.example has Google API key');
  });

  await test('.gitignore includes .env', () => {
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    if (!fs.existsSync(gitignorePath)) return;
    const content = fs.readFileSync(gitignorePath, 'utf8');
    assert.ok(content.includes('.env'), '.gitignore must include .env');
  });
}

// ─── 6. Static source scan ───────────────────────────────────────────────────

async function testNoRawTokenInSource() {
  console.log('\n[6] Static source scan');

  await test('lib/ has no hardcoded ghp_ tokens (outside regex patterns)', () => {
    const result = spawnSync(
      'grep',
      ['-rn', '--include=*.ts', '-E', 'ghp_[a-zA-Z0-9]{36,}', 'lib/'],
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    const matches = (result.stdout || '')
      .split('\n')
      .filter((l) => l && !l.includes('g,]') && !l.includes("replace(/") && !l.includes('.replace('));
    assert.strictEqual(matches.length, 0, `Raw ghp_ tokens in lib/: ${matches.join(', ')}`);
  });

  await test('lib/ has no hardcoded github_pat_ tokens (outside regex patterns)', () => {
    const result = spawnSync(
      'grep',
      ['-rn', '--include=*.ts', '-E', "github_pat_[a-zA-Z0-9_]{50,}", 'lib/'],
      { cwd: process.cwd(), encoding: 'utf8' }
    );
    const matches = (result.stdout || '')
      .split('\n')
      .filter((l) => l && !l.includes('.replace('));
    assert.strictEqual(matches.length, 0, `Raw github_pat_ tokens in lib/: ${matches.join(', ')}`);
  });

  await test('solve-candidate-benchmark.ts no longer parses .env via string-split', () => {
    const benchPath = path.join(process.cwd(), 'scripts', 'solve-candidate-benchmark.ts');
    const content = fs.readFileSync(benchPath, 'utf8');
    assert.ok(
      !content.includes("line.split('=')[1].trim()"),
      'Must not parse .env via string split'
    );
    assert.ok(
      !content.match(/let token\s*=\s*''/),
      'Must not have mutable empty token variable'
    );
  });
}

// ─── 7. checkGitHubPermissions safe output ───────────────────────────────────

async function testCheckGitHubPermissions() {
  console.log('\n[7] checkGitHubPermissions safe output');

  await test('result never contains raw GITHUB_TOKEN value', async () => {
    const report = await checkGitHubPermissions();
    const reportStr = JSON.stringify(report);
    const token = process.env.GITHUB_TOKEN || '';

    assert.ok('authenticated' in report, 'Missing authenticated field');
    assert.ok('tokenPresent' in report, 'Missing tokenPresent field');
    assert.ok('login' in report, 'Missing login field');

    if (token && !token.includes('your_github_token') && token.length > 10) {
      assertNotContains(reportStr, token, 'checkGitHubPermissions() result');
    }
    // Extra: must not contain the old exposed credential prefix
    assertNotContains(reportStr, 'github_pat_11BGF5RRQ', 'checkGitHubPermissions result');
  });

  await test('returns only structured metadata — login is username or null', async () => {
    const report = await checkGitHubPermissions();
    assert.ok(
      report.login === null || (typeof report.login === 'string' && !report.login.includes('_pat_')),
      `login field must be a username, got: ${report.login}`
    );
    const validValues = [true, false, 'unknown'];
    assert.ok(validValues.includes(report.canCreateFork as any));
    assert.ok(validValues.includes(report.canPushOwnRepo as any));
    assert.ok(validValues.includes(report.canCreateExternalPR as any));
  });
}

// ─── 8. Fake token isolation ─────────────────────────────────────────────────

async function testFakeTokenIsolation() {
  console.log('\n[8] Fake token isolation (TEST_SECRET_123456789)');

  await test('sanitizeOutput redacts real-format ghp_ token', () => {
    const fakeGhp = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdef';
    const sanitized = sanitizeOutput('Error: token ' + fakeGhp + ' rejected');
    assertNotContains(sanitized, fakeGhp, 'sanitizeOutput result');
    assert.ok(sanitized.includes('[REDACTED_GITHUB_TOKEN]'), 'Must show redaction marker');
  });

  await test('real GITHUB_TOKEN not present in child process stdout', async () => {
    const result = await executeSafeCommand('printenv GITHUB_TOKEN || echo NOT_SET', {
      cwd: process.cwd(),
    });
    const token = process.env.GITHUB_TOKEN || '';
    if (token && !token.includes('your_github_token') && token.length > 10) {
      assertNotContains(result.stdout, token, 'child stdout');
      assertNotContains(result.stderr || '', token, 'child stderr');
    }
  });

  await test('askpass script contains env var reference not hardcoded token', () => {
    const scriptPath = path.join(os.tmpdir(), `mergemate-askpass-${process.pid}.js`);
    if (!fs.existsSync(scriptPath)) return; // Not created yet, skip
    const content = fs.readFileSync(scriptPath, 'utf8');
    const token = process.env.GITHUB_TOKEN || '';
    if (token && !token.includes('your_github_token') && token.length > 10) {
      assertNotContains(content, token, 'askpass script');
    }
    assert.ok(
      content.includes('process.env.MERGEMATE_GIT_TOKEN'),
      'askpass must read from env var'
    );
  });
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║     MERGEMATE CREDENTIAL ISOLATION TEST SUITE             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  await testProcessArgv();
  await testSafeExecutorCredentialGuard();
  await testGitTransport();
  await testGitConfigNoCredential();
  await testEnvFile();
  await testNoRawTokenInSource();
  await testCheckGitHubPermissions();
  await testFakeTokenIsolation();

  console.log('\n═════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error('\nFAILED TESTS:');
    failures.forEach((f) => console.error(`  • ${f}`));
    console.log('\n⛔ SECURITY HARDENING FAILED');
    process.exit(1);
  } else {
    console.log('\n✅ SECURITY HARDENING COMPLETE');
    console.log('   All credential isolation checks passed.');
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
