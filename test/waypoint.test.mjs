// P4 传送点：纯逻辑（engine/waypoint.js）。
import assert from "node:assert/strict";
import {
  normalizeWaypoints, waypointTable, isUnlocked, unlock,
  groupByAct, travelTargets, canTravel, waypointAtCell, touchWaypoint,
} from "../src/engine/waypoint.js";

const RAW = [
  { id: "a", name: "甲地", map: "平原", row: 3, col: 4, act: 1 },
  { id: "b", name: "乙地", map: "扬州", row: 5, col: 6, act: 2 },
  { id: "c", name: "丙地", map: "平原", row: 7, col: 8, act: 1 },
];

export function normalizeDropsInvalidEntries() {
  // 缺 id / 缺 map 的都无法使用；脏数据来自编辑器或手改 JSON
  const list = normalizeWaypoints([
    { id: "ok", map: "平原", row: 1, col: 2 },
    { id: "", map: "平原" },
    { map: "平原" },
    { id: "nomap" },
    null,
    "字符串不是对象",
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "ok");
}

export function normalizeFillsDefaults() {
  const [w] = normalizeWaypoints([{ id: "x", map: "平原" }]);
  assert.equal(w.name, "x", "缺 name 时用 id 兜底，否则 UI 显示空白行");
  assert.equal(w.row, 0);
  assert.equal(w.col, 0);
  assert.equal(w.act, 0);
  assert.equal(w.desc, "");
  // 负数/小数坐标被夹正
  const [n] = normalizeWaypoints([{ id: "y", map: "平原", row: -5, col: 2.7 }]);
  assert.equal(n.row, 0);
  assert.equal(n.col, 2);
}

export function normalizeDedupesById() {
  // 重复 id 会让"解锁状态"串台（解锁一个等于解锁两个），必须去重保留先出现的
  const list = normalizeWaypoints([
    { id: "dup", map: "平原", row: 1, col: 1 },
    { id: "dup", map: "扬州", row: 9, col: 9 },
  ]);
  assert.equal(list.length, 1);
  assert.equal(list[0].map, "平原");
}

export function tableLookup() {
  const m = waypointTable(RAW);
  assert.equal(m.size, 3);
  assert.equal(m.get("b").map, "扬州");
  assert.equal(m.get("不存在"), undefined);
}

export function unlockIsIdempotent() {
  const un = {};
  assert.equal(isUnlocked(un, "a"), false);
  assert.equal(unlock(un, "a"), true, "首次解锁应报告变化");
  assert.equal(unlock(un, "a"), false, "重复解锁不再报告变化（避免重复提示/多次存档标脏）");
  assert.equal(isUnlocked(un, "a"), true);
  // 空参数不崩
  assert.equal(unlock(null, "a"), false);
  assert.equal(unlock(un, ""), false);
  assert.equal(isUnlocked(null, "a"), false);
}

export function groupByActSorted() {
  const g = groupByAct(RAW, { a: true });
  assert.deepEqual(g.map(x => x.act), [1, 2], "按章节升序");
  assert.equal(g[0].items.length, 2);
  // 锁定的也返回（UI 灰色显示），带 unlocked 标记
  assert.equal(g[0].items[0].unlocked, true);
  assert.equal(g[0].items[1].unlocked, false);
  assert.equal(g[1].items[0].unlocked, false);
}

export function travelTargetsOnlyUnlocked() {
  const un = { a: true, c: true };
  assert.deepEqual(travelTargets(RAW, un).map(w => w.id), ["a", "c"]);
  assert.deepEqual(travelTargets(RAW, {}).map(w => w.id), []);
}

export function canTravelNeedsUnlock() {
  assert.equal(canTravel(RAW, { b: true }, "b"), true);
  assert.equal(canTravel(RAW, {}, "b"), false);
  assert.equal(canTravel(RAW, { b: true }, "不存在"), false);
}

export function waypointAtCellMatchesMapAndCoords() {
  // 同格子但不同地图不算命中（坐标是地图局部的）
  assert.equal(waypointAtCell(RAW, "平原", 3, 4).id, "a");
  assert.equal(waypointAtCell(RAW, "扬州", 3, 4), null);
  assert.equal(waypointAtCell(RAW, "平原", 4, 3), null, "行列不能颠倒匹配");
  assert.equal(waypointAtCell(RAW, "扬州", 5, 6).id, "b");
}

export function touchWaypointUnlocksOnce() {
  const un = {};
  const w = touchWaypoint(RAW, un, "平原", 3, 4);
  assert.ok(w);
  assert.equal(w.id, "a");
  assert.equal(isUnlocked(un, "a"), true);
  // 第二次踩同一格不该再报告"新发现"
  assert.equal(touchWaypoint(RAW, un, "平原", 3, 4), null);
  // 没踩到任何传送点
  assert.equal(touchWaypoint(RAW, un, "平原", 99, 99), null);
}
