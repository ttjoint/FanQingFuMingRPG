// 特效纯逻辑（engine/effect.js）测试。
import { assert, assertEq, readJSON, ASSETS_DIR } from "./helpers.mjs";
import {
  normalizeEffect, buildEffectTable, makeEffect, frameAt, stepEffect, effectPos,
  layerWeight, LAYER_UNDER, LAYER_OVER, LAYER_TOP,
} from "../src/engine/effect.js";

export function layerWeights() {
  assert(layerWeight(LAYER_UNDER) < layerWeight(LAYER_OVER), "under 低于 over");
  assert(layerWeight(LAYER_OVER) < layerWeight(LAYER_TOP), "over 低于 top");
}

export function normalizeDefaults() {
  const d = normalizeEffect({ id: "x", frames: ["a.png", "b.png"] });
  assertEq(d.id, "x");
  assertEq(d.frames.length, 2);
  assertEq(d.layer, LAYER_OVER, "默认 over 层");
  assertEq(d.fps, 12, "默认帧率 12");
  assert(d.life > 0, "有帧时应推算寿命");
}

export function fpsFromCps() {
  const d = normalizeEffect({ id: "y", cps: 20 });
  assertEq(d.fps, 20, "cps 作为 fps 的兼容别名");
}

export function makeEffectWorldAnchor() {
  const inst = makeEffect({ id: "z", layer: "under", anchor: "world", life: 1 }, { x: 10, y: 20 });
  assertEq(inst.layer, "under");
  assertEq(inst.anchor, "world");
  const p = effectPos(inst);
  assertEq(p.x, 10);
  assertEq(p.y, 20);
}

export function effectFollowsUnit() {
  const unit = { x: 5, y: 6 };
  const inst = makeEffect({ id: "u", anchor: "unit" }, { follow: unit, x: 0, y: 0 });
  assertEq(effectPos(inst).x, 5);
  unit.x = 50;   // 跟随单位实时位置
  assertEq(effectPos(inst).x, 50);
}

export function frameAdvances() {
  const inst = makeEffect({ id: "f", frames: ["0.png", "1.png", "2.png"], fps: 10, layer: "over" }, {});
  assertEq(frameAt(inst), 0);
  stepEffect(inst, 0.15);   // 0.15s * 10fps = 1.5 → 第 1 帧
  assertEq(frameAt(inst), 1);
  stepEffect(inst, 0.15);
  assertEq(frameAt(inst), 2);
}

export function holdFirstDelaysFrames() {
  const inst = makeEffect({ id: "h", frames: ["0.png", "1.png"], fps: 10, holdFirst: 0.5 }, {});
  stepEffect(inst, 0.2);
  assertEq(frameAt(inst), 0, "首帧停留期间不前进");
}

export function loopNeverDone() {
  const inst = makeEffect({ id: "l", frames: ["0.png"], fps: 10, loop: true, layer: "under" }, {});
  for (let i = 0; i < 100; i++) stepEffect(inst, 0.1);
  assert(!inst.done, "循环特效不应结束");
}

export function oneShotFinishes() {
  const inst = makeEffect({ id: "o", frames: ["0.png", "1.png"], fps: 10, layer: "over" }, {});
  let done = false;
  for (let i = 0; i < 100 && !done; i++) done = stepEffect(inst, 0.05);
  assert(done, "一次性特效应结束");
}

export function tableLookup() {
  const t = buildEffectTable([{ id: "a" }, { id: "b" }]);
  assert(!!t.get("a"));
  assertEq(t.get("nope"), null);
  assertEq(t.list().length, 2);
}

export function assetsEffectsNormalize() {
  const list = readJSON(ASSETS_DIR + "/effects.json");
  assert(list.length >= 4, "内置特效定义应存在");
  const t = buildEffectTable(list);
  assert(!!t.get("ring_target"), "存在攻击目标红圈特效");
  assert(!!t.get("move_marker"), "存在落点光圈特效");
}
