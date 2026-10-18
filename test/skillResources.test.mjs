// P3：技能资源 / 充能 / 协同。纯逻辑测试，无需 DOM。
import assert from "node:assert/strict";
import {
  maxCharges, rechargeTime, chargesOf, hasCharge, spendCharge, tickCharges,
} from "../src/engine/targeting.js";
import { synergyBonus, applySynergy } from "../src/engine/skill.js";

// ---------- 充能 ----------
const dash = { name: "疾行", maxCharges: 3, recharge: 2, cooldown: 5 };

export function maxChargesDefaultsToZero() {
  // 不写 maxCharges 的技能不是充能技能，走普通冷却
  assert.equal(maxCharges({ name: "斩" }), 0);
  assert.equal(maxCharges({ name: "斩", maxCharges: 0 }), 0);
  assert.equal(maxCharges(null), 0);
  // 负数/小数都不合法
  assert.equal(maxCharges({ maxCharges: -2 }), 0);
  assert.equal(maxCharges({ maxCharges: 2.9 }), 2);
}

export function rechargeFallsBackToCooldown() {
  // 没写 recharge 时用 cooldown，避免"充能永远不回"
  assert.equal(rechargeTime({ cooldown: 4 }), 4);
  assert.equal(rechargeTime({ cooldown: 4, recharge: 1.5 }), 1.5);
  assert.equal(rechargeTime({ cooldown: 0 }), 0);
  assert.equal(rechargeTime(null), 0);
}

export function freshUnitHasFullCharges() {
  const u = {};
  const st = chargesOf(u, dash);
  assert.equal(st.cur, 3);
  assert.equal(st.max, 3);
  assert.equal(st.t, 0);
  assert.equal(hasCharge(u, dash), true);
  // 非充能技能永远可用
  assert.equal(hasCharge(u, { name: "斩" }), true);
}

export function spendChargeDecrements() {
  const u = {};
  assert.equal(spendCharge(u, dash), true);
  assert.equal(chargesOf(u, dash).cur, 2);
  assert.equal(spendCharge(u, dash), true);
  assert.equal(spendCharge(u, dash), true);
  assert.equal(chargesOf(u, dash).cur, 0);
  // 用完就放不出来了
  assert.equal(hasCharge(u, dash), false);
  assert.equal(spendCharge(u, dash), false);
  assert.equal(chargesOf(u, dash).cur, 0, "不能在 0 时扣成负数");
}

export function spendChargeIgnoresNonChargeSkills() {
  const u = {};
  // 非充能技能不该被记录，也不该返回 true（否则调用方会误以为扣了东西）
  assert.equal(spendCharge(u, { name: "斩" }), false);
  assert.equal(u.skillCharges && u.skillCharges["斩"], undefined);
}

export function tickChargesRecharges() {
  const u = {};
  const skills = { 疾行: dash };
  spendCharge(u, dash); spendCharge(u, dash); spendCharge(u, dash);
  assert.equal(chargesOf(u, dash).cur, 0);
  // recharge=2 秒一发
  tickCharges(u, 1.0, skills);
  assert.equal(chargesOf(u, dash).cur, 0, "不足 2 秒不应回");
  tickCharges(u, 1.0, skills);
  assert.equal(chargesOf(u, dash).cur, 1, "满 2 秒回一发");
  tickCharges(u, 4.0, skills);
  assert.equal(chargesOf(u, dash).cur, 3, "一次推进多秒可回满");
  // 满了之后计时归零，不会溢出到"超出上限"
  assert.equal(chargesOf(u, dash).t, 0);
  assert.equal(chargesOf(u, dash).cur, 3);
}

export function tickChargesCapsAtMax() {
  const u = {};
  const skills = { 疾行: dash };
  spendCharge(u, dash);
  // 推进很久也只回到 max
  tickCharges(u, 1000, skills);
  assert.equal(chargesOf(u, dash).cur, 3);
  assert.ok(chargesOf(u, dash).cur <= maxCharges(dash));
}

export function tickChargesNoopWithoutState() {
  // 单位没有 skillCharges 时不该崩，也不该凭空建出记录
  const u = {};
  tickCharges(u, 1, {});
  assert.equal(u.skillCharges, undefined);
  tickCharges(null, 1, {});   // 不抛
}

// ---------- 协同 ----------
const fireball = {
  name: "火球", power: 100,
  synergy: [
    { skill: "内功", per: 0.1, max: 0.4, stat: "power" },
    { skill: "火系精通", per: 0.05, max: 0.2, stat: "power" },
  ],
};

export function synergyBonusZeroWithoutSkills() {
  assert.equal(synergyBonus(fireball, {}, "power"), 0);
  assert.equal(synergyBonus(fireball, { 内功: 0 }, "power"), 0);
  // 没有 synergy 字段的技能恒为 0，不能抛
  assert.equal(synergyBonus({ power: 10 }, { 内功: 5 }, "power"), 0);
  assert.equal(synergyBonus(null, { 内功: 5 }, "power"), 0);
}

export function synergyBonusScalesWithRank() {
  assert.equal(synergyBonus(fireball, { 内功: 1 }, "power"), 0.1);
  assert.equal(synergyBonus(fireball, { 内功: 2 }, "power"), 0.2);
  // 两个协同叠加
  assert.ok(Math.abs(synergyBonus(fireball, { 内功: 1, 火系精通: 1 }, "power") - 0.15) < 1e-9);
}

export function synergyRespectsCap() {
  // 内功 per=0.1 max=0.4：10 级时 1.0 应被夹到 0.4
  assert.equal(synergyBonus(fireball, { 内功: 10 }, "power"), 0.4);
  // 两个协同各自封顶后的总和不超过各自 max 的最大值（0.4）
  const both = synergyBonus(fireball, { 内功: 10, 火系精通: 10 }, "power");
  assert.ok(both <= 0.4 + 1e-9, "总和不应突破单项上限: " + both);
}

export function synergyIgnoresOtherStats() {
  // stat 不匹配的协同条目不计入
  assert.equal(synergyBonus(fireball, { 内功: 3 }, "range"), 0);
  const sk = { power: 100, range: 100, synergy: [{ skill: "远射", per: 0.2, max: 0.5, stat: "range" }] };
  assert.equal(synergyBonus(sk, { 远射: 5 }, "range"), 0.5);
  assert.equal(synergyBonus(sk, { 远射: 5 }, "power"), 0);
}

export function applySynergyMultipliesPower() {
  // 内功 2 级 = +20% → 100 * 1.2 = 120
  assert.deepEqual(applySynergy(fireball, { 内功: 2 }), { power: 120, range: 0 });
  // 没学任何协同技能：原值不变（这是向后兼容的关键）
  assert.deepEqual(applySynergy(fireball, {}), { power: 100, range: 0 });
  // 等级极高也受上限约束：100 * 1.4 = 140
  assert.equal(applySynergy(fireball, { 内功: 99 }).power, 140);
}

export function applySynergyHandlesMissingFields() {
  // 缺 power/range 时按 0 处理，不产生 NaN
  const r = applySynergy({ name: "空" }, {});
  assert.deepEqual(r, { power: 0, range: 0 });
  assert.ok(!Number.isNaN(r.power));
}
