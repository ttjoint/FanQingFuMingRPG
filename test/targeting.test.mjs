// 技能目标选择 / 冷却（阶段 D）：纯逻辑单测。
import { assert, assertEq } from "./helpers.mjs";
import {
  normalizeTargeting, isValidTarget, selectTargets, isSelfOnly, needsPrimary,
  TARGET_ENEMY, TARGET_ALLY, TARGET_SELF, TARGET_POINT,
  normalizeCooldown, cdRemaining, isReady, startCooldown, tickCooldowns,
  knockbackTarget,
} from "../src/engine/targeting.js";

// 测试用：简单敌对判定（不同 side 即敌对）。
const hostile = (a, b) => a.side !== b.side;
const mk = (id, side, x, y) => ({ id, side, x, y, dead: false });
const SELF = mk("p", "player", 0, 0);
const E1 = mk("e1", "enemy", 30, 0);
const E2 = mk("e2", "enemy", 80, 0);
const A1 = mk("a1", "player", 20, 0);

export function normalizeDefaults() {
  const t = normalizeTargeting(null);
  assertEq(t.kind, TARGET_ENEMY, "默认敌对");
  assertEq(t.aoe, false);
  assertEq(t.radius, 0);
  assertEq(normalizeTargeting({ kind: "bogus" }).kind, TARGET_ENEMY, "非法 kind 回落敌对");
}

export function selfAndAlly() {
  const self = normalizeTargeting({ kind: "self" });
  assert(isSelfOnly(self), "self 是自身专一");
  assertEq(selectTargets(self, SELF, null, [E1, A1], hostile).length, 1, "self 只返回自己");

  const ally = normalizeTargeting({ kind: "ally" });
  assert(needsPrimary(ally), "ally 需要主目标");
  assertEq(selectTargets(ally, SELF, A1, [A1, E1], hostile).length, 1, "友军合法");
  assertEq(selectTargets(ally, SELF, E1, [A1, E1], hostile).length, 0, "敌军对 ally 不合法");
}

export function singleTargetEnemy() {
  const tg = normalizeTargeting({ kind: "enemy" });
  assertEq(selectTargets(tg, SELF, E1, [E1, E2, A1], hostile).length, 1, "单体只命中主目标");
  assertEq(selectTargets(tg, SELF, A1, [A1, E1], hostile).length, 0, "友军不可作敌对目标");
  assertEq(selectTargets(tg, SELF, null, [E1], hostile).length, 0, "无主目标 -> 空");
}

export function aoeRadius() {
  const tg = normalizeTargeting({ kind: "enemy", aoe: true, radius: 40 });
  // 以 E1(30,0) 为中心，半径 40：E1 在内、E2(80,0) 距离50 在外
  const r1 = selectTargets(tg, SELF, E1, [E1, E2, A1], hostile);
  assertEq(r1.length, 1); assertEq(r1[0].id, "e1");
  // 半径放到 100：E1 + E2 都命中
  const tg2 = normalizeTargeting({ kind: "enemy", aoe: true, radius: 100 });
  assertEq(selectTargets(tg2, SELF, E1, [E1, E2, A1], hostile).length, 2, "AOE 命中多个敌人");
}

export function aoeMaxTargetsAndIncludeSelf() {
  const tg = normalizeTargeting({ kind: "enemy", aoe: true, radius: 200, maxTargets: 1 });
  assertEq(selectTargets(tg, SELF, E1, [E1, E2], hostile).length, 1, "maxTargets 截断");
  const allyAoe = normalizeTargeting({ kind: "ally", aoe: true, radius: 200, includeSelf: true });
  const got = selectTargets(allyAoe, SELF, A1, [A1, E1], hostile).map(u => u.id);
  assert(got.includes("p"), "includeSelf 含施法者");
  assert(got.includes("a1")); assert(!got.includes("e1"));
}

export function deadExcluded() {
  const tg = normalizeTargeting({ kind: "enemy", aoe: true, radius: 200 });
  const dead = mk("e1", "enemy", 10, 0); dead.dead = true;
  assertEq(selectTargets(tg, SELF, E2, [dead, E2], hostile).length, 1, "死亡单位排除");
}

export function isValidTargetBasics() {
  const tg = normalizeTargeting({ kind: "enemy" });
  assert(!isValidTarget(tg, SELF, SELF, hostile), "自己不算敌对目标");
  assert(isValidTarget(tg, SELF, E1, hostile));
}

export function cooldownLifecycle() {
  const u = {};
  const sk = { name: "斩", cooldown: 3 };
  assertEq(normalizeCooldown(sk), 3);
  assert(isReady(u, sk), "初始就绪");
  startCooldown(u, sk);
  assertEq(cdRemaining(u, sk), 3);
  assert(!isReady(u, sk), "冷却中");
  tickCooldowns(u, 1);
  assertEq(cdRemaining(u, sk), 2, "倒计时");
  tickCooldowns(u, 5);
  assertEq(cdRemaining(u, sk), 0, "到期清零");
  assert(isReady(u, sk));
}

export function zeroCooldownNoOp() {
  const u = {};
  const sk = { name: "x", cooldown: 0 };
  assertEq(startCooldown(u, sk), 0);
  assertEq(cdRemaining(u, sk), 0);
  assert(isReady(u, sk));
}

export function multipleSkillsIndependent() {
  const u = {};
  startCooldown(u, { name: "a", cooldown: 2 });
  startCooldown(u, { name: "b", cooldown: 5 });
  assertEq(cdRemaining(u, { name: "a" }), 2);
  assertEq(cdRemaining(u, { name: "b" }), 5);
  tickCooldowns(u, 2);
  assertEq(cdRemaining(u, { name: "a" }), 0, "a 先好");
  assertEq(cdRemaining(u, { name: "b" }), 3, "b 仍在冷却");
}

export function knockbackDirection() {
  const self = { x: 0, y: 0 }, t = { x: 10, y: 0 };
  const d = knockbackTarget(self, t, 20);
  assert(d.x > 10 && Math.abs(d.y) < 1e-6, "朝远离施法者方向推开 20");
  assertEq(Math.round(d.x), 30);
  // 重合时不崩，给出确定方向
  const d2 = knockbackTarget(self, { x: 0, y: 0 }, 10);
  assert(d2 != null);
}
