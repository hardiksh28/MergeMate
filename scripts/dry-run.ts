import { createPR } from '../lib/github';
import * as fs from 'fs';
import * as path from 'path';

// Parse .env manually if process.env values are missing
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    envContent.split('\n').forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [key, ...valParts] = trimmed.split('=');
        const val = valParts.join('=').trim();
        if (key && val && !process.env[key.trim()]) {
          process.env[key.trim()] = val;
        }
      }
    });
  }
}

async function runDryRun() {
  loadEnv();

  console.log('\n======================================================');
  console.log('🤖 MergeMate Autonomous PR Engine - CLI Dry-Run Sandbox');
  console.log('======================================================\n');

  const args = process.argv.slice(2);
  const targetOwner = args[0] || 'octocat';
  const targetRepo = args[1] || 'Spoon-Knife';
  const issueNumber = Number(args[2]) || 1;

  const mockTimestamp = new Date().toISOString();
  const mockGeneratedCode = `<!-- MergeMate Autonomous PR Patch -->
# MergeMate Contributor Sandbox
Last verified patch timestamp: ${mockTimestamp}

This mock change tests MergeMate's cross-repository Fork PR Workflow:
1. Retrieve authenticated user account.
2. Fork ${targetOwner}/${targetRepo} to user account.
3. Poll GitHub API until fork is initialized.
4. Create feature branch on fork repository.
5. Commit code patch to fork.
6. Open Pull Request on upstream repository (${targetOwner}/${targetRepo}).
`;

  console.log(`🎯 Target Repository: ${targetOwner}/${targetRepo}`);
  console.log(`🐞 Target Issue Number: #${issueNumber}`);
  const hasToken = Boolean(process.env.GITHUB_TOKEN && !process.env.GITHUB_TOKEN.includes('your_github_token'));
  console.log(`🔑 GitHub Token Present: ${hasToken ? 'YES' : 'NO (Running Demo Mode)'}`);
  console.log('\n⏳ Initiating Fork & PR Engine...\n');

  try {
    const result = await createPR({
      owner: targetOwner,
      repo: targetRepo,
      issueNumber: issueNumber,
      generatedCode: mockGeneratedCode,
      filePath: 'README.md',
      commitMessage: `chore: test MergeMate fork PR workflow (${mockTimestamp})`,
      prTitle: `test: MergeMate Fork PR Workflow Test #${issueNumber}`,
      prBody: `## MergeMate Autonomous Dry-Run Test\n\n- Verified Fork creation and polling.\n- Target: ${targetOwner}/${targetRepo}\n- Timestamp: ${mockTimestamp}`,
    });

    console.log('======================================================');
    console.log('🎉 DRY-RUN EXECUTION COMPLETE');
    console.log('======================================================');
    console.log(`Success Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Simulated Demo Mode: ${result.simulated ? 'YES' : 'NO'}`);
    console.log(`Branch Name: ${result.branchName}`);
    if (result.forkOwner) console.log(`Fork Owner: ${result.forkOwner}`);
    console.log(`Message: ${result.message}`);
    if (result.prUrl) console.log(`\n🔗 LIVE PULL REQUEST URL:\n👉 ${result.prUrl}\n`);
  } catch (error: any) {
    console.error('\n❌ Dry-Run Execution Failed:', error?.message || error);
    process.exit(1);
  }
}

runDryRun();
