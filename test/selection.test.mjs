import { createSelection, selKey } from "../src/editor/selection.js";
import { assert, assertEq } from "./helpers.mjs";

export function basics() {
  const s = createSelection();
  assertEq(s.get(), null);
  s.set({ type: "cell", row: 1, col: 2 });
  assertEq(s.get(), { type: "cell", row: 1, col: 2 });
  assert(s.is("cell"));
  assert(!s.is("spawn"));
  s.clear();
  assertEq(s.get(), null);
}

export function keysAndQuery() {
  assertEq(selKey({ type: "cell", row: 3, col: 4 }), "cell:3,4");
  assertEq(selKey({ type: "entry" }), "entry");
  assertEq(selKey({ type: "spawn", index: 7 }), "spawn:7");
  assertEq(selKey(null), null);
  const s = createSelection();
  s.set({ type: "spawn", index: 7 });
  assertEq(s.is("spawn", 7), true);
  assertEq(s.is("spawn", 8), false);
}

export function multiSelectReserved() {
  const s = createSelection();
  s.set({ type: "cell", row: 0, col: 0 });
  s.toggle({ type: "object", index: 2 });
  assertEq(s.all().length, 2);
  assertEq(s.get(), { type: "object", index: 2 });   // 主选 = 最近
  s.toggle({ type: "object", index: 2 });
  assertEq(s.all().length, 1);
}

export function setMany() {
  const s = createSelection();
  s.setMany([{ type: "object", index: 1 }, { type: "object", index: 3 }, { type: "spawn", index: 0 }]);
  assertEq(s.all().length, 3);
  assertEq(s.get(), { type: "spawn", index: 0 });
  assert(s.has({ type: "object", index: 3 }));
  assert(!s.has({ type: "object", index: 2 }));
}
