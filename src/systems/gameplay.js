// 玩法系统：每帧的各个 system。运行时上下文 ctx 由调用方注入（见 engine/pipeline.js）。
// ctx = { state, assets, maps, config }。
import { VW, VH } from "../core/constants.js";
import { worldToCell, walkable } from "../core/utils.js";
import { nearestWalkable, findPathPoints } from "../world/pathfinding.js";
import { setAnim, updateMove, updateAnim, unitAhead } from "./motion.js";
import { playerAttackTarget } from "./combat.js";
import { npcAI } from "../world/npc.js";
import { pickupGround } from "../world/ground.js";
import { checkTriggers } from "../world/triggers.js";
import { separateUnits } from "./separation.js";

// 玩家：攻击计时、自动拾取、按住鼠标持续移动、攻击/移动、动画、奔跑耗精力。
export function playerSystem(ctx, dt) {
  const g = ctx.state, p = g.player;
  if (!p) return;
  if (!p.target && p.atkT <= 0) p.atkT = 0;   // 不在挥砍时才清计时（挥砍“提交”后必须播完）
  if (!p.target && p.attackCD > 0) p.attackCD = Math.max(0, p.attackCD - dt);
  if (p.dead) {   // 阵亡时若正在挥砍：先把这一刀播完再倒地
    if (p.pendingDie) { p.atkT -= dt; if (p.atkT <= 0) { p.pendingDie = false; p.action = "die"; p.frame = 0; p.ft = 0; p.animSpeed = 1; } }
    updateAnim(p, dt, ctx.assets.chars);
    return;
  }
  if (p.pickup && !p.dead && !g.dialog && !g.script) {
    const gr = p.pickup;
    if (g.ground.indexOf(gr) < 0) p.pickup = null;
    else if (Math.hypot(gr.x - p.x, gr.y - p.y) < 36) { if (pickupGround(g, gr)) p.pickup = null; }
  }
  if (!p.dead) {
    if (g.dialog || g.script) { setAnim(p, "stand"); }
    else {
      // 按住鼠标：持续朝鼠标**当前像素**移动。注意鼠标屏幕坐标不动、相机跟随玩家移动时，
      // 光标下的世界坐标会变，因此每帧用 sx/sy + cam 实时换算（不能依赖只在 mousemove 更新的 wx/wy）。
      if (g.hold !== null && !p.target) {
        const wx = g.mouse.sx + g.cam.x, wy = g.mouse.sy + g.cam.y;
        const c = worldToCell(wx, wy);
        const onCell = walkable(c.row, c.col);
        const t = onCell ? c : nearestWalkable(ctx, c.row, c.col);
        if (t) {
          const goalChanged = !g.holdCell || g.holdCell.row !== t.row || g.holdCell.col !== t.col;
          const mouseMoved = !g.holdTarget || Math.hypot(wx - g.holdTarget.x, wy - g.holdTarget.y) > 0.5;
          if (goalChanged || !p.path) {
            const cc = worldToCell(p.x, p.y);
            const pts = findPathPoints(ctx, cc.row, cc.col, t.row, t.col, { avoidUnits: true, mover: p }, { x: p.x, y: p.y }, onCell ? { x: wx, y: wy } : null);
            if (pts && pts.length) {
              g.holdCell = t; g.holdTarget = { x: wx, y: wy };
              p.path = pts;
              p.running = (g.hold === 0); p.speed = (g.hold === 0) ? 150 : 90;
            }
          } else if (mouseMoved && onCell && p.path && p.path.length) {
            // 同一目标格内：只把终点改到当前鼠标像素，持续跟随（无需 A*）
            p.path[p.path.length - 1] = { x: wx, y: wy };
            g.holdTarget = { x: wx, y: wy };
          }
        }
      }
      // 前方有单位挡路 → 用 avoidUnits 重规划（转身沿可行走路线绕行，而不是被推着划弧）
      if (p.path && p.path.length && !p.target) {
        p.repathT = Math.max(0, (p.repathT || 0) - dt);
        if (p.repathT <= 0 && unitAhead(p, p.path[0].x, p.path[0].y, 100)) {
          const goal = p.path[p.path.length - 1], gc = worldToCell(goal.x, goal.y), cc = worldToCell(p.x, p.y);
          const pts = findPathPoints(ctx, cc.row, cc.col, gc.row, gc.col, { avoidUnits: true, mover: p }, { x: p.x, y: p.y }, goal);
          if (pts && pts.length) p.path = pts;
          p.repathT = 0.35;
        }
      }
      if (p.atkT > 0 || (p.target && !p.target.dead)) playerAttackTarget(ctx, dt);
      else if (p.target && p.target.dead) p.target = null;
      else if (!updateMove(p, dt)) {
        if (p.action !== "stand") setAnim(p, "stand");
        if (p.running && g.stats.mp <= 0) p.running = false;
      }
      if (p.action === "run" || (p.action === "walk" && p.running)) g.stats.mp = Math.max(0, g.stats.mp - ctx.config.combat.mpDrainRun * dt);
    }
  }
  updateAnim(p, dt, ctx.assets.chars);
}

// NPC：AI + 动画（死亡单位只保留倒地最后一帧）。
export function npcSystem(ctx, dt) {
  const g = ctx.state, chars = ctx.assets.chars;
  for (const n of g.npcs) {
    if (n.dead) {
      // 阵亡时若正在挥砍：先把这一刀动画播完，再切换到倒地。
      if (n.pendingDie) {
        n.atkT -= dt;
        if (n.atkT <= 0) { n.pendingDie = false; n.action = "die"; n.frame = 0; n.ft = 0; n.animSpeed = 1; }
      }
      updateAnim(n, dt, chars); continue;
    }
    npcAI(ctx, n, dt); updateAnim(n, dt, chars);
  }
}

export function triggerSystem(ctx, dt) { checkTriggers(ctx, dt); }

// 技能特效推进。
export function effectSystem(ctx, dt) {
  const g = ctx.state;
  for (const e of g.effects) { e.t += dt; if (e.t > 0.06) { e.t = 0; e.i++; } }
  g.effects = g.effects.filter(e => e.i < e.frames.length);
}

// 相机跟随（带边界钳制）。
export function cameraSystem(ctx, dt) {
  const g = ctx.state, p = g.player; if (!p) return;
  const m = g.map;
  g.cam.x += ((p.x - VW / 2) - g.cam.x) * Math.min(1, dt * 8);
  g.cam.y += ((p.y - VH / 2) - g.cam.y) * Math.min(1, dt * 8);
  g.cam.x = Math.max(m.minX, Math.min(m.maxX - VW, g.cam.x));
  g.cam.y = Math.max(m.minY, Math.min(m.maxY - VH, g.cam.y));
}

// 单位间软分离（避免移动时互相卡死）。
export function separationSystem(ctx, dt) { separateUnits(ctx.state, dt); }

// 每帧玩法系统的顺序。
export const gameplaySystems = [playerSystem, npcSystem, separationSystem, triggerSystem, effectSystem, cameraSystem];
