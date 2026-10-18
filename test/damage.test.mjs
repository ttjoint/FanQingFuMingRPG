// engine/damage.js 单测：伤害类型 / 抗性减免 / 多类型结算 / 加成。
import { strict as assert } from "assert";
import {
  applyResist, clampResist, resistOf, isImmune, resolveDamage,
  applyDamageBonus, dominantType, DEFAULT_MAX_RESIST, MIN_RESIST, DEFAULT_DAMAGE_TYPE,
} from "../src/engine/damage.js";

export function clampResistBasic() {
  assert.equal(clampResist(50), 50);
  assert.equal(clampResist(200), DEFAULT_MAX_RESIST);        // 上限钳制
  assert.equal(clampResist(-200), MIN_RESIST);               // 下限钳制
  assert.equal(clampResist(null), 0);
  assert.equal(clampResist("abc"), 0);
  assert.equal(clampResist(NaN), 0);
  assert.equal(clampResist(90, 95), 90);                     // 自定义上限
  assert.equal(clampResist(96, 95), 95);
}

export function applyResistCurve() {
  assert.equal(applyResist(100, 0), 100);
  assert.equal(applyResist(100, 50), 50);
  assert.equal(applyResist(100, 75), 25);
  assert.equal(applyResist(100, -50), 150);                  // 负抗 = 弱点放大
  assert.equal(applyResist(100, 100), 0);                    // 免疫
  assert.equal(applyResist(100, 200), 0);                    // 超过 100 仍免疫
  assert.equal(applyResist(0, 50), 0);
  assert.equal(applyResist(-10, 0), 0);                      // 负基础伤害归零
  // 抗性 >=100 表示完全免疫，且优先于上限钳制（否则永远表达不出免疫）
  assert.equal(applyResist(100, 150), 0);
  // 取整
  assert.equal(applyResist(10, 33), 7);                      // 10*0.67 = 6.7 → 7
}

export function resistOfShapes() {
  // 映射形式
  assert.equal(resistOf({ resist: { fire: 50 } }, "fire"), 50);
  assert.equal(resistOf({ resist: { fire: 50 } }, "cold"), 0);
  // 数组形式（编辑器表格），同类型可叠加
  assert.equal(resistOf({ resist: [{ type: "fire", value: 30 }] }, "fire"), 30);
  assert.equal(resistOf({ resist: [{ type: "fire", value: 30 }, { type: "fire", value: 20 }] }, "fire"), 50);
  // 单数值形式（兼容旧数据，对所有类型生效）
  assert.equal(resistOf({ resist: 40 }, "fire"), 40);
  assert.equal(resistOf({ resist: 40 }, "physical"), 40);
  // 缺失/异常
  assert.equal(resistOf(null, "fire"), 0);
  assert.equal(resistOf({}, "fire"), 0);
  assert.equal(resistOf({ resist: "x" }, "fire"), 0);
  assert.equal(resistOf({ resist: { fire: NaN } }, "fire"), 0);
}

export function immuneCheck() {
  assert.equal(isImmune({ resist: { fire: 100 } }, "fire"), true);
  assert.equal(isImmune({ resist: { fire: 99 } }, "fire"), false);
  assert.equal(isImmune({ resist: { fire: 150 } }, "fire"), true);   // 免疫判定看原始值，不受上限钳制
  assert.equal(isImmune({}, "fire"), false);
}

export function resolveSingleType() {
  const r = resolveDamage([100], { resist: { physical: 50 } });
  assert.equal(r.total, 50);
  assert.equal(r.byType.physical, 50);
  // 未标类型 → 默认物理
  const r2 = resolveDamage([100], { resist: { physical: 10 } });
  assert.equal(r2.total, 90);
  assert.equal(DEFAULT_DAMAGE_TYPE, "physical");
}

export function resolveMultiType() {
  // 各类型分别减免后求和（不是取最大）——"冰火双修"因此有收益
  const target = { resist: { fire: 50, cold: 0 } };
  const r = resolveDamage([{ type: "fire", amount: 100 }, { type: "cold", amount: 100 }], target);
  assert.equal(r.byType.fire, 50);
  assert.equal(r.byType.cold, 100);
  assert.equal(r.total, 150);

  // 映射形式
  const r2 = resolveDamage({ fire: 100, cold: 50 }, target);
  assert.equal(r2.total, 100);

  // 免疫类型被完全吸收
  const r3 = resolveDamage([{ type: "fire", amount: 999 }, { type: "cold", amount: 10 }],
    { resist: { fire: 100, cold: 0 } });
  assert.equal(r3.byType.fire, undefined);
  assert.equal(r3.total, 10);
}

export function resolveDamageEmpty() {
  assert.equal(resolveDamage([], {}).total, 0);
  assert.equal(resolveDamage(null, {}).total, 0);
  assert.equal(resolveDamage([0], {}).total, 0);
  assert.equal(resolveDamage([{ type: "fire", amount: -5 }], {}).total, 0);
}

export function damageBonus() {
  assert.equal(applyDamageBonus(100, "fire", { fire: 30 }), 130);
  assert.equal(applyDamageBonus(100, "fire", { cold: 30 }), 100);      // 类型不匹配
  assert.equal(applyDamageBonus(100, "fire", { all: 20 }), 120);       // 全属性加成
  assert.equal(applyDamageBonus(100, "fire", { fire: 30, all: 20 }), 150);  // 叠加
  assert.equal(applyDamageBonus(100, "fire", null), 100);
  assert.equal(applyDamageBonus(0, "fire", { fire: 30 }), 0);
}

export function dominantTypePick() {
  assert.equal(dominantType({ fire: 10, cold: 50 }), "cold");
  assert.equal(dominantType({ fire: 10 }), "fire");
  assert.equal(dominantType({}), null);
  assert.equal(dominantType(null), null);
}

export function resistLimitInteraction() {
  // 抗性 90（超过 75 默认上限）→ 按 75 算
  assert.equal(applyResist(100, 90), 25);
  // 抗性 >=100 表示免疫（不受上限钳制影响，见 applyResist 的注释）
  assert.equal(applyResist(100, 100), 0);
  // 自定义上限 90 → 按 90 算
  assert.equal(applyResist(100, 90, 90), 10);
  // resolveDamage 也要遵守 maxResist
  const r = resolveDamage([100], { resist: { fire: 90 } }, { maxResist: 90, type: "fire" });
  assert.equal(r.total, 10);
}

// ---- schema.normalizeNpc 与 resistOf 的配合 ----
// schema 会把抗性统一规整成 [{type,value}]，单值则变成 type:"all"。
import { normalizeNpc } from "../src/content/schema.js";

export function npcResistNormalized() {
  // 单数值 → type:"all"，对所有类型生效
  const a = normalizeNpc({ id: 1, resist: 30 });
  assert.deepEqual(a.resist, [{ type: "all", value: 30 }]);
  assert.equal(resistOf(a, "fire"), 30);
  assert.equal(resistOf(a, "cold"), 30);
  assert.equal(resistOf(a, "physical"), 30);

  // 映射 → 有序数组
  const b = normalizeNpc({ id: 2, resist: { fire: 50, cold: -25 } });
  assert.deepEqual(b.resist, [{ type: "fire", value: 50 }, { type: "cold", value: -25 }]);
  assert.equal(resistOf(b, "fire"), 50);
  assert.equal(resistOf(b, "cold"), -25);
  assert.equal(resistOf(b, "physical"), 0);

  // 无抗性 → null（不在每个 NPC 上存一堆 0）
  assert.equal(normalizeNpc({ id: 3 }).resist, null);
  assert.equal(normalizeNpc({ id: 4, resist: 0 }).resist, null);
  assert.equal(normalizeNpc({ id: 5, resist: {} }).resist, null);
}

export function npcResistAllPlusSpecific() {
  // 数组里同时有 all 和具体类型 → 叠加
  const n = { resist: [{ type: "all", value: 10 }, { type: "fire", value: 40 }] };
  assert.equal(resistOf(n, "fire"), 50);
  assert.equal(resistOf(n, "cold"), 10);
  // 免疫（all >= 100，注意 applyResist 会先判断免疫）
  const im = normalizeNpc({ id: 6, resist: [{ type: "fire", value: 100 }] });
  assert.equal(isImmune(im, "fire"), true);
  assert.equal(resolveDamage([{ type: "fire", amount: 500 }], im).total, 0);
}

// 端到端：NPC 抗性配合伤害类型，验证减免真的生效
export function damageVsNpcResist() {
  const npc = normalizeNpc({ id: 7, hp: 1000, resist: { fire: 50, cold: -50 } });
  assert.equal(resolveDamage([{ type: "fire", amount: 100 }], npc).total, 50);
  assert.equal(resolveDamage([{ type: "cold", amount: 100 }], npc).total, 150);   // 弱点
  assert.equal(resolveDamage([{ type: "physical", amount: 100 }], npc).total, 100); // 无抗性
}
