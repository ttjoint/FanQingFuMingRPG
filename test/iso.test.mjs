import { cellCenter, worldToCell, dirFromVec, randomPointInCell, configureIso, isoGeometry } from "../src/engine/iso.js";
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
