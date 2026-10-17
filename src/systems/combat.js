// 战斗：命中/伤害公式、玩家攻击、死亡与掉落。运行时上下文 ctx 由调用方注入。
import { dirFromVec, worldToCell } from "../core/utils.js";
import { skillByName } from "../core/registry.js";
import { setAnim, moveEntity, actionDuration, updateMove, canRun, walkSpeed, runSpeed } from "./motion.js";
import { findPathPoints } from "../world/pathfinding.js";
import { addExp } from "./inventory.js";
import { dropGround } from "../systems/ground.js";
import { startScript } from "../script/vm.js";
import { canAttack } from "../engine/faction.js";
import { rollDrops } from "../engine/lootTable.js";
import { skillRange as skRange, rollAttackHit, damage as dmgFormula } from "../engine/skill.js";
import { normalizeTargeting, selectTargets, needsPrimary, isSelfOnly, tickCooldowns, isReady, startCooldown, knockbackTarget } from "../engine/targeting.js";
import { spawnProjectile } from "./projectiles.js";
import { spawnFx } from "./effects.js";
import { playBuffFx } from "./buffs.js";
import { statMods, applyBuff } from "../engine/buff.js";

// 阵营关系表（内容内置，只读）；缺失时 canAttack 退化为“有攻击力即可”。
const factionTable = ctx => (ctx.assets && ctx.assets.factionTable) || null;
// 玩家能否攻击目标：阵营敌对 + 目标未死。
export function playerCanAttack(ctx, t) {
  const p = ctx.state.player;
  if (!p) return false;
  return canAttack({ ...p, isPlayer: true, attackable: true, faction: p.faction || "player" }, t, factionTable(ctx));
}

export function skillRange(ctx) {
  const sk = skillByName(ctx.state.skill);
  return sk ? skRange(sk, ctx.config.combat.rangeMin) : ctx.config.combat.rangeMin;
}

export function dealDamage(atk, power, def, variance) {
  return dmgFormula(atk, power, def, variance);   // variance 省略则退化为固定值
}

// 结算瞬间的射程判定（命中与否只看"这一刻目标还在不在范围+缓冲内"）。
// 近战用 combat.meleeMaxRange，远程用技能射程；两者都加 combat.hitBuffer 缓冲。
export function attackReach(ctx, sk) {
  const C = ctx.config.combat || {};
  const base = sk && sk.range > 0 ? Math.max(C.rangeMin || 0, sk.range) : (C.meleeMaxRange || C.npcMelee || 46);
  return { range: base, buffer: C.hitBuffer == null ? 40 : C.hitBuffer };
}

export function spawnEffect(ctx, sk, x, y, anchor, follow) {
  // 新特效系统：技能可用 fx.hit 指定特效定义 id（或 fx 直接为 id）。
  const fxDef = sk && sk.fx;
  const fxId = typeof fxDef === "string" ? fxDef : (fxDef && (fxDef.hit || fxDef.cast));
  if (fxId) {
    spawnFx(ctx, fxId, { x, y, anchor: anchor || (follow ? "unit" : "world"), follow: follow || null });
    return;
  }
  // 兼容旧路径：技能自带 frames（贴图序列）作为命中特效。
  if (!sk || !sk.frames || !sk.frames.length) return;
  ctx.state.effects.push({ frames: sk.frames, x, y, i: 0, t: 0 });
}

// 命中结算发生在挥砍动画的哪个位置（0=起手，1=收尾）。
export const HIT_FRACTION = 0.45;

// 挥砍中段的伤害/特效结算（玩家）。
function applyPlayerHit(ctx, p) {
  const G = ctx.state;
  const t = p.swingTarget, sk = p.swingSkill || { power: 0, mode: "melee" };
  p.hitPending = false;
  if (!t || t.dead || !playerCanAttack(ctx, t)) return;
  // AOE / 多目标技能：走统一的目标选择入口（castSkill）。
  const tg = normalizeTargeting(sk.targeting);
  if (tg.aoe || isSelfOnly(tg) || tg.kind === "ally" || tg.kind === "point") {
    castSkill(ctx, p, t, sk, { atk: G.stats.attack });
    return;
  }
  if (sk.type === 0) {
    spawnEffect(ctx, sk, p.x, p.y);
    healUnit(ctx, p, Math.max(40, sk.power || 0));
    return;
  }
  // 远程 + 配置了弹道：发射一枚弹道，命中时机延后到飞行抵达时（伤害仍在 resolveHit）。
  if (sk.projectile) {
    spawnProjectile(ctx, p, t, sk, { params: { atk: G.stats.attack } });
    return;
  }
  resolveHit(ctx, p, t, sk, { atk: G.stats.attack });
}

export function playerAttackTarget(ctx, dt) {
  dt = dt || 1 / 60;
  const G = ctx.state, CFG = ctx.config;
  const p = G.player, t = p.target;
  if (p.attackCD > 0) p.attackCD -= dt;

  // 挥砍“提交”机制：一旦出手就把整段挥砍动画播完（**即使目标在挥砍中死亡**）；
  // 命中在动画中段结算。方向在出手时锁定，挥砍期间不再转向。
  // 注意：此分支必须在“目标失效”判定**之前**，否则最后一击杀死敌人时动画会被截断。
  if (p.atkT > 0) {
    p.atkT -= dt;
    p.swingT = (p.swingT || 0) + dt;
    if (p.atkT <= 0) p.animSpeed = 1;   // 挥砍结束，恢复正常速度
    setAnim(p, "fight");
    if (p.hitPending && p.swingT >= (p.swingTotal || 0) * HIT_FRACTION) applyPlayerHit(ctx, p);
    // 挥砍播完后，若目标已死亡/失效，再清理目标，让玩家回到站立。
    // 注意**不能清 p.path**：玩家可能在挥砍期间已点了新的移动目的地，那条路径不能被打断。
    if (p.atkT <= 0 && (!t || t.dead || !playerCanAttack(ctx, t))) {
      p.target = null; p.chaseTarget = null; p.chaseCell = null;
      p.hitPending = false; p.swingTarget = null;
    }
    return;
  }

  if (!t || t.dead || !playerCanAttack(ctx, t)) { p.target = null; p.atkT = 0; p.path = null; p.chaseTarget = null; p.chaseCell = null; p.hitPending = false; p.swingTarget = null; return; }
  const d = Math.hypot(t.x - p.x, t.y - p.y);
  const range = skillRange(ctx);

  if (d > range) {                     // 追击：路径寻路（绕开墙与其它单位）；不可达时才直走
    p.moveGoal = t;
    const tgt = worldToCell(t.x, t.y), cc = worldToCell(p.x, p.y);
    const needReplan = !p.path || !p.path.length || p.chaseTarget !== t || !p.chaseCell || p.chaseCell.row !== tgt.row || p.chaseCell.col !== tgt.col;
    if (needReplan) {
      const pts = findPathPoints(ctx, cc.row, cc.col, tgt.row, tgt.col, { avoidUnits: true, mover: p }, { x: p.x, y: p.y });
      p.path = (pts && pts.length) ? pts : null;
      p.chaseCell = tgt; p.chaseTarget = t;
    }
    const running = p.running && canRun(G);   // 精力为 0 → 追击也强制走路
    p.running = running;
    const speed = running ? runSpeed() : walkSpeed(); p.speed = speed;
    if (p.path && p.path.length) updateMove(p, dt);
    else moveEntity(p, t.x, t.y, speed, true);
    setAnim(p, running ? "run" : "walk");
    return;
  }
  p.path = null;                       // 进入射程：停步攻击

  p.moveGoal = null; setAnim(p, "fight"); faceTarget(p, t);
  if (p.attackCD > 0) { p.atkT = 0.08; p.swingTotal = 0.08; p.swingT = 0; p.hitPending = false; p.animSpeed = 1; return; }   // 冷却中：保持面朝并继续播放攻击帧

  const sk = skillByName(G.skill) || { power: 0, mp: 0 };
  // 技能级冷却（阶段 D）：冷却中不发起新攻击（保持面朝）。
  if (sk.name && !isReady(p, sk)) {
    p.atkT = 0.08; p.swingTotal = 0.08; p.swingT = 0; p.hitPending = false; p.animSpeed = 1;
    return;
  }
  if (sk.mp && G.stats.mp < sk.mp) { p.target = null; G.tip = "精力不足"; G.tipT = 2; return; }
  if (sk.mp) G.stats.mp -= sk.mp;
  const dur = actionDuration(p, "fight", ctx.assets.chars);
  // 攻击间隔 = 基础冷却 × 攻速系数。
  // attackSpeed 是百分比（100 = 基准）；越高越快，故用 100/(100+as) 收敛，
  // 保证不会因为堆攻速把间隔压到 0（下限 0.25s）。
  const as = Math.max(0, G.stats.attackSpeed || 0);
  const speedMul = 100 / (100 + as);
  const interval = Math.max(0.25, CFG.combat.attackCD * speedMul);   // 攻击间隔（招式节奏）
  p.atkT = interval;
  p.swingTotal = interval; p.swingT = 0;
  p.action = "fight"; p.frame = 0; p.ft = 0;               // 动画与挥砍计时同步从首帧开始
  p.animSpeed = dur / interval;                           // 动画配合间隔：间隔越短动画越快（反之变慢）
  p.hitPending = true; p.swingTarget = t; p.swingSkill = sk;
  p.attackCD = interval;
  // 只要发起攻击就拉仇恨（即使这一下未命中），敌人会立即开始反击。
  t.aggro = true;
}

// 面朝目标：只在“八方向格”真正变化时改 dir，且攻击期间不参与左右抽动（攻击目标不会自己跳格）。
export function faceTarget(e, t) {
  const nd = dirFromVec(t.x - e.x, t.y - e.y);
  if (e.dir !== nd) e.dir = nd;
}

// 命中结算的**唯一入口**（玩家 / NPC 共用）。
// 由调用方保证：attacker/target 均为有效单位，且 target 可被攻击。
// 返回 { hit, dmg, dead }。近战与远程在本阶段都“命中即瞬间结算”，
// 远程的弹道只是把“何时命中”延后 / 可视化（阶段 B），伤害逻辑不变。
export function resolveHit(ctx, attacker, target, sk, opts) {
  const o = opts || {};
  const mode = sk && sk.mode ? sk.mode : "melee";
  spawnEffect(ctx, sk, target.x, target.y);
  // 治疗型技能（type 0）：本阶段仅玩家自疗，NPC 不用。
  if (sk && sk.type === 0) return { hit: true, dmg: 0, heal: true };
  // 命中判定：看**结算这一刻**目标是否还在「射程 + 缓冲带」内。
  // 站桩换血必定命中；只有目标在前摇期间被拉开距离才落空（War3 式）。
  const { range, buffer } = attackReach(ctx, sk);
  const dist = Math.hypot((target.x || 0) - (attacker.x || 0), (target.y || 0) - (attacker.y || 0));
  const hit = o.forceHit ? true : rollAttackHit(dist, o.reach == null ? range : o.reach, buffer);
  if (!hit) return { hit: false, dmg: 0 };
  const power = sk ? (sk.power || 0) : 0;
  // Buff 属性加成：攻方 atk +、守方 def +（按层数累加）。
  const am = statMods(attacker), dm = statMods(target);
  const def = (target.defence || target.def || 0) + dm.def;
  // 伤害在 [min,max] 内浮动（不再"没打中 0 伤害"）。
  const variance = ctx.config.combat && ctx.config.combat.damageVariance;
  const amount = dealDamage((o.atk || 0) + am.atk, power, def, variance);
  const dead = applyDamage(ctx, target, amount, attacker);
  // 命中施加 buff / 治疗 / 击退（阶段 C/D）。
  applyOnHit(ctx, attacker, target, sk);
  return { hit: true, dmg: amount, dead };
}

// 命中后效果：施加 buff（按概率）、命中治疗、击退。
function applyOnHit(ctx, attacker, target, sk) {
  const oh = sk && sk.onHit;
  if (!oh) return;
  if (Array.isArray(oh.buffs)) {
    for (const b of oh.buffs) {
      const chance = b.chance == null ? 100 : b.chance;
      if (Math.random() * 100 > chance) continue;
      const def2 = ctx.assets.buffTable && ctx.assets.buffTable.byId.get(b.id);
      if (def2) { applyBuff(target, def2, { stacks: b.stacks }); playBuffFx(ctx, target, def2, "apply"); }
    }
  }
  if (oh.heal && oh.heal.amount > 0) {
    healUnit(ctx, oh.heal.to === "target" ? target : attacker, oh.heal.amount);
  }
  if (oh.knockback && oh.knockback.dist > 0 && !target.dead && !(target.isPlayer || target === ctx.state.player)) {
    const dst = knockbackTarget(attacker, target, oh.knockback.dist);
    if (dst) { target.x = dst.x; target.y = dst.y; target.path = null; }
  }
}

// 治疗一个单位（玩家走 G.stats.hp，NPC 走 hp）。
export function healUnit(ctx, unit, amount) {
  const g = ctx.state;
  if (!unit || unit.dead || amount <= 0) return 0;
  const dl = statMods(unit);
  if (unit.isPlayer || unit === g.player) {
    const before = g.stats.hp;
    g.stats.hp = Math.min(g.stats.hpMax + dl.hpMax, g.stats.hp + amount);
    return g.stats.hp - before;
  }
  const before = unit.hp;
  unit.hp = Math.min((unit.hpMax || 0) + dl.hpMax, unit.hp + amount);
  return unit.hp - before;
}

// 施放一个带目标选择的技能（玩家与 NPC 共用）。
//   target: 主目标单位（单体必填；AOE 时作为范围中心；self 时忽略）
// 返回实际命中的单位数量。
// 与 resolveHit 的区别：这里负责“选中一批目标” + 技能冷却。具体命中/伤害委托 resolveHit。
// 注：AOE 目前即时结算（不经过弹道）；带 projectile 的 AOE 可后续扩展为“弹道命中后溅射”。
export function castSkill(ctx, attacker, target, sk, opts) {
  const o = opts || {};
  if (!sk) return 0;
  const table = factionTable(ctx);
  // 玩家实体本身没有 attackable/atk（攻击力在 G.stats 里），需注入才能通过 canAttack。
  const isPlayer = attacker && attacker === ctx.state.player;
  const armed = isPlayer ? { ...attacker, isPlayer: true, attackable: true, faction: attacker.faction || "player" } : attacker;
  const hostile = (a, b) => canAttack(a === ctx.state.player ? armed : a, b, table);
  const tg = normalizeTargeting(sk.targeting);
  const units = collectAllUnits(ctx);
  const targets = selectTargets(tg, attacker, target, units, hostile);
  if (!targets.length) return 0;
  // 技能级冷却：未就绪时不可施放。
  if (!o.ignoreCooldown && !isReady(attacker, sk)) return 0;
  let hits = 0;
  for (const t of targets) {
    if (sk.type === 0) {          // 治疗型技能
      spawnEffect(ctx, sk, t.x, t.y);
      healUnit(ctx, t, Math.max(40, sk.power || 0));
      hits++;
      continue;
    }
    if (o.forceHit || hostile(attacker, t)) {
      const r = resolveHit(ctx, attacker, t, sk, { atk: o.atk || 0 });
      if (r.hit) hits++;
    }
  }
  if (hits) startCooldown(attacker, sk);
  return hits;
}

// 收集场上所有可被选中的单位（含玩家，排除施法者由 selectTargets 处理）。
function collectAllUnits(ctx) {
  const g = ctx.state, out = [];
  if (g.player) out.push(g.player);
  for (const u of g.npcs) if (!u.dead) out.push(u);
  return out;
}

// 每帧推进单位技能冷却（由 buffSystem / 主循环调用）。
export { tickCooldowns };

// 对一个单位造成伤害（玩家 / NPC 均适用）。返回是否致死。
// 玩家致死保留“挥砍提交”语义（先播完这一刀再倒地）；NPC 致死走 killNPC。
export function applyDamage(ctx, victim, amount, source) {
  const g = ctx.state;
  if (!victim || victim.dead) return false;
  // 用于 AI 报复/协助。同时记录时间戳，供仇恨衰减使用
  // （否则 lastAttacker 永久保留 —— 打了地图一头的一只怪，
  //   全图同阵营单位都会一直把它当目标）。
  if (source && source !== victim) {
    victim.lastAttacker = source;
    victim.aggroAt = (ctx.state && ctx.state.time) || 0;
  }
  if (victim.isPlayer || victim === g.player) {
    g.stats.hp -= amount;
    if (g.stats.hp <= 0) {
      g.stats.hp = 0; victim.dead = true;
      // 玩家死亡同样立即打断挥砍
      victim.atkT = 0; victim.swingT = 0; victim.hitPending = false; victim.swingTarget = null; victim.animSpeed = 1;
      victim.action = "die"; victim.frame = 0; victim.ft = 0;
      return true;
    }
    return false;
  }
  victim.hp -= amount;
  victim.dmgT = 0.4;
  if (victim.hp <= 0) { killNPC(ctx, victim); return true; }
  return false;
}

export function killNPC(ctx, n) {
  const G = ctx.state, A = ctx.assets;
  n.dead = true; n.dieT = 0; n.path = null; n.target = null;
  // 死亡立即打断一切挥砍/追击状态：未播完的攻击帧、待结算的命中、残影移动都清掉，
  // 避免“尸体还在挥刀/还能出伤害”或残留 atkT 让单位卡在战斗帧。
  n.atkT = 0; n.swingT = 0; n.hitPending = false; n.swingTarget = null; n.animSpeed = 1;
  if (n.ai$) { n.ai$.target = null; if (n.ai$.state) { n.ai$.state.returning = 0; n.ai$.state.aggroT = 0; } }
  n.action = "die"; n.frame = 0; n.ft = 0;
  addExp(G, n.exp);
  G.stats.honor += 1;
  // 掉落由数据驱动（npcs.json 的 drops 字段）。经掉落表 roll，支持几率/数量区间/词缀。
  const defs = {};
  for (const it of (A.items || [])) defs[it.name] = it;
  for (const e of rollDrops(n.drops || [], defs, null, A.affixes || [])) dropGround(G, e, n.x, n.y);
  for (const k in G.missions) { const m = G.missions[k];
    if (m.type === 1 && m.target === n.name && m.state === 4) { m.got++; if (m.got >= m.need) m.state = 1; } }
  const ds = n.name + "_死.gsp";
  if (A.scripts[ds] && !G.script) startScript(ctx, ds);
}

// 玩家对自己释放技能（type 0 = 治疗）
export function castSelf(ctx) {
  const G = ctx.state;
  const p = G.player; if (!p) return;
  const sk = skillByName(G.skill); if (!sk) return;
  if (sk.mp && G.stats.mp < sk.mp) { G.tip = "精力不足"; G.tipT = 2; return; }
  if (sk.mp) G.stats.mp -= sk.mp;
  spawnEffect(ctx, sk, p.x, p.y);
  if (sk.type === 0) { G.stats.hp = Math.min(G.stats.hpMax, G.stats.hp + Math.max(40, sk.power || 0)); G.tip = "疗伤"; G.tipT = 2; }
  p.action = "fight"; p.frame = 0; p.ft = 0; p.attackCD = 0.9;
}
