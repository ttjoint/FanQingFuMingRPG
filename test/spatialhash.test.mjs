import { createSpatialHash } from "../src/engine/spatialhash.js";
import { assert, assertEq } from "./helpers.mjs";

export function queryNear() {
  const h = createSpatialHash(10);
  const a = { x: 1, y: 1 }, b = { x: 5, y: 5 }, c = { x: 100, y: 100 };
  h.insert(a); h.insert(b); h.insert(c);
  const near = h.query(3, 3, 8);
  assert(near.includes(a) && near.includes(b) && !near.includes(c));
  h.clear();
  assertEq(h.size(), 0);
}

export function queryMiss() {
  const h = createSpatialHash(16);
  h.insert({ x: 0, y: 0 });
  assertEq(h.query(500, 500, 10).length, 0);
}
