// 掉落缩放纯逻辑（不依赖 DOM、content、core）。
//
// 为什么要单独一层：engine/lootTable.js 负责"这条掉落判定成不成立"，
// 但它没有"等级"概念——同样的 drops 定义，1 级小怪和 30 级首领掉出来的
// 东西一模一样。这里补上三个旋钮：
//
//   monsterLevel  怪物等级：决定品质权重往高稀有度偏移多少
//   dropRate      全局掉落率倍率（1 = 原样）
//   players       人数加成（暗黑2 风格：人越多，掉落判定次数越多）
//
// 设计取向是"可解释的乘算"，不做隐藏概率。所有返回值都是纯函数，
// 给定同样的 rng 序列结果稳定，方便单测。

// 稀有度阶梯。顺序即"高低"，用于按等级逐级抬升权重。
export const RARITY_ORDER = ["common", "magic", "rare", "unique", "quest"];

// 基础权重（未受等级影响时）。合计 1000，便于按千分比读。
// common 占大头、unique 很稀，与暗黑2 的量级感一致。
export const BASE_RARITY_WEIGHT = {
  common: 800,
  magic: 150,
  rare: 40,
  unique: 10,
};

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (d == null ? 0 : d);
}
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// 归一化缩放参数。全部可缺省，缺省即"不缩放"。
// 想关掉任何一项，把它设成中性值（level=1 / rate=1 / players=1）即可。
export function normalizeScale(s) {
  const o = s || {};
  return {
    // 怪物等级：<1 按 1 处理（等级 0 没有"更低品质"的意义）
    monsterLevel: Math.max(1, num(o.monsterLevel, 1)),
    // 全局掉落率倍率：>0。0 表示完全不掉（活动/剧情需要时可用）。
    dropRate: Math.max(0, num(o.dropRate, 1)),
    // 人数：1 = 单人。用于掉落判定次数加成。
    players: Math.max(1, num(o.players, 1)),
  };
}

// 等级对稀有度权重的抬升。
//
// 做法：每提升 levelStep 级，把"当前稀有度的一半权重"往上挪一档。
// 这样低等级几乎全是 common，高等级 rare/unique 明显变多，但 unique
// 永远不会压倒 common（避免满屏暗金，破坏稀缺感）。
//
// 返回各稀有度权重（未归一化）。
export function rarityWeights(level, opts) {
  const lv = Math.max(1, num(level, 1));
  const o = opts || {};
  const step = Math.max(1, num(o.levelStep, 5));       // 每 N 级抬一档
  const strength = clamp(num(o.strength, 0.5), 0, 1);  // 每档上移的比例
  const w = Object.assign({}, BASE_RARITY_WEIGHT);
  // 抬升档数：等级越高越多，但设上限避免高等级直接吃满
  const tiers = Math.min(RARITY_ORDER.length - 1, Math.floor((lv - 1) / step));
  for (let t = 0; t < tiers; t++) {
    // 从**最高**档往下挪（unique 没有更高的去处，所以跳过最高档）：
    // rare→unique、magic→rare、common→magic 各挪一次。
    // 顺序必须从高到低，否则会把刚进入 magic 的权重在同一档里又挪走，
    // 导致 high 档越高、magic 反而越少这种反直觉结果。
    for (let i = RARITY_ORDER.length - 2; i >= 0; i--) {
      const from = RARITY_ORDER[i];
      const to = RARITY_ORDER[i + 1];
      if (w[from] == null || w[to] == null) continue;
      if (to === "quest") continue;          // quest 是剧情专用，不参与 roll
      const move = w[from] * strength * 0.5;
      w[from] -= move;
      w[to] += move;
    }
  }
  delete w.quest;
  return w;
}

// 按等级权重掷一次稀有度。
// 注意：这里只决定"如果掉了，掉什么品质"，不决定"掉不掉"。
export function rollRarity(level, rng, opts) {
  const r = typeof rng === "function" ? rng : Math.random;
  const w = rarityWeights(level, opts);
  const keys = Object.keys(w);
  let total = 0;
  for (const k of keys) total += w[k];
  if (total <= 0) return "common";
  let x = r() * total;
  for (const k of keys) {
    x -= w[k];
    if (x < 0) return k;
  }
  return keys[keys.length - 1];
}

// 掉落率：把"百分比几率"乘上全局倍率与人数加成，并夹到 [0, 100]。
//
// 人数加成用 sqrt：4 人不是 4 倍，而是 2 倍。目的是让组队有收益但
// 不鼓励"堆小号刷图"（纯线性会严重通胀）。
export function scaleChance(chance, scale) {
  const s = normalizeScale(scale);
  const c = clamp(num(chance, 0), 0, 100);
  const playerMul = Math.sqrt(s.players);
  return clamp(c * s.dropRate * playerMul, 0, 100);
}

// 判定一次掉落是否成立。rng 返回 [0,1)。
export function rollScaled(chance, scale, rng) {
  const r = typeof rng === "function" ? rng : Math.random;
  const p = scaleChance(chance, scale);
  if (p <= 0) return false;
  if (p >= 100) return true;
  return r() * 100 < p;
}

// 从一组掉落定义里按权重挑一条（用于"掉一件，但掉什么随机"的场景）。
// 返回下标；列表为空返回 -1。
export function pickWeighted(list, rng, weightOf) {
  const r = typeof rng === "function" ? rng : Math.random;
  if (!list || !list.length) return -1;
  const wf = typeof weightOf === "function" ? weightOf : (x => num(x && x.weight, 1));
  let total = 0;
  for (const x of list) total += Math.max(0, wf(x));
  if (total <= 0) return -1;
  let v = r() * total;
  for (let i = 0; i < list.length; i++) {
    v -= Math.max(0, wf(list[i]));
    if (v < 0) return i;
  }
  return list.length - 1;
}
