// 实体移动与逐帧动画推进。
import { worldToCell, walkable, dirFromVec, overlapsUnit } from "../core/utils.js";

export function setAnim(e, a) { if (e.action !== a) { e.action = a; e.frame = 0; e.ft = 0; } }

// 目标点能否站立：地形可行走 + 不与其它单位重叠。
function canStand(e, x, y) {
  const c = worldToCell(x, y);
  return walkable(c.row, c.col) && !overlapsUnit(e, x, y);
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

export function updateMove(e, dt) {
  if (e.path && e.path.length) {
    const wp = e.path[0];
    const d = Math.hypot(wp.x - e.x, wp.y - e.y);
    if (d < 2) { e.path.shift(); if (!e.path.length) e.path = null; e.stuckT = 0; }
    else {
      e.dir = dirFromVec(wp.x - e.x, wp.y - e.y);
      const moved = moveEntity(e, wp.x, wp.y, e.speed || 90, true);
      setAnim(e, (e.speed || 90) > 100 ? "run" : "walk");
      if (!moved) {
        e.stuckT = (e.stuckT || 0) + dt;
        // 终点被其它单位占据（且已走到近旁），或原地卡住过久：结束这条路径，避免原地踏步。
        if ((e.path.length === 1 && d < 48 && overlapsUnit(e, wp.x, wp.y)) || e.stuckT > 0.4) {
          e.path = null; e.stuckT = 0;
          if (e.target) e.target = null;
        }
      } else e.stuckT = 0;
    }
    return true;
  }
  return false;
}

export function updateAnim(e, dt, chars) {
  const ch = chars && chars[e.model]; if (!ch) return;
  const blocks = ch[e.action] || ch.stand || ch.walk; if (!blocks) return;
  const block = blocks[e.dir % blocks.length] || blocks[0]; if (!block || !block.length) return;
  e.ft += dt;
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
