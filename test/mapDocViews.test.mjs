import { fromLegacyMap, attachLegacyViews, toLegacyMap } from "../src/content/mapDoc.js";
import { loadAllMaps, assert, assertEq } from "./helpers.mjs";

const oneRaw = () => { const m = loadAllMaps(); return m[Object.keys(m)[0]]; };

export function cellsWriteThrough() {
  const doc = attachLegacyViews(fromLegacyMap(oneRaw()));
  const c0 = doc.cells[0];
  assertEq([c0.row, c0.col, c0.dx, c0.dy], [0, 0, 1536, 0]);
  const orig = c0.sx;
  c0.sx = orig + 64;
  assertEq(doc.ground[0][0], orig + 64);
  c0.flag = 0;
  assertEq(doc.collision[0], 0);
  c0.trigger = 3;
  assertEq(doc.events[0].trigger, 3);
  c0.trigger = 0;
  assertEq(doc.events[0], undefined);        // 清空后删除
}

export function objectsProxy() {
  const doc = attachLegacyViews(fromLegacyMap(oneRaw()));
  const n0 = doc.objects.length;
  doc.objects.push({ sprite: [1, 2, 3, 4, 5, 6], tiles: [], layer: 1 });
  assertEq(doc.objects.length, n0 + 1);
  assertEq(doc.decorations.length, n0 + 1);
  const last = doc.objects[n0];
  assert(!!last.id, "应自动分配 id");
  last.layer = 2;
  assertEq(doc.decorations[n0].layer, 2);
  doc.objects.splice(n0, 1);
  assertEq(doc.objects.length, n0);
}

export function spawnsProxy() {
  const doc = attachLegacyViews(fromLegacyMap(oneRaw()));
  const n0 = doc.spawns.length;
  doc.spawns.push({ npc: 5, row: 3, col: 4 });
  assertEq(doc.spawns.length, n0 + 1);
  const u = doc.units[n0];
  assertEq([u.npc, u.r, u.c], [5, 3, 4]);
  const v = doc.spawns[n0];
  assertEq([v.npc, v.row, v.col], [5, 3, 4]);
  v.row = 9; v.col = 8;
  assertEq([u.r, u.c], [9, 8]);
  v.overrides = { speed: 10 };
  assertEq(u.overrides, { speed: 10 });
  delete v.overrides;
  assertEq(u.overrides, undefined);
  doc.spawns.splice(n0, 1);
  assertEq(doc.spawns.length, n0);
}

export function notSerialized() {
  const doc = attachLegacyViews(fromLegacyMap(oneRaw()));
  const json = JSON.parse(JSON.stringify(doc));
  assertEq("cells" in json, false);
  assertEq("objects" in json, false);
  assertEq("spawns" in json, false);
  assert(Array.isArray(json.ground) && Array.isArray(json.decorations) && Array.isArray(json.units));
  // 视图不影响 toLegacyMap（运行时构建仍正常）
  const back = toLegacyMap(doc);
  assertEq(back.spawns.length, doc.units.length);
}
