// 等距深度：纵向条带模型（engine/depth.js）+ 地基线拟合工具 测试。
import {
  buildObjectDrawables, suggestRoofY, lowerHull, hullYAt,
  baseLineFromBottom, lineToArray, trimSteepEnds, ROOF_TOP,
} from "../src/engine/depth.js";
import { assert, assertEq, loadMap } from "./helpers.mjs";

const TW = 64, TH = 32;

// 无地基线（点状对象）：整幅一条绘制物
export function singleCell() {
  const d = buildObjectDrawables([0, 0, TW, TH * 2, 100, 136], [[0, 0, 100, 200]], 0, TW, TH, {});
  assertEq(d.length, 1);
  assertEq(d[0].sortY, 200 + TH / 2);
}

// 整体单一深度
export function singleDepthMode() {
  const sprite = [0, 0, 192, 320, 300, 400];
  const tiles = [[0, 0, 300, 400], [0, 0, 364, 432], [0, 0, 428, 464]];
  const d = buildObjectDrawables(sprite, tiles, 0, TW, TH, { single: true });
  assertEq(d.length, 1, "单一深度：只有一个可绘制物");
  assertEq(d[0].sprite, sprite);
  assertEq(d[0].sortY, 464 + TH / 2);
}

// 有地基线时：覆盖多边形（斜线以上）+ 基座多边形（斜线以下）
export function overlayAndBasePolygons() {
  const sprite = [0, 0, 96, 320, 300, 400];
  const tiles = [[0, 0, 300, 400]];
  const base = new Int16Array(96); for (let x = 0; x < 96; x++) base[x] = 200 + Math.round(x * 0.5);
  const d = buildObjectDrawables(sprite, tiles, 0, TW, TH, { base, playerH: 64 });
  const ov = d.filter(x => x.roof), bs = d.filter(x => !x.roof);
  assertEq(ov.length, 1, "一个覆盖多边形");
  assertEq(bs.length, 1, "一个基座多边形");
  assertEq(ov[0].sortY, ROOF_TOP, "覆盖层高于所有角色");
  assertEq(bs[0].sortY, 400 + 200 - TH / 2, "基座深度 = 黄线最高点（避免沿黄区走动时被翻转）");
  // 覆盖/基座多边形的 y 都在精灵框内
  for (const it of d) for (const p of it.polygon) { assert(p[0] >= 300 && p[0] <= 396, "x 在框内"); assert(p[1] >= 400 && p[1] <= 720, "y 在框内"); }
  // 蓝线 = 黄线 - 玩家身高：基座多边形最高点（局部）≈ min(base)-64
  let top = Infinity; for (const p of bs[0].polygon) top = Math.min(top, p[1] - 400);
  assertEq(top, Math.min(...base) - 64, "蓝线 = 黄线最高点 − 玩家身高");
}

// 无地基线时只有一个整幅基座多边形
export function noBaseOnePolygon() {
  const d = buildObjectDrawables([0, 0, 192, 320, 300, 400], [[0, 0, 300, 400], [0, 0, 364, 432]], 0, TW, TH, { playerH: 64 });
  assertEq(d.length, 1);
  assertEq(d[0].sortY, 464 - TH / 2, "基座深度 = 最前地基格心");
}

// 层偏移叠加
export function layerOffset() {
  const base = new Int16Array(128).fill(120);
  const d = buildObjectDrawables([0, 0, 128, 128, 0, 0], [[0, 0, 0, 0], [0, 0, 64, 32]], 2, TW, TH, { base, playerH: 64 });
  for (const it of d) assert(it.sortY >= 200000, "layer 偏移已叠加");
}

// 真实地图：每个对象 ≤ 2 个多边形绘制物，且都在精灵框内
export function realMapPolygons() {
  for (const name of ["扬州", "龙家庄", "后山", "清军大营"]) {
    const d = loadMap(name);
    for (const o of d.objects) {
      const sp = o.sprite;
      const dr = buildObjectDrawables(sp, o.tiles || [], o.layer || 0, TW, TH, { base: new Int16Array(sp[2]).fill(sp[3] - 20), playerH: 64 });
      assert(dr.length <= 2, name + " ≤2 个绘制物");
      for (const it of dr) for (const p of it.polygon) {
        assert(p[0] >= sp[4] - 1 && p[0] <= sp[4] + sp[2] + 1, name + " x 在框内");
        assert(p[1] >= sp[5] - 1 && p[1] <= sp[5] + sp[3] + 1, name + " y 在框内");
      }
    }
  }
}

// ---- 地基线工具 ----

export function lowerHullBasic() {
  const h = lowerHull([[0, 100], [1, 150], [2, 100], [3, 120]]);
  assert(h.some(p => p[0] === 1 && p[1] === 150), "下凸包包含最低点");
  assertEq(hullYAt(h, 1), 150);
  assertEq(hullYAt(h, 0), 100);
}

export function hullSpansNotch() {
  const sh = 200, bottom = new Int16Array(160).fill(-1);
  for (let x = 8; x < 48; x++) bottom[x] = 180;
  for (let x = 48; x < 112; x++) bottom[x] = 100;   // 城门洞凹陷
  for (let x = 112; x < 152; x++) bottom[x] = 180;
  const line = baseLineFromBottom(bottom, 8, 152);
  assertEq(line[80], 180, "凹陷被凸包跨过（仍按地面线）");
  for (let x = 0; x < 160; x++) assert(line[x] >= 0, "整幅连续填充 x=" + x);
}

export function hullIgnoresEaves() {
  const bottom = new Int16Array(200).fill(-1);
  for (let x = 0; x < 30; x++) bottom[x] = 60;
  for (let x = 30; x < 170; x++) bottom[x] = 180;
  for (let x = 170; x < 200; x++) bottom[x] = 60;
  const line = baseLineFromBottom(bottom, 30, 170);
  assertEq(line[10], 180, "房檐列外推为地基线");
  assertEq(line[190], 180);
}

export function trimSteepEdges() {
  assertEq(trimSteepEnds([[0, 40], [4, 180], [80, 180], [86, 40]], 1.8), [[4, 180], [80, 180]], "两端陡峭点被舍去");
  assertEq(trimSteepEnds([[0, 100], [40, 120], [80, 100]], 1.8).length, 3, "平缓段保留");
}

export function manualLine() {
  const w = 128, line = [[10, 180], [60, 120], [110, 180]];
  const base = lineToArray(line, w);
  assertEq(base[10], 180); assertEq(base[60], 120); assertEq(base[110], 180);
  assertEq(base[0], 180, "左端外推"); assertEq(base[127], 180, "右端外推");
}

export function suggestRoof() {
  assertEq(suggestRoofY([0, 0, 192, 320, 0, 0], [[0, 96, 0, 0], [0, 64, 64, 32]]), 64);
  assertEq(suggestRoofY([0, 0, 0, 0, 0, 0], []), null);
}
