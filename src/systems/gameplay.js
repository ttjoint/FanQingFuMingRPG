// 玩法系统：每帧的各个 system。运行时上下文 ctx 由调用方注入（见 engine/pipeline.js）。
// ctx = { state, assets, maps, config }。
import { VW, VH } from "../core/constants.js";
import { worldToCell, walkable } from "../core/utils.js";
import { nearestWalkable, findPath, pathToWorld } from "../world/pathfinding.js";
import { setAnim, updateMove, updateAnim } from "./motion.js";
import { playerAttackTarget } from "./combat.js";
import { npcAI } from "../world/npc.js";
import { pickupGround } from "../world/ground.js";
import { checkTriggers } from "../world/triggers.js";

// 玩家：攻击计时、自动拾取、按住鼠标持续移动、攻击/移动、动画、奔跑耗精力。
export function playerSystem(ctx, dt) {
  const g = ctx.state, p = g.player;
  if (!p) return;
  if (!p.target) p.atkT = 0;
  if (!p.target && p.attackCD > 0) p.attackCD = Math.max(0, p.attackCD - dt);
  if (p.pickup && !p.dead && !g.dialog && !g.script) {
    const gr = p.pickup;
    if (g.ground.indexOf(gr) < 0) p.pickup = null;
    else if (Math.hypot(gr.x - p.x, gr.y - p.y) < 36) { if (pickupGround(g, gr)) p.pickup = null; }
  }
  if (!p.dead) {
    if (g.dialog || g.script) { setAnim(p, "stand"); }
    else {
      // 按住鼠标：持续朝鼠标当前位置移动（高精度：终点取鼠标像素，且按位移阈值重算）
      if (g.hold !== null && !p.target) {
        const c = worldToCell(g.mouse.wx, g.mouse.wy);
        const moved = !g.holdTarget || Math.hypot(g.mouse.wx - g.holdTarget.x, g.mouse.wy - g.holdTarget.y) > 8;
        if (!g.holdCell || g.holdCell.row !== c.row || g.holdCell.col !== c.col || moved) {
          g.holdCell = c;
          const onCell = walkable(c.row, c.col);
          const t = onCell ? c : nearestWalkable(ctx, c.row, c.col);
          if (t) {
            const cc = worldToCell(p.x, p.y);
            const path = findPath(ctx, cc.row, cc.col, t.row, t.col);
            if (path) {
              g.holdTarget = { x: g.mouse.wx, y: g.mouse.wy };
              p.path = pathToWorld(path, onCell ? { x: g.mouse.wx, y: g.mouse.wy } : null);
              p.running = (g.hold === 0); p.speed = (g.hold === 0) ? 150 : 90;
            }
          }
        }
      }
      if (p.target && !p.target.dead) playerAttackTarget(ctx);
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
  for (const n of g.npcs) { if (n.dead) { updateAnim(n, dt, chars); continue; } npcAI(ctx, n, dt); updateAnim(n, dt, chars); }
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

// 每帧玩法系统的顺序（与拆分前完全一致）。
export const gameplaySystems = [playerSystem, npcSystem, triggerSystem, effectSystem, cameraSystem];
