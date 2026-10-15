// A* 寻路与格子定位辅助（薄封装：把运行时地图适配成引擎的纯 A*）。ctx 由调用方注入。
import { cellCenter } from "../core/utils.js";
import { astar, nearestWalkableIn } from "../engine/grid.js";

function walkableOf(state) {
  const m = state.map;
  return (r, c) => !!m && r >= 0 && c >= 0 && r < m.width && c < m.width && m.flags[r * m.width + c] === 1;
}

export function findPath(ctx, sr, sc, tr, tc) {
  const m = ctx.state.map; if (!m) return null;
  return astar(m.width, walkableOf(ctx.state), sr, sc, tr, tc);
}

export function nearestWalkable(ctx, row, col) {
  const m = ctx.state.map; if (!m) return null;
  return nearestWalkableIn(m.width, walkableOf(ctx.state), row, col);
}

// 把格子路径转成世界坐标序列。
// exact 不为空时，用精确的世界坐标替换最后一个路点（高精度移动：停在鼠标点击的那个像素，
// 而不是最接近的格子中心）。仅当目标格可走时才应传入 exact。
export function pathToWorld(path, exact) {
  const pts = path.map(p => cellCenter(p.row, p.col));
  if (exact && pts.length) pts[pts.length - 1] = { x: exact.x, y: exact.y };
  return pts;
}
