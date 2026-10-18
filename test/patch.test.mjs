// 结构化差分（撤销栈从"整份快照"改为"变更路径"的底座）。
//
// 这里最容易错的是**数组长度变化**：删除一个 spawn 会让它后面所有下标前移，
// 如果按"逐个路径写回"的方式撤销，会写错位置（典型症状：撤销后少一个、
// 或者恢复到了相邻的条目上）。所以长度变化单独记一条 tail 补丁整体还原。
import assert from "node:assert/strict";
import { diff, applyPatches, deepEqual, getPath, setPath, delPath } from "../src/editor/patch.js";

// 造一份形似 MapDoc 的小样本
function sample() {
  return {
    name: "测试图", width: 3, music: "a.mp3", entry: [1, 2],
    cells: [
      { row: 0, col: 0, sx: 1, sy: 2, flag: 0, trigger: 0 },
      { row: 0, col: 1, sx: 1, sy: 2, flag: 0, trigger: 0 },
      { row: 0, col: 2, sx: 1, sy: 2, flag: 0, trigger: 0 },
    ],
    objects: [{ sprite: [0, 0, 32, 32], tiles: [[1, 2]] }],
    spawns: [{ npc: 1, row: 0, col: 0 }, { npc: 2, row: 0, col: 1 }],
  };
}

const clone = o => JSON.parse(JSON.stringify(o));

export function pathHelpersRoundTrip() {
  const o = { a: { b: [10, 20] } };
  assert.equal(getPath(o, ["a", "b", 1]), 20);
  setPath(o, ["a", "b", 0], 99);
  assert.equal(o.a.b[0], 99);
  assert.equal(getPath(o, ["nope", "x"]), undefined);
  delPath(o, ["a", "b", 0]);
  assert.deepEqual(o.a.b, [20], "delPath 应 splice 而不是留空位");
}

export function deepEqualBasics() {
  assert(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));
  assert(!deepEqual({ a: 1 }, { a: 1, b: 2 }));
  assert(!deepEqual([1, 2], [1, 2, 3]));
  assert(!deepEqual([1], {}), "数组与对象不能相等");
  assert(deepEqual(NaN, NaN));
}

export function noChangeMeansNoPatch() {
  const a = sample();
  assert.deepEqual(diff(a, clone(a)), []);
}

export function scalarChangeIsOnePath() {
  const a = sample(), b = clone(a);
  b.cells[1].flag = 7;
  const p = diff(a, b);
  assert.equal(p.length, 1, "只改一个字段应只产生一条补丁");
  assert.deepEqual(p[0].path, ["cells", 1, "flag"]);
  assert.equal(p[0].v, 0, "补丁里存的是**旧值**");
}

export function undoRestoresScalar() {
  const before = sample(), after = clone(before);
  after.cells[1].flag = 7;
  const p = diff(before, after);
  const cur = clone(after);
  applyPatches(cur, p);
  assert.deepEqual(cur, before, "应用补丁后应完全回到 before");
}

// 关键回归：删除中间一项后，撤销必须按原样还原（下标漂移）
export function undoAfterSpliceKeepsOrder() {
  const before = sample(), after = clone(before);
  after.spawns.splice(0, 1);            // 删掉第一个
  const p = diff(before, after);
  const cur = clone(after);
  applyPatches(cur, p);
  assert.deepEqual(cur, before, "删除后的撤销应完整还原（含顺序）");
  assert.equal(cur.spawns.length, 2);
  assert.equal(cur.spawns[0].npc, 1, "不能变成相邻那条");
}

export function undoAfterAppendWorks() {
  const before = sample(), after = clone(before);
  after.spawns.push({ npc: 9, row: 1, col: 1 });
  const p = diff(before, after);
  const cur = clone(after);
  applyPatches(cur, p);
  assert.deepEqual(cur, before);
}

export function undoAfterMassDeleteWorks() {
  const before = sample(), after = clone(before);
  after.cells.splice(0, after.cells.length);   // 清空
  const p = diff(before, after);
  const cur = clone(after);
  applyPatches(cur, p);
  assert.deepEqual(cur, before);
}

export function objectKeyAddAndRemove() {
  const before = { a: 1 }, after = { a: 1, b: 2 };
  const p1 = diff(before, after);
  const c1 = clone(after);
  applyPatches(c1, p1);
  assert.deepEqual(c1, { a: 1 });

  const p2 = diff(after, before);
  const c2 = clone(before);
  applyPatches(c2, p2);
  assert.deepEqual(c2, { a: 1, b: 2 });
}

export function typeChangeIsSinglePatch() {
  const before = { x: { y: 1 } }, after = { x: [1, 2] };
  const p = diff(before, after);
  const cur = clone(after);
  applyPatches(cur, p);
  assert.deepEqual(cur, before);
}

export function patchIsMuchSmallerThanSnapshot() {
  // 900 格的典型地图：改一格时，补丁数量应当是个位数，
  // 而不是"整份地图"的规模。这是这套改造的意义所在。
  const before = {
    cells: Array.from({ length: 900 }, (_, i) => ({
      row: (i / 30) | 0, col: i % 30, sx: 64, sy: 128, dx: 1536, dy: 0, flag: 0, trigger: 0,
    })),
  };
  const after = clone(before);
  after.cells[450].flag = 1;
  const p = diff(before, after);
  assert(p.length <= 3, "改一格只应产生极少量补丁，实际 " + p.length);

  const cur = clone(after);
  applyPatches(cur, p);
  assert.deepEqual(cur, before);
}

export function nestedArrayInArray() {
  const before = { objects: [{ sprite: [0, 0, 32, 32], tiles: [[1, 2], [3, 4]] }] };
  const after = clone(before);
  after.objects[0].tiles[1][0] = 99;
  const p = diff(before, after);
  const cur = clone(after);
  applyPatches(cur, p);
  assert.deepEqual(cur, before);
}

export function largeScaleRandomEditsStayReversible() {
  // 随机改 200 处，撤销后必须逐字节相同（含数组增删）
  const before = { arr: Array.from({ length: 50 }, (_, i) => ({ i, v: i * 2 }) ) };
  const after = clone(before);
  for (let k = 0; k < 200; k++) {
    const idx = (k * 7) % after.arr.length;
    if (k % 11 === 0) after.arr.splice(idx, 1);
    else if (k % 13 === 0) after.arr.push({ i: -k, v: k });
    else after.arr[idx].v = k;
  }
  const p = diff(before, after);
  const cur = clone(after);
  applyPatches(cur, p);
  assert(deepEqual(cur, before), "大量增删改混合后仍应完整还原");
}

// 关键回归：数组长度变化只应产生**一条** tail 补丁，不应同时展开逐项。
//
// 真实 bug（2026-10）：先展开逐项 + 再补一条 tail，撤销正常、重做却删错位置——
// 因为逐项补丁的下标基于原来的长度，而重做时长度已经变了，下标全错位。
// 症状：删第一项 → 撤销 → 重做，结果删掉了**最后一项**。
export function lengthChangeIsSingleTailPatch() {
  const before = { spawns: [{ npc: 1 }, { npc: 2 }, { npc: 3 }] };
  const after = { spawns: [{ npc: 2 }, { npc: 3 }] };   // 删掉第一项
  const p = diff(before, after);
  assert.equal(p.length, 1, "长度变化应只产生一条 tail 补丁，实际 " + p.length);
  assert.equal(p[0].tail, true);
  assert.deepEqual(p[0].path, ["spawns"]);
}

// 撤销 + 重做必须对称：两次 apply 回到两个不同状态
// （不掺入新增键的补丁，那里还要验证 added/removed 的互换语义）
export function undoRedoSymmetryOnSplice() {
  const before = { spawns: [{ npc: 1 }, { npc: 2 }, { npc: 3 }] };
  const after = { spawns: [{ npc: 2 }, { npc: 3 }] };   // 删掉第一项
  const p = diff(before, after);
  assert.equal(p.length, 1, "删一项只应产生一条 tail 补丁");
  const cur = JSON.parse(JSON.stringify(after));
  applyPatches(cur, p);
  assert.equal(JSON.stringify(cur), JSON.stringify(before), "撤销应回到 before");
  // 重做：把 tail 的旧值换成 after 的数组
  p[0].v = [{ npc: 2 }, { npc: 3 }];
  applyPatches(cur, p);
  assert.equal(JSON.stringify(cur.spawns), JSON.stringify(after.spawns), "重做不应删错位置");
}
