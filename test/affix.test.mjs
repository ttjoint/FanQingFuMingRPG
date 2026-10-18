// 词缀表 / 词缀 roll 测试。
import { assert, assertEq, readJSON, ASSETS_DIR } from "./helpers.mjs";
import { normalizeAffix, rollAffix, rollAffixes, instanceStats } from "../src/engine/item.js";

const POOL = [
  { id: "a", name: "锋利的", prefix: "锋利的", rarity: "magic", mods: { atk: 4 }, weight: 10, slots: ["weapon"] },
  { id: "b", name: "坚固的", prefix: "坚固的", rarity: "magic", mods: { def: 4 }, weight: 10, slots: ["armor"] },
  { id: "c", name: "神圣的", prefix: "神圣的", rarity: "unique", mods: { atk: 10 }, weight: 1, slots: null },
];

export function normalizeAffixDefaults() {
  const a = normalizeAffix({ name: "锋利的", mods: { atk: 3 } });
  assertEq(a.id, "锋利的", "无 id 时用 name");
  assertEq(a.rarity, "magic", "默认稀有度 magic");
  assertEq(a.mods.atk, 3);
  assertEq(a.mods.def, 0, "缺失属性补 0");
  assertEq(a.weight, 10, "默认权重 10");
}

export function slotFiltersPool() {
  // slot=weapon 时 armor-only 与无 slots 限制的都保留（无 slots = 通用）。
  const a = rollAffix(POOL, () => 0, { slot: "weapon" });
  assert(a.id === "a" || a.id === "c", "weapon 槽不应抽到 armor-only，实得 " + a.id);
}

export function weightBias() {
  // r 接近 0 → 命中第一个（权重最大区间起点）。
  assertEq(rollAffix(POOL.slice(0, 2), () => 0, {}).id, "a");
  // r 接近 1 → 命中最后一个。
  assertEq(rollAffix(POOL.slice(0, 2), () => 0.999, {}).id, "b");
}

export function emptyPoolReturnsNull() {
  assertEq(rollAffix([], () => 0.5), null);
  assertEq(rollAffix(null, () => 0.5), null);
}

export function rarityGivesAffixCount() {
  // 用多个固定 rng 排除偶然性：common 恒 0 条。
  assertEq(rollAffixes(POOL, "common", () => 0.5).length, 0, "普通物品无词缀");
  const r = rollAffixes(POOL, "magic", () => 0.5);
  assertEq(r.length, 1, "magic 一条词缀");
  const u = rollAffixes(POOL, "unique", () => 0.25);
  assert(u.length >= 1 && u.length <= 3, "unique 1~3 条，实得 " + u.length);
}

export function affixesAreDeduped() {
  // rng 恒 0 → 一直抽第一个，必须去重后仍只有 1 条。
  const r = rollAffixes(POOL, "unique", () => 0);
  const ids = r.map(a => a.id);
  assertEq(new Set(ids).size, ids.length, "词缀不重复");
}

export function assetsAffixesNormalize() {
  const list = readJSON(ASSETS_DIR + "/affixes.json");
  assert(list.length >= 10, "词缀表条目数正常");
  for (const a of list) {
    const n = normalizeAffix(a);
    assert(n.id && n.name, "每条词缀有 id/name");
    const sum = Object.keys(n.mods).reduce((s, k) => s + Math.abs(n.mods[k] || 0), 0);
    assert(sum > 0, "词缀 " + n.id + " 应至少有一项属性（含元素键）");
  }
}

// 元素键回归：normalizeAffix 曾经把 mods 硬编码成固定 6 个基础键，
// 于是 dmgFire/resPoison 这类元素词缀在规整时被**静默丢光**——
// 数据里写了、编辑器里显示，但实例上查不到，伤害加成永远是 0。
export function elementModsSurviveNormalize() {
  const a = normalizeAffix({ id: "af_flame", name: "烈焰的", mods: { dmgFire: 35, resCold: 20 } });
  assertEq(a.mods.dmgFire, 35, "火焰伤害加成应保留");
  assertEq(a.mods.resCold, 20, "冰冷抗性应保留");
  // 基础键仍要正常出现（值为 0）
  assertEq(a.mods.atk, 0, "基础键仍在");
}

// 元素键必须一路走到 instanceStats（词缀 → 实例 → 属性汇总）。
export function elementModsReachInstanceStats() {
  const def = { name: "测试剑", mods: { atk: 5 } };
  const entry = { name: "测试剑", inst: { affixes: [{ id: "af_flame", mods: { dmgFire: 35 } }], sockets: [] } };
  const st = instanceStats(entry, def, {});
  assertEq(st.atk, 5, "基础属性照常");
  assertEq(st.dmgFire, 35, "元素加成应汇总进属性");
}
