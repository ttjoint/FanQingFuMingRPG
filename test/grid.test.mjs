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

// ---- 非方形网格（rows ≠ cols）----
// 引擎的 astar / nearestWalkableIn 原先只收一个 width 并把行数也当成 width，
// 于是「宽 > 高」的网格会扫描/索引到不存在的行（越界或漏格）。
// 下面把它钉成回归条件：传入 (rows, cols) 时行与列必须各按各的维度处理。

function rectGrid(rows, cols, blocked) {
  const b = new Set(blocked);
  return (r, c) => r >= 0 && c >= 0 && r < rows && c < cols && !b.has(r + "," + c);
}

export function astarRectWide() {
  // 3 行 8 列：从最左到最右必须能走通（旧实现只认 8×8，行 0..2 虽在范围内但列索引会错）
  const R = 3, C = 8, isWalk = rectGrid(R, C, []);
  const p = astar(R, C, isWalk, 1, 0, 1, 7);
  assert(p, "宽网格应能走通");
  assertEq(p[p.length - 1], { row: 1, col: 7 });
  for (const pt of p) assert(pt.row >= 0 && pt.row < R && pt.col >= 0 && pt.col < C, "路径点在网格内");
}

export function astarRectTall() {
  // 8 行 3 列：上下走通
  const R = 8, C = 3, isWalk = rectGrid(R, C, []);
  const p = astar(R, C, isWalk, 0, 1, 7, 1);
  assert(p, "高网格应能走通");
  assertEq(p[p.length - 1], { row: 7, col: 1 });
  for (const pt of p) assert(pt.row >= 0 && pt.row < R && pt.col >= 0 && pt.col < C, "路径点在网格内");
}

export function astarRectNoWrap() {
  // 3 行 4 列，右下角封死整列 -> 不可达。若索引用了错误的步长（按 4 行展开），
  // 路径会从行尾「绕回」下一行行首，产生不可能的通路。
  const R = 3, C = 4;
  const wall = [];
  for (let r = 0; r < R; r++) wall.push(r + ",2");
  const isWalk = rectGrid(R, C, wall);
  assertEq(astar(R, C, isWalk, 0, 0, 0, 3), null, "整列封死时不可达（不能借错行索引绕过去）");
}

export function nearestWalkableRect() {
  const R = 2, C = 6;
  // 只有最后一行最后一列可走
  const isWalk = (r, c) => r === 1 && c === 5;
  assertEq(nearestWalkableIn(R, C, isWalk, 0, 0), { row: 1, col: 5 }, "必须能扫到列 5（旧实现只扫到 col<R=2）");
}

// 旧单参签名必须保持原行为（按正方形处理），否则既有调用点会静默变形
export function legacySingleWidthStillSquare() {
  const W = 6, isWalk = grid(W, []);
  const p = astar(W, isWalk, 0, 0, 5, 5);
  assert(p, "旧签名仍可用");
  assertEq(p[p.length - 1], { row: 5, col: 5 });
  const n = nearestWalkableIn(W, (r, c) => r === 4 && c === 5, 0, 0);
  assertEq(n, { row: 4, col: 5 }, "旧签名按正方形扫描");
}
