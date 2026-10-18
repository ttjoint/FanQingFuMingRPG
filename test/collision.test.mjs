import { ellipsesOverlap } from "../src/engine/collision.js";
import { assert } from "./helpers.mjs";

export function overlap() {
  assert(ellipsesOverlap(0, 0, 16, 8, 0, 0, 16, 8), "同心应重叠");
  assert(ellipsesOverlap(0, 0, 16, 8, 20, 0, 16, 8), "接近应重叠");
  assert(!ellipsesOverlap(0, 0, 16, 8, 100, 0, 16, 8), "远离不应重叠");
}

export function boundary() {
  // 水平极限：dx/(rx+rx) < 1 才算重叠
  assert(ellipsesOverlap(0, 0, 16, 8, 31, 0, 16, 8));
  assert(!ellipsesOverlap(0, 0, 16, 8, 32, 0, 16, 8));
}
