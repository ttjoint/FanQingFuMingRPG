// 词缀表 / 词缀 roll 测试。
import { assert, assertEq, readJSON, ASSETS_DIR } from "./helpers.mjs";
import { normalizeAffix, rollAffix, rollAffixes } from "../src/engine/item.js";

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
    const sum = Math.abs(n.mods.atk) + Math.abs(n.mods.def) + Math.abs(n.mods.hp) + Math.abs(n.mods.mp) + Math.abs(n.mods.hit) + Math.abs(n.mods.spd);
    assert(sum > 0, "词缀 " + n.id + " 应至少有一项属性");
  }
}
