// 掉落表纯逻辑（engine/lootTable.js）测试。
import * as assets from "./helpers.mjs";
const { assert, assertEq } = assets;
import { normalizeDrop, rollDrop, rollDrops, mergeOrPush } from "../src/engine/lootTable.js";
import { normalizeItemDef } from "../src/engine/item.js";

// 固定序列随机源：按给定序列返回，用尽后返回 0。
function seq(vals) { let i = 0; return () => (i < vals.length ? vals[i++] : 0); }

export function normalizeDropLegacyCompat() {
  const d = normalizeDrop({ name: "金创药", chance: 50, count: 3 });
  assertEq(d.name, "金创药");
  assertEq(d.chance, 50);
  assertEq(d.min, 3);
  assertEq(d.max, 3);
}

export function chanceZeroNeverDrops() {
  // rng 返回接近 1，使 r()*100 > chance(0) 成立 → 判定不产出。
  const got = rollDrop({ name: "药", chance: 0 }, null, seq([0.999999]));
  assertEq(got.length, 0, "0% 掉落不应产出");
}

export function chanceAlwaysDropsStackable() {
  const def = normalizeItemDef({ name: "药", type: 0 });
  const got = rollDrop({ name: "药", chance: 100, min: 2, max: 2 }, def, seq([0.5]));
  assertEq(got.length, 1);
  assertEq(got[0].count, 2);
  assert(!got[0].inst, "可堆叠物品无实例");
}

export function equipmentAlwaysInstance() {
  const def = normalizeItemDef({ name: "剑", type: 1, attack: 10, stackable: false });
  const got = rollDrop({ name: "剑", chance: 100, min: 2, max: 2 }, def, seq([0.5, 0.1, 0.2]));
  assertEq(got.length, 2, "装备逐件产出");
  assert(got.every(e => e.inst && e.inst.id), "装备条目应带实例");
}

export function rarityForcesInstance() {
  const def = normalizeItemDef({ name: "药", type: 0 });
  const got = rollDrop({ name: "药", chance: 100, rarity: "rare" }, def, seq([0.5, 0.1]));
  assertEq(got.length, 1);
  assert(!!got[0].inst, "指定稀有度时生成实例");
}

export function affixesAttached() {
  const def = normalizeItemDef({ name: "剑", type: 1, stackable: false });
  const got = rollDrop({ name: "剑", chance: 100, affixes: [{ name: "锋利", mods: { atk: 3 } }] }, def, seq([0.5, 0.1]));
  assertEq(got[0].inst.affixes.length, 1);
  assertEq(got[0].inst.affixes[0].name, "锋利");
}

export function rollDropsMergesStackable() {
  const defs = { 药: normalizeItemDef({ name: "药", type: 0 }) };
  const drops = [{ name: "药", chance: 100, min: 1, max: 1 }, { name: "药", chance: 100, min: 1, max: 1 }];
  const out = rollDrops(drops, defs, seq([0.5, 0.5, 0.5, 0.5]));
  assertEq(out.length, 1, "同名可堆叠合并为一条");
  assertEq(out[0].count, 2);
}

export function mergeOrPushKeepsInstancesSeparate() {
  const list = [];
  mergeOrPush(list, { name: "剑", count: 1, inst: { id: "a" } });
  mergeOrPush(list, { name: "剑", count: 1, inst: { id: "b" } });
  assertEq(list.length, 2, "带实例的条目各自独立");
}

export function affixPoolRolledByRarity() {
  const { readJSON, ASSETS_DIR } = assets;
  const pool = readJSON(ASSETS_DIR + "/affixes.json");
  const def = normalizeItemDef({ name: "剑", type: 1, stackable: false, rarity: "rare" });
  const got = rollDrop({ name: "剑", chance: 100 }, def, seq([0.5, 0.1, 0.3, 0.3, 0.3, 0.3]), pool);
  assertEq(got.length, 1);
  assert(!!got[0].inst, "装备带实例");
  assert(got[0].inst.affixes.length > 0, "稀有装备应从词缀表获得词缀，实得 " + got[0].inst.affixes.length);
}

export function noPoolNoAffix() {
  const def = normalizeItemDef({ name: "剑", type: 1, stackable: false, rarity: "rare" });
  const got = rollDrop({ name: "剑", chance: 100 }, def, seq([0.5, 0.1]), null);
  assertEq(got[0].inst.affixes.length, 0, "无词缀表时不产生词缀");
}
