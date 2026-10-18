import { buildContentDB } from "../src/content/contentdb.js";
import { createRegistry } from "../src/content/registry.js";
import { loadAssets, loadAllMaps, assert } from "./helpers.mjs";
import { fromLegacyMap } from "../src/content/mapDoc.js";

export function lookup() {
  const maps = loadAllMaps(), docs = {}; for (const n in maps) docs[n] = fromLegacyMap(maps[n]);
  const content = buildContentDB(loadAssets(), docs);
  const r = createRegistry(content);
  assert(r.get("item", "金创药"), "应能按 id 取物品");
  assert(r.has("script", "main.gsp"), "应能取脚本");
  assert(r.get("npc", "8"), "应能按字符串 id 取 NPC");
  assert(Array.isArray(r.validate()), "validate 返回数组");
}
