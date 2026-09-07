import test from 'node:test';
import assert from 'node:assert';

// Production META_CONTENT_PATTERNS from ackness/covel packages/create/src/validation-helpers.ts
const PRODUCTION_META_CONTENT_PATTERNS = [
  /测试用/u,
  /测试目的/u,
  /低成本/u,
  /快速验证/u,
  /提示词/u,
  /模型/u,
  /框架内部/u,
  /\btest(?:ing)?\b/iu,
  /\bvalidation\b/iu,
  /\bprompt\b/iu,
  /\bmodel\b/iu,
  /\bcost\b/iu,
  /\bcheap\b/iu,
  /\be2e\b/iu,
  /\bapi\b/iu,
  /\bframework\b/iu,
];

function findLoreQualityErrors(lore: string, patterns = PRODUCTION_META_CONTENT_PATTERNS): string[] {
  const errors: string[] = [];
  if (!/^#\s+\S/m.test(lore)) {
    errors.push("WORLD.md must start with an H1 title");
  }
  const forbidden = patterns.find((pattern) => pattern.test(lore));
  if (forbidden) {
    errors.push("WORLD.md contains meta/test/model/cost wording");
  }
  const numberedHooks = lore.match(/^\s*\d+\.\s+/gmu)?.length ?? 0;
  if (numberedHooks < 3) {
    errors.push("WORLD.md must include 3 numbered adventure hooks");
  }
  return errors;
}

test('Covel Issue #50 Baseline: Legitimate lore with natural English words fails quality check', () => {
  const loreWithFramework = `# The Floating Isles of Aetheria

The technomantic framework powers the levitation engines across the archipelago.

1. Investigate the fluctuations in the energy matrix.
2. Recover the lost catalyst from the lower depths.
3. Protect the archivist from sky pirates.`;

  const loreWithModel = `# The Solaris Republic

The senate operates as a model of democratic governance in the post-war era.

1. Uncover the conspiracy behind the senate election.
2. Escort the diplomat through hostile territory.
3. Decrypt the intercepted imperial dispatch.`;

  const loreWithCost = `# The Necropolis of Ur

The cost of forbidden sorcery is always extracted from the caster's memories.

1. Restore the shattered memory monolith.
2. Slay the wraith haunting the catacombs.
3. Find the cure for the memory rot.`;

  const loreWithApiary = `# The Golden Citadel

The sacred apiary keepers harvest celestial honey for the high priest.

1. Defend the hive from subterranean wasps.
2. Retrieve the queen bee from the corrupted forest.
3. Discover the truth behind the nectar drought.`;

  const loreWithChineseModel = `# 机械沙城

城中心的沙盘模型记录了整个机械绿洲的运行规律。

1. 寻找遗失的齿轮核心。
2. 修复沙暴防御屏障。
3. 揭开沙盘模型暗藏的古老蓝图。`;

  console.log("Checking lore with 'framework' errors:", findLoreQualityErrors(loreWithFramework));
  console.log("Checking lore with 'model' errors:", findLoreQualityErrors(loreWithModel));
  console.log("Checking lore with 'cost' errors:", findLoreQualityErrors(loreWithCost));

  // These SHOULD be valid (0 errors), but baseline regex causes false positive errors!
  assert.strictEqual(findLoreQualityErrors(loreWithFramework).length, 0, "Legitimate lore using 'framework' must be accepted");
  assert.strictEqual(findLoreQualityErrors(loreWithModel).length, 0, "Legitimate lore using 'model' must be accepted");
  assert.strictEqual(findLoreQualityErrors(loreWithCost).length, 0, "Legitimate lore using 'cost' must be accepted");
  assert.strictEqual(findLoreQualityErrors(loreWithChineseModel).length, 0, "Legitimate lore using '沙盘模型' must be accepted");
});
