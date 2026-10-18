// 技能 / 攻击方式（阶段 A）：纯逻辑单测。
import { assert, assertEq, loadAssets } from "./helpers.mjs";
import { normalizeSkill } from "../src/content/schema.js";
import { MODE_MELEE, MODE_RANGED, isMelee, isRanged, skillRange, inRange, rollAttackHit, damageRange, damage, MELEE_RANGE } from "../src/engine/skill.js";

export function modeInferredFromRange() {
  // 未显式给出 mode -> 按射程推断
  assertEq(normalizeSkill({ name: "a", range: 20 }).mode, MODE_MELEE, "短射程应为近战");
  assertEq(normalizeSkill({ name: "b", range: 60 }).mode, MODE_MELEE, "60 应为近战边界");
  assertEq(normalizeSkill({ name: "c", range: 61 }).mode, MODE_RANGED, ">60 应为远程");
  assertEq(normalizeSkill({ name: "d", range: 200 }).mode, MODE_RANGED, "200 应为远程");
  // 显式指定优先
  assertEq(normalizeSkill({ name: "e", range: 200, mode: "melee" }).mode, MODE_MELEE, "显式 melee 优先");
  assertEq(normalizeSkill({ name: "f", range: 10, mode: "ranged" }).mode, MODE_RANGED, "显式 ranged 优先");
  // 非法值回退到推断
  assertEq(normalizeSkill({ name: "g", range: 200, mode: "xxx" }).mode, MODE_RANGED, "非法 mode 回退推断");
}

export function realAssetsMigrated() {
  const A = loadAssets();
  const byName = {};
  for (const s of A.skills) byName[s.name] = normalizeSkill(s);
  // 龙家剑法 range=200 -> 远程；清军剑法 range=20 -> 近战
  assertEq(byName["龙家剑法"].mode, MODE_RANGED, "龙家剑法应为远程");
  assertEq(byName["清军剑法"].mode, MODE_MELEE, "清军剑法应为近战");
  assertEq(byName["长剑"].mode, MODE_MELEE, "长剑应为近战");
  // type 0 治疗技能不应被当成攻击（mode 仍可推断，但 isRanged 语义只在攻击时用）
  assert(byName["御心术"], "御心术应存在");
}

export function rangeHelpers() {
  const melee = { range: 20, mode: MODE_MELEE };
  const ranged = { range: 200, mode: MODE_RANGED };
  // 射程下限（贴脸也能打）
  assertEq(skillRange(melee, 40), 40, "近战射程受 rangeMin 抬升");
  assertEq(skillRange(ranged, 40), 200, "远程射程为 200");
  assertEq(skillRange(null, 40), 40, "无技能 -> rangeMin");
  assert(inRange(ranged, 40, 150), "150 应在远程射程内");
  assert(!inRange(ranged, 40, 250), "250 超出远程射程");
  assert(isMelee(melee) && !isRanged(melee), "近战判定");
  assert(isRanged(ranged) && !isMelee(ranged), "远程判定");
  assert(isMelee(null), "无技能视为近战");
}

export function hitIsDistanceBased() {
  // 新判定：结算瞬间看距离，范围内 + 缓冲内必中，跑出缓冲才落空。
  const R = 100, BUF = 30;
  assert(rollAttackHit(50, R, BUF), "射程内必中");
  assert(rollAttackHit(R, R, BUF), "贴边必中");
  assert(rollAttackHit(R + BUF, R, BUF), "缓冲带边缘仍算命中");
  assert(!rollAttackHit(R + BUF + 1, R, BUF), "跑出缓冲带才落空");
  // 缓冲为 0 时就是硬射程
  assert(rollAttackHit(R, R, 0), "无缓冲：贴边中");
  assert(!rollAttackHit(R + 1, R, 0), "无缓冲：超出即落空");
  // 非有限距离（防守方信息缺失）不凭空判 miss
  assert(rollAttackHit(NaN, R, BUF), "距离未知时按命中处理");
}

export function damageVarianceRange() {
  // 伤害在 [min,max] 内浮动，且区间随 variance 展开、下限不低于 1。
  const [lo, hi] = damageRange(20, 0, 0, 0.25);
  assertEq(lo, 15, "min = base*(1-v)");
  assertEq(hi, 25, "max = base*(1+v)");
  const [l2, h2] = damageRange(1, 0, 0, 0.5);
  assertEq(l2, 1, "下限夹到 1");
  assert(h2 >= l2, "max 不小于 min");
  // variance=0 时退化为固定值
  const [l3, h3] = damageRange(10, 5, 4, 0);
  assertEq(l3, h3, "无浮动时 min == max");
  assertEq(l3, 13, "基准公式不变");
}

export function damageStaysInRange() {
  // 随机结果必须始终落在 [min,max] 内，且不再出现 0（旧系统 miss 才会 0）。
  const [, lo] = [0, damageRange(30, 0, 0, 0.3)[0]];
  const hi = damageRange(30, 0, 0, 0.3)[1];
  for (let i = 0; i < 500; i++) {
    const d = damage(30, 0, 0, 0.3);
    assert(d >= lo && d <= hi, "伤害越界: " + d);
    assert(d > 0, "命中后伤害不应为 0");
  }
  // 同一参数多次取值应出现差异（确实在浮动）
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(damage(30, 0, 0, 0.3));
  assert(seen.size > 1, "伤害应当在区间内浮动");
}

export function damageFormula() {
  // variance 省略时按 0 处理：保持旧公式的确定性结果。
  assertEq(damage(10, 0, 0), 10, "基础伤害");
  assertEq(damage(10, 5, 4), 13, "威力+、防御/2 向下取整");
  assertEq(damage(1, 0, 100), 1, "最低 1 点");
}

export function meleeRangeConstant() {
  assertEq(MELEE_RANGE, 60, "近战分界常量");
}
