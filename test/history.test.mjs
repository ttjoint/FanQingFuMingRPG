import { createHistory } from "../src/editor/history.js";
import { assert, assertEq } from "./helpers.mjs";

export function undoRedo() {
  const h = createHistory(10);
  assert(!h.canUndo() && !h.canRedo());
  h.push({ map: "m", before: 1, after: 2, label: "a" });
  h.push({ map: "m", before: 2, after: 3, label: "b" });
  assertEq(h.size(), 2);
  assert(h.canUndo());
  const e2 = h.undo(); assertEq(e2.before, 2); assertEq(e2.map, "m");
  assert(h.canRedo());
  const e1 = h.undo(); assertEq(e1.before, 1);
  assertEq(h.undo(), null);
  const r1 = h.redo(); assertEq(r1.after, 2);
  const r2 = h.redo(); assertEq(r2.after, 3);
  assertEq(h.redo(), null);
}

export function pushClearsFuture() {
  const h = createHistory();
  h.push({ a: 1 }); h.undo();
  assert(h.canRedo());
  h.push({ a: 2 });
  assert(!h.canRedo());
}

export function limitAndClear() {
  const h = createHistory(2);
  h.push({ n: 1 }); h.push({ n: 2 }); h.push({ n: 3 });
  assertEq(h.size(), 2);              // 只保留最近 2 条
  h.clear();
  assert(!h.canUndo() && !h.canRedo());
}
