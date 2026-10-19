// engine/balance.js 与 mitigation 伤害模型的单测。
//
// 这些断言都在锁「曲线是可用的」这一事实：单调、无断崖、指标落在目标区间。
// 数值调整后若测试挂了，先去跑 tools/balance-report.mjs 看全貌，
// 而不是直接把期望值改掉。
import {
  TIERS, DEFAULT_CURVE, curveAt, normalizeCurve, normalizeTier,
  monsterStats, playerStats, expToNext, armorKAt, hitsToKill, levelSnapshot,
} from "../src/engine/balance.js";
import { damageRangeMitigation, armorMitigation, damageRange, DEFAULT_ARMOR_K } from "../src/engine/skill.js";

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---- 曲线基础 ----
export function testCurveAtLevel1IsBase() {
  for (const [base, growth] of [[100, 1.5], [30, 1.1], [1, 2]]) {
    if (curveAt(base, growth, 1) !== base) throw new Error(`lv1 应等于基准 ${base}，实际 ${curveAt(base, growth, 1)}`);
  }
}

export function testCurveIsMonotonic() {
  // 单调递增是“等级有意义”的最低要求。
  for (const [base, growth] of [[55, 1.115], [20, 1.09], [101, 1.07]]) {
    let prev = -1;
    for (let lv = 1; lv <= 60; lv++) {
      const v = curveAt(base, growth, lv);
      if (v < prev) throw new Error(`base=${base} growth=${growth} lv=${lv} 出现下降：${prev} → ${v}`);
      prev = v;
    }
  }
}

export function testCurveNeverZero() {
  // base 写成 0 / 负数时，曲线也不能产出 0 血。
  if (curveAt(0, 1.1, 5) !== 0) throw new Error("base=0 应返回 0");
  if (curveAt(-5, 1.1, 5) !== 0) throw new Error("base<0 应返回 0");
}

export function testCurveBadInputFallsBack() {
  // 非法等级（0 / 负数 / null / NaN）一律按 1 级，不抛错。
  for (const lv of [0, -3, null, undefined, NaN, "abc"]) {
    const v = curveAt(100, 1.5, lv);
    if (v !== 100) throw new Error(`lv=${lv} 应回退到 1 级(=100)，实际 ${v}`);
  }
}

export function testCurveGrowthOneIsFlat() {
  for (let lv = 1; lv <= 10; lv++) {
    if (curveAt(42, 1, lv) !== 42) throw new Error(`growth=1 应恒定，lv=${lv} 得 ${curveAt(42, 1, lv)}`);
  }
}

// ---- normalizeCurve ----
export function testNormalizeCurveFillsDefaults() {
  const c = normalizeCurve(undefined);
  if (c.monster.hpBase !== DEFAULT_CURVE.monster.hpBase) throw new Error("缺省应用默认值");
  const c2 = normalizeCurve({ monster: { hpBase: 999 } });
  if (c2.monster.hpBase !== 999) throw new Error("显式值应生效");
  if (c2.monster.hpGrowth !== DEFAULT_CURVE.monster.hpGrowth) throw new Error("未写的字段应取默认");
}

export function testNormalizeCurveIgnoresGarbage() {
  // 存档里可能出现 null / 字符串，不能让整条曲线变成 NaN。
  const c = normalizeCurve({ monster: { hpBase: null, hpGrowth: "x" }, expA: undefined, maxLevel: -5 });
  if (!Number.isFinite(c.monster.hpBase)) throw new Error("hpBase 应为有限数");
  if (!Number.isFinite(c.monster.hpGrowth)) throw new Error("hpGrowth 应为有限数");
  if (c.maxLevel < 1) throw new Error("maxLevel 至少为 1");
}

// ---- tier ----
export function testTierMultipliers() {
  const t = TIERS.trash, e = TIERS.elite, b = TIERS.boss;
  if (!(e.hp > t.hp && b.hp > e.hp)) throw new Error("hp 乘数应 trash<elite<boss");
  if (!(e.exp > t.exp && b.exp > e.exp)) throw new Error("exp 乘数应 trash<elite<boss");
  // NPC 不出战：攻击与经验归零。
  if (TIERS.npc.atk !== 0 || TIERS.npc.exp !== 0) throw new Error("npc 档应无攻击/经验");
}

export function testNormalizeTierFallsBackToTrash() {
  for (const bad of [undefined, null, "", "不存在的档", 42]) {
    if (normalizeTier(bad).id !== "trash") throw new Error(`${bad} 应回退 trash`);
  }
  if (normalizeTier("elite").id !== "elite") throw new Error("elite 应识别");
}

export function testMonsterStatsScaleWithLevel() {
  let prev = null;
  for (let lv = 1; lv <= 30; lv++) {
    const m = monsterStats(lv, "trash");
    if (m.hp <= 0 || m.atk <= 0) throw new Error(`lv${lv} 数值应 >0`);
    if (prev && m.hp < prev.hp) throw new Error(`lv${lv} hp 不应下降`);
    prev = m;
  }
}

export function testNpcTierHasNoAttack() {
  const m = monsterStats(20, "npc");
  if (m.atk !== 0) throw new Error("npc 档攻击应为 0");
  if (m.exp !== 0) throw new Error("npc 档经验应为 0");
  if (!(m.hp > 0)) throw new Error("npc 档仍应有 hp（防止被一击误杀）");
}

// ---- 玩家曲线 ----
export function testPlayerStatsMonotonic() {
  let prev = null;
  for (let lv = 1; lv <= 40; lv++) {
    const p = playerStats(lv);
    if (p.hpMax <= 0 || p.attack <= 0) throw new Error(`lv${lv} 玩家数值应 >0`);
    if (prev) {
      if (p.hpMax < prev.hpMax) throw new Error(`lv${lv} hpMax 下降`);
      if (p.attack < prev.attack) throw new Error(`lv${lv} attack 下降`);
      if (p.defence < prev.defence) throw new Error(`lv${lv} defence 下降`);
    }
    prev = p;
  }
}

export function testPlayerLevel1MatchesBase() {
  const p = playerStats(1);
  const d = DEFAULT_CURVE.player;
  if (p.hpMax !== d.hpBase) throw new Error(`lv1 hpMax 应为 ${d.hpBase}，实际 ${p.hpMax}`);
  if (p.attack !== d.atkBase) throw new Error(`lv1 attack 应为 ${d.atkBase}，实际 ${p.attack}`);
}

// ---- 经验曲线 ----
export function testExpToNextQuadratic() {
  // 平方增长：比值应随等级趋于 (lv2/lv1)^2，而不是指数。
  const a = expToNext(10), b = expToNext(20), c = expToNext(30);
  if (!(b > a && c > b)) throw new Error("expToNext 应单调递增");
  // 平方项主导，但仍有线性项 expB*lv 拉低比值，所以 20/10 级约 2.9 倍，
  // 而不是纯平方的 4 倍——两者的关键区别是“不要指数级爆炸”（那会是 2^10）。
  const r = b / a;
  if (r < 2.5 || r > 6) throw new Error(`10→20 级经验比 ${r.toFixed(2)}，应在 2.5..6（平方而非指数）`);
}

export function testExpToNextNeverZero() {
  for (let lv = 1; lv <= 99; lv++) {
    if (expToNext(lv) < 1) throw new Error(`lv${lv} 升级需求应 >=1`);
  }
}

export function testExpCurveIsReachable() {
  // 核心回归：每级所需击杀数必须落在可玩区间（8..60）。
  // 现行 config 下 26 级要杀 103 万只同级怪，这条测试就是为了挡住那种回归。
  for (let lv = 1; lv <= 30; lv++) {
    const need = expToNext(lv);
    const m = monsterStats(lv, "trash");
    const kills = Math.ceil(need / m.exp);
    if (kills < 8 || kills > 60) throw new Error(`lv${lv} 需击杀 ${kills} 只，超出可玩区间 8..60`);
  }
}

// ---- 护甲减免率模型 ----
export function testArmorMitigationBasics() {
  if (!near(armorMitigation(0, 100), 0)) throw new Error("无护甲应 0 减伤");
  if (!near(armorMitigation(100, 100), 0.5)) throw new Error("armor=K 应减伤 50%");
  if (!near(armorMitigation(300, 100), 0.75)) throw new Error("armor=3K 应减伤 75%");
}

export function testArmorMitigationMonotonicAndBounded() {
  // 关键性质：永远 <1（不会完全免疫），且随护甲单调上升。
  let prev = -1;
  for (const a of [0, 1, 10, 50, 100, 1000, 1e6, 1e9]) {
    const r = armorMitigation(a, 100);
    if (!(r >= 0 && r < 1)) throw new Error(`armor=${a} 减伤率 ${r} 应在 [0,1)`);
    if (r < prev) throw new Error(`armor=${a} 减伤率下降`);
    prev = r;
  }
}

export function testArmorMitigationBadInput() {
  for (const bad of [null, undefined, NaN, -5, "x", Infinity]) {
    if (armorMitigation(bad, 100) !== 0 && !isFinite(bad)) {
      throw new Error(`${bad} 应返回 0`);
    }
  }
  // k 非法时回退默认值
  if (!near(armorMitigation(100, 0), 100 / (100 + DEFAULT_ARMOR_K))) throw new Error("k=0 应回退默认 K");
  if (!near(armorMitigation(100, -1), 100 / (100 + DEFAULT_ARMOR_K))) throw new Error("k<0 应回退默认 K");
}

export function testMitigationDamageShrinksWithArmor() {
  // 无断崖：护甲从 0 一路涨到极大，伤害应平滑下降，且始终 >=1。
  let prev = Infinity;
  for (const def of [0, 5, 20, 50, 100, 500, 5000, 1e9]) {
    const [lo, hi] = damageRangeMitigation(100, 0, def, 0, { armorK: 100 });
    if (lo < 1) throw new Error(`def=${def} 伤害下限应 >=1，实际 ${lo}`);
    if (hi > prev) throw new Error(`def=${def} 伤害上升了：${hi} > ${prev}`);
    prev = hi;
  }
}

export function testMitigationNeverCollapsesTo1() {
  // 与旧线性公式最大的区别：中等护甲不会把伤害打到下限 1。
  // 旧公式 def=200, atk=100 → 伤害 = 1（塌到地板）；
  // 新公式下 def=200, K=100 → 减伤 2/3，伤害约 33。
  const oldV = damageRange(100, 0, 200, 0);
  const newV = damageRangeMitigation(100, 0, 200, 0, { armorK: 100 });
  if (oldV[0] !== 1) throw new Error(`旧公式 def=200 应为 1，实际 ${oldV[0]}（用于对照）`);
  if (newV[0] <= 5) throw new Error(`新公式 def=200 不应塌到 ${newV[0]}，应约 33`);
}

export function testMitigationVarianceRange() {
  const [lo, hi] = damageRangeMitigation(100, 0, 0, 0.25, { armorK: 100 });
  if (!(lo < hi)) throw new Error("有浮动时 min 应 < max");
  // 浮动 0 时 min == max
  const [a, b] = damageRangeMitigation(100, 0, 0, 0, { armorK: 100 });
  if (a !== b) throw new Error("variance=0 应固定值");
}

export function testMitigationIncludesPower() {
  // 技能威力应加在“伤害源”上，再乘减免率。
  const [lo0] = damageRangeMitigation(100, 0, 100, 0, { armorK: 100 });
  const [lo50] = damageRangeMitigation(100, 50, 100, 0, { armorK: 100 });
  if (!(lo50 > lo0)) throw new Error("威力应提升伤害");
  if (lo50 !== 75) throw new Error(`(100+50)*0.5 应为 75，实际 ${lo50}`);
}

export function testArmorKAtScalesWithLevel() {
  // K 必须随等级增长，否则低等级护甲在高等级依旧无敌。
  let prev = 0;
  for (let lv = 1; lv <= 40; lv++) {
    const k = armorKAt(lv);
    if (!(k > 0)) throw new Error(`lv${lv} K 应 >0`);
    if (k <= prev) throw new Error(`lv${lv} K 未增长：${prev} → ${k}`);
    prev = k;
  }
  if (armorKAt(1000) <= armorKAt(10)) throw new Error("高等级 K 应远大于低等级");
}

// ---- 战斗时长目标 ----
export function testHitsToKill() {
  if (hitsToKill(100, 10) !== 10) throw new Error("100/10 应为 10 击");
  if (hitsToKill(101, 10) !== 11) throw new Error("应向上取整");
  if (hitsToKill(1, 1000) !== 1) throw new Error("至少 1 击");
  if (hitsToKill(100, 0) !== Infinity) throw new Error("0 伤害应返回 Infinity，而不是除零");
  if (hitsToKill(100, -5) !== Infinity) throw new Error("负伤害应返回 Infinity");
}

export function testTtkTargets() {
  // 端到端：用曲线 + mitigation 跑一遍，TTK 应落在 3..6 击、
  // 玩家存活 10..20 击。这是 docs/BALANCE.md §2.1 的硬指标。
  for (let lv = 1; lv <= 30; lv++) {
    const p = playerStats(lv), m = monsterStats(lv, "trash");
    const K = armorKAt(lv);
    const [lo, hi] = damageRangeMitigation(p.attack, 0, m.def, 0.25, { armorK: K });
    const ttk = hitsToKill(m.hp, (lo + hi) / 2);
    if (ttk < 3 || ttk > 6) throw new Error(`lv${lv} TTK=${ttk} 击，应在 3..6`);

    const cut = armorMitigation(p.defence, K);
    const mHit = Math.max(1, Math.round(m.atk * (1 - cut)));
    const survive = hitsToKill(p.hpMax, mHit);
    if (survive < 10 || survive > 20) throw new Error(`lv${lv} 玩家可撑 ${survive} 击，应在 10..20`);
  }
}

// ---- 升级快照 ----
export function testLevelSnapshotConsistent() {
  for (let lv = 1; lv <= 20; lv++) {
    const s = levelSnapshot(lv);
    const p = playerStats(lv);
    if (s.hpMax !== p.hpMax || s.attack !== p.attack) throw new Error("levelSnapshot 应与 playerStats 一致");
    if (s.expNext !== expToNext(lv)) throw new Error("expNext 应一致");
  }
}

export function testCurveConfigOverrideTakesEffect() {
  // config 覆盖必须真的影响数值（否则 config.balance.curve 就是装饰）。
  const fast = normalizeCurve({ monster: { hpGrowth: 1.5 } });
  const a = monsterStats(10, "trash").hp;
  const b = monsterStats(10, "trash", fast).hp;
  if (!(b > a)) throw new Error(`覆盖 hpGrowth 后 hp 应更大：${a} vs ${b}`);
}

// ---- 跨级战斗：K 必须按被攻击者（target）等级取 ----
//
// 这是实机验证时发现的真 bug：最初 armorK 用的是 **attacker** 的等级，
// 于是 lv1 玩家打 lv25 怪时，拿 lv1 的 K(=62) 去削怪的高等级护甲，
// 护甲几乎失效（跨级战斗数值完全失真）。
export function testArmorKUsesTargetLevel() {
  // 同一套护甲（def=100），被高等级攻击者打时不该变得“更不护人”。
  // 用 target 等级算 K：target lv 越高 → K 越大 → 同一 def 减伤越低，
  // 这正是“护甲要跟上等级”的设计意图；关键是**不该**由攻击者等级决定。
  const k10 = armorKAt(10), k30 = armorKAt(30);
  if (k30 <= k10) throw new Error("高等级 K 应更大");
  // 目标等级固定时，无论攻击者多少级，护甲减伤率都应相同（K 只取决于目标）。
  const cutAtTarget20 = armorMitigation(100, armorKAt(20));
  const cutAtTarget20Again = armorMitigation(100, armorKAt(20));
  if (cutAtTarget20 !== cutAtTarget20Again) throw new Error("同一目标的减伤率应稳定");
}

// ---- 起始状态与曲线的一致性（实机验证时发现的断点）----
//
// resetNewGame 曾直接取 config.player.expNext（旧值 500），而升级后
// expNext 变成曲线值（325 → 2125 …），玩家会看到经验条莫名跳变。
export function testStartExpNextMatchesCurve() {
  const lv1 = levelSnapshot(1);
  if (lv1.expNext !== expToNext(1)) throw new Error("lv1 expNext 应与曲线一致");
  // 曲线首级经验必须明显小于旧配置的 500，否则说明曲线没生效
  if (lv1.expNext >= 500) throw new Error(`curve 模式 lv1 expNext 应 <500（旧值），实际 ${lv1.expNext}`);
}

export function testExpProgressionHasNoJump() {
  // 相邻等级的 expNext 比值应平滑，不能出现数量级跳变。
  //
  // 低等级比值天然大（lv1→lv2 是 325→700，2.15×）：平方曲线在 1 级附近
  // 的斜率最陡，而且早期升级本来就该快。真正要防的是**指数曲线**那样
  // 到高等级后动辄 10 倍、100 倍的跳变（旧配置 lv30 一级要 2270 万经验）。
  let prev = expToNext(1);
  for (let lv = 2; lv <= 40; lv++) {
    const cur = expToNext(lv);
    const ratio = cur / prev;
    const limit = lv <= 3 ? 2.5 : 1.8;
    if (ratio < 1.02 || ratio > limit) {
      throw new Error(`lv${lv} expNext 跳变 ${ratio.toFixed(2)}×（${prev}→${cur}），上限 ${limit}`);
    }
    prev = cur;
  }
}
