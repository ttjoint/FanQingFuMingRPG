// 可编辑的全局数值配置（由 assets/config.json 提供默认值，编辑器可覆盖）。
// 运行时逻辑统一从这里读取，避免把“升级常数/战斗常数”散落成魔法数字。
// 这里是**单一事实来源**：content/schema.js 与 assets/config.json 都以此为基准。
export const DEFAULT_CONFIG = {
  player: {
    hpMax: 200, mpMax: 100, expNext: 500, level: 1, money: 500, moral: 0, honor: 0,
    attack: 20, defence: 5, attackSpeed: 30,
    startSkills: ["长剑"], startSkill: "长剑",
  },
  levelUp: { expMul: 1.5, expAdd: 200, hpMax: 40, mpMax: 20, attack: 5, defence: 3, attackSpeed: 3, maxLevel: 99, healOnLevel: true },
  combat: { rangeMin: 40, attackCD: 0.9, mpDrainRun: 1.6, npcAttackCD: 1.1, npcAggro: 260, npcMelee: 46, meleeMaxRange: 60,
            // 命中已改为“结算瞬间距离判定”：范围内必中，跑出 range+hitBuffer 才落空。
            hitBuffer: 40, damageVariance: 0.25,
            // 抗性上限（百分数）：超过此值的抗性不再生效，除非内容显式抬高。
            // 抗性 >=100 仍为完全免疫（优先级高于此上限，见 engine/damage.js）。
            maxResist: 75 },
  // 经济与掉落旋钮。
  // - sellRate：卖价系数。
  // - dropRate：全局掉落率倍率（1=原样，0.5=减半，2=翻倍）。
  // - players ：人数（暗黑2 风格），掉落几率 × sqrt(players)。
  // - rarityLevelStep / rarityStrength：怪物等级每 N 级把稀有度权重往上挪一档，
  //   每次挪「当前权重 × strength」。曲线见 engine/lootScale.js。
  economy: { sellRate: 0.5, dropRate: 1, players: 1, rarityLevelStep: 5, rarityStrength: 0.5, gambleBase: 120, gambleLevelStep: 8 },
  inventory: { packItem: "包裹", packSize: 25 },
  // 共享仓库（P4）：账号级、不随存档。格子数影响玩家能攒多少东西。
  stash: { size: 100 },
  // 掉落物：存在时长 / 散布 / 拾取与保护 / 地面堆叠合并半径。
  items: { dropTtl: 0, dropScatter: 22, pickupRadius: 20, pickupDelay: 0, stackRadius: 18, maxEnhance: 10, enhancePriceBase: 50, enhancePriceMul: 1.6, socketFailChance: 0, durabilityLossOnHit: 0.5,
    // 铁匠（P4）：修理按"缺失耐久占比 × 物品价 × repairRate"计价；
    // 鉴定按稀有度倍率；赌博底价随等级上涨。三者都是金币出口。
    repairRate: 0.6, identifyBase: 20 },
  // 强化等级每级对 atk/def 的加成（applyBonus/instanceStats 读它）。
  itemEnhance: { enhancePerLevel: 2 },
  // 特效/指示：层级、颜色、开关（可由内容覆盖）。
  fx: { uiRings: true, moveMarker: true, itemHighlight: true,
        ring: { target: "#e04040", interact: "#4080ff", move: "#ffe08a" } },
  move: { walkSpeed: 90, runSpeed: 150 },
  iso: { originX: 1568, halfW: 32, halfH: 16 },
  // 音频默认音量（0~1）。玩家在游戏设置面板里改的值存 localStorage，会覆盖这里的默认。
  // 之前这两个值是硬编码在 runtime/context.js 的 createGameState() 里，没法配。
  audio: { bgm: 0.6, sfx: 0.8 },
};

const deep = o => JSON.parse(JSON.stringify(o));

// 运行中的生效配置（启动时用 setConfig 覆盖）。
export const CFG = deep(DEFAULT_CONFIG);

// 把（可能缺字段的）外部配置合并进 CFG，未知字段忽略，缺失字段保留默认。
export function setConfig(c) {
  if (!c) return;
  for (const sec of Object.keys(DEFAULT_CONFIG)) {
    const src = c[sec];
    if (!src) continue;
    for (const k of Object.keys(DEFAULT_CONFIG[sec])) if (src[k] != null) CFG[sec][k] = src[k];
  }
}
