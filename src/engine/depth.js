// 等距深度排序（纵向条带模型）。
//
// 把对象看成“一系列纵向小切片 / 与玩家等高的圆柱”：按宽度切成竖条，每条：
//   · 蓝线（头顶最高线 = 黄线 − 玩家身高）以上 → 覆盖条带（单深度 frontBase，永远遮挡玩家）；
//   · 蓝线以下（含黄线与地基）→ 基座条带，**深度 = 该列黄线（地基线）的 y**。
// 玩家按脚底 y 与各条带比较：在黄线之前 → 玩家画出；在黄线之后 → 条带遮住。
// 因为每条带只占自己的屏幕列、相邻列互不重叠，所以不需要方格切块也能与角色正确交错。
//
// opts: { single?, base?: Int16Array(逐列黄线，源本地 y), playerH?, stripW?, roofY? }
// 覆盖条带（蓝线以上）的排序键：**高于所有角色**，实现“只要屏幕重叠就遮挡玩家”。
// 站在对象可走地基格（门廊）上的角色会被渲染层提升到 ROOF_TOP 之上，仍可见。
export const ROOF_TOP = 1e9;

// 纯函数，不依赖 DOM / 全局状态，可在 Node 中测试。
export function buildObjectDrawables(sprite, tiles, layer, tileW, tileH, opts) {
  opts = opts || {};
  const lay = (layer || 0) * 100000;
  const list = tiles || [];
  const [sx0, sy0, sw, sh, dxa, dya] = sprite;
  if (!list.length) return [{ sprite, sortY: dya + sh - tileH / 2 + lay, layer: layer || 0 }];
  const cells = list.map(t => ({ dy: t[3], cx: t[2] + tileW / 2 }));
  let maxB = -Infinity;
  for (const c of cells) { const b = c.dy + tileH; if (b > maxB) maxB = b; }
  const frontBase = maxB - tileH / 2 + lay;   // 最前（最深）地基格的格心 y

  // 模式 1：整体单一深度
  if (opts.single) return [{ sprite: sprite.slice(), sortY: frontBase, layer: layer || 0, single: true }];

  const pH = opts.playerH || 0;
  // 作者水平分界（roofY）兼容：等价于一条平直黄线 = 分界 + 玩家身高
  let baseArr = opts.base || null;
  if (!baseArr && typeof opts.roofY === "number" && opts.roofY > sy0 && opts.roofY < sy0 + sh) {
    baseArr = new Int16Array(sw).fill(Math.round(opts.roofY - sy0 + pH));
  }
  const bxOf = xL => (baseArr ? Math.min(baseArr.length - 1, Math.max(0, xL)) : -1);

  // 覆盖层：蓝线（黄线 − 玩家身高）**以上**的多边形（沿斜线精确裁剪，永远遮挡玩家）
  // 基座：蓝线以下的多边形，整块一个深度（避免竖条边界把角色“切半边”）
  const blue = new Int16Array(sw + 1);
  for (let x = 0; x < sw; x++) {
    const bx = bxOf(x);
    const b = (baseArr && bx >= 0 && baseArr[bx] >= 0) ? baseArr[bx] : -1;
    blue[x] = b >= 0 ? Math.max(0, Math.min(sh, b - pH)) : 0;   // 无地基线→无覆盖层
  }
  blue[sw] = blue[sw - 1];

  const out = [];
  // 覆盖多边形：上边 + 沿蓝线（右→左）
  let anyOverlay = false; for (let x = 0; x < sw; x++) if (blue[x] > 0) { anyOverlay = true; break; }
  if (anyOverlay) {
    const poly = [[dxa, dya], [dxa + sw, dya], [dxa + sw, dya + blue[sw - 1]]];
    for (let x = sw - 1; x >= 0; x--) poly.push([dxa + x, dya + blue[x]]);
    out.push({ sprite: [sx0, sy0, sw, sh, dxa, dya], polygon: poly, sortY: ROOF_TOP + lay, layer: layer || 0, roof: true, frontBase });
  }
  // 基座多边形：沿蓝线（左→右）+ 底边
  {
    const poly = [];
    for (let x = 0; x < sw; x++) poly.push([dxa + x, dya + blue[x]]);
    poly.push([dxa + sw, dya + blue[sw - 1]], [dxa + sw, dya + sh], [dxa, dya + sh]);
    // 基座深度取黄线的**最高点**（最小 y）：玩家只要在其前方就完整露出，沿黄色区走动不会时遮时不遮。
    let minB = Infinity;
    if (baseArr) for (let x = 0; x < sw; x++) { const bx = bxOf(x); const v = baseArr[bx]; if (v >= 0 && v < minB) minB = v; }
    const baseSortY = minB === Infinity ? frontBase : (dya + minB - tileH / 2 + lay);
    out.push({ sprite: [sx0, sy0, sw, sh, dxa, dya], polygon: poly, sortY: baseSortY, layer: layer || 0 });
  }
  return out;
}

// ---- 地基线（自动拟合 / 手画）----

// 下凸包（单调链）：输入按 x 递增的点 [[x,y],...]，返回下方边界顶点。
export function lowerHull(pts) {
  const h = [];
  for (const p of pts) {
    while (h.length >= 2) {
      const a = h[h.length - 2], b = h[h.length - 1];
      const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      if (cross > 0) h.pop(); else break;   // y 向下：丢掉在上方的点
    }
    h.push(p);
  }
  return h;
}

// 在凸包上取 x 处的 y（两端按端点外推）。
export function hullYAt(h, x) {
  if (!h.length) return -Infinity;
  if (x <= h[0][0]) return h[0][1];
  for (let i = 1; i < h.length; i++) {
    if (x <= h[i][0]) {
      const a = h[i - 1], b = h[i];
      const t = (x - a[0]) / ((b[0] - a[0]) || 1);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return h[h.length - 1][1];
}

// 舍去凸包两端的“陡峭”段：边缘上常见“地基→飞檐顶”的近竖直连线，它不是地基，
// 会把地基线带歪。超过 maxSlope 的端点直接舍去，向两侧水平延伸（hullYAt 端点外推）。
export function trimSteepEnds(hull, maxSlope) {
  const ms = maxSlope == null ? 1.8 : maxSlope;   // ≈60°
  const h = hull.slice();
  const steep = (a, b) => Math.abs(b[1] - a[1]) > ms * Math.abs(b[0] - a[0]) + 1e-6;
  while (h.length >= 2 && steep(h[0], h[1])) h.shift();
  while (h.length >= 2 && steep(h[h.length - 2], h[h.length - 1])) h.pop();
  return h;
}

// 由逐列 alpha 底边 bottom[]（源本地 y，-1=无像素）拟合“地基线”：只用 [tx0,tx1) 内的点（忽略房檐），
// 下凸包跨过城门洞等凹陷，并舍去两端陡峭段。返回**连续**的逐列 y 数组（整幅宽度都填）。
// （若只在“有像素”的列填值，屋顶切片等中间有透明列时会断开，导致手画时拉出一堆节点。）
export function baseLineFromBottom(bottom, tx0, tx1) {
  const w = bottom.length;
  const a = Math.max(0, Math.floor(tx0)), b = Math.min(w, Math.ceil(tx1));
  const pts = [];
  for (let x = a; x < b; x++) if (bottom[x] >= 0) pts.push([x, bottom[x]]);
  if (pts.length < 2) return null;
  const hull = trimSteepEnds(lowerHull(pts));
  if (hull.length < 2) return null;
  const line = new Int16Array(w).fill(-1);
  for (let x = 0; x < w; x++) line[x] = Math.round(hullYAt(hull, x));   // 连续：所有列都算
  return line;
}

// 从折线（源本地坐标）生成逐列地基线 y。
export function lineToArray(line, w) {
  if (!line || line.length === 0) return null;
  const pts = line.map(p => [p[0], p[1]]).sort((a, b) => a[0] - b[0]);
  const out = new Int16Array(w).fill(-1);
  for (let x = 0; x < w; x++) out[x] = Math.round(hullYAt_(pts, x));   // 两端外推，覆盖整幅宽度
  return out;
}
// 折线（非凸）取 y：分段线性，两端外推
function hullYAt_(pts, x) {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const a = pts[i - 1], b = pts[i];
      const t = (x - a[0]) / ((b[0] - a[0]) || 1);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return pts[pts.length - 1][1];
}

// 地基线 → 头顶最高线（覆盖层分界）：ceiling[x] = base[x] − playerH。
export function ceilingFromBase(base, playerH, sh) {
  if (!base) return null;
  const ceil = new Int16Array(base.length).fill(-1);
  let any = false;
  for (let x = 0; x < base.length; x++) {
    if (base[x] < 0) continue;
    const v = base[x] - playerH;
    if (v >= 4) { ceil[x] = Math.min(sh, v); any = true; }
  }
  return any ? ceil : null;
}

export function ceilingFromBottom(bottom, tx0, tx1, playerH, sh) {
  return ceilingFromBase(baseLineFromBottom(bottom, tx0, tx1), playerH, sh);
}

// 屋顶“自动分界”建议值（水平，历史保留）。
export function suggestRoofY(sprite, tiles) {
  if (!sprite || !tiles || !tiles.length) return null;
  let top = Infinity;
  for (const t of tiles) if (t[1] < top) top = t[1];
  return top === Infinity ? null : top;
}
