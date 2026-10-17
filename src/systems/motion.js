// 实体移动与逐帧动画推进。
import { worldToCell, walkable, dirFromVec, overlappingUnit, unitRadii, eachUnit } from "../core/utils.js";

export function setAnim(e, a) { if (e.action !== a) { e.action = a; e.frame = 0; e.ft = 0; } }

// ---- 精力（奔跑）门控 ----
// 纯逻辑在 engine/stamina.js（可在 Node 测试，无 DOM 依赖），这里再导出并接入运行时状态。
import { CFG } from "../core/config.js";
export { WALK_SPEED, RUN_SPEED } from "../engine/stamina.js";
import { canRun as _canRun, resolveRun, WALK_SPEED as _WALK, RUN_SPEED as _RUN } from "../engine/stamina.js";

// 玩家移速来自配置（数值平衡数据），缺省回退引擎默认。
export function walkSpeed() { return (CFG.move && CFG.move.walkSpeed != null) ? CFG.move.walkSpeed : _WALK; }
export function runSpeed() { return (CFG.move && CFG.move.runSpeed != null) ? CFG.move.runSpeed : _RUN; }

// 精力充足才能奔跑：精力降到 0 时强制走路，直到靠药水/NPC 回复精力（mp > 0）。
export function canRun(g) { return _canRun(g && g.stats); }

// 设定玩家奔跑状态/速度：wantRun 为真但精力为 0 时，自动降为走路。返回实际是否在跑。
export function setPlayerRun(g, wantRun) {
  const r = resolveRun(g.stats, wantRun, { walkSpeed: walkSpeed(), runSpeed: runSpeed() });
  g.player.running = r.running;
  g.player.speed = r.speed;
  return r.running;
}

// 目标点能否站立：仅看地形可行走（单位之间不再硬阻挡——改由 separationSystem 每帧软推开，
// 否则两个迎面移动的单位会互相卡死、原地踏步）。
function canStand(e, x, y) {
  const c = worldToCell(x, y);
  return walkable(c.row, c.col);
}

// 前方“近处有单位挡路”检测（用于触发重规划：绕过对方所在格，而不是被推着划弧）。
export function unitAhead(e, tx, ty, reach) {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  if (d < 1) return false;
  const ux = dx / d, uy = dy / d, a = unitRadii(e), R = reach || 60;
  let hit = false;
  eachUnit(u => {
    if (hit || u === e || u.dead) return;
    const ox = u.x - e.x, oy = u.y - e.y;
    const fwd = ox * ux + oy * uy;
    if (fwd <= 0 || fwd > R) return;
    if (Math.abs(ox * (-uy) + oy * ux) < a.rx + unitRadii(u).rx) hit = true;
  });
  return hit;
}

// 走一步：整步被挡时沿单轴滑动（绕开挡路的单位 / 贴住墙角），返回实际位移向量或 null。
function stepTo(e, sx, sy) {
  if (!sx && !sy) return null;
  if (canStand(e, e.x + sx, e.y + sy)) { e.x += sx; e.y += sy; return { x: sx, y: sy }; }
  if (sx && canStand(e, e.x + sx, e.y)) { e.x += sx; return { x: sx, y: 0 }; }
  if (sy && canStand(e, e.x, e.y + sy)) { e.y += sy; return { x: 0, y: sy }; }
  return null;
}

export function moveEntity(e, tx, ty, speed, collide) {
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  if (d < 1) return true;
  const stepx = dx / d * speed / 60, stepy = dy / d * speed / 60;
  let delta = null;
  if (!collide) { e.x += stepx; e.y += stepy; delta = { x: stepx, y: stepy }; }
  else delta = stepTo(e, stepx, stepy);
  if (delta) {   // 平滑速度求朝向：用“实际位移”，被墙/单位挡住换轴时朝向才正确，避免贴图闪烁
    e.vx = (e.vx || 0) * 0.75 + delta.x * 0.25;
    e.vy = (e.vy || 0) * 0.75 + delta.y * 0.25;
    if (Math.hypot(e.vx, e.vy) > 0.02) e.dir = dirFromVec(e.vx, e.vy);
  }
  return !!delta;
}

// 终点被其它单位占据、且已经贴到“碰撞接触距离”时，视为“到达”并结束该段路径。
// 否则（只看 d<2 的格心）移动方会永远挤不到终点，被 separation 反复推回 → 原地踏步。
function arrivedAtOccupied(e, wp) {
  const o = overlappingUnit(e, wp.x, wp.y);
  if (!o) return false;
  const a = unitRadii(e), b = unitRadii(o);
  return Math.hypot(o.x - e.x, o.y - e.y) <= Math.max(a.rx + b.rx, a.ry + b.ry) + 8;
}

export function updateMove(e, dt) {
  if (e.path && e.path.length) {
    const wp = e.path[0];
    const d = Math.hypot(wp.x - e.x, wp.y - e.y);
    if (d < 2 || (e.path.length === 1 && !e.target && arrivedAtOccupied(e, wp))) {   // 追击目标时不用“到达被占据点”提前停
      e.path.shift(); if (!e.path.length) e.path = null; e.stuckT = 0;
    }
    else {
      e.dir = dirFromVec(wp.x - e.x, wp.y - e.y);
      // moveSpeed：本次移动的临时步速（由 goTo 按动作传入，如 chase=基础、flee=runSpeed）。
      // 它同时决定位移与 run/walk 动画，两者不一致时会出现“人在跑却放走路动画”，
      // 或 run/walk 逐帧互切，看上去就是动画一抽一抽。
      const sp = e.moveSpeed || e.speed || 90;
      const moved = moveEntity(e, wp.x, wp.y, sp, true);
      if (moved) { setAnim(e, sp > 100 ? "run" : "walk"); e.stuckT = 0; }
      else {
        e.stuckT = (e.stuckT || 0) + dt;
        if (e.stuckT > 0.12) setAnim(e, "stand");   // 顶住时不再原地播放跑动动画
        // 被墙/地形卡住过久：放弃这条路径，避免原地踏步。
        if (e.stuckT > 0.4) { e.path = null; e.stuckT = 0; if (e.target) e.target = null; }
      }
    }
    return true;
  }
  return false;
}

export function updateAnim(e, dt, chars) {
  const ch = chars && chars[e.model]; if (!ch) return;
  const blocks = ch[e.action] || ch.stand || ch.walk; if (!blocks) return;
  const block = blocks[e.dir % blocks.length] || blocks[0]; if (!block || !block.length) return;
  e.ft += dt * (e.animSpeed || 1);   // e.animSpeed：动画配合攻击间隔的加减速
  const fps = animFps(e.action);
  if (e.ft > 1 / fps) {
    e.ft = 0;
    if (e.action === "die") e.frame = Math.min(e.frame + 1, block.length - 1);
    else e.frame = (e.frame + 1) % block.length;
  }
}

export function animFps(action) {
  return action === "walk" ? 9 : action === "run" ? 14 : action === "fight" ? 12 : action === "die" ? 12 : 5;
}

// 某动作当前方向整段动画的播放时长（秒），用于“攻击提交”时长。
export function actionDuration(e, action, chars) {
  const ch = chars && chars[e.model]; if (!ch) return 0.6;
  const blocks = ch[action] || ch.stand; if (!blocks) return 0.6;
  const block = blocks[e.dir % blocks.length] || blocks[0];
  if (!block || !block.length) return 0.6;
  return block.length / animFps(action);
}
