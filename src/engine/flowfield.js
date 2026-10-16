// 多单位共享“流场”（flow field）：从目标格集做 Dijkstra 得到代价场，单位只需朝代价更低的邻格前进。
// 适合 RTS 式「数百单位涌向同一目标/多目标」——每个目标只算一次，之后每次查询 O(1)。
// 纯函数，可单测。
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, 1.41421356], [1, -1, 1.41421356], [-1, 1, 1.41421356], [-1, -1, 1.41421356],
];

export function buildFlowField(width, isWalkable, goals) {
  const N = width * width;
  const cost = new Float32Array(N).fill(Infinity);
  const heap = [];
  const push = (i, d) => {
    heap.push([i, d]); let k = heap.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (heap[p][1] <= heap[k][1]) break; const t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last; let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1; let s = k;
        if (l < heap.length && heap[l][1] < heap[s][1]) s = l;
        if (r < heap.length && heap[r][1] < heap[s][1]) s = r;
        if (s === k) break; const t = heap[s]; heap[s] = heap[k]; heap[k] = t; k = s;
      }
    }
    return top;
  };
  for (const g of goals || []) {
    const r = g.row != null ? g.row : g[0], c = g.col != null ? g.col : g[1];
    if (!isWalkable(r, c)) continue;
    const i = r * width + c;
    if (cost[i] !== 0) { cost[i] = 0; push(i, 0); }
  }
  while (heap.length) {
    const [i, d] = pop();
    if (d > cost[i]) continue;
    const r = (i / width) | 0, c = i % width;
    for (const [dr, dc, w] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (!isWalkable(nr, nc)) continue;
      if (dr && dc && (!isWalkable(r + dr, c) || !isWalkable(r, c + dc))) continue;   // 不穿角
      const ni = nr * width + nc, nd = Math.fround(d + w);   // 与 Float32Array 统一精度，避免浮点误差导致节点被误跳过
      if (nd < cost[ni]) { cost[ni] = nd; push(ni, nd); }
    }
  }
  return { width, cost };
}

// 从 (r,c) 朝代价更低（更接近目标）的邻格方向；不可达返回 null。
export function flowDir(field, r, c) {
  const { width, cost } = field;
  const i = r * width + c;
  if (!isFinite(cost[i])) return null;
  let best = null, bd = cost[i];
  for (const [dr, dc] of DIRS) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nc < 0 || nr >= width || nc >= width) continue;
    const nd = cost[nr * width + nc];
    if (nd < bd) { bd = nd; best = [dr, dc]; }
  }
  return best;
}

export function flowCost(field, r, c) { return field.cost[r * field.width + c]; }
