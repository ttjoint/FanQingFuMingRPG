import { lineOfSight, smoothPath, astar } from "../src/engine/grid.js";
import { assert, assertEq } from "./helpers.mjs";

function grid(W, blocked) { const b = new Set(blocked); return (r, c) => r >= 0 && c >= 0 && r < W && c < W && !b.has(r + "," + c); }

export function losOpen() {
  const W = 6, g = grid(W, []);
  assert(lineOfSight(W, g, 0, 0, 5, 5));
  assert(lineOfSight(W, g, 0, 0, 0, 5));
}

export function losBlocked() {
  const W = 6, g = grid(W, ["0,3", "1,3", "2,3", "3,3", "4,3", "5,3"]);
  assert(!lineOfSight(W, g, 0, 0, 0, 5));
  assert(!lineOfSight(W, g, 3, 0, 3, 5));
  assert(lineOfSight(W, g, 0, 0, 0, 2));
}

export function losNoCornerCut() {
  const W = 4, g = grid(W, ["0,1", "1,0"]);
  assert(!lineOfSight(W, g, 0, 0, 1, 1));   // 对角两侧都是墙，不允许穿角
}

export function smoothingCollapses() {
  const W = 8, g = grid(W, []);
  const p = astar(W, g, 0, 0, 7, 7);
  assert(p.length > 3, "原始网格路径节点较多");
  const s = smoothPath(W, g, p);
  assert(s.length <= 2, "无阻挡应平滑到极少数路点");
  assertEq(s[s.length - 1], { row: 7, col: 7 });
}

export function smoothingAroundWall() {
  const W = 8, g = grid(W, ["0,4", "1,4", "2,4", "3,4", "4,4", "5,4", "6,4"]);   // 竖墙，仅 7,4 可通过
  const p = astar(W, g, 0, 0, 7, 7);
  const s = smoothPath(W, g, p);
  assert(s.length < p.length, "平滑后路点应减少");
  assertEq(s[s.length - 1], { row: 7, col: 7 });
  for (const pt of s) assert(g(pt.row, pt.col), "路点均在可走格");
}
