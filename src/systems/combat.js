// 战斗：命中/伤害公式、玩家攻击、死亡与掉落。运行时上下文 ctx 由调用方注入。
import { dirFromVec, worldToCell } from "../core/utils.js";
import { skillByName } from "../core/registry.js";
import { setAnim, moveEntity, actionDuration, updateMove, canRun, walkSpeed, runSpeed } from "./motion.js";
import { findPathPoints } from "../world/pathfinding.js";
import { addExp, wearEquip } from "./inventory.js";
import { dropGround } from "../systems/ground.js";
import { startScript } from "../script/vm.js";
import { canAttack } from "../engine/faction.js";
import { rollDrops } from "../engine/lootTable.js";
import { monsterMults, scaleBy, difficultyById } from "../engine/difficulty.js";
import { skillRange as skRange, rollAttackHit, damage as dmgFormula, damageRangeMitigation as dmgRangeMitigation } from "../engine/skill.js";
import { normalizeTargeting, selectTargets, needsPrimary, isSelfOnly, tickCooldowns, isReady, startCooldown, knockbackTarget, hasCharge, spendCharge } from "../engine/targeting.js";
import { applySynergy } from "../engine/skill.js";
import { spawnProjectile } from "./projectiles.js";
import { spawnFx } from "./effects.js";
import { playBuffFx } from "./buffs.js";
import { statMods, applyBuff } from "../engine/buff.js";
import { resolveDamage, applyDamageBonus, DEFAULT_DAMAGE_TYPE, isImmune } from "../engine/damage.js";
import { armorKAt } from "../engine/balance.js";
import { pushFloat, makeDamageFloat } from "../engine/floatText.js";

// 阵营关系表（内容内置，只读）；缺失时 canAttack 退化为“有攻击力即可”。
const factionTable = ctx => (ctx.assets && ctx.assets.factionTable) || null;
// 玩家能否攻击目标：阵营敌对 + 目标未死。
export function playerCanAttack(ctx, t) {
  const p = ctx.state.player;
  if (!p) return false;
  return canAttack({ ...p, isPlayer: true, attackable: true, faction: p.faction || "player" }, t, factionTable(ctx));
}

export function skillRange(ctx) {
  const sk = skillByName(ctx, ctx.state.skill);
  return sk ? skRange(sk, ctx.config.combat.rangeMin) : ctx.config.combat.rangeMin;
}

export function dealDamage(atk, power, def, variance, opts) {
  const o = opts || {};
  // 两种护甲模型共存，由 config.combat.armorModel 选（默认 linear = 旧行为）：
  //   linear      ：atk + power - def/2（旧公式，def 接近 atk 时伤害塌到 1）
  //   mitigation  ：攻击 × (1 - armor/(armor+K))（单调、无断崖）
  // 切换模型会改变所有战斗数值手感，所以用开关而不是直接替换：
  // 旧存档/旧内容不改配置就能完全保持原样。
  if (o.armorModel === "mitigation") {
    const [lo, hi] = dmgRangeMitigation(atk, power, def, variance, { armorK: o.armorK });
    // 与旧公式一致：variance 省略时退化为固定值（取中位数）。
    if (!isFinite(variance) || variance <= 0) return Math.round((lo + hi) / 2);
    const rnd = o.randomFn || Math.random;
    return lo + Math.floor(rnd() * (hi - lo + 1));
  }
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

// “保持面朝”：这一帧不发起新挥砍，只把手臂留在攻击姿势上。
//
// 以前这里是三段复制粘贴的 `p.atkT = 0.08; ...`，没有重置动画帧，
// 导致一个很明显的 bug：上一刀的最后一击如果没播完（目标先死了 /
// 冷却没走完 / 技能没就绪），马上切去砍另一个敌人时，新的一刀会接着
// 旧帧往后续播，**不会从首帧开始**——视觉上就是“抬手抬到一半就又砍下去”。
//
// 原因在 setAnim：它只在 action 名字变化时才重置帧。而这里新旧都是
// "fight"，名字没变，于是 setAnim 什么都不做。
//
// 这里显式把帧推回 0。stillSwing 为真时不动：那是“这一刀还没播完”，
// 本来就应该继续播到结束（挥砍提交机制）。
function holdFightPose(p, stillSwing) {
  p.atkT = 0.08; p.swingTotal = 0.08; p.swingT = 0;
  p.hitPending = false; p.animSpeed = 1;
  if (!stillSwing) { p.action = "fight"; p.frame = 0; p.ft = 0; }
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
  // 冷却中：保持面朝。此时上一刀已经在 atkT<=0 时播完了，下一次出手必须从首帧开始。
  if (p.attackCD > 0) { holdFightPose(p, false); return; }

  const sk = skillByName(ctx, G.skill) || { power: 0, mp: 0 };
  // 技能级冷却（阶段 D）：冷却中不发起新攻击（保持面朝）。
  if (sk.name && !isReady(p, sk)) {
    holdFightPose(p, false);
    return;
  }
  // 充能型技能：没有充能时不发起攻击（与冷却中同样"保持面朝"）。
  if (sk.name && !hasCharge(p, sk)) {
    holdFightPose(p, false);
    return;
  }
  // 资源消耗：支持 mp/hp/none（旧逻辑只认 mp）。
  if (resourceCost(sk, G) > 0) { p.target = null; G.tip = "精力不足"; G.tipT = 2; return; }
  payResource(sk, G);
  // 攻击时才扣充能：施放被打断（目标丢失等）不该白白消耗。
  if (sk.name) spendCharge(p, sk);
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
  const cbt = ctx.config.combat || {};
  const variance = cbt.damageVariance;
  // 护甲 K 按**被攻击者（target）**的等级取，而不是攻击者的。
  //
  // 护甲减免是“这身护甲在当前位置有多护人”的属性，它随 **穿护甲的人** 的等级
  // 缩放；用攻击者的等级算 K 会在跨级战斗时完全失真（lv1 玩家打 lv25 怪，
  // 却拿 lv1 的 K 去削怪的高等级护甲，护甲几乎无效）。
  const targetLv = (target && target.level) || (ctx.state.stats && ctx.state.stats.level) || 1;
  const armorK = (ctx.config.balance && ctx.config.balance.curve)
    ? armorKAt(targetLv, ctx.config.balance.curve)
    : undefined;
  const raw = dealDamage((o.atk || 0) + am.atk, power, def, variance, {
    armorModel: cbt.armorModel,
    armorK,
  });
  // 元素/抗性结算：先应用攻方的伤害加成（词缀），再按守方抗性减免。
  // 未标注类型的技能一律按物理处理，行为与旧版一致。
  const dtype = (sk && sk.damageType) || DEFAULT_DAMAGE_TYPE;
  const bonus = attacker && attacker.dmgBonus;
  const boosted = applyDamageBonus(raw, dtype, bonus);
  const res = resolveDamage([{ type: dtype, amount: boosted }], target, {
    maxResist: ctx.config.combat && ctx.config.combat.maxResist,
  });
  // 完全免疫（抗性>=100 或被全部吸收）时伤害为 0，但仍然算“打中了”。
  const amount = res.total;
  const dead = amount > 0 ? applyDamage(ctx, target, amount, attacker) : false;
  // 伤害数字：按类型着色上浮。免疫（抗性>=100）单独显示“免疫”而不是 0，
  // 否则玩家会以为是漏伤害。这里只负责生成数据，绘制在 render 层。
  spawnDamageFloat(ctx, target, {
    amount,
    type: dtype,
    immune: isImmune(target, dtype),
  });
  // 命中施加 buff / 治疗 / 击退（阶段 C/D）。
  applyOnHit(ctx, attacker, target, sk);
  return { hit: true, dmg: amount, dead };
}

// 生成一条浮动伤害数字。
//
// 数据挂在单位自己身上（n.floats）而不是全局列表：这样单位被移除（死亡清场、
// 切图）时数字自然一起消失，不需要额外的清理/关联逻辑。
// 玩家自己也有 floats（被反击时同样要看到数字）。
function spawnDamageFloat(ctx, target, hit) {
  if (!target) return;
  const cfg = (ctx.config && ctx.config.floatText) || {};
  if (cfg.enabled === false) return;
  if (!Array.isArray(target.floats)) target.floats = [];
  pushFloat(target.floats, makeDamageFloat({
    amount: hit.amount,
    type: hit.type,
    x: target.x,
    y: target.y,
    immune: hit.immune,
  }, { colors: cfg.colors, offsetY: cfg.offsetY }), {
    maxCount: cfg.maxCount,
    mergeWindow: cfg.mergeWindow,
  });
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

// 技能名 -> 定义表（供 tickCharges 查每个技能的 recharge）。
// 按 ctx 缓存：同一帧里对多个单位复用，避免每个单位都重建一遍。
export function skillMap(ctx) {
  const list = (ctx.assets && ctx.assets.skills) || [];
  if (ctx._skillMapSrc === list) return ctx._skillMap;
  const m = {};
  for (const s of list) if (s && s.name) m[s.name] = s;
  ctx._skillMapSrc = list; ctx._skillMap = m;
  return m;
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
    // 装备耐久：受击时磨损（config.items.durabilityLossOnHit）。
    //
    // 以前这条链是断的：engine 有 wearDurability / isBroken，
    // systems/inventory.js 有 wearEquip，config 有旋钮，编辑器也把它
    // 摆给了策划，铁匠甚至有「修理」——但**没有任何地方调 wearEquip**，
    // 所以耐久永远不掉，那 4 件带 maxDurability 的装备（逆龙剑/冷泉剑/
    // 诛仙剑/霸王战袍）的耐久字段是死的，铁匠修理也永远提示“无需修理”。
    //
    // 只扣装备栏（G.equip），不扣背包——背包里的东西没在“用”。
    const loss = (ctx.config && ctx.config.items && ctx.config.items.durabilityLossOnHit) || 0;
    if (loss > 0) for (const k in (g.equip || {})) wearEquip(g, k, loss);
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
  // 难度倍率：经验与掉落都按当前难度放大。
  // 注意伤害/血量已经在 spawnNPC 时烘进单位了，这里只处理"击杀结算"部分。
  // drop 倍率**故意小于** hp/damage 倍率（见 engine/difficulty.js），
  // 否则最优解永远是无脑开最高难度。
  const dmul = monsterMults(difficultyById(ctx.config && ctx.config.difficulties, G.difficulty));
  addExp(G, scaleBy(n.exp, dmul.exp));
  G.stats.honor += 1;
  // 掉落由数据驱动（npcs.json 的 drops 字段）。经掉落表 roll，支持几率/数量区间/词缀。
  // 缩放旋钮来自 config.economy（dropRate/players）+ NPC 自身 level，见 engine/lootScale.js。
  const defs = {};
  for (const it of (A.items || [])) defs[it.name] = it;
  const eco = (ctx && ctx.config && ctx.config.economy) || {};
  const scale = {
    monsterLevel: n.level || 1,
    // 难度掉落倍率与经济的 dropRate 相乘（两者是独立的旋钮）。
    dropRate: (eco.dropRate == null ? 1 : eco.dropRate) * dmul.drop,
    players: eco.players == null ? 1 : eco.players,
    levelStep: eco.rarityLevelStep == null ? 5 : eco.rarityLevelStep,
    strength: eco.rarityStrength == null ? 0.5 : eco.rarityStrength,
  };
  // 掉率为 0 时直接跳过 roll（省掉无意义的随机与实例构造）。
  if (scale.dropRate > 0) {
    for (const e of rollDrops(n.drops || [], defs, null, A.affixes || [], scale, A.uniques || [], A.sets || [])) dropGround(G, e, n.x, n.y);
  }
  for (const k in G.missions) { const m = G.missions[k];
    if (m.type === 1 && m.target === n.name && m.state === 4) { m.got++; if (m.got >= m.need) m.state = 1; } }
  const ds = n.name + "_死.gsp";
  if (A.scripts[ds] && !G.script) startScript(ctx, ds);
}

// 玩家对自己释放技能（type 0 = 治疗）
export function castSelf(ctx) {
  const G = ctx.state;
  const p = G.player; if (!p) return;
  const sk = skillByName(ctx, G.skill); if (!sk) return;
  // 被动技能不能主动施放（它只通过 synergy 给别的技能加成）。
  if (sk.passive) return;
  // 技能级冷却：原先这条路径完全没接冷却，导致带 cooldown 的治疗/自身技能
  // 可以无限连放（攻击路径有 isReady，自身施法漏了）。
  if (!isReady(p, sk)) { G.tip = "冷却中"; G.tipT = 1.2; return; }
  // 充能型技能：没有充能就不能放。
  if (!hasCharge(p, sk)) { G.tip = "充能未就绪"; G.tipT = 1.2; return; }
  const cost = resourceCost(sk, G);
  if (cost > 0) { G.tip = "精力不足"; G.tipT = 2; return; }
  payResource(sk, G);
  spawnEffect(ctx, sk, p.x, p.y);
  if (sk.type === 0) {
    // 协同加成也作用于治疗量，保持"加成的都是技能主数值"这一直觉。
    const lv = skillLevels(G);
    const power = applySynergy(sk, lv).power || sk.power || 0;
    G.stats.hp = Math.min(G.stats.hpMax, G.stats.hp + Math.max(40, power));
    G.tip = "疗伤"; G.tipT = 2;
  }
  // 施放成功才进冷却 / 扣充能（失败不该惩罚玩家）。
  startCooldown(p, sk);
  spendCharge(p, sk);
  p.action = "fight"; p.frame = 0; p.ft = 0; p.attackCD = 0.9;
}

// ---- 资源消耗（P3）----
// 旧逻辑只认 mp 且写死"精力不足"，现在支持 resource = mp/hp/none。
// 返回还需要补多少资源（0 = 够用）。
export function resourceCost(sk, G) {
  if (!sk) return 0;
  const res = sk.resource || "mp";
  if (res === "none") return 0;
  const need = sk.mp || 0;
  if (res === "hp") return Math.max(0, need - G.stats.hp);
  return Math.max(0, need - G.stats.mp);
}

// 扣资源。hp 型技能不会把自己扣死（至少留 1 点）。
export function payResource(sk, G) {
  if (!sk) return;
  const res = sk.resource || "mp";
  const need = sk.mp || 0;
  if (res === "none" || need <= 0) return;
  if (res === "hp") G.stats.hp = Math.max(1, G.stats.hp - need);
  else G.stats.mp = Math.max(0, G.stats.mp - need);
}

// 已学技能等级表（供 synergy 计算）。技能等级沿用 setSkill 的记录，
// 没有等级记录的技能视为已学 1 级。
export function skillLevels(G) {
  const out = {};
  for (const name of (G.skills || [])) {
    const lv = (G.skillLevels && G.skillLevels[name]) || 1;
    out[name] = Math.max(0, lv | 0);
  }
  return out;
}
