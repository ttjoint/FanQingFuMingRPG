import { createRuntime } from "../src/runtime/context.js";
import { buildContentDB } from "../src/content/contentdb.js";
import { fromLegacyMap } from "../src/content/mapDoc.js";
import { loadAssets, loadAllMaps, assert, assertEq } from "./helpers.mjs";

// 上下文是运行时状态的装配点：install 派生旧视图 + 用注入的 buildMap 重建地图。
export function installDerivesViews() {
  const maps = loadAllMaps(), docs = {};
  for (const n in maps) docs[n] = fromLegacyMap(maps[n]);
  const base = buildContentDB(loadAssets(), docs);

  const built = [];
  const rt = createRuntime();
  rt.install(base, base, (assets, legacy) => { built.push(legacy.width); return { ok: true, width: legacy.width }; });

  assertEq(rt.assets.npcsData.length, base.npcOrder.length, "npcsData 应由 ContentDB 派生");
  assert(rt.assets.content === base, "A.content 应指向 ContentDB");
  assert(rt.assets.defaults === base, "A.defaults 应为基准");
  assertEq(built.length, Object.keys(base.mapDocs).length, "每张地图都应构建");
  assertEq(rt.maps["孙家庄"], { ok: true, width: base.mapDocs["孙家庄"].width });
  assert(rt.registry.get("item", "金创药"), "registry 可用");
}
