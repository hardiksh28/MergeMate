/**
 * End-to-End Test: Browser Agent Generic AI Planning Loop
 *
 * Proves the full milestone loop against a deterministic, self-hosted local
 * fixture page (no external network dependency, no GitHub involvement):
 *
 *   natural language task -> AI observes page -> AI selects action
 *   -> Playwright executes it -> AI observes result -> AI selects next action
 *   -> ... -> task completes
 *
 * Assertions never trust the LLM's self-reported "done" alone — they also
 * independently re-inspect the live page afterward to confirm the DOM
 * actually reflects the completed task.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { browserController } from '../lib/browserAgent/browserController';
import { runBrowserAgentTask } from '../lib/browserAgent/planningLoop';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`❌ Assertion Failed: ${message}`);
  }
}

async function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const fixturePath = path.join(__dirname, 'fixtures', 'browser-agent-task.html');
  const html = fs.readFileSync(fixturePath, 'utf-8');

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function runBrowserAgentLoopTestSuite() {
  let passed = 0;
  const total = 3;

  const fixture = await startFixtureServer();
  console.log(`📄 Serving deterministic fixture at ${fixture.url}`);

  let sessionId: string | null = null;

  try {
    // -------------------------------------------------------------
    // Test 1: Full multi-step task completes and the DOM proves it
    // -------------------------------------------------------------
    try {
      console.log('\nTest 1: Multi-step form-fill task completes end to end...');

      const { sessionId: sid } = await browserController.startSession({ headless: true });
      sessionId = sid;

      const navResult = await browserController.navigate(sessionId, fixture.url);
      assert(navResult.success, `Expected navigation to succeed: ${navResult.error || navResult.message}`);

      const capturedEvents: string[] = [];
      const unsubscribe = browserController.onActivity(sessionId, (event) => {
        capturedEvents.push(`[${event.type}] ${event.message}`);
      });

      const task =
        'Fill in the "Full Name" field with "Ada Lovelace", select "Canada" as the country, ' +
        'check the "Subscribe to newsletter" checkbox, then submit the form.';

      const result = await runBrowserAgentTask(sessionId, task, { maxSteps: 10 });
      unsubscribe();

      console.log('  Activity timeline captured during run:');
      capturedEvents.forEach((line) => console.log(`    ${line}`));

      assert(result.success === true, `Expected task to report success, got: ${result.summary}`);
      assert(result.steps.length > 0, 'Expected at least one action step to have been taken');
      assert(
        capturedEvents.some((e) => e.startsWith('[task_started]')),
        'Expected a task_started activity event'
      );
      assert(
        capturedEvents.some((e) => e.startsWith('[plan]')),
        'Expected at least one plan activity event (AI reasoning step)'
      );
      assert(
        capturedEvents.some((e) => e.startsWith('[task_completed]')),
        'Expected a task_completed activity event'
      );

      // Independent verification: re-inspect the live DOM ourselves rather
      // than trusting the LLM's self-reported "done".
      const finalSnapshot = await browserController.inspect(sessionId);
      assert(
        finalSnapshot.visibleText.includes('Form submitted successfully'),
        `Expected page to show a success message, got visible text: ${finalSnapshot.visibleText.slice(0, 300)}`
      );
      assert(finalSnapshot.visibleText.includes('Ada Lovelace'), 'Expected submitted name to appear in the success message');
      assert(finalSnapshot.visibleText.includes('Canada'), 'Expected submitted country to appear in the success message');
      assert(finalSnapshot.visibleText.includes('Subscribed: true'), 'Expected the checkbox to have actually been checked before submit');

      console.log(`  ✅ Passed: task completed in ${result.steps.length} action step(s), DOM independently confirms real submission`);
      passed++;
    } catch (e: any) {
      console.error('  ❌ Test 1 Failed:', e.message);
    } finally {
      if (sessionId) {
        await browserController.stopSession(sessionId);
        sessionId = null;
      }
    }

    // -------------------------------------------------------------
    // Test 2: Unreachable goal fails cleanly within the step bound
    // -------------------------------------------------------------
    try {
      console.log('\nTest 2: Impossible task fails cleanly instead of hanging...');

      const { sessionId: sid } = await browserController.startSession({ headless: true });
      sessionId = sid;

      const navResult = await browserController.navigate(sessionId, fixture.url);
      assert(navResult.success, `Expected navigation to succeed: ${navResult.error || navResult.message}`);

      const startedAt = Date.now();
      const result = await runBrowserAgentTask(
        sessionId,
        'Click the "Export to PDF" button on this page to download the form as a PDF file.',
        { maxSteps: 6 }
      );
      const durationMs = Date.now() - startedAt;

      // Note: a well-reasoning planner may correctly conclude impossibility
      // straight from the inspected element list (0 steps) rather than
      // wasting an actual click attempt first — both are valid; either way
      // it must terminate promptly and report failure, never loop forever.
      assert(result.success === false, 'Expected the task to report failure for an unreachable goal');
      assert(result.steps.length <= 6, `Expected the loop to respect the step bound, took ${result.steps.length} steps`);
      assert(durationMs < 5 * 60 * 1000, 'Expected the loop to terminate well within a bounded time, not hang');

      console.log(`  ✅ Passed: correctly failed after ${result.steps.length} step(s) in ${Math.round(durationMs / 1000)}s — "${result.summary}"`);
      passed++;
    } catch (e: any) {
      console.error('  ❌ Test 2 Failed:', e.message);
    } finally {
      if (sessionId) {
        await browserController.stopSession(sessionId);
        sessionId = null;
      }
    }

    // -------------------------------------------------------------
    // Test 3: Cooperative cancellation stops the loop early
    //
    // Cancels before the very first iteration so this test exercises only
    // the cancellation check itself — deterministic and independent of the
    // LLM/network (no planner call happens at all if cancellation works).
    // -------------------------------------------------------------
    try {
      console.log('\nTest 3: Cooperative cancellation stops the loop before it starts...');

      const { sessionId: sid } = await browserController.startSession({ headless: true });
      sessionId = sid;

      const navResult = await browserController.navigate(sessionId, fixture.url);
      assert(navResult.success, `Expected navigation to succeed: ${navResult.error || navResult.message}`);

      let plannerCallsObserved = 0;
      const unsubscribe = browserController.onActivity(sessionId, (event) => {
        if (event.type === 'plan') plannerCallsObserved++;
      });

      const result = await runBrowserAgentTask(
        sessionId,
        'Fill in the "Full Name" field with "Grace Hopper", select "United Kingdom" as the country, then submit the form.',
        { maxSteps: 10, isCancelled: () => true }
      );
      unsubscribe();

      assert(result.success === false, 'Expected a cancelled task to report failure');
      assert(result.steps.length === 0, `Expected zero action steps when cancelled immediately, got ${result.steps.length}`);
      assert(plannerCallsObserved === 0, 'Expected no planner/LLM call to have been made at all once cancelled');
      assert(/cancel/i.test(result.summary), `Expected summary to explicitly mention cancellation, got: "${result.summary}"`);

      console.log(`  ✅ Passed: cancelled before any action or LLM call — "${result.summary}"`);
      passed++;
    } catch (e: any) {
      console.error('  ❌ Test 3 Failed:', e.message);
    } finally {
      if (sessionId) {
        await browserController.stopSession(sessionId);
        sessionId = null;
      }
    }
  } finally {
    await fixture.close();
  }

  console.log('\n===============================================================');
  console.log(`📊 BROWSER AGENT LOOP TEST RESULTS: ${passed}/${total} PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('===============================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runBrowserAgentLoopTestSuite();
