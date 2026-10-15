// 世界工具层：与运行时状态/DOM 相关的部分（可行走、单位碰撞、屏幕坐标）。
// 纯几何/方向函数已抽到 engine/iso.js，这里再导出以保持既有 import 不变。
import { G } from "./state.js";
import { VW, VH, cv } from "./constants.js";
import { cellCenter, worldToCell, randomPointInCell, dirFromVec } from "../engine/iso.js";
import { ellipsesOverlap } from "../engine/collision.js";
export { cellCenter, worldToCell, randomPointInCell, dirFromVec };

export function inMap(row, col) { const m = G.map; return m && row >= 0 && col >= 0 && row < m.width && col < m.width; }

export function walkable(row, col) { return inMap(row, col) && G.map.flags[row * G.map.width + col] === 1; }

// ---- 单位碰撞体 ----
// 每个单位在地面上占一个椭圆足迹：水平半径 UNIT_RX，垂直半径约为一半（与 2:1 的等距投影一致）。
// 单位可用 radiusX / radiusY 覆盖默认值（例如体型更大的将领/野兽）。
export const UNIT_RX = 16, UNIT_RY = 8;

export function unitRadii(e) {
  const rx = (e && e.radiusX) || UNIT_RX;
  const ry = (e && e.radiusY) || rx * 0.5;
  return { rx, ry };
}

// 遍历所有单位（玩家 + NPC）。
export function eachUnit(fn) {
  if (G.player) fn(G.player);
  const list = G.npcs;
  for (let i = 0; i < list.length; i++) fn(list[i]);
}

// (x,y) 处是否与其它“存活”单位的碰撞椭圆重叠（忽略 exclude 与自身）。
// 死亡单位趴在地上不再阻挡通行，避免尸体把路口堵死。
export function overlapsUnit(e, x, y, exclude) {
  const a = unitRadii(e);
  let hit = false;
  eachUnit(u => {
    if (hit || u === e || u === exclude || u.dead) return;
    const b = unitRadii(u);
    if (ellipsesOverlap(x, y, a.rx, a.ry, u.x, u.y, b.rx, b.ry)) hit = true;
  });
  return hit;
}

export function screenToWorld(cx, cy) {
  const r = cv.getBoundingClientRect();
  return { x: (cx - r.left) * VW / r.width + G.cam.x, y: (cy - r.top) * VH / r.height + G.cam.y };
}

export function screenPos(cx, cy) {
  const r = cv.getBoundingClientRect();
  return { x: (cx - r.left) * VW / r.width, y: (cy - r.top) * VH / r.height };
}
