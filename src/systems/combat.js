// 战斗：命中/伤害公式、玩家攻击、死亡与掉落。运行时上下文 ctx 由调用方注入。
import { dirFromVec, worldToCell } from "../core/utils.js";
import { skillByName } from "../core/registry.js";
import { setAnim, moveEntity, actionDuration, updateMove } from "./motion.js";
import { findPathPoints } from "../world/pathfinding.js";
import { addExp } from "./inventory.js";
import { dropGround } from "../world/ground.js";
import { startScript } from "../script/vm.js";

export function skillRange(ctx) {
  const sk = skillByName(ctx.state.skill);
  return sk ? Math.max(ctx.config.combat.rangeMin, sk.range) : ctx.config.combat.rangeMin;
}

// 忠实还原 exe：roll = Random(100)（MINSTD 0x429300）；若 role+0x64>0 则 roll=(roll²)%100；
// 命中条件 roll <= role+0xa8c（命中率，上限 100）。
export function rollHit(hitRate, square) {
  let roll = Math.floor(Math.random() * 100);
  if (square) roll = (roll * roll) % 100;
  return roll <= Math.max(0, Math.min(100, hitRate));
}
export function dealDamage(atk, power, def) { return Math.max(1, atk + power - Math.floor(def / 2)); }

export function spawnEffect(ctx, sk, x, y) {
  if (!sk || !sk.frames || !sk.frames.length) return;
  ctx.state.effects.push({ frames: sk.frames, x, y, i: 0, t: 0 });
}

// 命中结算发生在挥砍动画的哪个位置（0=起手，1=收尾）。
export const HIT_FRACTION = 0.45;

// 挥砍中段的伤害/特效结算（玩家）。
function applyPlayerHit(ctx, p) {
  const G = ctx.state;
  const t = p.swingTarget, sk = p.swingSkill || { power: 0 };
  p.hitPending = false;
  if (!t || t.dead || !t.attackable) return;
  spawnEffect(ctx, sk, t.x, t.y);
  if (sk.type === 0) { G.stats.hp = Math.min(G.stats.hpMax, G.stats.hp + 40); return; }
  if (rollHit(G.stats.hit, false)) {
    t.hp -= dealDamage(G.stats.attack, sk.power || 0, t.def);
    t.dmgT = 0.4;
    if (t.hp <= 0) killNPC(ctx, t);
  }
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
    if (p.atkT <= 0 && (!t || t.dead || !t.attackable)) {
      p.target = null; p.chaseTarget = null; p.chaseCell = null;
      p.hitPending = false; p.swingTarget = null;
    }
    return;
  }

  if (!t || t.dead || !t.attackable) { p.target = null; p.atkT = 0; p.path = null; p.chaseTarget = null; p.chaseCell = null; p.hitPending = false; p.swingTarget = null; return; }
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
    const speed = p.running ? 150 : 90; p.speed = speed;
    if (p.path && p.path.length) updateMove(p, dt);
    else moveEntity(p, t.x, t.y, speed, true);
    setAnim(p, p.running ? "run" : "walk");
    return;
  }
  p.path = null;                       // 进入射程：停步攻击

  p.moveGoal = null; setAnim(p, "fight"); faceTarget(p, t);
  if (p.attackCD > 0) { p.atkT = 0.08; p.swingTotal = 0.08; p.swingT = 0; p.hitPending = false; p.animSpeed = 1; return; }   // 冷却中：保持面朝并继续播放攻击帧

  const sk = skillByName(G.skill) || { power: 0, mp: 0 };
  if (sk.mp && G.stats.mp < sk.mp) { p.target = null; G.tip = "精力不足"; G.tipT = 2; return; }
  if (sk.mp) G.stats.mp -= sk.mp;
  const dur = actionDuration(p, "fight", ctx.assets.chars);
  const interval = Math.max(0.25, CFG.combat.attackCD);   // 攻击间隔（招式节奏）
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

const DROPS = { "野猴": ["猴皮", "猴肉"], "花豹": ["豹牙", "豹肉"] };

export function killNPC(ctx, n) {
  const G = ctx.state, A = ctx.assets;
  n.dead = true; n.dieT = 0; n.path = null; n.target = null;
  if (n.atkT > 0) { n.pendingDie = true; n.hitPending = false; }   // 正在挥砍：先把这一刀打完再倒地
  else { n.action = "die"; n.frame = 0; n.ft = 0; n.animSpeed = 1; }
  addExp(G, n.exp);
  G.stats.honor += 1;
  const drops = (n.drops && n.drops.length) ? n.drops : (DROPS[n.name] || []).map(x => ({ name: x, count: 1 }));
  for (const d of drops) {
    const nm = typeof d === "string" ? d : d.name;
    const ct = typeof d === "string" ? 1 : (d.count || 1);
    if (nm) dropGround(G, nm, n.x, n.y, ct);
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
  const sk = skillByName(G.skill); if (!sk) return;
  if (sk.mp && G.stats.mp < sk.mp) { G.tip = "精力不足"; G.tipT = 2; return; }
  if (sk.mp) G.stats.mp -= sk.mp;
  spawnEffect(ctx, sk, p.x, p.y);
  if (sk.type === 0) { G.stats.hp = Math.min(G.stats.hpMax, G.stats.hp + Math.max(40, sk.power || 0)); G.tip = "疗伤"; G.tipT = 2; }
  p.action = "fight"; p.frame = 0; p.ft = 0; p.attackCD = 0.9;
}
