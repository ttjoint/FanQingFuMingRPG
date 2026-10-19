// 引擎核心：技能 / 攻击方式（attack mode）纯逻辑。无 DOM 依赖，可在 Node 中测试。
//
// 设计目标（阶段 A）：
//  - 把“一次攻击如何发生”从玩家 / NPC 两套代码里抽出来，统一成数据驱动。
//  - 引入 attackMode：melee（近战，瞬间结算）/ ranged（远程，可挂弹道）。
//  - 本阶段 **不改变任何现有行为**：melee/ranged 仍都在命中时刻瞬间结算伤害，
//    ranged 只是为后续阶段的弹道（projectile）预留语义。
//
// 技能数据（assets/skills.json，经 normalizeSkill 规整）字段：
//   { name, type, range, mode, mp, reqLevel, power, sound, icon, frames, desc }
//   type: 0 = 治疗（自身 / 后续可扩展为队友），1 = 攻击
//   mode: "melee" | "ranged"（由 combat.meleeMaxRange 推断，见 content/schema.js）

// 技能生效射程：至少为 rangeMin（原版“贴脸也能打”的下限）。
export function skillRange(sk, rangeMin) {
  const r = sk && typeof sk.range === "number" ? sk.range : 0;
  return Math.max(rangeMin || 0, r);
}

// ---- 命中判定：不再用“命中率”随机 ----
//
// 旧实现（原 exe 还原）用 rollHit(hitRate) 随机决定命中与否，命中率低时连续 miss，
// 手感很差。现改为 RTS（War3 式）的“前摇结束瞬间做距离判定”：
//
//   出手时锁定目标 → 播前摇 → **结算瞬间**看目标此刻是否还在「射程 + 缓冲区」内。
//     在范围内  → 必中，伤害在 [min,max] 内浮动
//     已跑出缓冲 → 这次落空（dmg 0）
//
// 也就是说：站桩换血永远不会 miss，只有“读条期间把敌人放风筝放掉”才 miss。
//
// 引擎不持有世界坐标，这里只提供纯函数，由 systems 层传入当帧距离。

// 结算瞬间的命中判定。dist 为**结算那一刻**攻击者与目标的实际距离。
//   range     技能/攻击的生效射程（像素）
//   buffer    缓冲带宽度（像素）：目标可以多跑出这么远仍算命中
// 返回 true = 命中（必中，伤害另行浮动）；false = 目标已逃脱。
export function rollAttackHit(dist, range, buffer) {
  if (!isFinite(dist)) return true;
  if (!isFinite(range) || range < 0) return true;
  const buf = isFinite(buffer) && buffer > 0 ? buffer : 0;
  return dist <= range + buf;
}

// 伤害区间：返回 [min, max]。
// 基准 = 攻击力 + 技能威力 - 防御的一半（原公式），再按浮动系数展开：
//   min = base * (1 - variance)，max = base * (1 + variance)
// 结果至少为 1，且 min <= max 恒成立。
export function damageRange(atk, power, def, variance) {
  const base = Math.max(1, (atk | 0) + (power | 0) - Math.floor((def | 0) / 2));
  const v = isFinite(variance) ? Math.max(0, Math.min(1, variance)) : 0;
  const min = Math.max(1, Math.floor(base * (1 - v)));
  const max = Math.max(min, Math.ceil(base * (1 + v)));
  return [min, max];
}

// ---- 护甲减免率模型（B1，config.combat.armorModel = "mitigation" 时启用）----
//
// 为什么需要第二套公式：旧的 `atk + power - def/2` 是**线性减法**，
// 一旦 def 接近 atk，伤害就塌到 1（下限）。后果：
//   - 防御属性稍微一高就接近无敌（数值脆弱，没有可用区间）；
//   - “高等级怪物打低等级玩家”与反过来，都不是平滑曲线，而是阶跃。
//
// 换成 RPG 常用的“护甲→减伤率”换算：
//
//   减伤率 = armor / (armor + K)        （armor = K 时减伤 50%）
//   实际   = 攻击 × (1 - 减伤率)
//
// 性质：单调、无断崖、永不归零。K 建议按等级缩放
// （如 K = 50 + 10×等级），否则低等级护甲在高等级无敌，反之亦然。
//
// 与已有元素抗性（engine/damage.js 的百分数线性减免）语义一致，
// 玩家只需要一套心智模型：“这个百分比减免了多少伤害”。

/** 默认的减伤 50% 护甲值（K）。K 随等级缩放时由调用方传入。 */
export const DEFAULT_ARMOR_K = 100;

/**
 * 把护甲值换算成减伤率（0..1）。
 * @param {number} armor 护甲值（>=0）
 * @param {number} [k] 减伤 50% 对应的护甲值
 * @returns {number} 0..1
 */
export function armorMitigation(armor, k) {
  const a = Number(armor);
  if (!isFinite(a) || a <= 0) return 0;
  const kk = isFinite(k) && k > 0 ? Number(k) : DEFAULT_ARMOR_K;
  // a/(a+k) 恒 < 1，因此永远不会完全免疫（免疫交给元素抗性 >=100 表达）。
  return a / (a + kk);
}

/**
 * 护甲减免率模型的伤害区间：返回 [min, max]。
 *
 * 攻击力 + 威力 是“伤害源”，护甲只按比例削减它，不做减法。
 *
 * @param {number} atk 攻击力
 * @param {number} power 技能威力
 * @param {number} def 目标护甲值
 * @param {number} [variance] 浮动系数（0..1）
 * @param {{armorK?:number}} [opts] armorK = 减伤50%的护甲值
 * @returns {[number, number]}
 */
export function damageRangeMitigation(atk, power, def, variance, opts) {
  const o = opts || {};
  const raw = Math.max(1, (atk | 0) + (power | 0));
  const cut = armorMitigation(def, o.armorK);
  // 至少造成 1 点：与旧公式保持一致的下限，避免“高护甲 = 完全无伤”。
  const base = Math.max(1, Math.round(raw * (1 - cut)));
  const v = isFinite(variance) ? Math.max(0, Math.min(1, variance)) : 0;
  const min = Math.max(1, Math.floor(base * (1 - v)));
  const max = Math.max(min, Math.ceil(base * (1 + v)));
  return [min, max];
}

// 伤害浮动：[min,max] 内均匀随机。randomFn 便于测试注入。
export function damage(atk, power, def, variance, randomFn) {
  const rnd = randomFn || Math.random;
  const [min, max] = damageRange(atk, power, def, variance);
  if (max <= min) return min;
  return min + Math.floor(rnd() * (max - min + 1));
}

// ---- 技能协同（synergy）----
//
// 形如 [{ skill: "内功", per: 0.08, max: 0.4 }]：指定技能每 1 级给本技能
// +per 的加成（作用于 stat 指定的数值），最多累加到 max。
//
// 设计要点：
//  - 只按「已学等级」算，不看是否在装备/当前选中技能——被动加成应当是常驻的。
//  - 单项与总和都夹到 max，避免多个协同叠加突破上限。
//  - levels 为 { 技能名: 等级 }；缺失视为 0 级（未学）。
//
// 返回加成**比例**（0.24 表示 +24%），由调用方乘到原始数值上。
export function synergyBonus(sk, levels, stat) {
  const list = sk && Array.isArray(sk.synergy) ? sk.synergy : null;
  if (!list || !list.length) return 0;
  const lv = levels || {};
  const want = stat || "power";
  let total = 0;
  for (const s of list) {
    if (!s || !s.skill) continue;
    if ((s.stat || "power") !== want) continue;
    const rank = Math.max(0, Number(lv[s.skill]) || 0);
    if (!rank) continue;
    let add = rank * (Number(s.per) || 0);
    const cap = Number(s.max) || 0;
    if (cap > 0 && add > cap) add = cap;
    total += add;
  }
  // 多个协同叠加时，最终也不超过各自 max 中的最大值（保守：避免叠满)
  const caps = list.filter(s => s && (s.stat || "power") === want && Number(s.max) > 0).map(s => Number(s.max));
  if (caps.length) {
    const hardCap = Math.max(...caps);
    if (total > hardCap) total = hardCap;
  }
  return total;
}

// 应用协同后的技能数值。返回 { power, range }（不修改原对象）。
// 协同只作用于 power/range；其它字段原样返回由调用方自取。
export function applySynergy(sk, levels) {
  const base = { power: Number(sk && sk.power) || 0, range: Number(sk && sk.range) || 0 };
  const pMul = 1 + synergyBonus(sk, levels, "power");
  const rMul = 1 + synergyBonus(sk, levels, "range");
  return {
    power: Math.round(base.power * pMul),
    range: Math.round(base.range * rMul),
  };
}
