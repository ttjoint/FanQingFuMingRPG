import { worldToCell, cellCenter, isoGeometry } from "./iso.js";
// 引擎核心：A* 寻路（纯函数，不依赖 DOM / 全局状态）。
// 通过注入 `isWalkable(row,col)` 谓词适配任意网格（运行时用 G.map，编辑器可用 MapDoc）。
// world/pathfinding.js 只是它的薄封装。

const NEIGHBORS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

// 从 (row,col) 由近及远找最近的可走格。
export function nearestWalkableIn(width, isWalkable, row, col) {
  if (isWalkable(row, col)) return { row, col };
  // 确定性“欧氏最近”：扫描所有可走格取距离最小者（原按切比雪夫环+固定顺序会偏向另一侧）。
  let best = null, bd = Infinity;
  for (let r = 0; r < width; r++) for (let c = 0; c < width; c++) {
    if (!isWalkable(r, c)) continue;
    const d = (r - row) * (r - row) + (c - col) * (c - col);
    if (d < bd) { bd = d; best = { row: r, col: c }; }
  }
  return best;
}

// A*：返回 [{row,col}...]（不含起点，含终点）；不可达返回 null。
export function astar(width, isWalkable, sr, sc, tr, tc) {
  if (!isWalkable(tr, tc)) {
    const n = nearestWalkableIn(width, isWalkable, tr, tc);
    if (!n) return null;
    tr = n.row; tc = n.col;
  }
  const N = width * width, start = sr * width + sc, goal = tr * width + tc;
  if (!isWalkable(sr, sc) || start === goal) return [{ row: tr, col: tc }];
  const open = [start], g = new Float32Array(N).fill(-1), came = new Int32Array(N).fill(-1);
  g[start] = 0;
  const closed = new Uint8Array(N);
  const h = i => { const r = (i / width) | 0, c = i % width; return Math.max(Math.abs(r - tr), Math.abs(c - tc)); };
  const f = new Float32Array(N); f[start] = h(start);
  let guard = 0;
  while (open.length && guard++ < 20000) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur === goal) break;
    closed[cur] = 1;
    const cr = (cur / width) | 0, cc = cur % width;
    for (const [dr, dc, cost] of NEIGHBORS) {
      const nr = cr + dr, nc = cc + dc, ni = nr * width + nc;
      if (!isWalkable(nr, nc) || closed[ni]) continue;
      if (dr && dc && (!isWalkable(cr + dr, cc) || !isWalkable(cr, cc + dc))) continue;   // 不穿角
      const ng = g[cur] + cost;
      if (g[ni] < 0 || ng < g[ni]) { g[ni] = ng; came[ni] = cur; f[ni] = ng + h(ni); if (open.indexOf(ni) < 0) open.push(ni); }
    }
  }
  if (came[goal] < 0 && goal !== start) return null;
  const path = []; let cur = goal;
  while (cur !== -1 && cur !== start) { path.push({ row: (cur / width) | 0, col: cur % width }); cur = came[cur]; }
  return path.reverse();
}

// 网格直线可见（supercover 采样，且不允许穿角）：从 (r0,c0) 到 (r1,c1) 沿途都不被阻挡。
export function lineOfSight(width, isWalkable, r0, c0, r1, c1) {
  if (!isWalkable(r0, c0) || !isWalkable(r1, c1)) return false;
  const steps = Math.max(Math.abs(r1 - r0), Math.abs(c1 - c0)) * 2;
  if (steps === 0) return true;
  let pr = r0, pc = c0;
  for (let i = 1; i <= steps; i++) {
    const r = Math.round(r0 + (r1 - r0) * i / steps);
    const c = Math.round(c0 + (c1 - c0) * i / steps);
    if (r === pr && c === pc) continue;
    if (Math.abs(r - pr) >= 1 && Math.abs(c - pc) >= 1) {          // 对角步：两侧不能都是墙
      if (!isWalkable(pr, c) || !isWalkable(r, pc)) return false;
    }
    if (!isWalkable(r, c)) return false;
    pr = r; pc = c;
  }
  return true;
}

// 路径平滑（string pulling）：在可见的前提下尽量跳过中间路点，消除网格“阶梯/折线”。
// path 为 astar 的输出（不含起点，含终点）。
export function smoothPath(width, isWalkable, path) {
  if (!path || path.length <= 2) return path;
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    for (; j > i + 1; j--)
      if (lineOfSight(width, isWalkable, path[i].row, path[i].col, path[j].row, path[j].col)) break;
    out.push(path[j]);
    i = j;
  }
  return out;
}

// A* + 平滑（常用入口）。
export function astarSmooth(width, isWalkable, sr, sc, tr, tc) {
  const p = astar(width, isWalkable, sr, sc, tr, tc);
  return p ? smoothPath(width, isWalkable, p) : null;
}

// ---- 像素级连续路径（纯函数；isW(x,y) 判定世界坐标处是否可走）----
// 菱形半宽/半高来自等距几何（可由配置注入），不再写死。
// 线段按 ~4px 采样，每点都必须可走。
export function walkableSegment(isW, a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / 4));
  for (let k = 0; k <= n; k++) if (!isW(a.x + (b.x - a.x) * k / n, a.y + (b.y - a.y) * k / n)) return false;
  return true;
}
export function tautPath(isW, pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(q.x - p.x, q.y - p.y) > 1) out.push(p); }
  if (out.length <= 2) return out;
  const res = [out[0]]; let i = 0;
  while (i < out.length - 1) { let j = out.length - 1; for (; j > i + 1; j--) if (walkableSegment(isW, out[i], out[j])) break; res.push(out[j]); i = j; }
  return res;
}
function cellVerts(c) { const { halfW: RX, halfH: RY } = isoGeometry(); return [{ x: c.x, y: c.y - RY }, { x: c.x + RX, y: c.y }, { x: c.x, y: c.y + RY }, { x: c.x - RX, y: c.y }]; }
// 角点路径：候选点 = 路径各格菱形的四个角点；贪心跳到“沿路最远且可见”的角点（拐弯落在几何角点）。
export function cornerPath(isW, nodes, start, end) {
  const cands = [];
  // 角点向所属格心内缩 15%：避免路点正好落在与阻挡格共用的顶点上（worldToCell 会判成阻挡格）
  for (let i = 0; i < nodes.length; i++) { const c = cellCenter(nodes[i].row, nodes[i].col); for (const v of cellVerts(c)) cands.push({ p: { x: v.x + (c.x - v.x) * 0.15, y: v.y + (c.y - v.y) * 0.15 }, i }); }
  cands.push({ p: { x: end.x, y: end.y }, i: nodes.length });
  const out = [start]; let cur = start, idx = 0, guard = 0;
  while (guard++ < 500) {
    let bestP = null, bestI = idx;
    for (const cd of cands) { if (cd.i <= bestI) continue; if (walkableSegment(isW, cur, cd.p)) { bestP = cd.p; bestI = cd.i; } }
    if (!bestP) break;
    out.push(bestP); cur = bestP; idx = bestI;
  }
  const dedup = []; for (const p of out) { const q = dedup[dedup.length - 1]; if (!q || Math.hypot(q.x - p.x, q.y - p.y) > 1) dedup.push(p); }
  return dedup;
}
