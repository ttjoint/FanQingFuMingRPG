// 引擎核心：等距坐标换算与方向（纯函数，不依赖 DOM / 全局状态，可在 Node 中测试）。
// 运行时通过 core/utils.js 再导出，保持既有 import 不变（过渡层）。
//
// 几何参数（世界原点 / 菱形半宽半高）**可由游戏配置注入**：
//   configureIso({ originX, halfW, halfH })
// 缺省时使用引擎内置默认（与原版一致），因此引擎本身保持通用，
// 其余项目只需在装配层调用一次 configureIso 即可适配不同的地图尺寸。

const GEO = { originX: 1568, halfW: 32, halfH: 16 };

export function configureIso(g) {
  if (!g) return;
  if (typeof g.originX === "number") GEO.originX = g.originX;
  if (typeof g.halfW === "number") GEO.halfW = g.halfW;
  if (typeof g.halfH === "number") GEO.halfH = g.halfH;
}
export function isoGeometry() { return { ...GEO }; }

export function cellCenter(row, col) {
  return { x: GEO.originX + GEO.halfW * (row - col), y: GEO.halfH * (row + col) + GEO.halfH };
}

export function worldToCell(x, y) {
  const sum = (y - GEO.halfH) / GEO.halfH, diff = (x - GEO.originX) / GEO.halfW;
  return { row: Math.round((sum + diff) / 2), col: Math.round((sum - diff) / 2) };
}

// 在一个格子的菱形范围内取一个随机点（用于 NPC 走到格内任意位置）。
// 内缩 2px 避免贴边；外接菱形筛选用半宽/半高。
export function randomPointInCell(row, col, rnd = Math.random) {
  const c = cellCenter(row, col);
  const rx = GEO.halfW - 2, ry = GEO.halfH - 2;
  let dx, dy;
  do { dx = (rnd() * 2 - 1) * rx; dy = (rnd() * 2 - 1) * ry; }
  while (Math.abs(dx) / GEO.halfW + Math.abs(dy) / GEO.halfH > 0.85);   // 限制在菱形内部，避免贴边
  return { x: c.x + dx, y: c.y + dy };
}

// 方向：引擎方向 0=南(面向镜头)，顺时针到 7；pmg 的帧块从“背向”开始，所以要 +4。
export function dirFromVec(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  let a = Math.atan2(dx, dy);              // 0=下(南)，顺时针
  let d = Math.round(a / (Math.PI / 4));
  d = ((d % 8) + 8) % 8;                   // 0=南,2=东,4=北,6=西
  return ((4 - d) % 8 + 8) % 8;            // 帧块下标：0=北,2=东,4=南,6=西
}

// ---- 网格尺寸与边界判定（纯函数）----
//
// 地图是 row × col 的矩形网格，行数（rows/height）与列数（cols/width）是**两个独立维度**。
// 历史上这里习惯把 width 当边长用（`row < width && col < width`、`new Uint8Array(w*w)`），
// 因为原版地图恰好都是正方形，所以从未暴露；但那是隐式不变量，会让非方形地图
// 静默错乱（行数偏多时下半张图走不进去，列数偏多时越界读到「可走」）。
//
// mapSize() 把「缺 height 时按方形补齐」这条兼容规则收在一个地方，
// 上层（core/utils、world/pathfinding、world/map、engine/grid）统一走它，
// 避免每个调用点各自 `m.height == null ? m.width : m.height` 手抄一遍。
export function mapSize(m) {
  if (!m) return { rows: 0, cols: 0 };
  const cols = m.width | 0;
  const rows = (m.height == null ? cols : m.height | 0);
  return { rows, cols };
}

// (row,col) 是否落在地图范围内。
export function inBounds(m, row, col) {
  const { rows, cols } = mapSize(m);
  return row >= 0 && col >= 0 && row < rows && col < cols;
}
