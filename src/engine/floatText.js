// 浮动伤害数字（纯逻辑，无 DOM / 无 Canvas）。
//
// 为什么单独一层：绘制只需读「若干条 {text, x, y, color, alpha}」，
// 而决定这些值的是生命周期、上浮轨迹、淡出曲线、同屏数量上限与合并规则——
// 全是纯算术，放引擎里能被单测钉住，不必靠肉眼看屏幕。
//
// 设计要点：
//   - 颜色是**数据**：由伤害类型表决定，引擎只负责查表，不认识 "fire" 这个词的含义。
//   - 多条同时命中同一目标会**合并**（而非叠成一坨看不见的数字），
//     但只合并「类型相同、时间接近」的，避免火冰双修时颜色错乱。
//   - 数量有上限（默认 64），超出时丢弃最旧的，防止大规模 AOE 时数组无限膨胀。

/** 伤害类型的默认配色。可被配置覆盖（渲染层从内容表读）。 */
export const DAMAGE_COLORS = {
  physical: "#ffffff",
  fire: "#ff7a3c",
  cold: "#7fd4ff",
  lightning: "#ffe14d",
  poison: "#8fd94f",
  magic: "#c98bff",
};

/** 未标注类型时的退路颜色。 */
export const DEFAULT_COLOR = "#ffffff";

/**
 * 查一个伤害类型的颜色。
 * @param {string} type
 * @param {Record<string,string>} [table] 覆盖表（如内容配置里的 damageColors）
 * @returns {string}
 */
export function colorFor(type, table) {
  const t = type || "physical";
  const fromTable = table && table[t];
  if (fromTable) return String(fromTable);
  return DAMAGE_COLORS[t] || DEFAULT_COLOR;
}

/** 一条浮动数字的默认参数。 */
export const FLOAT_DEFAULTS = {
  life: 0.9,        // 总存活秒数
  rise: 26,         // 上浮像素总量
  riseT: 0.55,      // 上浮持续时长（之后静止淡出）
  fadeFrom: 0.45,   // 剩余生命比例低于此值开始淡出
  maxCount: 64,     // 同屏上限
  mergeWindow: 0.18,// 同类型在此秒数内可合并
};

const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 规整一条浮动数字。缺字段补默认值，非法数值退化为安全值。
 * @param {any} f
 * @param {any} [opts]
 */
export function normalizeFloat(f, opts) {
  const o = opts || {};
  const src = f || {};
  const life = Math.max(0.05, num(src.life, num(o.life, FLOAT_DEFAULTS.life)));
  const text = src.text == null ? "" : String(src.text);
  return {
    text,
    x: num(src.x, 0),
    y: num(src.y, 0),
    type: src.type ? String(src.type) : "physical",
    color: src.color ? String(src.color) : colorFor(src.type, o.colors),
    age: clamp(num(src.age, 0), 0, life),
    life,
    // 记录"是否暴击/是否免疫"这类语义标记，渲染层可据此加粗或改字号。
    crit: !!src.crit,
    immune: !!src.immune,
    // 合并计数：>1 时文本显示为 "12×3"
    count: Math.max(1, Math.round(num(src.count, 1))),
  };
}

/**
 * 推进一条浮动数字；返回它是否仍然存活。原地修改。
 * @param {any} f
 * @param {number} dt
 * @returns {boolean}
 */
export function tickFloat(f, dt) {
  if (!f) return false;
  f.age = num(f.age, 0) + Math.max(0, num(dt, 0));
  return f.age < f.life;
}

/**
 * 计算一条浮动数字当前的绘制状态（位置 + 透明度 + 文本）。
 * 纯函数，不修改入参。
 *
 * 上浮用 ease-out（前快后慢），淡出用剩余生命线性 —— 这是最不"抢眼"的组合，
 * 同时保证数字在刚出现的瞬间最清晰（战斗中最需要看清的就是那一瞬）。
 *
 * @param {any} f
 * @param {any} [opts]
 * @returns {{text:string,x:number,y:number,alpha:number,color:string,crit:boolean}}
 */
export function floatVisual(f, opts) {
  const o = opts || {};
  const d = FLOAT_DEFAULTS;
  const rise = num(o.rise, d.rise);
  const riseT = Math.max(0.001, num(o.riseT, d.riseT));
  const fadeFrom = clamp(num(o.fadeFrom, d.fadeFrom), 0, 1);
  if (!f) return { text: "", x: 0, y: 0, alpha: 0, color: DEFAULT_COLOR, crit: false };
  const life = Math.max(0.001, num(f.life, d.life));
  const age = clamp(num(f.age, 0), 0, life);
  // 上浮进度：ease-out（1-(1-p)^2）
  const p = clamp(age / riseT, 0, 1);
  const eased = 1 - (1 - p) * (1 - p);
  const rem = 1 - age / life;
  // 淡出：剩余比例低于 fadeFrom 时开始线性降到 0
  const alpha = rem <= 0 ? 0 : (rem >= fadeFrom ? 1 : rem / fadeFrom);
  const label = f.count > 1 ? f.text + "×" + f.count : f.text;
  return {
    text: label,
    x: num(f.x, 0),
    y: num(f.y, 0) - eased * rise,
    alpha: clamp(alpha, 0, 1),
    color: f.color || DEFAULT_COLOR,
    crit: !!f.crit,
  };
}

/**
 * 向列表里加一条浮动数字，处理「合并」与「数量上限」。原地修改并返回列表。
 *
 * 合并条件：类型相同、颜色相同、且**位置接近**（同一目标）。
 * 只看类型不看位置会把左右两个怪身上的数字并成一个，那是明显错误。
 *
 * @param {any[]} list
 * @param {any} f
 * @param {any} [opts]
 * @returns {any[]}
 */
export function pushFloat(list, f, opts) {
  const o = opts || {};
  const d = FLOAT_DEFAULTS;
  const arr = Array.isArray(list) ? list : [];
  const nf = normalizeFloat(f, o);
  const mergeWindow = num(o.mergeWindow, d.mergeWindow);
  const near = num(o.mergeDist, 24);
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    if (!e) continue;
    if (e.type !== nf.type || e.color !== nf.color) continue;
    if (Math.abs(e.x - nf.x) > near || Math.abs(e.y - nf.y) > near) continue;
    // 已被淡出到看不见的不合并（避免复活一条快消失的数字）
    if (num(e.age, 0) > mergeWindow) continue;
    // 合并：累加计数、刷新寿命（让新伤害把旧数字"顶"回清晰状态）。
    const total = num(e.count, 1) + nf.count;
    e.count = Math.round(total);
    e.age = 0;
    e.life = nf.life;
    return arr;
  }
  arr.push(nf);
  const max = Math.max(1, Math.round(num(o.maxCount, d.maxCount)));
  if (arr.length > max) arr.splice(0, arr.length - max);
  return arr;
}

/**
 * 一次性推进整个列表：剔除过期项，返回仍然存活的数组（新数组，不改入参）。
 * @param {any[]} list
 * @param {number} dt
 * @returns {any[]}
 */
export function tickFloats(list, dt) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const f of list) if (f && tickFloat(f, dt)) out.push(f);
  return out;
}

/**
 * 由一次伤害结算生成浮动数字的原始描述（尚未入列表）。
 *
 * @param {{amount:number, type?:string, x:number, y:number, crit?:boolean, immune?:boolean}|any} hit
 * @param {any} [opts]  colors / offsetY
 * @returns {any}
 */
export function makeDamageFloat(hit, opts) {
  const o = opts || {};
  const h = hit || {};
  const amount = Math.max(0, Math.round(num(h.amount, 0)));
  const type = h.type || "physical";
  // 免疫时显示「免疫」而不是 0，避免玩家以为漏伤害。
  const immune = !!h.immune || amount === 0;
  return normalizeFloat({
    text: immune ? "免疫" : String(amount),
    x: num(h.x, 0),
    y: num(h.y, 0) + num(o.offsetY, -28),
    type,
    color: immune ? "#9aa0a6" : colorFor(type, o.colors),
    crit: !!h.crit,
    immune,
  }, o);
}
