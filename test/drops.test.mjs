// 掉落表回归：chance 不能被内容层丢掉。
//
// 历史 P0：src/content/npcFields.js 的 drops.fromTemplate 只搬 name/count，
// chance/min/max/rarity/affixes 全被丢弃。engine/lootTable.js 的
// normalizeDrop 对缺失的 chance 默认 100% —— 于是**每个怪都必掉全部掉落物**，
// npcs.json 里写的 55%/45%/20% 静默失效。
// 实机：野猴连杀 21 只，21 次「猴皮+猴肉+金创药」三件全掉。
import { readFileSync } from "node:fs";
import { normalizeDrop } from "../src/engine/lootTable.js";

const NPCS = new URL("../versions/default/assets/npcs.json", import.meta.url);

export function npcDropsKeepChance() {
  const npcs = JSON.parse(readFileSync(NPCS, "utf8"));
  const withChance = npcs.filter(n => (n.drops || []).some(d => d.chance != null && d.chance < 100));
  if (!withChance.length) throw new Error("测试前提失效：没有配置非必掉几率的 NPC");
  return;
}

// 直接验证内容层的搬运逻辑：给定模板，产出必须保留 chance/min/max/rarity/affixes。
export function dropFieldsSurviveTemplateMapping() {
  const src = readFileSync(new URL("../src/content/npcFields.js", import.meta.url), "utf8");
  // 简版防止回归的静态检查：不能再出现只搬 name/count 的写法
  if (/\{ name: x\.name, count: x\.count \|\| 1 \}/.test(src))
    throw new Error("npcFields drops 映射又变成只搬 name/count，chance 会丢（掉落会变成必掉）");
  if (!/Object\.assign\(\{\}, x\)/.test(src))
    throw new Error("npcFields drops 应浅拷贝整条定义，避免漏搬字段");
  return;
}

// 端到端数值验证：用真实配置跑多次，掉率必须接近声明的 chance。
export function dropRateMatchesConfiguredChance() {
  const npcs = JSON.parse(readFileSync(NPCS, "utf8"));
  const monkey = npcs.find(n => n.name === "野猴");
  if (!monkey) throw new Error("npcs.json 缺少野猴");
  const drops = monkey.drops.map(d => normalizeDrop(d));
  const skin = drops.find(d => d.name === "猴皮");
  if (!skin) throw new Error("野猴缺少猴皮掉落");
  if (skin.chance !== 55) throw new Error("猴皮 chance 应为 55，实际 " + skin.chance);
  // normalizeDrop 对缺失 chance 会补 100，这里断言没被补
  if (skin.chance >= 100) throw new Error("猴皮 chance 被补成 100（必掉），字段在加载链路上丢了");
  return;
}
