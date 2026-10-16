// A* 寻路与格子定位辅助（薄封装：把运行时地图适配成引擎的纯 A*）。ctx 由调用方注入。
import { cellCenter, worldToCell, UNIT_RX } from "../core/utils.js";
import { astar, nearestWalkableIn, smoothPath, walkableSegment as wsPure, tautPath as tpPure, cornerPath as cpPure } from "../engine/grid.js";

function walkableOf(state) {
  const m = state.map;
  return (r, c) => !!m && r >= 0 && c >= 0 && r < m.width && c < m.width && m.flags[r * m.width + c] === 1;
}

// 单位“占位圈”（用于绕行）：把单位周围**净空半径**内的格子都算障碍，这样路径是从旁边**绕过去**、
// 而不是贴着对方擦过去再靠软分离滑开。
// 排除：自己（mover）与目标单位（目标格及其周围要能接近/攻击）。
export function unitCells(state, mover, sr, sc, tr, tc) {
  const set = new Set();
  const m = state.map; if (!m) return set;
  const w = m.width;
  const add = u => {
    if (!u || u.dead || u === mover) return;
    const c = worldToCell(u.x, u.y);
    if (c.row === tr && c.col === tc) return;               // 目标单位不阻挡
    // 净空半径 = 单位半径 + 少量余量（约 1 格宽以内）。过大会让窄道在 A* 阶段就被判无路可走。
    const rad = ((u.radiusX || UNIT_RX) + 14);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const r = c.row + dr, cc = c.col + dc;
      if (r < 0 || cc < 0 || r >= w || cc >= w) continue;
      const p = cellCenter(r, cc);
      if (Math.hypot(p.x - u.x, p.y - u.y) <= rad) set.add(r + "," + cc);
    }
  };
  if (state.player) add(state.player);
  for (const n of state.npcs) add(n);
  set.delete(sr + "," + sc);
  set.delete(tr + "," + tc);
  return set;
}

// opts.avoidUnits=true 时把其它单位占据的格子视为障碍（终点除外）。
// 返回经 string pulling 平滑后的路点（消除网格階梯/折线）。
function walkFnOf(ctx, opts, sr, sc, tr, tc) {
  let isW = walkableOf(ctx.state);
  if (opts && opts.avoidUnits) {
    const blocked = unitCells(ctx.state, opts.mover, sr, sc, tr, tc), base = isW;
    isW = (r, c) => base(r, c) && !blocked.has(r + "," + c);
  }
  return isW;
}
export function findPath(ctx, sr, sc, tr, tc, opts) {
  const m = ctx.state.map; if (!m) return null;
  const isW = walkFnOf(ctx, opts, sr, sc, tr, tc);
  const path = astar(m.width, isW, sr, sc, tr, tc);
  return path ? smoothPath(m.width, isW, path) : null;
}
// 原始 A*（相邻格，带对角），不经平滑 —— 供漏斗构造“门”。
export function findPathRaw(ctx, sr, sc, tr, tc, opts) {
  const m = ctx.state.map; if (!m) return null;
  const isW = walkFnOf(ctx, opts, sr, sc, tr, tc);
  return astar(m.width, isW, sr, sc, tr, tc);
}

export function nearestWalkable(ctx, row, col) {
  const m = ctx.state.map; if (!m) return null;
  return nearestWalkableIn(m.width, walkableOf(ctx.state), row, col);
}

// ---- 角点路径（Simple Stupid Funnel）----
// 世界坐标可走判定（供纯引擎的连续路径使用）
function isWorldWalkable(ctx) {
  const isW = walkableOf(ctx.state);
  return (x, y) => { const c = worldToCell(x, y); return isW(c.row, c.col); };
}
export function walkableSegment(ctx, a, b) { return wsPure(isWorldWalkable(ctx), a, b); }
export function tautPath(ctx, pts) { return tpPure(isWorldWalkable(ctx), pts); }
export function cornerPath(ctx, nodes, start, end) { return cpPure(isWorldWalkable(ctx), nodes, start, end); }

// A*（原始相邻格）+ 角点路径：连续的世界折线（起点用角色当前位置、终点可用精确像素）。
// 注意：角点路径的“视线”必须用**同一个含 avoidUnits 的可走谓词**，否则它会穿过被单位占位圈
// 挡住的格子抄近道（表现为“还是从单位身边滑过去”）。
export function findPathPoints(ctx, sr, sc, tr, tc, opts, startPos, exactPos) {
  const m = ctx.state.map; if (!m) return null;
  const isW = walkFnOf(ctx, opts, sr, sc, tr, tc);
  const cells = astar(m.width, isW, sr, sc, tr, tc);
  if (!cells) return null;
  const nodes = [{ row: sr, col: sc }, ...cells];
  const start = startPos ? { x: startPos.x, y: startPos.y } : cellCenter(sr, sc);
  const end = exactPos ? { x: exactPos.x, y: exactPos.y } : cellCenter(tr, tc);
  const isWW = (x, y) => { const c = worldToCell(x, y); return isW(c.row, c.col); };
  let pts = cpPure(isWW, nodes, start, end);
  if (!pts || !pts.length) pts = [start];
  if (!wsPure(isWW, pts[pts.length - 1], end)) pts = tpPure(isWW, nodes.map(n => cellCenter(n.row, n.col)).concat([end]));
  return pts;
}

// 世界坐标 (wx,wy) 最近的**可走格中心**（确定性，按世界距离）。用于点击到不可走位置时“贴近该点”。
export function nearestWalkablePoint(ctx, wx, wy) {
  const m = ctx.state.map; if (!m) return null;
  const w = m.width;
  let best = null, bd = Infinity;
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) {
    if (m.flags[r * w + c] !== 1) continue;
    const p = cellCenter(r, c);
    const d = (p.x - wx) * (p.x - wx) + (p.y - wy) * (p.y - wy);
    if (d < bd) { bd = d; best = { row: r, col: c, x: p.x, y: p.y }; }
  }
  return best;
}

// 把格子路径转成世界坐标序列。
// exact 不为空时，用精确的世界坐标替换最后一个路点（高精度移动：停在鼠标点击的那个像素，
// 而不是最接近的格子中心）。仅当目标格可走时才应传入 exact。
export function pathToWorld(path, exact) {
  const pts = path.map(p => cellCenter(p.row, p.col));
  if (exact && pts.length) pts[pts.length - 1] = { x: exact.x, y: exact.y };
  return pts;
}

// 世界坐标 (wx,wy) 最近的可走**像素**：先找最近可走格，再把点夹进该格菱形（|dx|/32+|dy|/16<=1）。
export function nearestWalkablePixel(ctx, wx, wy) {
  const n = nearestWalkablePoint(ctx, wx, wy); if (!n) return null;
  let dx = wx - n.x, dy = wy - n.y;
  const k = Math.abs(dx) / 32 + Math.abs(dy) / 16;
  if (k > 1) { dx /= k; dy /= k; }
  return { row: n.row, col: n.col, x: n.x + dx, y: n.y + dy };
}
