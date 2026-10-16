// 可编辑的全局数值配置（由 assets/config.json 提供默认值，编辑器可覆盖）。
// 运行时逻辑统一从这里读取，避免把“升级常数/战斗常数”散落成魔法数字。
// 这里是**单一事实来源**：content/schema.js 与 assets/config.json 都以此为基准。
export const DEFAULT_CONFIG = {
  player: {
    hpMax: 200, mpMax: 100, expNext: 500, level: 1, money: 500, moral: 0, honor: 0,
    attack: 20, defence: 5, hit: 30,
    startSkills: ["长剑"], startSkill: "长剑",
  },
  levelUp: { expMul: 1.5, expAdd: 200, hpMax: 40, mpMax: 20, attack: 5, defence: 3, hit: 3, maxLevel: 99, healOnLevel: true },
  combat: { rangeMin: 40, attackCD: 0.9, mpDrainRun: 1.6, npcAttackCD: 1.1, npcAggro: 260, npcMelee: 46, npcHitBase: 20, npcHitPerLevel: 60, meleeMaxRange: 60 },
  economy: { sellRate: 0.5 },
  inventory: { packItem: "包裹", packSize: 25 },
  move: { walkSpeed: 90, runSpeed: 150 },
  iso: { originX: 1568, halfW: 32, halfH: 16 },
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
