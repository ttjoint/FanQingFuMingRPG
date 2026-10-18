// P4 套装 / 暗金物品：纯逻辑。
import assert from "node:assert/strict";
import {
  normalizeMods, normalizeUnique, normalizeUniques, uniqueFor, normalizeSet,
  normalizeSets, setCounts, activeBonuses, setBonusTotal, tagInstance, setOfInstance,
} from "../src/engine/uniqueItem.js";

const UNIQUES = [
  { id: "u1", name: "凌锋剑", uname: "破军", mods: { atk: 12, hit: 5 } },
  { id: "u2", name: "牛皮甲", uname: "铁壁", mods: { def: 15 } },
];
const SETS = [
  { id: "s1", name: "狼烟套", pieces: ["凌锋剑", "牛皮甲", "红宝石"],
    bonuses: [{ pieces: 2, mods: { atk: 5 } }, { pieces: 3, mods: { def: 10, hp: 20 } }] },
];

export function modsOnlyKnownKeys() {
  const m = normalizeMods({ atk: 5, def: -2, 未知: 9, spd: 0, hp: "3" });
  assert.deepEqual(m, { atk: 5, def: -2, hp: 3 }, "只留认识的键，0 值丢弃");
  assert.deepEqual(normalizeMods(null), {});
}

export function uniqueRequiresBindName() {
  assert.equal(normalizeUnique({ id: "x" }).name, "");
  // 没有 name 的项永远匹配不到模板 → normalizeUniques 丢掉
  const list = normalizeUniques([{ id: "a" }, { id: "b", name: "剑" }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "b");
}

export function uniqueDedupes() {
  const list = normalizeUniques([
    { id: "a", name: "剑", uname: "甲名" },
    { id: "a", name: "刀", uname: "乙名" },
  ]);
  assert.equal(list.length, 1, "重复 id 去掉（inst.unique.id 靠它指认）");
  assert.equal(list[0].name, "剑", "保留第一个");
}

export function uniqueLookup() {
  assert.equal(uniqueFor(UNIQUES, "凌锋剑").uname, "破军");
  assert.equal(uniqueFor(UNIQUES, "不存在"), null);
  assert.equal(uniqueFor(null, "凌锋剑"), null);
}

export function setRequiresPieces() {
  // 没有部件的套装永远激活不了 → 丢掉，避免死数据
  const list = normalizeSets([{ id: "empty", pieces: [] }, { id: "ok", pieces: ["甲"] }]);
  assert.deepEqual(list.map(s => s.id), ["ok"]);
}

export function setBonusesSorted() {
  // bonuses 必须按件数升序（累加依赖顺序）
  const s = normalizeSet({ id: "x", pieces: ["a"], bonuses: [{ pieces: 5, mods: { atk: 3 } }, { pieces: 2, mods: { atk: 1 } }] });
  assert.deepEqual(s.bonuses.map(b => b.pieces), [2, 5]);
}

export function countsOnlyWornPieces() {
  const c = setCounts(SETS, ["凌锋剑", "牛皮甲", "别的甲", null]);
  assert.equal(c.s1, 2, "只数套装内的部件");
  // 全套
  assert.equal(setCounts(SETS, ["凌锋剑", "牛皮甲", "红宝石"]).s1, 3);
  // 一件都没有 → 该套装不出现在结果里
  assert.equal(setCounts(SETS, ["无关"]).s1, undefined);
}

export function bonusesAccumulateByTier() {
  const s = SETS[0];
  // 1 件：无档位达标
  assert.deepEqual(activeBonuses(s, 1), { mods: {}, tiers: [] });
  // 2 件：只拿 2 件档
  const b2 = activeBonuses(s, 2);
  assert.deepEqual(b2.mods, { atk: 5 });
  assert.deepEqual(b2.tiers, [2]);
  // 3 件：2 件档 + 3 件档累加
  const b3 = activeBonuses(s, 3);
  assert.deepEqual(b3.mods, { atk: 5, def: 10, hp: 20 });
  assert.deepEqual(b3.tiers, [2, 3]);
  // 超过总件数：全部档位（不会崩）
  assert.deepEqual(activeBonuses(s, 99).tiers, [2, 3]);
}

export function totalSumsAcrossSets() {
  const sets = [
    ...SETS,
    { id: "s2", name: "另一套", pieces: ["凌锋剑"], bonuses: [{ pieces: 1, mods: { spd: 3 } }] },
  ];
  const t = setBonusTotal(sets, ["凌锋剑", "牛皮甲"]);
  assert.equal(t.mods.atk, 5, "s1 两件档");
  assert.equal(t.mods.spd, 3, "s2 一件档也生效");
  assert.equal(t.detail.length, 2);
}

export function tagReplacesAffixes() {
  // 暗金用**替换**而不是叠加：价值在"确定的强"，叠随机词缀会让强度不可预期
  const inst = { affixes: [{ id: "random", mods: { atk: 1 } }] };
  tagInstance(inst, UNIQUES, SETS, "凌锋剑");
  assert.equal(inst.unique.uname, "破军");
  assert.equal(inst.affixes.length, 1, "随机词缀被替换掉");
  assert.equal(inst.affixes[0].id, "u_u1");
  assert.deepEqual(inst.affixes[0].mods, { atk: 12, hit: 5 });
  // 同时打上套装标记
  assert.equal(inst.setId, "s1");
}

export function tagNoOpForPlainItem() {
  const inst = { affixes: [{ id: "r", mods: { atk: 2 } }] };
  tagInstance(inst, UNIQUES, SETS, "普通剑");
  assert.equal(inst.unique, undefined);
  assert.equal(inst.setId, undefined);
  assert.equal(inst.affixes.length, 1, "普通物品的词缀不能被改");
  // null 安全
  assert.equal(tagInstance(null, UNIQUES, SETS, "x"), null);
}

export function setOfInstanceLookup() {
  const inst = { setId: "s1" };
  assert.equal(setOfInstance(SETS, inst).name, "狼烟套");
  assert.equal(setOfInstance(SETS, {}), null);
  assert.equal(setOfInstance(SETS, null), null);
}
