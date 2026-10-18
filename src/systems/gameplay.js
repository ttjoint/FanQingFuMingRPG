// 玩法系统：每帧的各个 system。运行时上下文 ctx 由调用方注入（见 engine/pipeline.js）。
// ctx = { state, assets, maps, config }。
import { VW, VH } from "../core/constants.js";
import { worldToCell, walkable } from "../core/utils.js";
import { nearestWalkable, findPathPoints } from "../world/pathfinding.js";
import { setAnim, updateMove, updateAnim, unitAhead, canRun, walkSpeed, setPlayerRun } from "./motion.js";
import { tickMp } from "../engine/stamina.js";
import { playerAttackTarget } from "./combat.js";
import { npcAI } from "../world/npc.js";
import { pickupGround } from "../systems/ground.js";
import { updateGround } from "../systems/ground.js";
import { fxSystem } from "./effects.js";
import { tickIndicators } from "./indicators.js";
import { checkTriggers } from "../world/triggers.js";
import { separateUnits } from "./separation.js";
import { projectileSystem } from "./projectiles.js";
import { buffSystem } from "./buffs.js";
import { waypointSystem } from "./waypoint.js";
import { mercSystem } from "./merc.js";

// 精力充足才能奔跑：精力降到 0 时强制走路（左右键都只能是走路），直到靠药水/NPC 回复精力。
// 门控本体在 motion.js（避免 gameplay↔combat 循环 import），这里再导出保持既有引用不变。
export { canRun, WALK_SPEED, RUN_SPEED, setPlayerRun } from "./motion.js";

// 玩家：攻击计时、自动拾取、按住鼠标持续移动、攻击/移动、动画、奔跑耗精力。
export function playerSystem(ctx, dt) {
  const g = ctx.state, p = g.player;
  if (!p) return;
  if (!p.target && p.atkT <= 0) p.atkT = 0;   // 不在挥砍时才清计时（挥砍“提交”后必须播完）
  if (!p.target && p.attackCD > 0) p.attackCD = Math.max(0, p.attackCD - dt);
  if (p.dead) {   // 血量归零立即倒地，打断未完成的挥砍
    if (p.pendingDie) { p.pendingDie = false; p.action = "die"; p.frame = 0; p.ft = 0; p.animSpeed = 1; }
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
            }
          } else if (mouseMoved && onCell && p.path && p.path.length) {
            // 同一目标格内：只把终点改到当前鼠标像素，持续跟随（无需 A*）
            p.path[p.path.length - 1] = { x: wx, y: wy };
            g.holdTarget = { x: wx, y: wy };
          }
        }
        // 每帧根据当前精力重新评估跑/走：精力耗尽时（即使左键按住）立即降为走路。
        // 精力只能靠药水/NPC 恢复；恢复后再按住左键即可重新起跑。
        setPlayerRun(g, g.hold === 0);
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
      }
      // 精力耗尽：立即取消奔跑、改成走路速度（保证“奔跑中精力瞬间到 0”当帧切成走路）。
      // （按住移动的跑/走判定已在上面每帧由 setPlayerRun 处理，这里兼容单击/追击等非按住情形。）
      if (p.running && !canRun(g)) { p.running = false; p.speed = walkSpeed(); }
      // 精力消耗只看“是否真的在奔跑移动”（p.action==="run" 由 updateMove/追击在实际位移时设置）：
      // 停止（待机/到达终点/被挡）时不掉精力；精力**不会自动回复**，只能靠药水或 NPC/脚本。
      if (p.action === "run") { const CFG = ctx.config.combat; g.stats.mp = tickMp(g.stats.mp, g.stats.mpMax, true, CFG.mpDrainRun, dt); }
    }
  }
  updateAnim(p, dt, ctx.assets.chars);
}

// NPC：AI + 动画（死亡单位只保留倒地最后一帧）。
export function npcSystem(ctx, dt) {
  const g = ctx.state, chars = ctx.assets.chars;
  for (const n of g.npcs) {
    if (n.dead) {
      // 一旦血量归零就**立即**进入死亡：不再等当前挥砍帧播完。
      // （旧行为“攻击帧做完了才倒地”会让玩家看到尸体还在挥刀）
      if (n.pendingDie) { n.pendingDie = false; n.action = "die"; n.frame = 0; n.ft = 0; n.animSpeed = 1; }
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

// 地面掉落物：存在时长到期移除。
export function groundSystem(ctx, dt) { updateGround(ctx.state, dt); }

// 指示：落点光圈计时（红/蓝圈与高亮在渲染时每帧重算）。
export function indicatorSystem(ctx, dt) { tickIndicators(ctx.state, dt); }

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
// waypointSystem 紧跟 playerSystem：玩家的落点由 playerSystem 更新，
// 踩点判定必须看到本帧的最新坐标（否则切图后要等一帧才解锁）。
export const gameplaySystems = [playerSystem, waypointSystem, mercSystem, npcSystem, separationSystem, triggerSystem, projectileSystem, buffSystem, fxSystem, groundSystem, indicatorSystem, effectSystem, cameraSystem];
