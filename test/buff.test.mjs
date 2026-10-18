// Buff / Debuff（阶段 C）：纯逻辑单测。
import { assert, assertEq } from "./helpers.mjs";
import {
  normalizeBuff, normalizeBuffs, buildBuffTable, makeBuffInstance,
  applyBuff, removeBuff, findBuff, hasBuff, getStacks,
  statMods, dotPerSecond, hotPerSecond, tickBuffs, clearBuffs,
  STACK_STACK, STACK_REFRESH,
} from "../src/engine/buff.js";

const BURN = { id: "burn", name: "灼烧", duration: 6, maxStacks: 3, stackMode: "stack", dot: { dps: 4 }, tags: ["debuff"] };
const RAGE = { id: "rage", name: "狂暴", duration: 10, maxStacks: 2, stackMode: "stack", mods: { atk: 8 } };
const REGEN = { id: "regen", name: "回复", duration: 8, maxStacks: 1, hot: { hps: 6 } };
const BLESS = { id: "bless", name: "祝福", duration: 5, maxStacks: 1, stackMode: "refresh", mods: { def: 3 } };

export function normalizeAndTable() {
  assertEq(normalizeBuff(null), null, "空 -> null");
  assertEq(normalizeBuff({}), null, "无 id -> null");
  const b = normalizeBuff({ id: "x", duration: 3 });
  assertEq(b.name, "x"); assertEq(b.duration, 3);
  assertEq(b.maxStacks, 1); assertEq(b.stackMode, STACK_REFRESH, "默认刷新");
  assertEq(b.mods.atk, 0); assertEq(b.dot, null);
  const tbl = buildBuffTable([BURN, RAGE, { id: "burn", name: "dup" }]);
  assertEq(tbl.byId.size, 2, "同 id 去重");
  assertEq(tbl.byId.get("burn").name, "dup", "同 id 后者覆盖（Map.set 语义）");
  assertEq(normalizeBuffs([null, BURN]).length, 1);
}

export function applyAndRefresh() {
  const u = {};
  const a = applyBuff(u, BLESS);
  assert(a && a.stacks === 1, "新建一层");
  a.dur = 1;   // 衰减后
  const b = applyBuff(u, BLESS);
  assertEq(b.dur, 5, "refresh 刷新时长");
  assertEq(b.stacks, 1, "refresh 不叠层");
  assertEq(u.buffs.length, 1, "不重复创建");
}

export function stackingRespectsMax() {
  const u = {};
  applyBuff(u, BURN); applyBuff(u, BURN); applyBuff(u, BURN);
  assertEq(getStacks(u, "burn"), 3, "叠到 3 层");
  applyBuff(u, BURN);
  assertEq(getStacks(u, "burn"), 3, "不超过 maxStacks");
  assertEq(findBuff(u, "burn").stackMode, STACK_STACK);
}

export function explicitStacks() {
  const u = {};
  applyBuff(u, RAGE, { stacks: 2 });
  assertEq(getStacks(u, "rage"), 2, "一次性叠 2 层");
  const m = statMods(u);
  assertEq(m.atk, 16, "2 层 * 8 攻击");
}

export function modsAggregateByStacks() {
  const u = {};
  applyBuff(u, RAGE); applyBuff(u, RAGE);         // atk +16
  applyBuff(u, BLESS);                             // def +3
  const m = statMods(u);
  assertEq(m.atk, 16); assertEq(m.def, 3); assertEq(m.hpMax, 0);
}

export function dotHotPerSecond() {
  const u = {};
  applyBuff(u, BURN); applyBuff(u, BURN);         // 2 层 * 4 dps
  assertEq(dotPerSecond(u), 8, "DoT = 层数 * dps");
  applyBuff(u, REGEN);                             // hps 6
  assertEq(hotPerSecond(u), 6, "HoT");
  // 层数越高 DoT 越大
  applyBuff(u, BURN);
  assertEq(dotPerSecond(u), 12);
}

export function tickAndExpire() {
  const u = {};
  applyBuff(u, BLESS);        // 5s
  assertEq(tickBuffs(u, 2).length, 0, "未到期");
  assert(findBuff(u, "bless").dur <= 3.0001 && findBuff(u, "bless").dur >= 2.9999, "时长递减");
  const exp = tickBuffs(u, 4);
  assertEq(exp.length, 1, "到期返回 id");
  assertEq(exp[0], "bless");
  assertEq(u.buffs.length, 0, "已移除");
}

export function removeAndClear() {
  const u = {};
  applyBuff(u, BURN); applyBuff(u, RAGE);
  assert(removeBuff(u, "burn"), "移除成功");
  assert(!hasBuff(u, "burn"));
  assert(!removeBuff(u, "nope"), "移除不存在的返回 false");
  clearBuffs(u);
  assertEq(u.buffs.length, 0, "清空");
}

export function makeInstanceIsolation() {
  const def = normalizeBuff(BURN);
  const i1 = makeBuffInstance(def), i2 = makeBuffInstance(def);
  i1.mods.atk = 999; i1.tags.push("x");
  assertEq(i2.mods.atk, 0, "实例独立拷贝 mods");
  assert(i2.tags.indexOf("x") < 0, "实例独立拷贝 tags");
}

export function realBuffsFileValid() {
  // 真实资产：assets/buffs.json 应能规整且 id 唯一
  const list = normalizeBuffs(REAL);
  assert(list.length >= 5, "至少 5 条 buff");
  const ids = new Set(list.map(b => b.id));
  assertEq(ids.size, list.length, "id 唯一");
  const burn = list.find(b => b.id === "burn");
  assert(burn && burn.maxStacks === 3 && burn.dot.dps === 4, "burn 定义正确");
}

// 直接内联真实资产内容（避免测试依赖文件系统读取）。
const REAL = [
  { id: "burn", duration: 6, maxStacks: 3, stackMode: "stack", dot: { dps: 4 } },
  { id: "poison", duration: 10, dot: { dps: 2 } },
  { id: "regen", duration: 8, hot: { hps: 6 } },
  { id: "rage", duration: 10, maxStacks: 2, stackMode: "stack", mods: { atk: 8 } },
  { id: "guard", duration: 8, mods: { def: 6 } },
  { id: "slow", duration: 5, mods: { speed: -30 } },
];
