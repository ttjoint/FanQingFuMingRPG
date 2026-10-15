// 引擎核心：A* 寻路（纯函数，不依赖 DOM / 全局状态）。
// 通过注入 `isWalkable(row,col)` 谓词适配任意网格（运行时用 G.map，编辑器可用 MapDoc）。
// world/pathfinding.js 只是它的薄封装。

const NEIGHBORS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414],
];

// 从 (row,col) 由近及远找最近的可走格。
export function nearestWalkableIn(width, isWalkable, row, col) {
  for (let r = 0; r < width; r++)
    for (let dr = -r; dr <= r; dr++)
      for (let dc = -r; dc <= r; dc++) {
        const rr = row + dr, cc = col + dc;
        if (isWalkable(rr, cc)) return { row: rr, col: cc };
      }
  return null;
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
