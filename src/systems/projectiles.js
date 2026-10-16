// 运行时：弹道系统。把 engine/projectile.js 的纯逻辑接到“阵营 / 单位列表 / 命中结算”。
//
// 职责：
//  - spawnProjectile(ctx, attacker, target, sk)：按技能的 projectile 配置发射一枚弹道。
//  - projectileSystem(ctx, dt)：每帧推进所有弹道；命中时调用 combat.resolveHit。
//  - 命中过滤复用 canAttack（阵营敌对 + 存活），因此“只打敌人”天然成立。
import { stepProjectile, makeProjectile } from "../engine/projectile.js";
import { canAttack } from "../engine/faction.js";
import { resolveHit } from "./combat.js";

const factionTable = ctx => (ctx.assets && ctx.assets.factionTable) || null;

// 收集可被弹道命中的单位（发射者自身与死亡单位除外）。
function hitUnits(g, attacker) {
  const out = [];
  if (g.player && g.player !== attacker && !g.player.dead) out.push(g.player);
  for (const n of g.npcs) if (n !== attacker && !n.dead) out.push(n);
  return out;
}

// 发射：仅当技能为远程且配置了 projectile 时才创建；否则返回 null（调用方仍走瞬间结算）。
export function spawnProjectile(ctx, attacker, target, sk, opts) {
  const proj = sk && sk.projectile;
  if (!proj) return null;
  const p = makeProjectile(attacker, target, sk, proj, opts);
  const g = ctx.state;
  if (!g.projectiles) g.projectiles = [];
  g.projectiles.push(p);
  return p;
}

export function projectileSystem(ctx, dt) {
  const g = ctx.state;
  if (!g.projectiles || !g.projectiles.length) return;
  const table = factionTable(ctx);
  const api = {
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    units: () => hitUnits(g, null),
    canHit: (proj, u) => {
      if (u === proj.attacker || u.dead) return false;
      // 玩家实体本身不带 attackable，需注入；否则 canAttack 会因“无攻击力”拒绝。
      const atk = proj.attacker === g.player ? { ...proj.attacker, isPlayer: true, attackable: true, faction: proj.attacker.faction || "player" } : proj.attacker;
      // 阵营敌对才可命中：支持“只打敌人 / 只奶队友”由技能 targeting 决定（阶段 D 扩展）。
      return canAttack(atk, u, table) || (proj.params && proj.params.friendly);
    },
  };
  const alive = [];
  for (const proj of g.projectiles) {
    // 已抵达但尚未结算的目标（reach 时也会返回，见下）
    const victims = stepProjectile(proj, dt, api);
    for (const v of victims) {
      // 复用统一命中结算：弹道只负责“何时/对谁”，伤害逻辑仍在 combat.resolveHit。
      resolveHit(ctx, proj.attacker, v, proj.skill, proj.params);
      if (proj.onHit) proj.onHit(ctx, proj, v);
    }
    if (!proj.dead) alive.push(proj);
  }
  g.projectiles = alive;
}
