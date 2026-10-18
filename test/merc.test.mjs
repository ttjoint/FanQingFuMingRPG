// P4 雇佣兵：纯逻辑。
import assert from "node:assert/strict";
import {
  MERCENARIES, normalizeMerc, normalizeMercs, mercById, feesDue, nextFeeIn,
  reviveCost, reviveState, followStep, canHire, FEE_PERIOD, REVIVE_DELAY,
  FOLLOW_LEAD, FOLLOW_STOP,
} from "../src/engine/merc.js";

export function normalizeFillsDefaults() {
  const m = normalizeMerc({ id: "x" });
  assert.equal(m.hp, 100);
  assert.equal(m.name, "x", "name 缺省用 id 兜底");
  assert.equal(m.fee, 0);
  assert.equal(m.price, 0);
  // 非法/负数不能出现负血或 0 攻击范围
  const bad = normalizeMerc({ id: "y", hp: -5, range: 0, cd: 0, speed: "abc" });
  assert.ok(bad.hp >= 1);
  assert.ok(bad.range >= 1);
  assert.ok(bad.cd > 0, "冷却为 0 会变成每帧攻击");
}

export function normalizeListDedupes() {
  const list = normalizeMercs([{ id: "a", hp: 1 }, { id: "a", hp: 999 }, { id: "b" }]);
  assert.equal(list.length, 2, "重复 id 必须去掉（存档按 id 指认）");
  assert.equal(list[0].hp, 1, "保留第一个");
  // 空表退回内置，否则游戏里没有随从可招
  assert.equal(normalizeMercs([]).length, MERCENARIES.length);
  assert.equal(normalizeMercs(null).length, MERCENARIES.length);
}

export function byIdReturnsNullForUnknown() {
  const list = normalizeMercs(null);
  assert.equal(mercById(list, "swordsman").id, "swordsman");
  assert.equal(mercById(list, "不存在"), null, "未知 id 返回 null，不能瞎给一个");
}

export function feesAccumulateByPeriod() {
  const m = { fee: 25 };
  assert.equal(feesDue(m, 0), 0);
  assert.equal(feesDue(m, FEE_PERIOD - 1), 0, "不到一个周期不扣");
  assert.equal(feesDue(m, FEE_PERIOD), 25);
  assert.equal(feesDue(m, FEE_PERIOD * 2.5), 50, "只算整数周期");
  // 免费随从不扣钱
  assert.equal(feesDue({ fee: 0 }, FEE_PERIOD * 10), 0);
}

export function nextFeeCountsDown() {
  assert.equal(nextFeeIn(0), FEE_PERIOD);
  assert.equal(nextFeeIn(FEE_PERIOD), FEE_PERIOD, "刚好一个周期后回到满");
  const n = nextFeeIn(10);
  assert.ok(n > 0 && n <= FEE_PERIOD);
}

export function reviveNeedsWaiting() {
  assert.equal(reviveState({ dead: false }), "alive");
  assert.equal(reviveState({ dead: true, deadT: 0 }), "waiting");
  assert.equal(reviveState({ dead: true, deadT: REVIVE_DELAY - 1 }), "waiting");
  assert.equal(reviveState({ dead: true, deadT: REVIVE_DELAY }), "ready");
  assert.equal(reviveState(null), "alive");
}

export function reviveCostIsFractionOfPrice() {
  assert.equal(reviveCost({ price: 200 }), 60);
  assert.ok(reviveCost({ price: 0 }) >= 1, "再便宜也至少 1：免费复活没有代价");
}

export function followOnlyWhenFar() {
  const owner = { x: 0, y: 0 };
  // 近处不动
  const near = followStep({ x: 10, y: 0 }, owner);
  assert.equal(near.move, false, "在允许半径内不该动（否则会一直抖）");
  // 远处要追
  const far = followStep({ x: 1000, y: 0 }, owner);
  assert.equal(far.move, true);
  assert.ok(far.x < 1000 && far.x > 0, "朝主人方向靠近");
  // 从不重叠：目标点与主人保持 stop 距离
  const at = followStep({ x: 1000, y: 0 }, owner);
  const d = Math.hypot(at.x - owner.x, at.y - owner.y);
  assert.ok(Math.abs(d - FOLLOW_STOP) < 1, "停在 stop 距离上，不叠在主人身上");
}

export function followHysteresisBand() {
  // lead 与 stop 之间是滞回区间：刚越过 lead 才动，追到 stop 才停。
  assert.ok(FOLLOW_STOP < FOLLOW_LEAD, "stop 必须小于 lead，否则会在边界反复启停");
  const owner = { x: 0, y: 0 };
  const mid = (FOLLOW_LEAD + FOLLOW_STOP) / 2;
  assert.equal(followStep({ x: mid, y: 0 }, owner).move, false, "滞回区间内不动");
}

export function hireGates() {
  const list = normalizeMercs(null);
  const m = list[0];
  const current = null;
  // 没钱
  assert.equal(canHire(m, m.price - 1, current).ok, false);
  assert.equal(canHire(m, m.price - 1, current).reason, "银两不足");
  // 钱够
  const ok = canHire(m, m.price, current);
  assert.equal(ok.ok, true);
  assert.equal(ok.cost, m.price);
  // 已有随从
  assert.equal(canHire(m, 1e9, { id: "x" }).ok, false);
  assert.equal(canHire(null, 1e9, null).ok, false);
}
