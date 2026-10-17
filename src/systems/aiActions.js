// 运行时：AI 动作的副作用实现 + AI 运行时适配器（把 engine/ai.js 的纯决策接到移动/战斗）。
//
// engine/ai.js 只描述「做什么」；本模块实现「怎么移动/怎么攻击」，
// 并注册动作原语（registerAction）。这样引擎纯逻辑可单测，副作用集中在这里。
import { worldToCell, walkable, dirFromVec, randomPointInCell, overlapsUnit, cellCenter } from "../core/utils.js";
import { findPathPoints } from "../world/pathfinding.js";
import { setAnim, moveEntity, updateMove, actionDuration, unitAhead } from "./motion.js";
import { resolveHit, HIT_FRACTION, castSkill } from "./combat.js";
import { spawnProjectile } from "./projectiles.js";
import { canAttack, nearestHostile, isHostile } from "../engine/faction.js";
import { registerAction, ACTIONS } from "../engine/ai.js";
import { NPC_DEFAULT_SPEED, NPC_DEFAULT_RUN_SPEED } from "../content/npcFields.js";

// ---- 单位当前使用的技能（数据驱动）----
// NPC 可用其 skills 列表里的第一项（需满足等级/精力），否则徒手（近战、无威力加成）。
// 玩家走 combat.js 中的 G.skill；这里只服务 NPC。
export function skillFor(ctx, n) {
  const list = ctx && ctx.assets && ctx.assets.skills;
  const names = (n && n.skills) || [];
  for (const nm of names) {
    const sk = list && list.find(s => s.name === nm);
    if (!sk) continue;
    if (sk.reqLevel && (n.level || 1) < sk.reqLevel) continue;
    return sk;
  }
  return null;   // 徒手：resolveHit 会把 null 当作近战、power=0
}

// ---- 距离解析：数字 / "melee" / "aggro" / "leash" ----
export function resolveRange(v, bb, ctx) {
  const cfg = ctx && ctx.cfg ? ctx.cfg : {};
  if (typeof v === "number" && isFinite(v)) return v;
  if (v === "melee") return cfg.npcMelee || 46;
  if (v === "aggro") return (bb.plan && bb.plan.targeting.aggroRange) || cfg.npcAggro || 260;
  if (v === "leash") return (bb.plan && bb.plan.targeting.leash) || 480;
  if (v == null) return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

// ---- 同一黑板上的公共动作实现 ----
// 让单位朝某点走（A* + 绕单位）；返回是否到达 stopRange。
function goTo(ctx, n, tx, ty, speed, stopRange, dt) {
  const cc = worldToCell(n.x, n.y), tgt = worldToCell(tx, ty);
  const needReplan = !n.path || !n.path.length || !n.chaseCell || n.chaseCell.row !== tgt.row || n.chaseCell.col !== tgt.col;
  if (needReplan) {
    const pts = findPathPoints(ctx, cc.row, cc.col, tgt.row, tgt.col, { avoidUnits: true, mover: n }, { x: n.x, y: n.y });
    n.path = (pts && pts.length) ? pts : null;
    n.chaseCell = tgt;
  }
  const d = Math.hypot(n.x - tx, n.y - ty);
  if (d <= (stopRange || 0)) { n.path = null; return true; }
  const sp = speed === "run" ? (n.runSpeed || NPC_DEFAULT_RUN_SPEED) : (n.speed || NPC_DEFAULT_SPEED);
  if (n.path && n.path.length) { n.repathT = 0.35; updateMove(n, dt); }
  else moveEntity(n, tx, ty, sp, true);
  return false;
}

// ---- 注册动作原语 ----
// 每个动作返回 { statePatch } 可选（合并进 AI 状态）。

registerAction("idle", (rt, bb, params) => {
  const n = bb.self;
  if (n.path) n.path = null;
  setAnim(n, "stand");
  return {};
});

// 原地附近随机游荡（以出生点 home 为圆心，radius 像素内）——网游野怪式的小范围巡逻。
registerAction("wander", (rt, bb, params, dt) => {
  const n = bb.self, st = bb.state;
  if (rt.ctx && (rt.ctx.state.dialog || rt.ctx.state.script)) { setAnim(n, "stand"); return {}; }
  const ch = rt.ctx && rt.ctx.assets && rt.ctx.assets.chars[n.model];
  if (!ch || !ch.walk) { setAnim(n, "stand"); return {}; }   // 无行走帧 -> 站着不动
  if (n.path && n.path.length) { updateMove(n, dt); return {}; }
  if (st.wanderDest) {
    const done = goTo(rt.ctx, n, st.wanderDest.x, st.wanderDest.y, n.speed, 12, dt);
    st.wanderDest = null;
    if (done) setAnim(n, "stand");
    return {};
  }
  setAnim(n, "stand");
  st.wanderT = (st.wanderT || 0) - dt;
  if (st.wanderT > 0) return {};
  const iv = Array.isArray(params.interval) ? params.interval : [2, 6];
  st.wanderT = iv[0] + Math.random() * Math.max(0, iv[1] - iv[0]);
  const radius = params.radius === undefined ? 160 : params.radius;
  // 优先用单位自身记录的出生点（n.homeX/homeY，spawnNPC 时写入并经过 placeFree 校正），
  // 退化时才用黑板的 home（黑板在首次访问时建立，可能早于 placeFree 的位移）。
  const home = (n.homeX != null && n.homeY != null) ? { x: n.homeX, y: n.homeY }
                                                     : (bb.home || { x: n.x, y: n.y });
  let dest = null;
  for (let k = 0; k < 6; k++) {
    const ang = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
    const px = home.x + Math.cos(ang) * r, py = home.y + Math.sin(ang) * r;
    const c = worldToCell(px, py);
    if (!walkable(c.row, c.col)) continue;
    if (overlapsUnit(n, px, py)) continue;
    dest = { x: px, y: py }; break;
  }
  if (!dest) return {};
  const cc = worldToCell(n.x, n.y), dc = worldToCell(dest.x, dest.y);
  const pts = findPathPoints(rt.ctx, cc.row, cc.col, dc.row, dc.col, null, { x: n.x, y: n.y }, dest);
  if (pts && pts.length) { n.path = pts; n.speed = n.speed || NPC_DEFAULT_SPEED; }
  return {};
});

// 追击：走到目标的 stopRange 内；超过 maxTime（默认由 targeting.giveUpT）则放弃。
registerAction("chase", (rt, bb, params, dt) => {
  const n = bb.self, t = bb.target;
  if (!t || t.dead) return {};
  const stop = resolveRange(params.stopRange, bb, rt.ctx);
  const maxTime = params.maxTime === undefined ? (bb.plan ? bb.plan.targeting.giveUpT : 8) : params.maxTime;
  if (maxTime > 0 && (bb.state.aggroT || 0) > maxTime) {
    // 追击超时：放弃目标，仇恨清零，然后**走回出生点**
    // （只清目标不回家会让怪永远停在地图另一头）。
    bb.target = null; bb.state.aggroT = 0;
    if (bb.self) { bb.self.lastAttacker = null; bb.self.aggroAt = null; }
    const home = homeOf(bb);
    return returnTo(rt.ctx, n, home, dt);
  }
  // 追得太远（离开出生点超过 leashFrom）也放弃并返回。
  const tg = (bb.plan && bb.plan.targeting) || {};
  const leashFrom = tg.leashFrom != null ? tg.leashFrom : 0;
  if (leashFrom > 0) {
    const home = homeOf(bb);
    if (Math.hypot(n.x - home.x, n.y - home.y) > leashFrom) {
      bb.target = null; bb.state.aggroT = 0;
      if (bb.self) { bb.self.lastAttacker = null; bb.self.aggroAt = null; }
      return returnTo(rt.ctx, n, home, dt);
    }
  }
  const d = Math.hypot(t.x - n.x, t.y - n.y);
  if (d <= stop) { n.path = null; n.dir = dirFromVec(t.x - n.x, t.y - n.y); setAnim(n, "stand"); return {}; }
  const speed = params.speed === "walk" ? (n.speed || NPC_DEFAULT_SPEED) : (n.runSpeed || NPC_DEFAULT_RUN_SPEED);
  goTo(rt.ctx, n, t.x, t.y, params.speed === "walk" ? "walk" : "run", 0, dt);
  n.dir = dirFromVec(t.x - n.x, t.y - n.y);
  setAnim(n, "walk");
  return {};
});

// 攻击：面向目标、按 cooldown 触发一次挥砍；命中在挥砍中段结算。
registerAction("attack", (rt, bb, params, dt) => {
  const n = bb.self, t = bb.target;
  if (!t || t.dead) return {};
  n.path = null;
  n.dir = dirFromVec(t.x - n.x, t.y - n.y);
  if (n.atkT > 0) {   // 挥砍提交：播完这一刀
    n.atkT -= dt; n.swingT = (n.swingT || 0) + dt;
    if (n.atkT <= 0) n.animSpeed = 1;
    setAnim(n, "fight");
    if (n.hitPending && n.swingT >= (n.swingTotal || 0) * HIT_FRACTION) {
      n.hitPending = false;
      const atk = Math.round((n.atk || 0) * (params.rage || 1));
      // 统一命中结算入口（与玩家共用）；NPC 使用技能（如果有），否则徒手。
      const sk = skillFor(rt.ctx, n);
      const tg = sk ? sk.targeting : null;
      if (sk && (sk.projectile || (tg && (tg.aoe || tg.kind === "ally" || tg.kind === "point")))) {
        // 带目标选择 / 弹道的技能：走统一施放入口。
        if (sk.projectile) spawnProjectile(rt.ctx, n, t, sk, { params: { atk } });
        else castSkill(rt.ctx, n, t, sk, { atk });
      } else {
        resolveHit(rt.ctx, n, t, sk, { atk });
      }
    }
    if (n.atkT <= 0) n.swingTarget = null;
    return {};
  }
  const cd = params.cooldown === undefined ? 1.1 : params.cooldown;
  if ((n.attackCD || 0) > 0) { setAnim(n, "fight"); return {}; }
  const interval = Math.max(0.25, cd);
  const dur = actionDuration(n, "fight", rt.ctx.assets.chars);
  n.atkT = interval; n.swingTotal = interval; n.swingT = 0;
  n.action = "fight"; n.frame = 0; n.ft = 0;
  n.animSpeed = dur / interval;
  n.hitPending = true; n.swingTarget = t;
  n.attackCD = interval;
  return {};
});

// 逃跑：远离目标方向移动；到达 range 之外则停止（交由规则重新决策）。
registerAction("flee", (rt, bb, params, dt) => {
  const n = bb.self, t = bb.target;
  const range = params.range === undefined ? 400 : params.range;
  const d = t ? Math.hypot(t.x - n.x, t.y - n.y) : Infinity;
  const speed = params.speed === undefined ? (n.runSpeed || NPC_DEFAULT_RUN_SPEED) : ((n.runSpeed || NPC_DEFAULT_RUN_SPEED) * params.speed);
  if (!t || d >= range) { n.path = null; setAnim(n, "stand"); return {}; }
  // 朝“目标的反方向”找一个可走点
  const ang = Math.atan2(n.y - t.y, n.x - t.x);
  let dest = null;
  for (let k = 0; k < 6; k++) {
    const a = ang + (Math.random() - 0.5) * 0.8;
    const px = n.x + Math.cos(a) * 80, py = n.y + Math.sin(a) * 80;
    const c = worldToCell(px, py);
    if (walkable(c.row, c.col) && !overlapsUnit(n, px, py)) { dest = { x: px, y: py }; break; }
  }
  n.dir = dirFromVec(n.x - t.x, n.y - t.y);
  if (dest) moveEntity(n, dest.x, dest.y, speed, true);
  else moveEntity(n, n.x + Math.cos(ang) * 40, n.y + Math.sin(ang) * 40, speed, true);
  setAnim(n, "run");
  return {};
});

// 协助：附近同阵营单位正在被打 -> 把目标切到攻击者并追击。
registerAction("assist", (rt, bb, params, dt) => {
  const n = bb.self;
  const radius = params.radius === undefined ? 300 : params.radius;
  const a = findAllyInCombat(rt, bb, radius);
  if (a && a.attacker) { bb.target = a.attacker; bb.state.aggroT = 0; }
  // 立即按追击/攻击处理本帧
  const t = bb.target;
  if (!t) { setAnim(n, "stand"); return {}; }
  return ACTIONS.chase(rt, bb, { stopRange: "melee" }, dt);
});

// 守卫：在 home 附近，超出 leash 则回防，否则按攻击/待机。
registerAction("guard", (rt, bb, params, dt) => {
  const n = bb.self, t = bb.target;
  const home = (n.homeX != null && n.homeY != null) ? { x: n.homeX, y: n.homeY }
                                                    : (bb.home || { x: n.x, y: n.y });
  // 守卫的拴绳距离优先取 AI 配置的 leashFrom（表驱动），否则用参数/缺省。
  const tg = (bb.plan && bb.plan.targeting) || {};
  const leash = params.leash !== undefined ? params.leash
               : (tg.leashFrom != null && tg.leashFrom > 0 ? tg.leashFrom : 260);
  if (Math.hypot(n.x - home.x, n.y - home.y) > leash) { bb.target = null; return returnTo(rt.ctx, n, home, dt); }
  if (!t || t.dead) return ACTIONS.idle(rt, bb, params, dt);
  const d = Math.hypot(t.x - n.x, t.y - n.y);
  if (d <= (rt.ctx.config.combat.npcMelee || 46)) return ACTIONS.attack(rt, bb, { cooldown: 1.1 }, dt);
  return ACTIONS.chase(rt, bb, { stopRange: "melee" }, dt);
});

// 回到某点（用于守卫回防）。
// 取单位的出生/巡逻锚点（spawnNPC 写入并经过 placeFree 校正）。
function homeOf(bb) {
  const n = bb.self;
  if (n && n.homeX != null && n.homeY != null) return { x: n.homeX, y: n.homeY };
  return bb.home || (n ? { x: n.x, y: n.y } : { x: 0, y: 0 });
}

function returnTo(ctx, n, home, dt) {
  const done = goTo(ctx, n, home.x, home.y, "walk", 12, dt);
  if (done) setAnim(n, "stand");
  else { n.dir = dirFromVec(home.x - n.x, home.y - n.y); setAnim(n, "walk"); }
  return {};
}

// ---- AI 运行时适配器 ----
// 依据 ctx 与黑板，执行动作并处理索敌/丢失。
// engine/ai.js 需要一个“AI 上下文”：除真实 ctx 的 state/assets/config 外，
// 还提供 dist / resolveRange / allyBeingAttacked / nearbyCount 等条件依赖。
export function createAiRuntime(ctx) {
  const table = (ctx.assets && ctx.assets.factionTable) || null;
  const aiCtx = makeAiContext(ctx, table);
  return {
    ctx: aiCtx,
    // 单位是否应当与目标脱离。
    //   - 目标死亡 / 丢失
    //   - 超出 leash（自身与目标的直线距离）
    //   - 超出 leashFrom（自身离开出生点/巡逻锚点太远，即"追得太远"）
    //   - 超出 giveUpT（追了太久，仇恨衰减到消失）
    lost(bb, t) {
      const n = bb.self;
      if (!t || t.dead) return true;
      const tg = (bb.plan && bb.plan.targeting) || {};
      const leash = tg.leash != null ? tg.leash : 480;
      if (leash > 0 && Math.hypot(n.x - t.x, n.y - t.y) > leash) return true;
      // 离开锚点（出生/巡逻点）太远 → 放弃追击，返回原地
      const leashFrom = tg.leashFrom != null ? tg.leashFrom : leash;
      if (leashFrom > 0 && n.homeX != null && n.homeY != null) {
        if (Math.hypot(n.x - n.homeX, n.y - n.homeY) > leashFrom) return true;
      }
      // 追击超时 → 仇恨消失（giveUpT，单位：秒）
      const giveUpT = tg.giveUpT != null ? tg.giveUpT : 8;
      if (giveUpT > 0 && (bb.state.aggroT || 0) > giveUpT) return true;
      return false;
    },
    // 目标是否仍应保留（阵营/敌对关系可能被脚本动态改变）
    canKeep(bb, t) { return canAttack(bb.self, t, table); },
    // 仇恨衰减：长时间没被攻击，就忘掉 lastAttacker。
    // 由 stepAi 每帧调用，避免"打过一次就永远记仇"。
    decayAggro(bb, dt) {
      const n = bb.self;
      if (!n.lastAttacker) return;
      const tg = (bb.plan && bb.plan.targeting) || {};
      // 仇恨记忆时长：默认取 giveUpT 的 2 倍，至少 6 秒。
      const memT = Math.max(6, (tg.giveUpT != null ? tg.giveUpT : 8) * 2);
      const now = ctx.state.time || 0;
      const since = n.aggroAt != null ? now - n.aggroAt : memT + 1;
      if (since > memT) { n.lastAttacker = null; n.aggroAt = null; }
    },
    pickTarget(bb) {
      const n = bb.self;
      // 只有“具备攻击力 + 有索敌半径”的单位才主动索敌
      const plane = bb.plan ? bb.plan.targeting : null;
      const aggroRange = plane ? plane.aggroRange : 0;
      if (aggroRange <= 0) return null;
      const units = collectUnits(ctx, n);
      // 优先报复攻击者（retaliate）。
      // **必须同样受 aggroRange 约束**：否则玩家打了地图另一头的一只怪，
      // 全图所有该阵营单位都会靠 lastAttacker 直奔玩家（"全图怪都来打我"）。
      if (plane.retaliate && n.lastAttacker && !n.lastAttacker.dead && canAttack(n, n.lastAttacker, table)) {
        const a = n.lastAttacker;
        if (Math.hypot(n.x - a.x, n.y - a.y) <= aggroRange) return a;
      }
      return nearestHostile(n, units, table, aggroRange);
    },
    run(bb, action, params, dt) {
      const fn = ACTIONS[action] || ACTIONS.idle;
      return fn(this, bb, params || {}, dt) || {};
    },
  };
}

// AI 上下文：包装真实 ctx，补充条件原语所需的辅助函数。
function makeAiContext(ctx, table) {
  return {
    state: ctx.state, assets: ctx.assets, config: ctx.config, map: ctx.map,
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    resolveRange: (v, bb) => resolveRange(v, bb, { cfg: ctx.config.combat || {} }),
    allyBeingAttacked: (bb, radius) => !!findAllyInCombat({ ctx, _table: table }, bb, radius),
    nearbyCount: (bb, side, radius) => countNearby(ctx, table, bb.self, side, radius),
  };
}

// 统计某单位附近某类单位的数量（hostile=敌对 / ally=同阵营）。
function countNearby(ctx, table, self, side, radius) {
  if (!self) return 0;
  let c = 0;
  for (const u of collectUnits(ctx, self)) {
    if (!u || u.dead) continue;
    if (Math.hypot(u.x - self.x, u.y - self.y) > radius) continue;
    const hostile = isHostile(self, u, table);
    if (side === "hostile" ? hostile : !hostile) c++;
  }
  return c;
}

function collectUnits(ctx, exclude) {
  const g = ctx.state, out = [];
  if (g.player && g.player !== exclude) out.push(g.player);
  for (const u of g.npcs) if (u !== exclude) out.push(u);
  return out;
}

// 找一个“附近正在被攻击的同阵营单位”，返回 { ally, attacker }。
// 接受 { ctx } 形式的适配器对象（与 rt 兼容）。
export function findAllyInCombat(rt, bb, radius) {
  const ctx = rt.ctx, n = bb.self, table = (ctx.assets && ctx.assets.factionTable) || null;
  if (!n) return null;
  const units = collectUnits(ctx, n);
  for (const u of units) {
    if (!u || u.dead || u === n) continue;
    if (isHostile(n, u, table)) continue;                    // 只关心同阵营
    if (Math.hypot(u.x - n.x, u.y - n.y) > radius) continue;
    const attacker = u.lastAttacker;
    if (attacker && !attacker.dead && isHostile(n, attacker, table)) return { ally: u, attacker };
  }
  return null;
}
