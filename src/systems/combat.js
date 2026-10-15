// 战斗：命中/伤害公式、玩家攻击、死亡与掉落。运行时上下文 ctx 由调用方注入。
import { dirFromVec } from "../core/utils.js";
import { skillByName } from "../core/registry.js";
import { setAnim, moveEntity, actionDuration } from "./motion.js";
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

export function playerAttackTarget(ctx) {
  const G = ctx.state, CFG = ctx.config;
  const p = G.player, t = p.target;
  if (!t || t.dead || !t.attackable) { p.target = null; p.atkT = 0; return; }
  const d = Math.hypot(t.x - p.x, t.y - p.y);
  const range = skillRange(ctx);
  if (p.attackCD > 0) p.attackCD -= 1 / 60;

  // 攻击“提交”机制：一旦开始一次攻击，就先把整段攻击动画播完（约 0.5s），
  // 期间即使目标（猴子等）小幅移动也不切回 run/walk，消除动画闪烁。
  if (p.atkT > 0) {
    p.atkT -= 1 / 60;
    setAnim(p, "fight");
    faceTarget(p, t);
    return;
  }

  if (d > range) {                     // 追击：朝向交给 moveEntity 的平滑速度，避免每帧翻转
    p.moveGoal = t;
    moveEntity(p, t.x, t.y, p.running ? 150 : 90, true);
    setAnim(p, p.running ? "run" : "walk");
    return;
  }

  p.moveGoal = null; setAnim(p, "fight"); faceTarget(p, t);
  if (p.attackCD > 0) { p.atkT = 0.08; return; }   // 冷却中：保持面朝并继续播放攻击帧

  const sk = skillByName(G.skill) || { power: 0, mp: 0 };
  if (sk.mp && G.stats.mp < sk.mp) { p.target = null; G.tip = "精力不足"; G.tipT = 2; return; }
  if (sk.mp) G.stats.mp -= sk.mp;
  const dur = actionDuration(p, "fight", ctx.assets.chars);
  p.atkT = Math.max(0.5, dur - 0.1);
  p.attackCD = Math.max(p.atkT, CFG.combat.attackCD);
  spawnEffect(ctx, sk, t.x, t.y);
  if (sk.type === 0) { G.stats.hp = Math.min(G.stats.hpMax, G.stats.hp + 40); return; }
  // 只要发起攻击就拉仇恨（即使这一下未命中），敌人会立即开始反击。
  t.aggro = true;
  if (rollHit(G.stats.hit, false)) {
    t.hp -= dealDamage(G.stats.attack, sk.power || 0, t.def);
    t.dmgT = 0.4;
    if (t.hp <= 0) killNPC(ctx, t);
  }
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
  n.action = "die"; n.frame = 0; n.ft = 0;
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
