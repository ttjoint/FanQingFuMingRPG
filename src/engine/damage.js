// 引擎核心：伤害类型与抗性减免（纯函数，无 DOM / 无运行时状态）。
//
// 为什么需要这一层：
//   在此之前伤害是一个**无类型的数字**（`hp -= amount`），于是
//   “+30% 火焰伤害”“抗毒 50%”这类词缀根本无法表达，怪物差异化只能靠堆血量，
//   装备追求塌缩成“攻击力更高”。D2 的 build 多样性全部建立在这套正交体系上。
//
// 设计要点：
//   - 类型是**数据**（字符串），不是引擎里的硬编码分支；游戏通过配置注入类型表。
//     引擎只保证「同一个类型 key 在两处（来源/抗性）能对上」。
//   - 抗性用**百分数**（0..100 = 0%..100%），可为负数（弱点，受到额外伤害）。
//   - 减免曲线按 D2 的老规矩：负抗放大伤害，正抗线性减免，抗性上限钳制
//     （默认 75%，可被配置抬高），达到免疫（>=100）时伤害归零。
//   - 多元素攻击：各类型分别结算后求和（而不是取最大），这样“冰火双修”有实际收益。
//
// 所有函数都接受显式的 options，便于单测与不同玩法配置。

/** 默认伤害类型：物理。未标注类型的攻击一律按物理结算（保持旧行为）。 */
export const DEFAULT_DAMAGE_TYPE = "physical";

/**
 * 抗性上限（百分数）。D2 默认 75%；超过上限的部分不生效，
 * 除非用配置抬高（如“抗性上限 +5%”词缀）。
 */
export const DEFAULT_MAX_RESIST = 75;

/** 抗性下限：可以是负数（弱点），但不允许无限放大伤害。 */
export const MIN_RESIST = -100;

/**
 * 规整一个抗性数值：钳到 [MIN_RESIST, maxResist]，非数字视为 0。
 * @param {any} v
 * @param {number} [maxResist]
 * @returns {number}
 */
export function clampResist(v, maxResist) {
  const n = typeof v === "number" && isFinite(v) ? v : 0;
  const hi = typeof maxResist === "number" && isFinite(maxResist) ? maxResist : DEFAULT_MAX_RESIST;
  // 负数方向只到 MIN_RESIST；正数方向钳到上限。
  return Math.max(MIN_RESIST, Math.min(hi, n));
}

/**
 * 按抗性计算实际伤害。
 *
 *   实际 = round(基础 × (100 - 抗性) / 100)
 *
 * - 抗性 0    → 100%
 * - 抗性 50   → 50%
 * - 抗性 -50  → 150%（弱点）
 * - 抗性 >=100 → 0（免疫）
 *
 * 至少造成 0（不会因负抗把伤害算成负数）。
 * 不在此处强制“至少 1 点伤害”——那会让“完全免疫”无法表达；
 * 是否保底 1 点由调用方（游戏规则）决定。
 *
 * @param {number} base 减免前伤害
 * @param {number} resist 抗性百分数（可负）
 * @param {number} [maxResist] 抗性上限
 * @returns {number} 整数伤害（>=0）
 */
export function applyResist(base, resist, maxResist) {
  const b = typeof base === "number" && isFinite(base) ? base : 0;
  if (b <= 0) return 0;
  // 免疫必须先于上限钳制判断：抗性 100 应表示“完全免疫”，
  // 而 clampResist 会把它压到 75%（默认上限），那样就永远无法表达免疫。
  const raw = typeof resist === "number" && isFinite(resist) ? resist : 0;
  if (raw >= 100) return 0;
  const r = clampResist(raw, maxResist);
  const out = Math.round(b * (100 - r) / 100);
  return Math.max(0, out);
}

/**
 * 取目标对某类型的抗性。
 *
 * target.resist 支持三种写法（从简到繁）：
 *   resist: { fire: 50 }                      → 直接映射
 *   resist: [{ type: "fire", value: 50 }]     → 数组形式（便于编辑器表格编辑）
 *   resist: 50                                → 单一数值（对所有类型生效，兼容旧数据）
 *
 * @param {any} target
 * @param {string} type
 * @returns {number} 抗性百分数（未配置为 0）
 */
export function resistOf(target, type) {
  if (!target) return 0;
  const r = target.resist;
  if (r == null) return 0;
  if (typeof r === "number") return isFinite(r) ? r : 0;
  if (Array.isArray(r)) {
    let sum = 0;
    for (const e of r) {
      if (!e) continue;
      // "all" 表示对所有伤害类型生效（schema 会把单值规整成 type:"all"）。
      if (e.type !== type && e.type !== "all") continue;
      const v = typeof e.value === "number" ? e.value : 0;
      if (isFinite(v)) sum += v;                // 同类型多条可叠加
    }
    return sum;
  }
  if (typeof r === "object") {
    // 映射形式：具体类型优先，然后叠加 "all"。
    const v = r[type];
    const a = r.all;
    const n = (typeof v === "number" && isFinite(v) ? v : 0) + (typeof a === "number" && isFinite(a) ? a : 0);
    return n;
  }
  return 0;
}

/**
 * 目标是否对某类型免疫（抗性 >= 100）。
 * @param {any} target
 * @param {string} type
 * @returns {boolean}
 */
export function isImmune(target, type) {
  return resistOf(target, type) >= 100;
}

/**
 * 多类型伤害结算：对每种类型分别按抗性减免后**求和**。
 *
 * parts 可以是：
 *   [150]                                    → 单一物理伤害
 *   [{ type:"fire", amount:100 }, ...]       → 分类型
 *   { fire: 100, cold: 50 }                  → 映射形式
 *
 * @param {Array<number|{type?:string,amount:number}>|Record<string,number>} parts
 * @param {any} target 承受者（提供 resist）
 * @param {{maxResist?:number, type?:string}} [opts]
 * @returns {{ total:number, byType:Record<string,number> }}
 */
export function resolveDamage(parts, target, opts) {
  const o = opts || {};
  const maxResist = o.maxResist;
  const fallback = o.type || DEFAULT_DAMAGE_TYPE;
  /** @type {Record<string, number>} */
  const byType = {};
  let total = 0;

  const add = (type, amount) => {
    const t = type || fallback;
    const n = typeof amount === "number" && isFinite(amount) ? amount : 0;
    if (n <= 0) return;
    const dealt = applyResist(n, resistOf(target, t), maxResist);
    if (dealt <= 0) return;
    byType[t] = (byType[t] || 0) + dealt;
    total += dealt;
  };

  if (Array.isArray(parts)) {
    for (const p of parts) {
      if (typeof p === "number") add(fallback, p);
      else if (p && typeof p === "object") add(p.type, p.amount);
    }
  } else if (parts && typeof parts === "object") {
    for (const k of Object.keys(parts)) add(k, parts[k]);
  } else if (typeof parts === "number") {
    add(fallback, parts);
  }

  return { total, byType };
}

/**
 * 把“伤害类型 → 百分数加成”的映射汇总成按类型的绝对值。
 *
 * 用于词缀/被动：例如 fireBonus 30 表示火系伤害 +30%。
 * 加成在**抗性减免之前**应用（先放大再减抗，符合直觉）。
 *
 * @param {number} base
 * @param {string} type
 * @param {Record<string, number>} [bonus] 例如 { fire: 30, all: 10 }
 * @returns {number}
 */
export function applyDamageBonus(base, type, bonus) {
  const b = typeof base === "number" && isFinite(base) ? base : 0;
  if (b <= 0) return 0;
  const pct = (bonus && ((bonus[type] || 0) + (bonus.all || 0))) || 0;
  if (!pct) return b;
  return Math.round(b * (100 + pct) / 100);
}

/**
 * 从若干来源的伤害类型统计中挑出“主类型”（伤害最高者），用于伤害数字着色。
 * @param {Record<string, number>} byType
 * @returns {string|null}
 */
export function dominantType(byType) {
  if (!byType) return null;
  let best = null, bestV = -1;
  for (const k of Object.keys(byType)) {
    if (byType[k] > bestV) { bestV = byType[k]; best = k; }
  }
  return best;
}
