import test from 'node:test';
import assert from 'node:assert';

// Patched META_CONTENT_PATTERNS resolving ackness/covel#50
const PATCHED_META_CONTENT_PATTERNS = [
  /测试用/u,
  /测试目的/u,
  /低成本/u,
  /快速验证/u,
  /提示词/u,
  /(?:语言模型|大模型|AI模型|模型生成|模型输出|模型内部)/u,
  /框架内部/u,
  /\btest(?:ing)?\b/iu,
  /\bvalidation\b/iu,
  /\bprompt(?:s|ing)?\b/iu,
  /\b(?:language|llm|ai|gpt|claude|deepseek)\s+model\b/iu,
  /\bmodel\s+(?:generation|output|prompt|weights|parameters|internals?)\b/iu,
  /\b(?:low[- ]?cost|cheapness|cost[- ]?effective(?:ness)?)\b/iu,
  /\bcheap\s+(?:llm|model|api|generation|token)\b/iu,
  /\be2e\b/iu,
  /\bapi\s+(?:key|endpoint|call|token|request|response)\b/iu,
  /\brest\s+api\b/iu,
  /\bframework\s+internals?\b/iu,
  /\bsoftware\s+framework\b/iu,
];

function findLoreQualityErrors(lore: string, patterns = PATCHED_META_CONTENT_PATTERNS): string[] {
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

test('Covel Issue #50 Post-fix: Accepts legitimate lore with ordinary English and Chinese words', () => {
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

  const loreWithCheap = `# The Rustlands

Scavengers sell cheap iron plating to wanderers braving the dust storm.

1. Find the salvage convoy before the raiders strike.
2. Negotiate passage through the canyon tollgate.
3. Repair the moisture vaporator in the scrap outpost.`;

  const loreWithChineseModel = `# 机械沙城

城中心的沙盘模型记录了整个机械绿洲的运行规律。

1. 寻找遗失的齿轮核心。
2. 修复沙暴防御屏障。
3. 揭开沙盘模型暗藏的古老蓝图。`;

  // 1. All legitimate lore passes with 0 errors
  assert.strictEqual(findLoreQualityErrors(loreWithFramework).length, 0, "Lore with 'framework' must pass");
  assert.strictEqual(findLoreQualityErrors(loreWithModel).length, 0, "Lore with 'model' must pass");
  assert.strictEqual(findLoreQualityErrors(loreWithCost).length, 0, "Lore with 'cost' must pass");
  assert.strictEqual(findLoreQualityErrors(loreWithApiary).length, 0, "Lore with 'apiary' must pass");
  assert.strictEqual(findLoreQualityErrors(loreWithCheap).length, 0, "Lore with 'cheap' must pass");
  assert.strictEqual(findLoreQualityErrors(loreWithChineseModel).length, 0, "Lore with '沙盘模型' must pass");
});

test('Covel Issue #50 Post-fix: Strictly catches actual meta wording leakage', () => {
  const metaChinese1 = `# 测试世界\n\n这是一个低成本快速验证用的世界。\n\n1. 钩子一。\n2. 钩子二。\n3. 钩子三。`;
  const metaChinese2 = `# 测试世界\n\n该世界由大模型生成，用于提示词微调。\n\n1. 钩子一。\n2. 钩子二。\n3. 钩子三。`;
  const metaEnglish1 = `# Test World\n\nThis world was created to test prompts in an e2e validation suite.\n\n1. First hook.\n2. Second hook.\n3. Third hook.`;
  const metaEnglish2 = `# AI Output\n\nDirect language model generation testing framework internals.\n\n1. First hook.\n2. Second hook.\n3. Third hook.`;
  const metaEnglish3 = `# Bench World\n\nBuilt for low-cost token evaluation via API endpoint.\n\n1. First hook.\n2. Second hook.\n3. Third hook.`;

  assert.strictEqual(findLoreQualityErrors(metaChinese1).includes("WORLD.md contains meta/test/model/cost wording"), true);
  assert.strictEqual(findLoreQualityErrors(metaChinese2).includes("WORLD.md contains meta/test/model/cost wording"), true);
  assert.strictEqual(findLoreQualityErrors(metaEnglish1).includes("WORLD.md contains meta/test/model/cost wording"), true);
  assert.strictEqual(findLoreQualityErrors(metaEnglish2).includes("WORLD.md contains meta/test/model/cost wording"), true);
  assert.strictEqual(findLoreQualityErrors(metaEnglish3).includes("WORLD.md contains meta/test/model/cost wording"), true);
});
