import { normalizeSave, migrateSave, SAVE_VERSION } from "../src/content/saveSchema.js";
import { assert, assertEq } from "./helpers.mjs";

export function fillsDefaults() {
  const s = normalizeSave({});
  assertEq(s.schemaVersion, SAVE_VERSION);
  assertEq(s.hotbar.length, 9);
  assertEq(s.stats.level, 1);
  assertEq(s.equip.Wu, null);
  assert(Array.isArray(s.pack) && Array.isArray(s.ground) && Array.isArray(s.npcs));
  assertEq(s.player, null);
}

export function keepsProvided() {
  const s = normalizeSave({ stats: { hp: 42 }, currentMap: "孙家庄", player: { x: 1, y: 2, dir: 4 }, skill: "长剑" });
  assertEq(s.stats.hp, 42);
  assertEq(s.stats.level, 1);          // 缺字段补默认
  assertEq(s.currentMap, "孙家庄");
  assertEq(s.player, { x: 1, y: 2, dir: 4 });
}

export function rejectsNewer() {
  let threw = false;
  try { normalizeSave({ schemaVersion: SAVE_VERSION + 5 }); } catch (e) { threw = true; }
  assert(threw, "过新存档应拒绝");
}

export function legacyVersionField() {
  // 老存档用 v 表示版本：migrateSave 应识别并升到当前版本
  const s = migrateSave({ v: 1, stats: {} });
  assert(s);
}
