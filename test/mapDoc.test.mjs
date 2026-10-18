import { fromLegacyMap, toLegacyMap, cellDx, cellDy } from "../src/content/mapDoc.js";
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
