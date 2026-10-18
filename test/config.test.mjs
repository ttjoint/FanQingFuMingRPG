// 配置单一事实来源 + 数据驱动结局标记。
import { DEFAULT_CONFIG, CFG, setConfig } from "../src/core/config.js";
import { normalizeConfig } from "../src/content/schema.js";
import { assert, assertEq } from "./helpers.mjs";
import { readJSON, ASSETS_DIR } from "./helpers.mjs";

// 主角初始技能来自配置（不再硬编码在引擎里）。
export function startSkillsFromConfig() {
  assert(Array.isArray(DEFAULT_CONFIG.player.startSkills), "默认配置应有 startSkills");
  assert(DEFAULT_CONFIG.player.startSkills.length > 0, "startSkills 非空");
  assertEq(DEFAULT_CONFIG.player.startSkill, DEFAULT_CONFIG.player.startSkills[0], "startSkill 默认取第一项");
}

// core/config.js 与 content/schema.js 的默认配置必须同源（曾各写一份、数值还漂移）。
export function configSingleSource() {
  assertEq(normalizeConfig(null), JSON.parse(JSON.stringify(DEFAULT_CONFIG)), "normalizeConfig(null) 应等于默认配置");
  // 外部配置能覆盖 startSkills（数组），且缺失字段保留默认。
  const c = normalizeConfig({ player: { startSkills: ["烈焰斩"], hpMax: 999 } });
  assertEq(c.player.startSkills, ["烈焰斩"], "startSkills 可被覆盖");
  assertEq(c.player.hpMax, 999, "hpMax 可被覆盖");
  assertEq(c.player.startSkill, DEFAULT_CONFIG.player.startSkill, "未覆盖字段保留默认");
}

// 经济参数（卖出折扣）与引擎调优参数（移速 / 近战分界）来自配置。
export function economyConfig() {
  assert(DEFAULT_CONFIG.economy && DEFAULT_CONFIG.economy.sellRate != null, "应有 economy.sellRate");
  assertEq(DEFAULT_CONFIG.economy.sellRate, 0.5, "默认卖出折扣 0.5");
  assert(DEFAULT_CONFIG.move && DEFAULT_CONFIG.move.walkSpeed != null, "应有 move.walkSpeed");
  assert(DEFAULT_CONFIG.move && DEFAULT_CONFIG.move.runSpeed != null, "应有 move.runSpeed");
  assert(DEFAULT_CONFIG.combat && DEFAULT_CONFIG.combat.meleeMaxRange != null, "应有 combat.meleeMaxRange");
  assert(DEFAULT_CONFIG.iso && DEFAULT_CONFIG.iso.originX != null, "应有 iso 几何");
  assert(DEFAULT_CONFIG.inventory && DEFAULT_CONFIG.inventory.packItem, "应有 inventory.packItem");
}

// 真实 assets/config.json 应携带这两项（版本库为数据事实来源）。
export function assetsConfigHasNewFields() {
  const cfg = readJSON(ASSETS_DIR + "/config.json");
  assert(Array.isArray(cfg.player.startSkills) && cfg.player.startSkills.length, "assets 配置应带 startSkills");
  assert(cfg.economy && cfg.economy.sellRate != null, "assets 配置应带 economy.sellRate");
  assert(cfg.move && cfg.move.walkSpeed != null && cfg.move.runSpeed != null, "assets 配置应带 move 移速");
  assert(cfg.combat && cfg.combat.meleeMaxRange != null, "assets 配置应带 combat.meleeMaxRange");
  assert(cfg.iso && cfg.iso.originX != null && cfg.iso.halfW != null, "assets 配置应带 iso 几何");
  assert(cfg.inventory && cfg.inventory.packItem, "assets 配置应带 inventory.packItem");
  // setConfig 后运行时 CFG 生效
  setConfig(cfg);
  assertEq(CFG.player.startSkills, cfg.player.startSkills, "setConfig 后 CFG 生效");
}

// 结局由剧本显式命令 ShowEnding() 触发（不再扫描对白文本里的“游戏结束”关键字）。
export function endingIsDataDriven() {
  const scripts = readJSON(ASSETS_DIR + "/scripts.json");
  const finals = Object.keys(scripts).filter(k => String(scripts[k]).includes("ShowEnding()"));
  assert(finals.length > 0, "至少一个剧本应显式调用 ShowEnding()");
}
