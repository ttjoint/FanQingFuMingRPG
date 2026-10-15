// NPC 创建与 AI（闲逛 / 追击 / 攻击）。运行时上下文 ctx 由调用方注入。
import { cellCenter, worldToCell, walkable, dirFromVec, randomPointInCell, overlapsUnit } from "../core/utils.js";
import { preloadChar } from "../core/assets.js";
import { findPath, pathToWorld } from "./pathfinding.js";
import { setAnim, moveEntity, updateMove } from "../systems/motion.js";
import { rollHit, dealDamage } from "../systems/combat.js";
import { resolveNpc } from "../content/contentdb.js";
import { attachAll } from "../engine/ecs.js";
import { UNIT_COMPONENTS } from "../runtime/components.js";

export function npcDataByName(ctx, nm) { return ctx.assets.npcsData.find(n => n.name === nm); }

export function makeNPC(d, row, col, overrides) {
  d = resolveNpc(d, overrides);   // 地图单位实例可用 overrides 单独覆盖模板属性
  const p = cellCenter(row, col);
  const n = { id: d.id, name: d.name, model: (d.model || "").replace(/\.pmg$/, ""),
    portrait: d.portrait, script: d.script, hp: d.hp, hpMax: d.hp, atk: d.attack,
    def: d.defence, level: d.level, exp: d.exp || 0, attackable: d.attack > 0, aggressive: !!d.hostile, ai: d.ai,
    talk: (d.talks && d.talks.length) ? d.talks[0].replace(/\\n/g, "\n") : "", talks: d.talks || [],
    speed: d.speed || 45, runSpeed: d.runSpeed || 70,
    drops: (d.drops || []).map(x => ({ name: x.name, count: x.count || 1 })),
    x: p.x, y: p.y, row, col, dir: 4, action: "stand", frame: 0, ft: 0,
    target: null, path: null, attackCD: 0, aggro: false, dead: false, dieT: 0, dmgT: 0, wanderT: 1 + Math.random() * 3 };
  attachAll(n, UNIT_COMPONENTS);   // 统一补齐组件默认字段（半径/速度/姿态…）
  preloadChar(n.model);
  placeFree(n);   // 防止出生点与已有单位重叠
  return n;
}

// 若当前位置与其它单位重叠，就在附近格心找一个空位（最多外扩 3 圈）。
export function placeFree(e) {
  if (!overlapsUnit(e, e.x, e.y)) return true;
  const c = worldToCell(e.x, e.y);
  for (let r = 1; r <= 3; r++) {
    for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;   // 只看当前一圈
      const rr = c.row + dr, cc = c.col + dc;
      if (!walkable(rr, cc)) continue;
      const p = cellCenter(rr, cc);
      if (!overlapsUnit(e, p.x, p.y)) { e.x = p.x; e.y = p.y; e.row = rr; e.col = cc; return true; }
    }
  }
  return false;
}

export function spawnNPC(ctx, id, row, col, overrides) {
  const d = ctx.assets.npcsData.find(n => n.id === id);
  return d ? makeNPC(d, row, col, overrides) : null;
}

export function spawnByName(ctx, name, x, y, isCol) {
  const d = npcDataByName(ctx, name);
  if (!d) return null;
  // 脚本按 (x,y) 传，x=列, y=行
  const npc = makeNPC(d, y, x);
  ctx.state.npcs.push(npc);
  return npc;
}

export function wanderIdle(ctx, n, dt) {
  const g = ctx.state, A = ctx.assets;
  if (g.dialog || g.script) { setAnim(n, "stand"); return; }
  const ch = A.chars[n.model];
  if (!ch || !ch.walk) { setAnim(n, "stand"); return; }   // 没有行走帧的 NPC 原地不动（如老父/老母/卖药人）
  if (n.path && n.path.length) { updateMove(n, dt); return; }
  setAnim(n, "stand");
  n.wanderT = (n.wanderT || 0) - dt;
  if (n.wanderT > 0) return;
  n.wanderT = 2 + Math.random() * 5;
  const c = worldToCell(n.x, n.y);
  const tr = c.row + Math.floor(Math.random() * 7 - 3), tc = c.col + Math.floor(Math.random() * 7 - 3);
  if (!walkable(tr, tc)) return;
  // 终点取目标格内的任意一点（而非格心），这样 NPC 能走到任意位置。
  let dest = randomPointInCell(tr, tc);
  for (let k = 0; k < 4 && overlapsUnit(n, dest.x, dest.y); k++) dest = randomPointInCell(tr, tc);
  if (overlapsUnit(n, dest.x, dest.y)) return;   // 目标格已被其它单位占据，换下次再游荡
  if (Math.hypot(dest.x - n.x, dest.y - n.y) < 12) return;
  const path = findPath(ctx, c.row, c.col, tr, tc);
  if (path && path.length) {
    const pts = pathToWorld(path);
    pts[pts.length - 1] = dest;
    n.path = pts; n.speed = n.speed || 45;
  }
}

export function npcAI(ctx, n, dt) {
  const g = ctx.state, CFG = ctx.config;
  if (n.dead || !g.player || g.player.dead) return;
  const p = g.player;
  n.attackCD -= dt;
  if (n.dmgT > 0) n.dmgT -= dt;
  const d = Math.hypot(p.x - n.x, p.y - n.y);
  if (!n.attackable) { wanderIdle(ctx, n, dt); return; }
  if (!n.aggro && n.aggressive && d < CFG.combat.npcAggro) n.aggro = true;
  if (!n.aggro) { wanderIdle(ctx, n, dt); return; }
  if (g.dialog || g.script) { setAnim(n, "stand"); return; }
  if (d > CFG.combat.npcMelee) {
    moveEntity(n, p.x, p.y, n.runSpeed || 70, true);
    setAnim(n, "walk");
  } else {
    setAnim(n, "fight"); n.dir = dirFromVec(p.x - n.x, p.y - n.y);
    if (n.attackCD <= 0) {
      n.attackCD = CFG.combat.npcAttackCD;
      const nhit = CFG.combat.npcHitBase + Math.min(CFG.combat.npcHitPerLevel, n.level || 10);
      // 原版：NPC 的 role+0x64 != 0，掷骰会平方（17 → 89）；玩家为 0，不平方。
      if (rollHit(nhit, true)) {
        g.stats.hp -= dealDamage(n.atk, 0, g.stats.defence);
        if (g.stats.hp <= 0) { g.stats.hp = 0; g.player.dead = true; g.player.action = "die"; g.player.frame = 0; g.player.ft = 0; }
      }
    }
  }
}
