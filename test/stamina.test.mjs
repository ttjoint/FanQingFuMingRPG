import { canRun, resolveRun, tickMp, WALK_SPEED, RUN_SPEED } from "../src/engine/stamina.js";
import { assert } from "./helpers.mjs";

// 精力门控：精力为 0 时左右键都只能走路；精力不自动回复（只靠药水/NPC）。

export function canRunGate() {
  assert(!canRun({ mp: 0 }), "mp=0 不能跑");
  assert(canRun({ mp: 1 }), "mp>0 可以跑");
  assert(!canRun(null), "没有 stats 时不能跑");
}

export function exhaustionForcesWalk() {
  const r = resolveRun({ mp: 0 }, true);   // 左键想跑，但精力为 0
  assert(r.running === false, "精力为 0 时左键也降为走路");
  assert(r.speed === WALK_SPEED, "速度应为走路速度 " + WALK_SPEED);
}

export function recoversAllowsRun() {
  const r = resolveRun({ mp: 5 }, true);   // （靠药水/NPC）回复后左键可跑
  assert(r.running === true, "精力恢复后左键可跑");
  assert(r.speed === RUN_SPEED, "速度应为奔跑速度 " + RUN_SPEED);
}

export function rightClickAlwaysWalks() {
  const r = resolveRun({ mp: 100 }, false);   // 右键 = 走路，即使精力充足
  assert(r.running === false, "右键永远是走路");
  assert(r.speed === WALK_SPEED, "右键速度为走路速度");
}

export function drainWhileRunning() {
  // 1 秒奔跑：100 - 1.6*1 => 98.4
  const v = tickMp(100, 100, true, 1.6, 1);
  assert(Math.abs(v - 98.4) < 1e-9, "奔跑应消耗精力，得到 " + v);
}

export function drainFloorsAtZero() {
  const v = tickMp(1, 100, true, 1.6, 10);   // 消耗 16 > 1 → 夹到 0
  assert(v === 0, "精力不应为负，得到 " + v);
}

export function noDrainWhenNotRunning() {
  // 停止（不奔跑）时精力不变 —— 不消耗也不回复
  const v = tickMp(50, 100, false, 1.6, 10);
  assert(v === 50, "不奔跑时精力应保持不变（无自动回复），得到 " + v);
}

// 移速可由游戏配置注入（引擎默认仅为兵底）。
export function speedsInjectable() {
  const r1 = resolveRun({ mp: 0 }, true, { walkSpeed: 120, runSpeed: 200 });
  assert(r1.speed === 120, "注入后走路速度生效，得到 " + r1.speed);
  const r2 = resolveRun({ mp: 5 }, true, { walkSpeed: 120, runSpeed: 200 });
  assert(r2.speed === 200, "注入后奔跑速度生效，得到 " + r2.speed);
  // 缺省回退引擎内置默认
  const r3 = resolveRun({ mp: 0 }, true);
  assert(r3.speed === WALK_SPEED, "未注入时回退默认走路速度");
}
