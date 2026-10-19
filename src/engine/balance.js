// 数值曲线（balance）：纯函数，无 DOM / 无运行时状态。
//
// 为什么需要独立一层：
//   项目早期是「低命中率 + 固定攻击力」模型，改成「完全命中 + 攻击力浮动」后
//   公式换了、数值没跟着调，于是出现了两极分化：
//     - 野猴 lv9 30hp（一击必死），沈慈 lv15 10000hp（要砍 125 击）；
//     - 山贼 lv25 对玩家只有 2 点伤害（等于无敌），清将 lv20 却有 69；
//     - 升级要 2270 万经验，而同级怪只给 22 点（需击杀 103 万只）。
//   根因是**没有一条统一的曲线**：每只怪的数字都是手拍的。
//
// 这一层把「等级 → 基准数值」和「档次（tier）→ 乘数」固化下来，
// 让内容数据可以被生成/校验，而不是靠感觉。
//
// 设计取向（与暗黑类 / 常见 RPG 一致）：
//   - 怪物血量/攻击随等级**温和指数**增长（每级约 +13% / +9%）；
//     指数是必要的：玩家会装装备、加属性，线性怪物会在中后期变成纸片。
//   - 玩家成长也是指数，但**斜率更小**（+8% / +7%）：
//     差额由装备补，这样“换装备”才会有实感。
//   - 经验曲线接近平方（而不是指数）：指数经验 + 指数怪物经验会让
//     “每级所需击杀数”也指数增长，几十级后直接不可玩。
//   - 所有函数都是显式的（参数化），便于不同版本/难度复用与单测。

/** 怪物档次：决定同一等级下“杂兵 / 精英 / 首领”的强度倍率。
 *
 * hp 倍率与 atk 倍率是一起调的：先把 boss 定到 hp×12 / atk×1.8，
 * 实测结果是“TTK 76 击 / 玩家只能撑 9 击”——必死，不是“难”。
 * 改成 hp×5 / atk×1.35 后：TTK 约 20 击、玩家能撑 13–14 击，
 * 落在 docs/BALANCE.md §2.1 的“精英/boss TTK 15–25 击”区间。
 *
 * 经验倍率保持相对高（boss 应该是“打一只顶一群”），
 * 因为它是挑战奖励，不是刷怪效率。
 */
export const TIERS = {
  trash: { id: "trash", name: "普通", hp: 1, atk: 1, def: 1, exp: 1 },
  elite: { id: "elite", name: "精英", hp: 3, atk: 1.15, def: 1.5, exp: 3 },
  boss: { id: "boss", name: "首领", hp: 5, atk: 1.35, def: 2, exp: 6 },
  // 友好 NPC：不出战。hp 保留（剧情里不能被一击误杀），攻防经验归零。
  npc: { id: "npc", name: "NPC", hp: 5, atk: 0, def: 1, exp: 0 },
};

/**
 * 默认曲线参数。全部可在 config.balance 里覆盖。
 *
 * growth* 是**每级乘数**；base* 是 1 级时的基准值。
 */
export const DEFAULT_CURVE = {
  // 怪物基准（trash 档）
  //
  // 参数是跑过数值报告后选的：
  //   TTK（同级普通怪）3–6 击；玩家能撑 16–20 击；每级需击杀 11–53 只。
  // 调整时必须重跑 tools/balance-report.mjs，不要凭感觉改。
  monster: {
    hpBase: 55, hpGrowth: 1.115,
    atkBase: 11, atkGrowth: 1.09,
    defBase: 3, defGrowth: 1.09,
    expBase: 30, expGrowth: 1.15,
  },
  // 玩家基准
  //
  // 攻击成长（+9%）故意比怪物血量（+11.5%）稍慢：差额由装备补，
  // “换装备”才会有实感。如果玩家曲线跑得比怪快，中后期装备就变成摆设。
  player: {
    hpBase: 200, hpGrowth: 1.08,
    atkBase: 20, atkGrowth: 1.09,
    defBase: 5, defGrowth: 1.07,
    mpBase: 100, mpGrowth: 1.06,
  },
  // 升级所需经验：expNext(lv) = expA*lv^2 + expB*lv
  // 平方项让“每级所需击杀数”温和上升，而不是指数爆炸。
  expA: 25, expB: 300,
  maxLevel: 99,
  // 护甲减伤 50% 对应的护甲值：K = armorKBase + armorKPerLevel × 等级。
  // 必须随等级缩放：否则低等级护甲在高等级依旧无敌（反之一样）。
  armorKBase: 50, armorKPerLevel: 12,
};

// 全部数值都除以下限，避免某处配置写 0 导致整条曲线归零。
const MIN = 1;

/** 取一个有限数值，非法时返回 fallback。 */
function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 等级钳到 [1, ...]，非数字按 1。 */
function lv1(lv) {
  const n = Math.floor(num(lv, 1));
  return n < 1 ? 1 : n;
}

/**
 * 指数曲线取值：base × growth^(lv-1)，四舍五入并至少为 1。
 *
 * 用 Math.pow 而不是循环，保证 O(1) 且与等级无关的误差。
 *
 * @param {number} base 1 级基准值
 * @param {number} growth 每级乘数
 * @param {number} lv 等级（从 1 开始）
 * @returns {number}
 */
export function curveAt(base, growth, lv) {
  const b = num(base, 1);
  const g = num(growth, 1);
  const n = lv1(lv);
  if (b <= 0) return 0;
  const raw = b * Math.pow(g, n - 1);
  return Math.max(MIN, Math.round(raw));
}

/**
 * 归一化曲线配置：缺省字段用默认值补齐。
 * 这样存档/内容里只写想改的那几项即可。
 *
 * @param {any} curve
 * @returns {typeof DEFAULT_CURVE}
 */
export function normalizeCurve(curve) {
  const c = curve || {};
  const mon = c.monster || {}, pl = c.player || {};
  const d = DEFAULT_CURVE;
  return {
    monster: {
      hpBase: num(mon.hpBase, d.monster.hpBase), hpGrowth: num(mon.hpGrowth, d.monster.hpGrowth),
      atkBase: num(mon.atkBase, d.monster.atkBase), atkGrowth: num(mon.atkGrowth, d.monster.atkGrowth),
      defBase: num(mon.defBase, d.monster.defBase), defGrowth: num(mon.defGrowth, d.monster.defGrowth),
      expBase: num(mon.expBase, d.monster.expBase), expGrowth: num(mon.expGrowth, d.monster.expGrowth),
    },
    player: {
      hpBase: num(pl.hpBase, d.player.hpBase), hpGrowth: num(pl.hpGrowth, d.player.hpGrowth),
      atkBase: num(pl.atkBase, d.player.atkBase), atkGrowth: num(pl.atkGrowth, d.player.atkGrowth),
      defBase: num(pl.defBase, d.player.defBase), defGrowth: num(pl.defGrowth, d.player.defGrowth),
      mpBase: num(pl.mpBase, d.player.mpBase), mpGrowth: num(pl.mpGrowth, d.player.mpGrowth),
    },
    expA: num(c.expA, d.expA), expB: num(c.expB, d.expB),
    maxLevel: Math.max(1, Math.floor(num(c.maxLevel, d.maxLevel))),
    armorKBase: num(c.armorKBase, d.armorKBase),
    armorKPerLevel: num(c.armorKPerLevel, d.armorKPerLevel),
  };
}

/**
 * 归一化档次 id：未知/缺失一律按 trash（“查不到就当杂兵”，
 * 而不是报错——老存档里可能有新加的档位名）。
 * @param {any} tier
 * @returns {typeof TIERS.trash}
 */
export function normalizeTier(tier) {
  const id = String(tier || "").trim();
  return TIERS[id] || TIERS.trash;
}

/**
 * 某等级、某档次的怪物基准数值。
 *
 * @param {number} lv 怪物等级
 * @param {string} [tier] trash / elite / boss / npc
 * @param {any} [curve] config.balance（可缺省）
 * @returns {{hp:number, atk:number, def:number, exp:number}}
 */
export function monsterStats(lv, tier, curve) {
  const c = normalizeCurve(curve);
  const t = normalizeTier(tier);
  const m = c.monster;
  return {
    hp: Math.max(MIN, Math.round(curveAt(m.hpBase, m.hpGrowth, lv) * t.hp)),
    atk: t.atk <= 0 ? 0 : Math.max(MIN, Math.round(curveAt(m.atkBase, m.atkGrowth, lv) * t.atk)),
    def: Math.max(0, Math.round(curveAt(m.defBase, m.defGrowth, lv) * t.def)),
    exp: t.exp <= 0 ? 0 : Math.max(0, Math.round(curveAt(m.expBase, m.expGrowth, lv) * t.exp)),
  };
}

/**
 * 某等级的玩家基准数值（不含装备）。
 *
 * @param {number} lv
 * @param {any} [curve]
 * @returns {{hpMax:number, mpMax:number, attack:number, defence:number}}
 */
export function playerStats(lv, curve) {
  const c = normalizeCurve(curve);
  const p = c.player;
  return {
    hpMax: curveAt(p.hpBase, p.hpGrowth, lv),
    mpMax: curveAt(p.mpBase, p.mpGrowth, lv),
    attack: curveAt(p.atkBase, p.atkGrowth, lv),
    defence: Math.max(0, Math.round(curveAt(p.defBase, p.defGrowth, lv))),
  };
}

/**
 * 从 lv 升到 lv+1 所需经验：expA*lv^2 + expB*lv。
 *
 * 用平方而不是指数：指数会让「每级所需击杀数」也指数增长（现行配置下
 * 26 级要杀 103 万只同级怪）。平方能让击杀数保持在同一数量级。
 *
 * @param {number} lv 当前等级
 * @param {any} [curve]
 * @returns {number}
 */
export function expToNext(lv, curve) {
  const c = normalizeCurve(curve);
  const n = lv1(lv);
  const raw = c.expA * n * n + c.expB * n;
  return Math.max(1, Math.round(raw));
}

/**
 * 某等级对应的“减伤 50% 护甲值”K。
 *
 * K = base + perLevel × 等级。必须随等级缩放：若不缩放，
 * 低等级玩家的护甲在高等级依旧提供 50% 减伤（相当于无敌）。
 *
 * @param {number} lv
 * @param {any} [curve]
 * @returns {number}
 */
export function armorKAt(lv, curve) {
  const c = normalizeCurve(curve);
  const n = lv1(lv);
  const k = c.armorKBase + c.armorKPerLevel * n;
  return k > 0 ? k : 1;
}

/**
 * 单场战斗时长（击数）估算：敌方 hp / 我方每击伤害。
 *
 * 用于数值报告与回归校验，不参与战斗结算。
 *
 * @param {number} targetHp
 * @param {number} perHit 每击平均伤害
 * @returns {number} 击数（向上取整，至少 1）
 */
export function hitsToKill(targetHp, perHit) {
  const hp = num(targetHp, 0);
  const d = num(perHit, 0);
  if (d <= 0) return Infinity;
  return Math.max(1, Math.ceil(hp / d));
}

/**
 * 升级后的玩家数值快照（纯函数，供 systems 层与报告共用）。
 *
 * 注意：**不**取代 config.player / config.levelUp 的旧行为——
 * 是否使用曲线由 config.balance.mode 控制（见 systems/inventory.js）。
 *
 * @param {number} lv
 * @param {any} [curve]
 * @returns {{hpMax:number, mpMax:number, attack:number, defence:number, expNext:number}}
 */
export function levelSnapshot(lv, curve) {
  const s = playerStats(lv, curve);
  return { ...s, expNext: expToNext(lv, curve) };
}
