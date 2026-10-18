// P4 难度分级：纯逻辑。
import assert from "node:assert/strict";
import {
  DIFFICULTIES, normalizeDifficulty, normalizeDifficulties, difficultyById,
  scaleBy, monsterMults, difficultyIndex, cycleDifficulty,
} from "../src/engine/difficulty.js";

export function normalizeFillsDefaults() {
  // 缺字段一律回中性值 1（不做乘法就是原样，不会意外放大）
  const d = normalizeDifficulty({ id: "x" });
  assert.equal(d.hp, 1);
  assert.equal(d.damage, 1);
  assert.equal(d.exp, 1);
  assert.equal(d.drop, 1);
  assert.equal(d.name, "x", "name 缺省用 id 兜底");
  // 残缺/非法值
  const bad = normalizeDifficulty({ id: "y", hp: "abc", damage: -3 });
  assert.equal(bad.hp, 1, "非数字 → 1");
  assert.equal(bad.damage, 1, "负数 → 1（负倍率会让怪物回血）");
  // 0 是合法值（例如"无掉落"）
  assert.equal(normalizeDifficulty({ id: "z", drop: 0 }).drop, 0);
}

export function normalizeRequiresId() {
  assert.equal(normalizeDifficulty(null).id, "normal");
  assert.equal(normalizeDifficulty({}).id, "normal");
  assert.equal(normalizeDifficulty({ id: "  " }).id, "normal");
}

export function normalizeListDedupes() {
  const list = normalizeDifficulties([
    { id: "a", hp: 2 }, { id: "a", hp: 9 }, { id: "b" },
  ]);
  assert.equal(list.length, 2, "重复 id 必须去掉（存档按 id 指向，会变歧义）");
  assert.equal(list[0].hp, 2, "保留第一个");
}

export function normalizeListFallsBackToBuiltins() {
  // 空表/非数组 → 内置三档，而不是空（否则游戏里没有难度可选）
  assert.equal(normalizeDifficulties([]).length, DIFFICULTIES.length);
  assert.equal(normalizeDifficulties(null).length, DIFFICULTIES.length);
}

export function builtinsAreMonotonic() {
  // 内置档位必须单调递增，否则"更高难度"反而不更难
  const [n, nm, h] = DIFFICULTIES.map(normalizeDifficulty);
  assert.ok(nm.hp > n.hp && h.hp > nm.hp);
  assert.ok(nm.damage > n.damage && h.damage > nm.damage);
  assert.ok(nm.exp > n.exp && h.exp > nm.exp);
  // 掉落也要涨，但**涨幅小于**血量（否则无脑最高难度是唯一解）
  assert.ok(nm.drop > n.drop && h.drop > nm.drop);
  assert.ok(h.drop / n.drop < h.hp / n.hp, "掉落增幅必须小于强度增幅");
}

export function byIdFallsBackToFirst() {
  const list = normalizeDifficulties(null);
  assert.equal(difficultyById(list, "hell").id, "hell");
  // 存档里写了已删除的难度：退回第一档而不是报错（否则读档直接进不去）
  assert.equal(difficultyById(list, "不存在").id, list[0].id);
  assert.equal(difficultyById(list, null).id, list[0].id);
}

export function scaleRoundsAndClamps() {
  assert.equal(scaleBy(100, 2.2), 220);
  assert.equal(scaleBy(3, 1.5), 5, "四舍五入，不是截断");
  assert.equal(scaleBy(10, 0), 0);
  assert.equal(scaleBy(10, null), 10, "null 倍率按 1（Number(null)===0 是个坑）");
  assert.equal(scaleBy(10, undefined), 10);
  assert.equal(scaleBy(10, NaN), 10);
  assert.equal(scaleBy(NaN, 2), 0, "非法基数按 0");
}

export function multsMatchDefinition() {
  const m = monsterMults({ id: "h", hp: 3, damage: 2, exp: 1.5, drop: 1.2 });
  assert.deepEqual(m, { hp: 3, damage: 2, exp: 1.5, drop: 1.2 });
  // 缺省难度 → 全 1（等于"没有难度系统"的旧行为）
  assert.deepEqual(monsterMults(null), { hp: 1, damage: 1, exp: 1, drop: 1 });
}

export function cycleWraps() {
  const list = normalizeDifficulties(null);
  const first = list[0].id, last = list[list.length - 1].id;
  assert.equal(cycleDifficulty(list, first, 1), list[1].id);
  assert.equal(cycleDifficulty(list, last, 1), first, "越界回绕到第一档");
  assert.equal(cycleDifficulty(list, first, -1), last, "反向回绕");
  assert.equal(difficultyIndex(list, last), list.length - 1);
  assert.equal(difficultyIndex(list, "没这个"), 0);
}
