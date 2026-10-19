import { cellCenter, worldToCell, dirFromVec, randomPointInCell, configureIso, isoGeometry, mapSize, inBounds } from "../src/engine/iso.js";
import { assert, assertEq } from "./helpers.mjs";

// 等距几何可由游戏配置注入：注入后换算生效，测完恢复默认，避免影响其他用例。
export function configurableGeometry() {
  assertEq(isoGeometry(), { originX: 1568, halfW: 32, halfH: 16 }, "默认几何");
  configureIso({ originX: 100, halfW: 20, halfH: 10 });
  assertEq(cellCenter(0, 0), { x: 100, y: 10 }, "注入后原点/半高生效");
  assertEq(cellCenter(2, 0), { x: 140, y: 30 }, "注入后半宽生效");
  assertEq(worldToCell(140, 30), { row: 2, col: 0 }, "注入后反算一致");
  configureIso({ originX: 1568, halfW: 32, halfH: 16 });   // 恢复
  assertEq(cellCenter(0, 0), { x: 1568, y: 16 }, "恢复默认几何");
}

export function center() {
  assertEq(cellCenter(0, 0), { x: 1568, y: 16 });
  assertEq(cellCenter(1, 0), { x: 1600, y: 32 });
  assertEq(cellCenter(0, 1), { x: 1536, y: 32 });
}

export function roundTrip() {
  for (const [r, c] of [[0, 0], [3, 4], [25, 25], [10, 20], [29, 0]]) {
    const p = cellCenter(r, c);
    assertEq(worldToCell(p.x, p.y), { row: r, col: c });
  }
}

export function dirs() {
  assertEq(dirFromVec(0, 1), 4);    // 南 -> 帧块 4
  assertEq(dirFromVec(0, -1), 0);   // 北 -> 帧块 0
  assertEq(dirFromVec(0, 0), 0);
  for (const [dx, dy] of [[1, 0], [-1, 0], [1, 1], [-1, -1], [3, 1]]) {
    const d = dirFromVec(dx, dy); assert(d >= 0 && d < 8 && Number.isInteger(d), "dir 范围");
  }
}

export function randomInCell() {
  for (let i = 0; i < 100; i++) {
    const p = randomPointInCell(5, 7);
    const c = cellCenter(5, 7);
    assert(Math.abs(p.x - c.x) / 32 + Math.abs(p.y - c.y) / 16 <= 0.8501, "随机点应在格内菱形");
  }
}

// ---- 网格尺寸与边界（纯函数，engine/iso.js）----
//
// 原版地图都是正方形，所以「row 也拿 width 判」这个 bug 从未暴露。
// 这里用非方形尺寸把它钉死，避免回归。

export function mapSizeRect() {
  assertEq(mapSize({ width: 5, height: 3 }), { rows: 3, cols: 5 });
  assertEq(mapSize({ width: 4 }), { rows: 4, cols: 4 }, "缺 height 时按方形补齐（兼容旧数据）");
  assertEq(mapSize(null), { rows: 0, cols: 0 });
}

export function inBoundsRect() {
  const m = { width: 5, height: 3 };        // 3 行 5 列
  // 全部 15 格在图内
  for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++)
    assert(inBounds(m, r, c), "格 " + r + "," + c + " 应在图内");
  // 越界：行看到 height，列看到 width
  assert(!inBounds(m, 3, 0), "第 height 行越界");
  assert(!inBounds(m, 0, 5), "第 width 列越界");
  assert(!inBounds(m, -1, 0), "负 row 越界");
  assert(!inBounds(m, 0, -1), "负 col 越界");
}

export function inBoundsTall() {
  const m = { width: 2, height: 7 };        // 高瘦地图：旧实现会把 row>=2 全判越界
  assert(inBounds(m, 6, 1), "最后一行必须可达");
  assert(!inBounds(m, 7, 0));
  assert(!inBounds(m, 0, 2));
}

export function inBoundsSquareFallback() {
  const m = { width: 4 };                   // 无 height
  assert(inBounds(m, 3, 3), "方形回退：右下角在图内");
  assert(!inBounds(m, 4, 0), "方形回退：越界行");
  assert(!inBounds(m, 0, 4), "方形回退：越界列");
}
