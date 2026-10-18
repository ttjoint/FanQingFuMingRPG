// 逐帧动画原语单测。
//
// 这一层原本住在 systems/motion.js，经 utils.js 间接依赖画布常量，
// 在 Node 里 import 不了——所以动画 bug 只能靠肉眼看。下沉到 engine/ 后
// 「起手会不会从头播」这类问题终于能被断言钉住。
import { setAnim, restartAnim, animFps, tickFrame } from "../src/engine/anim.js";
import { assert, assertEq } from "./helpers.mjs";

const mk = (over) => ({ action: "stand", frame: 0, ft: 0, animSpeed: 1, ...over });

// setAnim 只切动作。
export function setAnimSwitchesAction() {
  const e = mk();
  assertEq(setAnim(e, "fight"), true, "动作变了应返回 true");
  assertEq(e.action, "fight");
}

// setAnim 在动作没变时**什么都不做**——这是它被设计用来每帧调用的前提。
// 也正因为如此，它无法用于「同一动作重新起手」（见下一个用例）。
export function setAnimIsNoopForSameAction() {
  const e = mk({ action: "fight", frame: 5, ft: 0.7 });
  assertEq(setAnim(e, "fight"), false, "同动作应返回 false");
  assertEq(e.frame, 5, "同动作不能重置帧");
  assertEq(e.ft, 0.7, "同动作不能重置帧计时");
}

// ★ 用户报的 bug 的直接回归：上一刀没播完就切目标再砍，
//   用 setAnim 不会重新起手（这就是 bug 本身）。
export function setAnimDoesNotRestartSameAction() {
  const e = mk({ action: "fight", frame: 6, ft: 0.9 });
  setAnim(e, "fight");          // 旧实现走的路
  assertEq(e.frame, 6, "setAnim 不会重新起手（正是 bug 的成因）");
}

// restartAnim 强制从首帧开始——这是修复后应该走的路。
export function restartAnimForcesFirstFrame() {
  const e = mk({ action: "fight", frame: 6, ft: 0.9 });
  restartAnim(e, "fight");
  assertEq(e.action, "fight");
  assertEq(e.frame, 0, "应回到首帧");
  assertEq(e.ft, 0, "帧计时应清零");
}

// restartAnim 对切换动作同样有效。
export function restartAnimAlsoSwitchesAction() {
  const e = mk({ action: "die", frame: 3 });
  restartAnim(e, "stand");
  assertEq(e.action, "stand");
  assertEq(e.frame, 0);
}

// 空实体不能崩（实体可能已被移除）。
export function handlesNullEntity() {
  assertEq(setAnim(null, "fight"), false);
  restartAnim(null, "fight");
  tickFrame(null, 0.1, 5);
}

// 各动作的帧率必须合理且互不相同（run 最快、stand 最慢）。
export function fpsTableIsSane() {
  assert(animFps("run") > animFps("walk"), "跑比走快");
  assert(animFps("fight") > animFps("stand"), "攻击比站立快");
  assert(animFps("die") > 0);
  assert(animFps("unknown") === animFps("stand"), "未知动作退回站立帧率");
}

// 普通动作循环播放：播到末尾回到 0。
export function normalActionLoops() {
  const e = mk({ action: "walk", frame: 0 });
  // walk = 9fps → 每帧约 0.111s，推进 4 帧
  for (let i = 0; i < 20; i++) tickFrame(e, 0.12, 4);
  assert(e.frame >= 0 && e.frame < 4, "循环后帧号必须落在区间内");
}

// 死亡动作**停在最后一帧**，不能循环（否则尸体反复倒地）。
export function deathStopsAtLastFrame() {
  const e = mk({ action: "die", frame: 0 });
  for (let i = 0; i < 100; i++) tickFrame(e, 0.12, 4);
  assertEq(e.frame, 3, "死亡动画停在最后一帧");
}

// animSpeed 会影响推进速度（攻击间隔越短，动画越快）。
export function animSpeedScalesProgress() {
  const slow = mk({ action: "fight", animSpeed: 0.5 });
  const fast = mk({ action: "fight", animSpeed: 3 });
  for (let i = 0; i < 30; i++) { tickFrame(slow, 0.05, 8); tickFrame(fast, 0.05, 8); }
  // 用一个更直接的比较：相同时间内累计的「换帧次数」应该快 > 慢
  const count = (speed) => {
    const e = mk({ action: "fight", animSpeed: speed });
    let n = 0, prev = 0;
    for (let i = 0; i < 60; i++) { tickFrame(e, 0.02, 8); if (e.frame !== prev) { n++; prev = e.frame; } }
    return n;
  };
  assert(count(3) > count(0.5), "animSpeed 越大换帧越多");
  assert(slow.frame >= 0 && fast.frame >= 0);
}

// 帧数为 0 / 非法时不能除零或算出 NaN。
export function handlesEmptyBlock() {
  const e = mk({ action: "walk", frame: 0 });
  tickFrame(e, 0.1, 0);
  tickFrame(e, 0.1, -3);
  tickFrame(e, 0.1, undefined);
  assertEq(e.frame, 0, "空帧组不应改动帧号");
  assert(!Number.isNaN(e.ft), "ft 不能变成 NaN");
}

// ft 在每次换帧时清零（而不是无限累加），否则帧率会随时间漂移。
export function ftResetsOnFrameAdvance() {
  const e = mk({ action: "fight", frame: 0 });
  tickFrame(e, 0.5, 8);
  assert(e.ft < 0.1, "换帧后 ft 应清零");
}
