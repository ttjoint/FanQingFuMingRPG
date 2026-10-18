import { createPipeline } from "../src/engine/pipeline.js";
import { assert, assertEq } from "./helpers.mjs";

export function orderAndCtx() {
  const log = [];
  let seen = null;
  const ctx = { x: 1 };
  const p = createPipeline([(c, dt) => { seen = c; log.push("a" + dt); }, (c, dt) => log.push("b" + dt)]);
  p.run(ctx, 2);
  assertEq(log, ["a2", "b2"]);
  assertEq(seen, ctx);
}

export function interrupt() {
  const log = [];
  const p = createPipeline([() => log.push(1), () => { log.push(2); return false; }, () => log.push(3)]);
  assertEq(p.run({}, 0), false);
  assertEq(log, [1, 2]);
}

export function addSystem() {
  const log = [];
  const p = createPipeline();
  p.add(() => log.push("x"));
  p.run({}, 1);
  assertEq(log, ["x"]);
  assertEq(p.systems().length, 1);
}
