// MapDoc：地图的图层化文档模型（规范存储格式）。
// 旧 .map 导出的 raw json（cells 里混装 地形/碰撞/事件）在此被拆分为：
//   ground(地形) / collision(碰撞) / events(稀疏事件) / decorations(装饰) / units(单位)。
// 目标像素坐标由 (row,col) 推导（已验证所有地图满足 dx=1536+32*(r-c), dy=16*(r+c)）。
import { MAPDOC_VERSION, normalizeMapDoc } from "./schema.js";

export const cellDx = (r, c) => 1536 + 32 * (r - c);
export const cellDy = (r, c) => 16 * (r + c);

// legacy raw -> MapDoc
export function fromLegacyMap(raw) {
  const w = raw.width;
  // 旧 .map json 只有 width，行数 = 列数（正方形）。height 显式写出来，
  // 后续所有 w*h 运算都读它，而不是继续沿用「width 当边长」的隐式假设。
  const h = raw.height != null ? raw.height : w;
  const n = w * h;
  const ground = new Array(n);
  const collision = new Array(n).fill(1);
  const cellLayer = new Array(n).fill(1);
  const events = {};
  for (const c of raw.cells || []) {
    const i = c.row * w + c.col;
    ground[i] = [c.sx, c.sy];
    collision[i] = c.flag === 1 ? 1 : 0;
    if (c.layer != null) cellLayer[i] = c.layer;
    if (c.trigger || c.map) events[i] = { trigger: c.trigger || 0, map: c.map || 0 };
  }
  for (let i = 0; i < n; i++) if (!ground[i]) ground[i] = [0, 0];
  const decorations = (raw.objects || []).map((o, idx) => {
    const d = { id: "o" + (idx + 1), sprite: o.sprite.slice(), tiles: (o.tiles || []).map(t => t.slice()), layer: o.layer || 0 };
    if (o.roof != null) d.roof = o.roof;     // 水平分界源 y（可选）
    if (o.bias != null) d.bias = o.bias;     // 深度微调（像素，可选）
    if (o.single) d.single = true;           // 整体单一深度
    if (Array.isArray(o.line) && o.line.length) d.line = o.line.map(p => [p[0], p[1]]);   // 手画地基线
    return d;
  });
  const units = (raw.spawns || []).map((s, idx) => {
    const u = { id: "u" + (idx + 1), npc: s.npc, r: s.row, c: s.col };
    if (s.overrides) u.overrides = JSON.parse(JSON.stringify(s.overrides));   // 实例覆盖模板
    return u;
  });
  return normalizeMapDoc({
    schemaVersion: MAPDOC_VERSION, name: raw.name, width: w, height: h, music: raw.music || "",
    entry: raw.entry ? raw.entry.slice() : null,
    ground, collision, cellLayer, events, decorations, units,
  });
}

// MapDoc -> legacy raw（供 buildMapData / 旧编辑器视图使用）
export function toLegacyMap(doc) {
  const w = doc.width, h = (doc.height == null ? doc.width : doc.height), cells = [];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = r * w + c;
    const g = doc.ground[i] || [0, 0];
    const ev = doc.events[i] || {};
    cells.push({
      row: r, col: c, sx: g[0], sy: g[1], dx: cellDx(r, c), dy: cellDy(r, c),
      flag: doc.collision[i] === 0 ? 0 : 1, trigger: ev.trigger || 0, map: ev.map || 0,
      layer: doc.cellLayer ? (doc.cellLayer[i] || 1) : 1,
    });
  }
  return {
    name: doc.name, width: w, height: h, music: doc.music, entry: doc.entry ? doc.entry.slice() : null,
    cells,
    objects: (doc.decorations || []).map(d => {
      const o = { sprite: d.sprite.slice(), tiles: (d.tiles || []).map(t => t.slice()), layer: d.layer || 0 };
      if (d.roof != null) o.roof = d.roof;
      if (d.bias != null) o.bias = d.bias;
      if (d.single) o.single = true;
      if (Array.isArray(d.line) && d.line.length) o.line = d.line.map(p => [p[0], p[1]]);
      return o;
    }),
    spawns: (doc.units || []).map(u => {
      const s = { npc: u.npc, row: u.r, col: u.c };
      if (u.overrides) s.overrides = JSON.parse(JSON.stringify(u.overrides));
      return s;
    }),
  };
}

// ------------------------------------------------------------------ 旧视图适配
// 让 MapDoc 直接暴露旧的 cells / objects / spawns 接口（非枚举、写穿到图层），
// 使地图编辑器无需大改即可**直接编辑图层化 MapDoc**。视图不参与序列化（非枚举）。

let _seq = 0;
const nextId = p => p + (Date.now().toString(36)) + (_seq++).toString(36);

function normalizeDecoration(o) {
  if (!o) return o;
  if (!o.id) o.id = nextId("o");
  if (!Array.isArray(o.sprite)) o.sprite = [0, 0, 0, 0, 0, 0];
  if (!Array.isArray(o.tiles)) o.tiles = [];
  if (o.layer == null) o.layer = 0;
  return o;
}
function normalizeUnit(u) {
  if (!u) return u;
  if (!u.id) u.id = nextId("u");
  if (u.r == null && u.row != null) u.r = u.row;
  if (u.c == null && u.col != null) u.c = u.col;
  return u;
}

// 单位视图：把 MapDoc 的 r/c 映射为旧字段 row/col（含 delete/keys）。
function unitView(u) {
  return new Proxy(u, {
    get(t, p) { return p === "row" ? t.r : p === "col" ? t.c : t[p]; },
    set(t, p, v) { if (p === "row") t.r = v; else if (p === "col") t.c = v; else t[p] = v; return true; },
    deleteProperty(t, p) { if (p === "row") { delete t.r; } else if (p === "col") { delete t.c; } else { delete t[p]; } return true; },
    has(t, p) { return p === "row" ? "r" in t : p === "col" ? "c" in t : p in t; },
    ownKeys(t) { return [...Object.keys(t).filter(k => k !== "r" && k !== "c"), "row", "col"]; },
    getOwnPropertyDescriptor(t, p) {
      if (p === "row") return { configurable: true, enumerable: true, value: t.r };
      if (p === "col") return { configurable: true, enumerable: true, value: t.c };
      return Object.getOwnPropertyDescriptor(t, p);
    },
  });
}

// 数组视图：结构变更（push/splice）与元素读写都写穿到底层数组。
function arrayProxy(backing, toStore, fromStore) {
  const at = i => { const b = backing[i]; return b === undefined ? undefined : fromStore(b); };
  return new Proxy(backing, {
    get(t, p) {
      if (p === "length") return backing.length;
      if (p === "push") return (...items) => backing.push(...items.map(toStore));
      if (p === "splice") return (start, del, ...items) => backing.splice(start, del, ...items.map(toStore));
      if (typeof p === "string" && /^\d+$/.test(p)) return at(+p);
      if (typeof Array.prototype[p] === "function") return (...a) => Array.prototype[p].apply(backing.map(fromStore), a);
      return backing[p];
    },
    set(t, p, v) { if (typeof p === "string" && /^\d+$/.test(p)) { backing[+p] = toStore(v); return true; } backing[p] = v; return true; },
    has(t, p) { return p === "length" || (typeof p === "string" && /^\d+$/.test(p) && +p < backing.length) || p in backing; },
    deleteProperty(t, p) { if (typeof p === "string" && /^\d+$/.test(p)) { backing.splice(+p, 1); return true; } delete backing[p]; return true; },
    ownKeys() { return [...backing.keys()].map(String); },
    getOwnPropertyDescriptor(t, p) { if (typeof p === "string" && /^\d+$/.test(p) && +p < backing.length) return { configurable: true, enumerable: true, value: at(+p) }; return undefined; },
  });
}

export function attachLegacyViews(doc) {
  if (!doc || doc.__legacyViews) return doc;
  const w = doc.width || 0;
  const h = doc.height == null ? w : (doc.height || 0);
  const n = w * h;
  if (!Array.isArray(doc.ground)) doc.ground = new Array(n).fill(null).map(() => [0, 0]);
  if (!Array.isArray(doc.collision)) doc.collision = new Array(n).fill(1);
  if (!doc.events || typeof doc.events !== "object") doc.events = {};
  if (!Array.isArray(doc.decorations)) doc.decorations = [];
  if (!Array.isArray(doc.units)) doc.units = [];

  const cells = new Array(n);
  const def = (o, k, get, set) => Object.defineProperty(o, k, { get, set, enumerable: true, configurable: true });
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = r * w + c, cell = {};
    def(cell, "row", () => r); def(cell, "col", () => c);
    def(cell, "dx", () => cellDx(r, c)); def(cell, "dy", () => cellDy(r, c));
    def(cell, "sx", () => (doc.ground[i] ? doc.ground[i][0] : 0), v => { (doc.ground[i] || (doc.ground[i] = [0, 0]))[0] = v; });
    def(cell, "sy", () => (doc.ground[i] ? doc.ground[i][1] : 0), v => { (doc.ground[i] || (doc.ground[i] = [0, 0]))[1] = v; });
    def(cell, "flag", () => (doc.collision[i] === 0 ? 0 : 1), v => { doc.collision[i] = v === 0 ? 0 : 1; });
    def(cell, "trigger", () => { const e = doc.events[i]; return e ? (e.trigger || 0) : 0; },
                        v => { const e = doc.events[i] || (doc.events[i] = { trigger: 0, map: 0 }); e.trigger = v; if (!e.trigger && !e.map) delete doc.events[i]; });
    def(cell, "map", () => { const e = doc.events[i]; return e ? (e.map || 0) : 0; },
                    v => { const e = doc.events[i] || (doc.events[i] = { trigger: 0, map: 0 }); e.map = v; if (!e.trigger && !e.map) delete doc.events[i]; });
    def(cell, "layer", () => (doc.cellLayer ? (doc.cellLayer[i] || 1) : 1),
                     v => { if (!doc.cellLayer) doc.cellLayer = new Array(n).fill(1); doc.cellLayer[i] = v; });
    cells[i] = cell;
  }
  Object.defineProperty(doc, "cells", { value: cells, enumerable: false, configurable: true });
  Object.defineProperty(doc, "objects", { value: arrayProxy(doc.decorations, normalizeDecoration, d => d), enumerable: false, configurable: true });
  Object.defineProperty(doc, "spawns", { value: arrayProxy(doc.units, normalizeUnit, unitView), enumerable: false, configurable: true });
  Object.defineProperty(doc, "__legacyViews", { value: true, enumerable: false, configurable: true });
  return doc;
}

