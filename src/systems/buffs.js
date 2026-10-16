// 运行时：Buff / Debuff 系统。
//  - 每帧推进所有单位（玩家 + NPC）的 buff 计时，到期的移除。
//  - 结算 DoT（走 combat.applyDamage，可击杀/记录仇恨）/ HoT（回血，不超上限）。
//  - 属性加成（mods）通过「派生值」计算：不改写基础值，避免反复叠加漂移。
//
// 与 combat.js 解耦：本模块只调用 applyDamage；技能命中时施加 buff 的逻辑在 combat.resolveHit。
import { tickBuffs, dotPerSecond, hotPerSecond } from "../engine/buff.js";
import { tickCooldowns } from "../engine/targeting.js";
import { applyDamage } from "./combat.js";

// 累加固定时间步的 DoT/HoT（浮点误差累积到 1 点以上才结算，避免每帧小数扣血）。
function accumulate(unit, dt) {
  const dot = dotPerSecond(unit), hot = hotPerSecond(unit);
  unit._dotAcc = (unit._dotAcc || 0) + dot * dt;
  unit._hotAcc = (unit._hotAcc || 0) + hot * dt;
}

function flushAccumulators(ctx, unit) {
  const g = ctx.state;
  if (unit._dotAcc >= 1) {
    const amt = Math.floor(unit._dotAcc);
    unit._dotAcc -= amt;
    applyDamage(ctx, unit, amt, unit._dotSource || null);
  }
  if (unit._hotAcc >= 1) {
    const amt = Math.floor(unit._hotAcc);
    unit._hotAcc -= amt;
    if (unit.isPlayer || unit === g.player) {
      g.stats.hp = Math.min(g.stats.hpMax, g.stats.hp + amt);
    } else if (!unit.dead) {
      unit.hp = Math.min(unit.hpMax, unit.hp + amt);
    }
  }
  // 单位死亡时清空 buff 累加器
  if (unit.dead) { unit._dotAcc = 0; unit._hotAcc = 0; }
}

export function buffSystem(ctx, dt) {
  const g = ctx.state;
  const units = [];
  if (g.player) units.push(g.player);
  for (const n of g.npcs) units.push(n);
  for (const u of units) {
    if (!u) continue;
    // 技能冷却每帧推进（与 buff 无关，故放在 buff 早退之前）。
    tickCooldowns(u, dt);
    if (!Array.isArray(u.buffs) || !u.buffs.length) continue;
    if (u.dead) { u.buffs = []; u._dotAcc = 0; u._hotAcc = 0; continue; }
    accumulate(u, dt);
    tickBuffs(u, dt);
    flushAccumulators(ctx, u);
  }
}
