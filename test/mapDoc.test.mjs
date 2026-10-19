import { fromLegacyMap, toLegacyMap, attachLegacyViews, cellDx, cellDy } from "../src/content/mapDoc.js";
import { loadAllMaps, assert, assertEq } from "./helpers.mjs";

export function destFormula() {
  assertEq(cellDx(0, 0), 1536);
  assertEq(cellDy(0, 0), 0);
  assertEq(cellDx(25, 25), 1536);
  assertEq(cellDy(3, 4), 112);
}

// 图层化存储必须对全部原始地图无损往返。
export function layerRoundTrip() {
  const maps = loadAllMaps();
  const names = Object.keys(maps);
  assert(names.length >= 9, "应加载到全部地图");
  for (const name of names) {
    const raw = maps[name];
    const doc = fromLegacyMap(raw);
    const back = toLegacyMap(doc);
    assertEq(back.width, raw.width, name + " width");
    const idx = c => c.row * raw.width + c.col;
    const backByKey = new Map(back.cells.map(c => [idx(c), c]));
    for (const c of raw.cells) {
      const d = backByKey.get(idx(c));
      assert(d, name + " 缺格 " + c.row + "," + c.col);
      assertEq([d.sx, d.sy, d.flag, d.trigger, d.map, d.dx, d.dy],
              [c.sx, c.sy, c.flag, c.trigger, c.map, c.dx, c.dy], name + " 格 " + c.row + "," + c.col);
    }
    assertEq(back.spawns, raw.spawns, name + " spawns");
    assertEq(back.objects.map(o => o.sprite), raw.objects.map(o => o.sprite), name + " objects sprite");
    assertEq(back.objects.map(o => o.tiles), raw.objects.map(o => o.tiles), name + " objects tiles");
    assertEq(back.entry, raw.entry, name + " entry");
  }
}

export function eventsAreSparse() {
  const raw = loadAllMaps()[Object.keys(loadAllMaps())[0]];
  const doc = fromLegacyMap(raw);
  const evCells = raw.cells.filter(c => c.trigger || c.map).length;
  assertEq(Object.keys(doc.events).length, evCells, "事件应为稀疏存储");
  assertEq(doc.ground.length, raw.width * raw.width);
  assertEq(doc.collision.length, raw.width * raw.width);
}

// 单位实例覆盖（overrides）应无损往返。
export function unitOverridesRoundTrip() {
  const maps = loadAllMaps();
  const raw = JSON.parse(JSON.stringify(maps[Object.keys(maps)[0]]));
  raw.spawns[0].overrides = { speed: 77, drops: [{ name: "猴皮", count: 2 }] };
  const doc = fromLegacyMap(raw);
  assert(doc.units[0].overrides && doc.units[0].overrides.speed === 77, "overrides 应进入 MapDoc");
  const back = toLegacyMap(doc);
  assertEq(back.spawns[0].overrides, { speed: 77, drops: [{ name: "猴皮", count: 2 }] });
  // 无 overrides 的单位不应凭空产生字段
  assertEq(back.spawns[1].overrides, undefined);
}

// 装饰物扩展字段（layer / roof / bias）必须无损往返
export function objectExtrasRoundTrip() {
  const cell = (r, c, flag) => ({ row: r, col: c, sx: 0, sy: 0, dx: cellDx(r, c), dy: cellDy(r, c), flag, trigger: 0, map: 0, layer: 1 });
  const raw = {
    name: "t", width: 2, music: "", entry: null,
    cells: [cell(0, 0, 1), cell(0, 1, 0), cell(1, 0, 0), cell(1, 1, 0)],
    objects: [{ sprite: [0, 0, 64, 64, 0, 0], tiles: [[0, 0, cellDx(0, 0), cellDy(0, 0)]], layer: 2, roof: 32, bias: -8 }],
    spawns: [],
  };
  const back = toLegacyMap(fromLegacyMap(raw));
  assertEq(back.objects[0].layer, 2, "layer");
  assertEq(back.objects[0].roof, 32, "roof");
  assertEq(back.objects[0].bias, -8, "bias");
}

// ---- 非方形地图（width ≠ height）----
// 历史上 MapDoc 只有 width，且所有网格运算都假设 height === width。
// 原版 9 张图恰好都是正方形，所以这个假设从未暴露。下面这几条用例把
// "非方形必须正确"钉成回归条件。

// 3 行 5 列（宽 5 高 3）的最小 legacy raw
function rectRaw(width, height) {
  const cells = [];
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++)
    cells.push({ row: r, col: c, sx: r, sy: c, flag: 1, trigger: 0, map: 0 });
  return { name: "rect", width, height, cells, objects: [], spawns: [] };
}

export function rectSizePreserved() {
  const raw = rectRaw(5, 3);
  const doc = fromLegacyMap(raw);
  assertEq(doc.width, 5, "width");
  assertEq(doc.height, 3, "height 必须被保留，不能按 width 补齐");
  // 图层长度 = w*h，而不是 w*w
  assertEq(doc.ground.length, 15, "ground 长度 = w*h");
  assertEq(doc.collision.length, 15, "collision 长度 = w*h");
}

export function rectCellCount() {
  const raw = rectRaw(5, 3);
  const doc = attachLegacyViews(fromLegacyMap(raw));
  assertEq(doc.cells.length, 15, "cell 视图数量 = w*h");
  // 每个 cell 的 row/col 都应落在范围内
  const seen = new Set();
  for (const c of doc.cells) {
    assert(c.row >= 0 && c.row < 3, "row 越界：" + c.row);
    assert(c.col >= 0 && c.col < 5, "col 越界：" + c.col);
    seen.add(c.row + "," + c.col);
  }
  assertEq(seen.size, 15, "全部格子唯一");
}

export function rectRoundTrip() {
  const raw = rectRaw(5, 3);
  const back = toLegacyMap(fromLegacyMap(raw));
  assertEq(back.width, 5);
  assertEq(back.height, 3);
  assertEq(back.cells.length, 15, "往返后 cell 数不变");
  for (const c of back.cells) {
    assert(c.row < 3 && c.col < 5, "往返后越界");
  }
}

// 缺 height 的旧数据必须按方形处理（向后兼容）
export function missingHeightIsSquare() {
  const raw = rectRaw(4, 4);
  delete raw.height;
  const doc = fromLegacyMap(raw);
  assertEq(doc.width, 4);
  assertEq(doc.height, 4, "缺 height 时按 width 补齐");
  assertEq(doc.ground.length, 16);
}
