// engine/lootScale.js + lootTable 的缩放接线。
// 纯逻辑，无需 DOM。
import assert from "node:assert/strict";
import {
  RARITY_ORDER, BASE_RARITY_WEIGHT, normalizeScale, rarityWeights,
  rollRarity, scaleChance, rollScaled, pickWeighted,
} from "../src/engine/lootScale.js";
import { rollDrop, rollDrops } from "../src/engine/lootTable.js";

// 可复现的伪随机：给定序列循环取，便于精确断言边界。
function seq(vals) {
  let i = 0;
  return () => vals[i++ % vals.length];
}

export function normalizeScaleDefaultsToNeutral() {
  // 缺省必须是"不缩放"，否则会给所有既有内容带来隐藏变化。
  const s = normalizeScale();
  assert.equal(s.monsterLevel, 1);
  assert.equal(s.dropRate, 1);
  assert.equal(s.players, 1);
  assert.equal(scaleChance(37, s), 37);
  // 传 undefined / null / {} 都一样
  assert.equal(scaleChance(37, null), 37);
  assert.equal(scaleChance(37, {}), 37);
}

export function normalizeScaleClampsBadInput() {
  const s = normalizeScale({ monsterLevel: 0, dropRate: -3, players: 0 });
  assert.equal(s.monsterLevel, 1, "等级 0 应抬到 1");
  assert.equal(s.dropRate, 0, "负倍率应夹到 0");
  assert.equal(s.players, 1, "人数至少 1");
  // 非数字一律退回默认，不能变成 NaN 污染后续乘算
  const t = normalizeScale({ monsterLevel: "x", dropRate: NaN, players: null });
  assert.equal(t.monsterLevel, 1); assert.equal(t.dropRate, 1); assert.equal(t.players, 1);
}

export function rarityWeightsAtLevel1EqualBase() {
  const w = rarityWeights(1);
  // 1 级不做任何抬升，必须等于基础权重（去掉 quest）
  assert.equal(w.common, BASE_RARITY_WEIGHT.common);
  assert.equal(w.magic, BASE_RARITY_WEIGHT.magic);
  assert.equal(w.rare, BASE_RARITY_WEIGHT.rare);
  assert.equal(w.unique, BASE_RARITY_WEIGHT.unique);
  assert.equal(w.quest, undefined, "quest 不应参与 roll");
}

export function rarityWeightsShiftUpWithLevel() {
  const pct = lv => {
    const w = rarityWeights(lv);
    const t = Object.values(w).reduce((a, b) => a + b, 0);
    return { common: w.common / t, rare: w.rare / t, unique: w.unique / t };
  };
  const lo = pct(1), mid = pct(20), hi = pct(40);
  // 等级越高：普通越少，稀有/暗金越多（单调）
  assert.ok(mid.common < lo.common, "20 级 common 应少于 1 级");
  assert.ok(hi.common < mid.common, "40 级 common 应少于 20 级");
  assert.ok(mid.rare > lo.rare, "20 级 rare 应多于 1 级");
  assert.ok(hi.unique > mid.unique, "40 级 unique 应多于 20 级");
  // common 永远是大头：不能出现"高等级满地暗金"
  assert.ok(hi.common > hi.unique, "common 应始终多于 unique");
  assert.ok(hi.unique / hi.common < 1, "unique 不应超过 common");
}

export function rarityWeightsTotalIsPreserved() {
  // 抬升只搬运权重，不该凭空增减总量（保证百分比可解释）
  const total = lv => Object.values(rarityWeights(lv)).reduce((a, b) => a + b, 0);
  const t0 = total(1);
  for (const lv of [5, 10, 20, 40, 99]) {
    assert.ok(Math.abs(total(lv) - t0) < 1e-9, `第 ${lv} 级权重总量应守恒`);
  }
}

export function rarityWeightsRespectOpts() {
  // levelStep 越大，同样的等级抬升得越少
  const a = rarityWeights(20, { levelStep: 5 });
  const b = rarityWeights(20, { levelStep: 100 });
  assert.ok(a.rare > b.rare, "levelStep 小时 rare 应更多");
  // strength=0 表示不抬升，等价 1 级
  const z = rarityWeights(20, { strength: 0 });
  assert.equal(z.common, BASE_RARITY_WEIGHT.common);
  // strength 越大抬升越猛
  const lo = rarityWeights(20, { strength: 0.2 });
  const hi = rarityWeights(20, { strength: 0.9 });
  assert.ok(hi.unique > lo.unique, "strength 大时 unique 应更多");
}

export function rollRarityStaysInRange() {
  // 只可能落在 common/magic/rare/unique，绝不能返回 quest
  const allowed = RARITY_ORDER.filter(x => x !== "quest");
  for (let i = 0; i < 400; i++) {
    const r = rollRarity(1 + (i % 50), () => (i % 97) / 97);
    assert.ok(allowed.includes(r), "稀有度越界: " + r);
  }
}

export function rollRarityDistributionFollowsWeights() {
  // 用一个确定的线性同余发生器统计算频率，验证真的按权重分布
  let seed = 12345;
  const lcg = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const count = (lv) => {
    const c = { common: 0, magic: 0, rare: 0, unique: 0 };
    for (let i = 0; i < 4000; i++) c[rollRarity(lv, lcg)]++;
    return c;
  };
  const lo = count(1), hi = count(40);
  assert.ok(hi.common < lo.common, "40 级 common 频率应低于 1 级");
  assert.ok(hi.rare + hi.unique > lo.rare + lo.unique, "高等级高阶品质应更多");
}

export function scaleChanceAppliesRateAndPlayers() {
  // 倍率线性
  assert.equal(scaleChance(10, { dropRate: 2 }), 20);
  assert.equal(scaleChance(10, { dropRate: 0.5 }), 5);
  // 人数按 sqrt：4 人 = 2 倍
  assert.equal(scaleChance(10, { players: 4 }), 20);
  assert.equal(scaleChance(10, { players: 9 }), 30);
  // 两者叠乘
  assert.equal(scaleChance(10, { dropRate: 2, players: 4 }), 40);
  // dropRate=0 直接归零
  assert.equal(scaleChance(50, { dropRate: 0 }), 0);
}

export function scaleChanceClampsTo100() {
  // 溢出不能超过 100%（否则几率表达失去意义）
  assert.equal(scaleChance(100, { dropRate: 5 }), 100);
  assert.equal(scaleChance(80, { players: 100 }), 100);
  // 负数几率按 0 处理
  assert.equal(scaleChance(-20, { dropRate: 1 }), 0);
}

export function rollScaledHonoursBounds() {
  // 0% 必不掉、100% 必掉，与 rng 无关
  assert.equal(rollScaled(0, {}, () => 0), false);
  assert.equal(rollScaled(0, {}, () => 0.999), false);
  assert.equal(rollScaled(100, {}, () => 0.999), true);
  // 50% 时 rng 决定结果
  assert.equal(rollScaled(50, {}, () => 0.4), true);
  assert.equal(rollScaled(50, {}, () => 0.6), false);
  // 倍率影响判定：10% 提到 100% 就必掉
  assert.equal(rollScaled(10, { dropRate: 10 }, () => 0.99), true);
}

export function pickWeightedRespectsWeights() {
  const list = [{ w: 1 }, { w: 3 }];
  const wf = x => x.w;
  // total=4：x<1 → 0，1<=x<4 → 1
  assert.equal(pickWeighted(list, () => 0.0, wf), 0);
  assert.equal(pickWeighted(list, () => 0.24, wf), 0);   // 0.96 < 1
  assert.equal(pickWeighted(list, () => 0.3, wf), 1);    // 1.2
  assert.equal(pickWeighted(list, () => 0.99, wf), 1);
  // 空表 / 全零权重 → -1，避免调用方拿到下标 0 误以为有结果
  assert.equal(pickWeighted([], () => 0.5, wf), -1);
  assert.equal(pickWeighted([{ w: 0 }], () => 0.5, wf), -1);
}

export function rollDropWithoutScaleKeepsOldBehaviour() {
  // 不传 scale 时必须与改造前完全一致（这是向后兼容的硬约束）
  const def = { name: "破布", stackable: true };
  // chance=100 → 必掉
  assert.equal(rollDrop({ name: "破布", chance: 100 }, def, () => 0.99).length, 1);
  // chance=50，rng=0.6 → 60 > 50 不掉
  assert.equal(rollDrop({ name: "破布", chance: 50 }, def, () => 0.6).length, 0);
  // 旧实现的边界：chance=0 且 rng 恰好返回 0 时会掉（判断是 > 而非 >=）。
  // 这是改造前就有的行为，这里固化成"已知行为"，避免以后误以为回归。
  assert.equal(rollDrop({ name: "破布", chance: 0 }, def, () => 0).length, 1);
  // 有了 scale 之后这个边界被修好：dropRate=1 时 chance=0 仍然必不掉
  assert.equal(rollDrop({ name: "破布", chance: 0 }, def, () => 0, null, { dropRate: 1 }).length, 0);
}

export function rollDropWithScaleUsesRate() {
  const def = { name: "破布", stackable: true };
  const rr = () => 0.9;   // 90 > 50，原本不掉
  assert.equal(rollDrop({ name: "破布", chance: 50 }, def, rr).length, 0);
  // 倍率 2 → 100%，必掉
  const got = rollDrop({ name: "破布", chance: 50 }, def, rr, null, { dropRate: 2 });
  assert.equal(got.length, 1);
  // 倍率 0 → 必不掉
  assert.equal(rollDrop({ name: "破布", chance: 100 }, def, rr, null, { dropRate: 0 }).length, 0);
}

export function rollDropsPassesScaleThrough() {
  const defs = { 破布: { name: "破布", stackable: true } };
  const drops = [{ name: "破布", chance: 50 }];
  const rr = () => 0.9;
  // 不缩放：不掉
  assert.equal(rollDrops(drops, defs, rr).length, 0);
  // 缩放到 100%：掉一个
  assert.equal(rollDrops(drops, defs, rr, null, { dropRate: 2 }).length, 1);
}

export function highLevelYieldsMoreAffixes() {
  // 端到端：稀有度决定 rollAffixes 给几条词缀（common=0 / magic=1 / rare=2 / unique=3）。
  // 所以"高等级更好"的可观察表现 = 平均词缀条数变多。
  const pool = [
    { id: "a1", name: "锋锐", rarity: "magic", mods: {}, weight: 1 },
    { id: "a2", name: "利刃", rarity: "magic", mods: {}, weight: 1 },
    { id: "a3", name: "破军", rarity: "rare", mods: {}, weight: 1 },
    { id: "a4", name: "天罡", rarity: "rare", mods: {}, weight: 1 },
    { id: "a5", name: "玄铁", rarity: "unique", mods: {}, weight: 1 },
    { id: "a6", name: "寒霜", rarity: "unique", mods: {}, weight: 1 },
  ];
  const def = { name: "剑", stackable: false };
  const drop = { name: "剑", chance: 100 };
  const avgAffixes = (lv) => {
    let seed = 777;
    const lcg = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let total = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const got = rollDrop(drop, def, lcg, pool, { monsterLevel: lv });
      total += (got[0] && got[0].inst && got[0].inst.affixes.length) || 0;
    }
    return total / N;
  };
  const lo = avgAffixes(1), hi = avgAffixes(40);
  assert.ok(hi > lo, `40 级平均词缀数(${hi.toFixed(2)}) 应多于 1 级(${lo.toFixed(2)})`);
  // 1 级时 common 占 80%，平均词缀数应该很低
  assert.ok(lo < 0.6, `1 级平均词缀数(${lo.toFixed(2)}) 应偏低`);
}

export function explicitRarityBeatsLevelCurve() {
  // 掉落项/模板写死了 rarity 时，等级不该覆盖它（剧情/首领固定掉落要可控）。
  const pool = [{ id: "a1", name: "锋锐", rarity: "magic", mods: {}, weight: 1 }];
  const def = { name: "剑", stackable: false };
  // 模板写死 common + 等级 99 → 仍应 0 条词缀
  const got = rollDrop({ name: "剑", chance: 100 }, Object.assign({ rarity: "common" }, def), () => 0.5, pool, { monsterLevel: 99 });
  assert.equal(got[0].inst.affixes.length, 0, "模板 rarity 应优先于等级");
  // 掉落项显式写 unique → 应有词缀（unique=3 条，池里只有 1 条可用）
  const got2 = rollDrop({ name: "剑", chance: 100, rarity: "unique" }, def, () => 0.5, pool, { monsterLevel: 1 });
  assert.ok(got2[0].inst.affixes.length >= 1, "显式 unique 应至少 roll 出词缀");
}
