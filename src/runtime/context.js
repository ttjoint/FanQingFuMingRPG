// 运行时上下文（Composition Root）—— 运行时状态的**所有者**。
//
// 阶段 3 完成态：G / A / MAPS 在此声明并由上下文拥有；core/state.js 仅作兼容再导出，
// 因此旧代码 `import { G } from "core/state.js"` 不变，但状态归属已收敛到本模块。
// 建图函数（buildMapData）由入口注入，避免 context → world/map 的循环依赖。
import { setConfig } from "../core/config.js";
import { CFG } from "../core/config.js";
import { configureIso } from "../engine/iso.js";
import { createRegistry } from "../content/registry.js";
import { contentToLegacy } from "../content/contentdb.js";
import { toLegacyMap } from "../content/mapDoc.js";
import { buildFactionTable } from "../engine/faction.js";
import { buildAiTable } from "../engine/ai.js";
import { buildBuffTable } from "../engine/buff.js";
import { buildEffectTable } from "../engine/effect.js";

// 初始运行时状态（原先在 core/state.js）。
function createGameState() {
  return {
    stats: { hp: 200, hpMax: 200, mp: 100, mpMax: 100, exp: 0, expNext: 500, level: 1,
             money: 500, moral: 0, honor: 0, attack: 20, defence: 5, hit: 30 },
    player: null, npcs: [], vars: {}, inventory: {}, skills: (CFG.player.startSkills || []).slice(), skill: CFG.player.startSkill || (CFG.player.startSkills || [])[0],
    hotbar: new Array(9).fill(null), pack: [], packOpen: false,
    equip: { Wu: null, Jia: null, Shi1: null, Shi2: null }, cursor: null, shop: null, savePanel: false,
    settings: { bgm: 0.6, sfx: 0.8 }, settingsPanel: false, bgm: null, bgmSrc: null,
    factions: [], missions: {}, notes: [], vips: {}, love: {},
    dialog: null, tip: null, tipT: 0, script: null, gameOver: false, deathT: 0,
    currentMap: null, map: null, cam: { x: 0, y: 0 }, time: 0,
    panel: null, effects: [], projectiles: [], ground: [], triggerCD: 0, lastCell: null, hold: null, holdCell: null, holdTarget: null,
    fx: [], uiFx: null, moveMarker: null,
    scene: "boot", flashStep: 0, flashT: 0, resultTitle: null, pendingEnd: false,
    mouse: { x: 0, y: 0, sx: 0, sy: 0, wx: 0, wy: 0 },
  };
}

// 用 `let` 导出：上下文可重置/替换（为多文档与测试预留；正常游戏不替换）。
export let G = createGameState();
export let A = {};
export let MAPS = {};

export function createRuntime() {
  const rt = {
    get state() { return G; },
    get assets() { return A; },
    get maps() { return MAPS; },
    get config() { return CFG; },
    content: null, base: null, registry: null,

    // 装载内容：派生旧视图 + 重建全部运行时地图。buildMap 由入口注入。
    install(content, base, buildMap) {
      rt.content = content;
      if (base) rt.base = base;
      rt.registry = createRegistry(content);
      A.content = content;
      A.defaults = rt.base || content;

      const legacy = contentToLegacy(content);
      A.npcsData = legacy.npcs; A.items = legacy.items; A.skills = legacy.skills;
      A.scripts = legacy.scripts; A.game = legacy.game; A.transitions = legacy.transitions;
      A.mapsIndex = legacy.mapsIndex; A.config = legacy.config;
      setConfig(A.config);                                                  // 先装载配置，供后续派生
      if (A.config && A.config.iso) configureIso(A.config.iso);            // 等距几何（世界原点/菱形尺寸）由配置注入
      A.factions = legacy.factions || [];                                  // 阵营关系表（内容内置）
      A.factionTable = buildFactionTable(A.factions);                      // { byId, list }，运行时只读
      A.ais = legacy.ais || [];                                            // AI 配置表（内容内置）
      // AI targeting 缺省值由配置派生（索敌半径等平衡数值不再写死在引擎）。
      A.aiTable = buildAiTable(A.ais, { aggroRange: CFG.combat && CFG.combat.npcAggro });  // Map<id, plan>，运行时只读
      A.buffs = legacy.buffs || [];                                        // Buff 配置表（内容内置）
      A.buffTable = buildBuffTable(A.buffs);                               // { byId, list }，运行时只读
      A.effects = legacy.effects || [];                                    // 特效定义表（内容内置）
      A.effectTable = buildEffectTable(A.effects);                         // { byId, get, list }，运行时只读
      A.decorTemplates = legacy.decorTemplates || {};   // 跨地图共享的装饰物模板（手画地基线/单一深度）

      A.mapsManifest = content.mapsManifest;
      A.rawMaps = {};
      for (const n of content.mapsManifest) if (content.mapDocs[n]) A.rawMaps[n] = toLegacyMap(content.mapDocs[n]);
      rt.rebuildMaps(buildMap);
      return rt;
    },

    // 仅重建运行时地图（地图编辑后调用）。
    rebuildMaps(buildMap) {
      if (!rt.content || typeof buildMap !== "function") return;
      for (const n of rt.content.mapsManifest)
        if (rt.content.mapDocs[n]) MAPS[n] = buildMap(A, toLegacyMap(rt.content.mapDocs[n]));
    },

    registryOf(content) { return createRegistry(content || rt.content); },

    // 重置运行时（测试 / 多局）。importers 通过再导出的活绑定能看到新对象。
    reset() { G = createGameState(); A = {}; MAPS = {}; rt.content = null; rt.base = null; rt.registry = null; },
  };
  return rt;
}

let _rt = null;
export function getRuntime() { return _rt || (_rt = createRuntime()); }
