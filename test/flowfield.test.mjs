import { buildFlowField, flowDir, flowCost } from "../src/engine/flowfield.js";
import { assert, assertEq } from "./helpers.mjs";

function grid(W, blocked) { const b = new Set(blocked); return (r, c) => r >= 0 && c >= 0 && r < W && c < W && !b.has(r + "," + c); }
const near = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

export function distanceField() {
  const W = 5, g = grid(W, []);
  const f = buildFlowField(W, g, [{ row: 0, col: 0 }]);
  assertEq(flowCost(f, 0, 0), 0);
  assertEq(flowCost(f, 0, 3), 3);
  assert(near(flowCost(f, 2, 2), Math.hypot(2, 2)), "对角代价为 √2 累加");
}

export function directionPointsToGoal() {
  const W = 5, g = grid(W, []);
  const f = buildFlowField(W, g, [{ row: 0, col: 0 }]);
  assertEq(flowDir(f, 3, 3), [-1, -1]);
  assertEq(flowDir(f, 0, 3), [0, -1]);
  assertEq(flowDir(f, 0, 0), null);          // 已在目标
}

export function wallBlocks() {
  const W = 5, g = grid(W, ["0,4", "1,4", "2,4", "3,4", "4,4"]);   // 整列墙，右侧不可达
  const f = buildFlowField(W, g, [{ row: 0, col: 0 }]);
  assert(!isFinite(flowCost(f, 0, 4)), "被墙隔开的格代价为 ∞");
  assertEq(flowDir(f, 0, 4), null);
}
