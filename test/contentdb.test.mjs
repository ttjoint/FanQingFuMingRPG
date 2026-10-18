import { buildContentDB, contentToLegacy, diffContent, applyPatch, resolveNpc } from "../src/content/contentdb.js";
import { fromLegacyMap } from "../src/content/mapDoc.js";
import { loadAssets, loadAllMaps, assert, assertEq } from "./helpers.mjs";

function docs() { const maps = loadAllMaps(), out = {}; for (const n in maps) out[n] = fromLegacyMap(maps[n]); return out; }

export function buildAndToLegacy() {
  const assets = loadAssets();
  const content = buildContentDB(assets, docs());
  assertEq(Object.keys(content.npcs).length, assets.npcs.length, "npc 数量");
  assertEq(Object.keys(content.items).length, assets.items.length, "item 数量");
  assertEq(Object.keys(content.skills).length, assets.skills.length, "skill 数量");
  const legacy = contentToLegacy(content);
  assertEq(legacy.npcs.length, assets.npcs.length);
  assert(legacy.npcs.every(n => typeof n.speed === "number"), "全部 NPC 补齐速度默认值");
  assertEq(legacy.mapsManifest.length, assets.mapsManifest.length);
}

// 阵营关系表随内容构建，并在新旧视图间保留；内容包可整表覆盖。
export function factionsInContent() {
  const assets = loadAssets();
  const content = buildContentDB(assets, {});
  assertEq(content.factions.length, assets.factions.length, "阵营表随内容构建");
  assertEq(contentToLegacy(content).factions.length, assets.factions.length, "旧视图应带出阵营表");
  // NPC faction 缺省为空字符串（用兼容层派生）
  assert(content.npcOrder.every(id => typeof content.npcs[id].faction === "string"), "NPC faction 规整为字符串");
  // 内容包覆盖阵营表
  const next = JSON.parse(JSON.stringify(content));
  next.factions.push({ id: "newf", name: "新阵营", hostileTo: ["player"] });
  const patch = diffContent(content, next);
  assert(patch.content && patch.content.factions, "阵营表变化应进补丁");
  assertEq(applyPatch(content, patch).factions.length, assets.factions.length + 1, "应用补丁后表生效");
}

export function patchRoundTrip() {
  const content = buildContentDB(loadAssets(), {});
  const next = JSON.parse(JSON.stringify(content));
  next.npcs["15"].speed = 123;
  next.npcs["999"] = { id: 999, name: "新怪", speed: 50 };
  delete next.npcs["1"];
  const patch = diffContent(content, next);
  assert(patch.content && patch.content.npcs["15"], "应记录修改");
  assertEq(patch.content.removedNpcs, ["1"], "应记录删除");
  const applied = applyPatch(content, patch);
  assertEq(applied.npcs["15"].speed, 123);
  assert(applied.npcs["999"], "新增应存在");
  assert(!applied.npcs["1"], "删除应生效");
  assertEq(applied.npcOrder.includes("999"), true);
  assertEq(applied.npcOrder.includes("1"), false);
}

export function emptyPatchWhenEqual() {
  const content = buildContentDB(loadAssets(), {});
  const patch = diffContent(content, content);
  assertEq(patch, {});
}

export function resolveOverride() {
  const def = { id: 5, name: "A", speed: 45, drops: [{ name: "x", count: 1 }] };
  const r = resolveNpc(def, { speed: 99, name: "B" });
  assertEq(r.speed, 99);
  assertEq(r.name, "B");
  assertEq(r.drops, def.drops);          // 未覆盖字段继承模板
  assertEq(resolveNpc(def, null), def);  // 无 overrides 返回原对象
  assertEq(resolveNpc(def, {}), def);
}
