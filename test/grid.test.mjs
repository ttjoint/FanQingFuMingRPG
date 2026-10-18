import { astar, nearestWalkableIn, cornerPath, walkableSegment } from "../src/engine/grid.js";
import { worldToCell, cellCenter } from "../src/engine/iso.js";
import { assert, assertEq } from "./helpers.mjs";

function grid(W, blocked) {
  const b = new Set(blocked);
  return (r, c) => r >= 0 && c >= 0 && r < W && c < W && !b.has(r + "," + c);
}

export function straightPath() {
  const W = 6, isWalk = grid(W, []);
  const p = astar(W, isWalk, 0, 0, 5, 0);
  assert(p, "应有路径");
  assertEq(p[p.length - 1], { row: 5, col: 0 });
  assert(p.every(pt => isWalk(pt.row, pt.col)), "路径都在可走格");
  assert(!(p[0].row === 0 && p[0].col === 0), "不含起点");
}

export function detour() {
  const W = 5, isWalk = grid(W, ["2,1", "2,2", "2,3"]);   // 第 2 行中段封堵，留 2,0 与 2,4
  const p = astar(W, isWalk, 0, 0, 4, 0);
  assert(p, "应绕行");
  assertEq(p[p.length - 1], { row: 4, col: 0 });
  assert(p.every(pt => isWalk(pt.row, pt.col)));
}

export function unreachable() {
  const W = 5, isWalk = grid(W, ["2,0", "2,1", "2,2", "2,3", "2,4"]);   // 整行封死
  assertEq(astar(W, isWalk, 0, 0, 4, 0), null);
}

export function targetBlockedSnapsNear() {
  const W = 5, isWalk = grid(W, ["1,1"]);
  const p = astar(W, isWalk, 0, 0, 1, 1);
  assert(p, "目标被占时应到最近可走格");
  const end = p[p.length - 1];
  assert(isWalk(end.row, end.col), "终点可走");
  assert(Math.abs(end.row - 1) <= 1 && Math.abs(end.col - 1) <= 1, "终点在目标附近");
}

export function startEqualsGoal() {
  const W = 4, isWalk = grid(W, []);
  assertEq(astar(W, isWalk, 2, 2, 2, 2), [{ row: 2, col: 2 }]);
}

export function nearest() {
  const W = 4, isWalk = grid(W, ["0,0", "0,1", "1,0"]);
  assertEq(nearestWalkableIn(W, isWalk, 0, 0), { row: 1, col: 1 });
  const none = () => false;
  assertEq(nearestWalkableIn(4, none, 0, 0), null);
}

// 最近可走格必须是确定性“欧氏最近”（避免点不可走点时随机跑到附近别的点）
export function nearestWalkableDeterministic() {
  const W = 8, arr = new Uint8Array(W * W);
  arr[3 * W + 3] = 1; arr[1 * W + 3] = 1; arr[3 * W + 1] = 1;
  const isWalk = (r, c) => r >= 0 && c >= 0 && r < W && c < W && arr[r * W + c] === 1;
  assertEq(nearestWalkableIn(W, isWalk, 0, 0), nearestWalkableIn(W, isWalk, 0, 0), "确定性");
  const n = nearestWalkableIn(W, isWalk, 2, 2);
  assertEq([n.row, n.col], [1, 3], "取欧氏最近（同距离时行优先稳定）");
}

// 角点路径（纯引擎）：用真实 A* 路径，折点贴角点、每段可走、能到终点
export function cornerPathBendsAtCorner() {
  const W = 8, flags = new Uint8Array(W * W).fill(1);
  for (let c = 2; c <= 4; c++) flags[4 * W + c] = 0;   // 第 4 行 col2..4 阻挡
  const isW = (x, y) => { const c = worldToCell(x, y); return c.row >= 0 && c.col >= 0 && c.row < W && c.col < W && flags[c.row * W + c.col] === 1; };
  const cells = astar(W, (r, c) => c >= 0 && c < W && r >= 0 && r < W && flags[r * W + c] === 1, 2, 3, 6, 3);
  const nodes = [{ row: 2, col: 3 }, ...cells];
  const start = cellCenter(2, 3), end = cellCenter(6, 3);
  const pts = cornerPath(isW, nodes, start, end);
  assert(pts.length >= 2, "至少两点");
  for (let i = 1; i < pts.length; i++) assert(walkableSegment(isW, pts[i - 1], pts[i]), "每段可走");
  const last = pts[pts.length - 1];
  assert(Math.hypot(last.x - end.x, last.y - end.y) < 2, "到达终点");
  // 有折点应落在几何角点（非格心）
  let corner = false;
  for (const p of pts.slice(1, -1)) { const c = worldToCell(p.x, p.y); const cen = cellCenter(c.row, c.col); if (Math.hypot(p.x - cen.x, p.y - cen.y) > 2) corner = true; }
  assert(corner, "折点是角点而非格心");
}
