// 浮动伤害数字（纯逻辑层）单测。
//
// 这一层值得测的原因：生命周期、上浮曲线、淡出、合并、数量上限全是算术，
// 靠肉眼看屏幕根本无法判断「是不是提前淡出了」「合并有没有把隔壁怪的数字并进来」。
import {
  DAMAGE_COLORS, DEFAULT_COLOR, colorFor, FLOAT_DEFAULTS,
  normalizeFloat, tickFloat, tickFloats, floatVisual, pushFloat, makeDamageFloat,
} from "../src/engine/floatText.js";
import { assert, assertEq } from "./helpers.mjs";

// 每种伤害类型必须有不同颜色，否则「按类型着色」这件事在视觉上不成立。
export function eachTypeHasDistinctColor() {
  const seen = new Map();
  for (const t of Object.keys(DAMAGE_COLORS)) {
    const c = colorFor(t);
    assert(c && c !== DEFAULT_COLOR || t === "physical", "类型 " + t + " 应有配色");
    assert(!seen.has(c), "颜色重复：" + t + " 与 " + seen.get(c) + " 都是 " + c);
    seen.set(c, t);
  }
}

// 未知类型退化为默认色，不能返回 undefined（会让 canvas fillStyle 静默沿用上次的值）。
export function unknownTypeFallsBack() {
  assertEq(colorFor("nonsense"), DEFAULT_COLOR);
  assertEq(colorFor(undefined), DAMAGE_COLORS.physical);
  assertEq(colorFor(""), DAMAGE_COLORS.physical);
}

// 配置表可以覆盖默认配色（内容驱动）。
export function configTableOverridesDefault() {
  assertEq(colorFor("fire", { fire: "#123456" }), "#123456");
  assertEq(colorFor("cold", { fire: "#123456" }), DAMAGE_COLORS.cold, "未覆盖的类型仍用默认");
}

// 规整：缺字段要有默认值，非法数值不能变成 NaN（NaN 会让坐标算出 NaN，整条数字消失）。
export function normalizeFillsDefaults() {
  const f = normalizeFloat({ text: "12" });
  assertEq(f.text, "12");
  assertEq(f.x, 0);
  assertEq(f.y, 0);
  assertEq(f.age, 0);
  assertEq(f.life, FLOAT_DEFAULTS.life);
  assertEq(f.type, "physical");
  assertEq(f.count, 1);
  assert(!Number.isNaN(f.life), "life 不能是 NaN");
}

// 非法数值（NaN / Infinity / 字符串）一律退化为安全值。
export function normalizeRejectsBadNumbers() {
  const f = normalizeFloat({ text: "1", x: NaN, y: Infinity, life: -5, age: "abc" });
  assertEq(f.x, 0, "NaN 坐标退化为 0");
  assertEq(f.y, 0, "Infinity 坐标退化为 0");
  assert(f.life >= 0.05, "life 有下限，避免除零");
  assertEq(f.age, 0, "非法 age 退化为 0");
}

// 推进到超过寿命就判死。
export function tickKillsAfterLife() {
  const f = normalizeFloat({ text: "1", life: 0.5 });
  assert(tickFloat(f, 0.3), "0.3 < 0.5 仍存活");
  assert(!tickFloat(f, 0.3), "0.6 > 0.5 应死亡");
}

// 列表推进要剔除过期项，且不改入参。
export function tickFloatsFiltersAndDoesNotMutateInput() {
  const a = normalizeFloat({ text: "a", life: 1 });
  const b = normalizeFloat({ text: "b", life: 0.1 });
  const src = [a, b];
  const out = tickFloats(src, 0.2);
  assertEq(src.length, 2, "入参数组不应被修改");
  assertEq(out.length, 1, "只有 a 存活");
  assertEq(out[0].text, "a");
}

// 上浮：时间越久 y 越小（向上），且起始点就是 y - 0。这钉住「数字是上浮的」。
export function visualRisesOverTime() {
  const f = normalizeFloat({ text: "1", x: 10, y: 100, life: 1 });
  const v0 = floatVisual(f, { rise: 30, riseT: 0.5 });
  f.age = 0.25;
  const v1 = floatVisual(f, { rise: 30, riseT: 0.5 });
  f.age = 0.5;
  const v2 = floatVisual(f, { rise: 30, riseT: 0.5 });
  assertEq(v0.y, 100, "起点不偏移");
  assert(v1.y < v0.y, "中途应上浮");
  assert(v2.y < v1.y, "继续上浮");
  assertEq(Math.round(v2.y), 70, "到达 rise 上限后不再上浮");
  // 上浮结束后保持不变
  f.age = 0.8;
  assertEq(Math.round(floatVisual(f, { rise: 30, riseT: 0.5 }).y), 70, "上浮有上限");
}

// 淡出：末期透明度必须下降，且到寿命末尾为 0。
export function visualFadesAtEnd() {
  const f = normalizeFloat({ text: "1", life: 1 });
  f.age = 0;
  assertEq(floatVisual(f).alpha, 1, "刚出现时完全不透明");
  f.age = 0.6;
  assert(floatVisual(f).alpha < 1, "后期开始淡出");
  f.age = 0.85;
  assert(floatVisual(f).alpha < 0.5, "接近末尾更透明");
  f.age = 1;
  assertEq(floatVisual(f).alpha, 0, "寿命结束时完全透明");
}

// 合并：同类型 + 同一位置 + 时间接近 → 合并成一个并累加计数。
export function nearbySameTypeMerges() {
  const list = [];
  pushFloat(list, makeDamageFloat({ amount: 10, type: "fire", x: 100, y: 100 }));
  pushFloat(list, makeDamageFloat({ amount: 15, type: "fire", x: 102, y: 98 }));
  assertEq(list.length, 1, "应合并为一条");
  assertEq(list[0].count, 2, "计数累加");
}

// 不能把隔壁怪的数字并进来：位置差太远就不合并。
export function farApartDoesNotMerge() {
  const list = [];
  pushFloat(list, makeDamageFloat({ amount: 10, type: "fire", x: 100, y: 100 }));
  pushFloat(list, makeDamageFloat({ amount: 10, type: "fire", x: 300, y: 100 }));
  assertEq(list.length, 2, "位置相差 200px 不应合并");
}

// 不同类型不合并（否则火冰双修时颜色会错乱）。
export function differentTypeDoesNotMerge() {
  const list = [];
  pushFloat(list, makeDamageFloat({ amount: 10, type: "fire", x: 100, y: 100 }));
  pushFloat(list, makeDamageFloat({ amount: 10, type: "cold", x: 100, y: 100 }));
  assertEq(list.length, 2, "不同类型不应合并");
}

// 已被淡出的旧数字不再合并（否则一条快消失的数字会被"复活"，看起来像卡住）。
export function staleFloatDoesNotMerge() {
  const list = [];
  pushFloat(list, makeDamageFloat({ amount: 10, type: "fire", x: 100, y: 100 }));
  list[0].age = 1.0;   // 远超 mergeWindow
  pushFloat(list, makeDamageFloat({ amount: 10, type: "fire", x: 100, y: 100 }));
  assertEq(list.length, 2, "过期数字不参与合并");
}

// 同屏上限：超出时丢最旧的，避免大群怪 AOE 时数组无限膨胀。
export function respectsMaxCount() {
  const list = [];
  for (let i = 0; i < 20; i++) {
    // 用不同位置避开合并
    pushFloat(list, makeDamageFloat({ amount: i, type: "fire", x: i * 100, y: 0 }), { maxCount: 5 });
  }
  assertEq(list.length, 5, "应被限制到上限");
  // 保留的是最新的 5 条（15..19）
  assertEq(list[list.length - 1].text, "19", "最新的保留");
}

// 免疫显示「免疫」而不是 0 —— 否则玩家会以为漏伤害。
export function immuneShowsLabelNotZero() {
  const f = makeDamageFloat({ amount: 0, type: "fire", x: 0, y: 0, immune: true });
  assertEq(f.text, "免疫");
  assert(f.immune, "应带免疫标记");
  assertEq(f.color, "#9aa0a6", "免疫用灰白，不沿用类型色");
}

// 伤害为 0 但没有 immune 标记时，同样按免疫处理（抗性把伤害吃光了）。
export function zeroDamageTreatedAsImmune() {
  const f = makeDamageFloat({ amount: 0, type: "cold", x: 0, y: 0 });
  assertEq(f.text, "免疫");
}

// 正常伤害：文本是数字，颜色取自类型。
export function normalDamageUsesTypeColor() {
  const f = makeDamageFloat({ amount: 37, type: "fire", x: 0, y: 0 });
  assertEq(f.text, "37");
  assertEq(f.color, DAMAGE_COLORS.fire);
  assert(!f.immune);
}

// 合并后的显示文本要带 ×N。
export function mergedVisualShowsCount() {
  const list = [];
  pushFloat(list, makeDamageFloat({ amount: 10, type: "fire", x: 100, y: 100 }));
  pushFloat(list, makeDamageFloat({ amount: 10, type: "fire", x: 100, y: 100 }));
  pushFloat(list, makeDamageFloat({ amount: 10, type: "fire", x: 100, y: 100 }));
  assertEq(list.length, 1);
  assertEq(floatVisual(list[0]).text, "10×3", "合并后显示倍数");
}

// 数字应在目标上方偏移（不能盖住角色本体）。
export function spawnsAboveTarget() {
  const f = makeDamageFloat({ amount: 5, type: "physical", x: 50, y: 200 }, { offsetY: -28 });
  assertEq(f.y, 172, "默认在目标上放 28px");
}

// 空输入不能崩（战斗中单位被清空时也会调用）。
export function handleEmptyInput() {
  assertEq(tickFloats(null, 0.1).length, 0);
  assertEq(tickFloats(undefined, 0.1).length, 0);
  assertEq(pushFloat(null, makeDamageFloat({ amount: 1, type: "fire", x: 0, y: 0 })).length, 1, "null 列表应自动建");
  const v = floatVisual(null);
  assertEq(v.text, "");
  assertEq(v.alpha, 0);
}
