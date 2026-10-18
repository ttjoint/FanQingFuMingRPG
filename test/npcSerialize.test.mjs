import { diffNpcAgainst, npcFieldsFromSave, makeSchema } from "../src/engine/npcSerialize.js";
import { NPC_SCHEMA } from "../src/content/npcFields.js";
import { assert, assertEq } from "./helpers.mjs";

// NPC 存档差异化 + 还原（纯函数）。重点回归：货物背包（inventory）、阵营（faction）
// 等非默认字段必须在“存档 -> 还原”往返后保持不变。
// 引擎本身不认识具体字段：这里通过 npcFields 的 schema 显式注入（与运行时一致）。
const SCHEMA = makeSchema(NPC_SCHEMA.fields);
const diff = (u, t) => diffNpcAgainst(u, t, SCHEMA);
const restore = (t, s) => npcFieldsFromSave(t, s, SCHEMA);

const TEMPLATE = {
  id: 31, name: "郎中", model: "卖药人.pmg", portrait: "x.bmp", script: "",
  hp: 99, attack: 0, defence: 0, level: 1, exp: 0, hostile: 0, ai: 4,
  speed: 45, runSpeed: 70, drops: [], talks: [],
  inventory: { auto: "potion" }, faction: "",
};

// 按模板造一个“运行时实体”（含位置等非模板字段）。
function makeUnit(t, over) {
  return {
    id: t.id, name: t.name, model: (t.model || "").replace(/\.pmg$/, ""), portrait: t.portrait, script: t.script,
    hp: t.hp, hpMax: t.hp, atk: t.attack, def: t.defence, level: t.level, exp: t.exp,
    attackable: t.attack > 0, aggressive: !!t.hostile, ai: t.ai, speed: t.speed, runSpeed: t.runSpeed,
    drops: t.drops, inventory: t.inventory, faction: t.faction, talks: t.talks, talk: "",
    skills: Array.isArray(t.skillList) ? t.skillList.slice() : [],
    x: 100, y: 200, dir: 4, dead: false,
    ...over,
  };
}

export function unchangedUnitDiffsToPositionOnly() {
  const u = makeUnit(TEMPLATE);
  const d = diff(u, TEMPLATE);
  // 与模板一致 -> 只存位置/生死
  assertEq(Object.keys(d).sort(), ["dead", "dir", "id", "x", "y"], "未改动的字段不应进存档");
}

export function merchantInventorySurvivesRoundTrip() {
  const u = makeUnit(TEMPLATE);
  const d = diff(u, TEMPLATE);            // 与模板相同 -> 存档里没有 inventory
  const restored = restore(TEMPLATE, d);  // 但还原时应从模板取回
  assertEq(restored.inventory && restored.inventory.auto, "potion", "货物背包应经模板还原");
  assertEq(restored.name, "郎中", "名称还原");
}

export function changedInventoryIsStored() {
  const u = makeUnit(TEMPLATE, { inventory: { stock: [{ name: "金创药", count: 5 }] } });
  const d = diff(u, TEMPLATE);
  assert(d.inventory && d.inventory.stock[0].count === 5, "改动过的货物背包应写入存档");
  const restored = restore(TEMPLATE, d);
  assertEq(restored.inventory.stock[0].count, 5, "还原后仍是改动值");
}

export function factionRoundTrip() {
  // 模板无阵营，实例被脚本改成 qing -> 存档须记下，还原须恢复
  const u = makeUnit(TEMPLATE, { faction: "qing" });
  const d = diff(u, TEMPLATE);
  assertEq(d.faction, "qing", "动态阵营应写入存档");
  assertEq(restore(TEMPLATE, d).faction, "qing", "动态阵营应还原");
}

export function deadAndMovedStored() {
  const u = makeUnit(TEMPLATE, { x: 42, y: 43, dir: 2, dead: true });
  const d = diff(u, TEMPLATE);
  assertEq(d.x, 42); assertEq(d.y, 43); assertEq(d.dir, 2); assertEq(d.dead, true);
  const restored = restore(TEMPLATE, d);
  assertEq(restored.name, "郎中", "其余字段仍从模板补齐");
}

export function missingTemplateFallsBack() {
  // 模板缺失（例如地图单位引用了已删除的 NPC）：用默认值，不崩
  const d = { id: 999, x: 1, y: 2, dir: 0, dead: false, name: "幽灵" };
  const restored = restore(undefined, d);
  assertEq(restored.name, "幽灵", "存档里的名称保留");
  assertEq(restored.hp, 0, "模板缺失时 hp 用默认 0");
  assertEq(restored.inventory, null, "模板缺失时无货物背包");
}
