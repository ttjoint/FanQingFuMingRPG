// 运行时：Buff / Debuff 系统。
//  - 每帧推进所有单位（玩家 + NPC）的 buff 计时，到期的移除。
//  - 结算 DoT（走 combat.applyDamage，可击杀/记录仇恨）/ HoT（回血，不超上限）。
//  - 属性加成（mods）通过「派生值」计算：不改写基础值，避免反复叠加漂移。
//
// 与 combat.js 解耦：本模块只调用 applyDamage；技能命中时施加 buff 的逻辑在 combat.resolveHit。
import { tickBuffs, dotPerSecond, hotPerSecond } from "../engine/buff.js";
import { tickCooldowns, tickCharges } from "../engine/targeting.js";
import { tickFloats } from "../engine/floatText.js";
import { skillMap } from "./combat.js";
import { applyDamage } from "./combat.js";
import { spawnFx } from "./effects.js";

// 为循环型 buff 光环特效维护实例：每个单位每个带 fx.aura 的 buff 一个循环实例。
// 单位身上的光环用 anchor="unit" + follow=单位（每帧渲染时实时读取位置）。
function syncBuffAuras(ctx, unit) {
  if (!unit._fxAuras) unit._fxAuras = {};
  const live = {};
  for (const b of unit.buffs || []) {
    const def = b.def;
    const auraId = def && def.fx && def.fx.aura;
    if (!auraId) continue;
    const key = def.id;
    live[key] = true;
    if (!unit._fxAuras[key]) unit._fxAuras[key] = spawnFx(ctx, auraId, { anchor: "unit", follow: unit, loop: true });
  }
  // 移除已失效光环实例。
  for (const key in unit._fxAuras) {
    if (!live[key]) {
      const inst = unit._fxAuras[key];
      const list = ctx.state.fx;
      const i = list ? list.indexOf(inst) : -1;
      if (i >= 0) list.splice(i, 1);
      delete unit._fxAuras[key];
    }
  }
}

// 施加/到期特效（一次性）。
export function playBuffFx(ctx, unit, buffDef, phase) {
  const fx = buffDef && buffDef.fx;
  const id = fx && (phase === "expire" ? fx.onExpire : fx.onApply);
  if (id) spawnFx(ctx, id, { anchor: "unit", follow: unit, loop: false });
}

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
    // 浮动伤害数字的生命周期（上浮/淡出）同样与 buff 无关，也放在早退之前——
    // 否则「怪死了→buffs 清空→continue」会让最后的伤害数字卡在屏上不消失。
    if (Array.isArray(u.floats) && u.floats.length) u.floats = tickFloats(u.floats, dt);
    // 充能型技能的回复同理：单位身上 skillCharges 里的槽按 recharge 累加。
    if (u.skillCharges) tickCharges(u, dt, skillMap(ctx));
    if (!u.dead && Array.isArray(u.buffs) && u.buffs.length) syncBuffAuras(ctx, u);
    if (!Array.isArray(u.buffs) || !u.buffs.length) continue;
    if (u.dead) { u.buffs = []; u._dotAcc = 0; u._hotAcc = 0; continue; }
    accumulate(u, dt);
    tickBuffs(u, dt);
    flushAccumulators(ctx, u);
  }
}
