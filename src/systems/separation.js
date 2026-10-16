// 单位间“软分离”：移动时允许暂时穿过对方，但每帧把两者推开，避免迎面顶死。
// 关键规则：**只推正在移动的一方**——静止单位不会被移动单位撞得位移（移动方自己让开/绕行）。
// 双方都在移动时互相让开；双方都静止（异常重叠）时才互推以消解重叠。
// 用空间哈希做近邻查询，规模从 O(n²) 降为 O(n·k)，可支撑数百单位。
import { walkable, worldToCell, unitRadii } from "../core/utils.js";
import { createSpatialHash } from "../engine/spatialhash.js";

const PUSH = 110;      // 推开速度（像素/秒）
const ALONG = 0.6;     // 沿连线分量
const LATERAL = 0.8;   // 侧向分量（打破正面对撞，使两者绕开）
const HASH = createSpatialHash(48);
const QUERY_R = 56;    // 近邻查询半径（≥ 两单位半径之和）

// 判断“是否正在移动”：有路径；或玩家按住移动/有攻击目标（追击）。
function isMoving(e, g) {
  if (e.path && e.path.length) return true;
  if (e === g.player) return g.hold !== null || !!e.target;
  return false;
}

export function separateUnits(g, dt) {
  const units = [];
  if (g.player && !g.player.dead) units.push(g.player);
  for (const n of g.npcs) if (!n.dead) units.push(n);
  if (units.length < 2) return;
  HASH.clear();
  for (let i = 0; i < units.length; i++) { units[i].__si = i; HASH.insert(units[i]); }
  for (const a of units) {
    const near = HASH.query(a.x, a.y, QUERY_R);
    for (const b of near) {
      if (b === a || b.__si < a.__si) continue;   // 每对只处理一次
      resolve(a, b, dt, isMoving(a, g), isMoving(b, g));
    }
  }
}

function resolve(a, b, dt, am, bm) {
  const ra = unitRadii(a), rb = unitRadii(b);
  const rx = ra.rx + rb.rx, ry = ra.ry + rb.ry;
  const dx = b.x - a.x, dy = b.y - a.y;
  let nx = dx / rx, ny = dy / ry;
  let d = Math.hypot(nx, ny);
  if (d >= 1) return;                       // 未重叠
  let ux, uy;
  if (d < 1e-4) { ux = 1; uy = 0; d = 0; }  // 完全重合：任取方向
  else {
    ux = dx / (rx * rx); uy = dy / (ry * ry);
    const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
  }
  const sx = -uy, sy = ux;                  // 侧向
  const base = Math.min(1, 1 - d) * PUSH * dt;
  const ax = (ux * ALONG + sx * LATERAL) * base, ay = (uy * ALONG + sy * LATERAL) * base;
  if (am && bm) { /* 双方都在移动：交给 motion 的局部避让转向，不再互推 */ }
  else if (am) {   // 只有 a 移动：主要**侧向**让开（不沿法线把它顶回去 → 不会“蹭着很慢”）
    shift(a, -(ux * 0.15 + sx * 1.0) * base * 2, -(uy * 0.15 + sy * 1.0) * base * 2);
  }
  else if (bm) {
    shift(b, (ux * 0.15 + sx * 1.0) * base * 2, (uy * 0.15 + sy * 1.0) * base * 2);
  }
  else { shift(a, -ax, -ay); shift(b, ax, ay); }             // 都静止（异常重叠）：互推消解
}

function shift(e, mx, my) {
  const nx = e.x + mx, ny = e.y + my;
  const c = worldToCell(nx, ny);
  if (walkable(c.row, c.col)) { e.x = nx; e.y = ny; }
}
