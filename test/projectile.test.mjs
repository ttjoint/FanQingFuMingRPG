// 弹道（阶段 B）：纯逻辑单测。
import { assert, assertEq } from "./helpers.mjs";
import { normalizeProjectile, makeProjectile, stepProjectile, DEFAULT_PROJ } from "../src/engine/projectile.js";
import { normalizeSkill } from "../src/content/schema.js";

// 简易测试上下文：把单位数组与 canHit 暴露给引擎（模拟运行时注入）。
function mkCtx(units, canHit) {
  return {
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    units: () => units,
    canHit: canHit || (() => true),
  };
}

export function normalizeProjectileDefaults() {
  assertEq(normalizeProjectile(null), null, "空配置 -> null");
  const p = normalizeProjectile({});
  assertEq(p.speed, DEFAULT_PROJ.speed, "默认速度");
  assertEq(p.radius, DEFAULT_PROJ.radius, "默认半径");
  assertEq(p.homing, DEFAULT_PROJ.homing, "默认追踪");
  assertEq(p.pierce, DEFAULT_PROJ.pierce, "默认不穿透");
  assertEq(p.frames, [], "默认无帧");
  const q = normalizeProjectile({ speed: 100, radius: 5, homing: false, pierce: 2, frames: ["a.bmp"] });
  assertEq(q.speed, 100); assertEq(q.radius, 5); assertEq(q.homing, false); assertEq(q.pierce, 2);
  assertEq(q.frames, ["a.bmp"]);
}

export function skillCarriesProjectileOnlyWhenRanged() {
  // 近战技能即便带 projectile 配置也会被清空（normalizeSkill 只对 ranged 保留）
  const melee = normalizeSkill({ name: "m", range: 20, projectile: { speed: 100 } });
  assertEq(melee.projectile, null, "近战不应有弹道");
  const ranged = normalizeSkill({ name: "r", range: 200, projectile: { speed: 100 } });
  assert(ranged.projectile && ranged.projectile.speed === 100, "远程应保留弹道配置");
  // 远程但没有配置 -> null（仍可瞬间结算）
  const rangedNoCfg = normalizeSkill({ name: "r2", range: 200 });
  assertEq(rangedNoCfg.projectile, null, "远程无配置则无弹道");
}

export function fliesAndHits() {
  const atk = { x: 0, y: 0, id: "A" };
  const tgt = { x: 100, y: 0, id: "T" };
  const sk = { name: "s", power: 0, mode: "ranged" };
  const proj = makeProjectile(atk, tgt, sk, { speed: 200, radius: 10, homing: false }, {});
  const ctx = mkCtx([tgt]);
  let hits = [];
  for (let i = 0; i < 60 && !proj.dead; i++) hits = hits.concat(stepProjectile(proj, 1 / 60, ctx));
  assertEq(hits.length, 1, "应命中一次");
  assertEq(hits[0], tgt, "命中目标正确");
  assert(proj.dead, "命中后弹道结束");
}

export function missesWhenOutOfRadius() {
  const atk = { x: 0, y: 0 };
  const tgt = { x: 100, y: 0 };
  const sk = { name: "s", mode: "ranged" };
  // 半径极小且目标偏出路径（射向正上方，目标在正右方 -> 不会命中）
  const other = { x: 0, y: -100 };
  const proj = makeProjectile(atk, other, sk, { speed: 400, radius: 5, homing: false }, {});
  const ctx = mkCtx([tgt]);
  let hit = false;
  for (let i = 0; i < 60 && !proj.dead; i++) if (stepProjectile(proj, 1 / 60, ctx).length) hit = true;
  assert(!hit, "途经路径外目标不应命中");
}

export function canHitFilterRespected() {
  const atk = { x: 0, y: 0 };
  const tgt = { x: 100, y: 0 };
  const sk = { name: "s", mode: "ranged" };
  const proj = makeProjectile(atk, tgt, sk, { speed: 400, homing: false }, {});
  // canHit 一律拒绝 -> 不应有命中（但弹道仍会飞到终点而结束）
  const ctx = mkCtx([tgt], () => false);
  let hit = false;
  for (let i = 0; i < 60 && !proj.dead; i++) if (stepProjectile(proj, 1 / 60, ctx).length) hit = true;
  assert(!hit, "canHit=false 时不应命中");
  assert(proj.dead, "抵达终点后弹道结束");
}

export function homingFollowsMovingTarget() {
  const atk = { x: 0, y: 0 };
  const tgt = { x: 100, y: 0 };
  const sk = { name: "s", mode: "ranged" };
  const proj = makeProjectile(atk, tgt, sk, { speed: 120, radius: 12, homing: true }, {});
  const ctx = mkCtx([tgt]);
  let hit = false;
  for (let i = 0; i < 120 && !proj.dead; i++) {
    tgt.y += 0.6;   // 目标持续下移
    if (stepProjectile(proj, 1 / 60, ctx).length) hit = true;
  }
  assert(hit, "追踪弹道应追上移动目标");
}

export function pierceHitsMultiple() {
  const atk = { x: 0, y: 0 };
  const tgt = { x: 100, y: 0 };
  const u1 = { x: 30, y: 0 }, u2 = { x: 60, y: 0 };
  const sk = { name: "s", mode: "ranged" };
  const proj = makeProjectile(atk, tgt, sk, { speed: 200, radius: 12, homing: false, pierce: 2 }, {});
  const ctx = mkCtx([u1, u2, tgt]);
  const got = [];
  for (let i = 0; i < 60 && !proj.dead; i++) for (const h of stepProjectile(proj, 1 / 60, ctx)) got.push(h);
  assert(got.indexOf(u1) >= 0 && got.indexOf(u2) >= 0 && got.indexOf(tgt) >= 0, "穿透应命中路径上的多个单位");
}

export function lifeExpires() {
  const atk = { x: 0, y: 0 };
  const far = { x: 100000, y: 0 };
  const proj = makeProjectile(atk, far, { name: "s" }, { speed: 1, radius: 10 }, { life: 0.1 });
  const ctx = mkCtx([far]);
  for (let i = 0; i < 10; i++) stepProjectile(proj, 1 / 60, ctx);
  assert(proj.dead, "超时弹道应被回收");
}
