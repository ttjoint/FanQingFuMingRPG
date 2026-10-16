// 地图编辑器：等距画布上分层编辑（地面 / 装饰 / 碰撞 / 标记 / 单位）。
// - 每层默认「选择」工具；每层只能点选本层内容。
// - 地面：选中格子后右侧显示行列与贴图缩略图，并可直接换贴图。
// - 装饰：悬停自动高亮、点选后右侧显示坐标/图片/类别/删除；选中后按住左键可拖动。
// - 碰撞：二值，左键点/拖加碰撞，右键点去碰撞（右键拖动仍是平移）。
// - 标记：点选格子后右侧编辑脚本触发 / 地图直传 / 入口勾选；Ctrl+C/V 复制粘贴地块选项。
// - 单位：单位/入口点缩略图列表；选中后拖动改位置；右侧为绑定的 NPC 属性（含行走图预览）。
// 直接修改传入的 opts.maps[name]，保存时由 index.js 重建运行时地图。
import { h, clear } from "./dom.js";
import { A } from "../core/state.js";
import { worldToCell, cellCenter } from "../core/utils.js";
import { getImg, preloadChar, assetURL } from "../core/assets.js";
import { renderNpcPanel } from "./npc-panel.js";
import { createHistory } from "./history.js";
import { createSelection } from "./selection.js";
import { makeLineEditor, modeControl, decorState } from "./decor-line.js";
import { decorSpriteKey } from "../content/schema.js";
import { attachLegacyViews } from "../content/mapDoc.js";

const LAYERS = [
  ["ground", "地面"],
  ["decor", "装饰"],
  ["collide", "碰撞"],
  ["mark", "标记"],
  ["unit", "单位"],
];
const DEFAULT_TOOL = { ground: "select", decor: "select", collide: "select", mark: "select", unit: "select" };
const TILE_W = 64, TILE_H = 32;

const OFFS = [[-2, 0], [2, 0], [0, -2], [0, 2], [-2, -2], [2, -2], [-2, 2], [2, 2]];
const SIL = new Map();
function silhouette(src, sx, sy, sw, sh, color, key) {
  const k = color + "|" + key;
  if (SIL.has(k)) return SIL.get(k);
  const c = document.createElement("canvas"); c.width = sw; c.height = sh;
  const cx = c.getContext("2d");
  cx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  cx.globalCompositeOperation = "source-in"; cx.fillStyle = color; cx.fillRect(0, 0, sw, sh);
  SIL.set(k, c); return c;
}

export function mountMapEditor(main, side, opts) {
  const names = opts.names || [];
  const maps = opts.maps || {};
  const npcs = opts.npcs || [];
  const npcOptions = opts.npcOptions || [];
  const npcName = opts.npcName || (id => "#" + id);
  const itemNames = opts.itemNames || [];
  const factionOptions = opts.factionOptions || [];
  const aiOptions = opts.aiOptions || [];
  const skillNames = opts.skillNames || [];
  const scriptNames = opts.scriptNames || [];
  const models = opts.models || [];
  const images = opts.images || {};
  // 跨地图共享的装饰物模板（按贴图源矩形）：地基线/深度模式只存一份
  const decorTpls = opts.decorTemplates || (opts.decorTemplates = {});
  const tplOf = s => { const k = decorSpriteKey(s); return decorTpls[k] || (decorTpls[k] = {}); };

  let cur = opts.current || names[0];
  let raw = maps[cur];
  const cam = { x: 0, y: 0, zoom: 0.8 };
  let layer = "ground";
  let tool = DEFAULT_TOOL.ground;
  const brush = { tile: { sx: 0, sy: 0, index: 0 }, obj: 0, depth: 0, npc: npcOptions[0] ? Number(npcOptions[0].v) : 1 };
  let byKey = new Map();
  let painting = false, panning = false, panStart = null, lastCell = null;
  let rClick = null;      // 右键按下候选：未拖动则视为单击
  let drag = null;        // 左键拖动：object / spawn / entry
  let marquee = null;     // 框选矩形（世界坐标）
  let CW = 800, CH = 520;
  let hoverCell = null, hoverObj = -1, drawT = 0;
  let copiedMark = null, markMsg = "";

  // ---- 撤销/重做（地图文档快照；连续编辑用去抖合并为一次）----
  const history = createHistory(100);
  const selection = createSelection();
  let sel = null;                                   // selection 的缓存别名（旧代码直接读 sel）
  const setSel = s => { sel = s; selection.set(s); };
  const clearSel = () => { sel = null; selection.clear(); };
  const syncSel = () => { sel = selection.get(); };
  const toggleSel = s => { selection.toggle(s); syncSel(); };
  const selIndexes = type => selection.all().filter(k => k.startsWith(type + ":")).map(k => +k.split(":")[1]);
  const deleteSelection = () => {
    const objs = selIndexes("object").sort((a, b) => b - a);
    const sps = selIndexes("spawn").sort((a, b) => b - a);
    objs.forEach(i => raw.objects.splice(i, 1));
    sps.forEach(i => raw.spawns.splice(i, 1));
    clearSel(); mark("删除选中"); buildSide(); draw();
  };
  const marqueeSelect = () => {
    if (!marquee) return;
    const x0 = Math.min(marquee.x0, marquee.x1), y0 = Math.min(marquee.y0, marquee.y1);
    const x1 = Math.max(marquee.x0, marquee.x1), y1 = Math.max(marquee.y0, marquee.y1);
    const list = [];
    if (layer === "decor") raw.objects.forEach((o, i) => { const s = o.sprite; if (s[4] < x1 && s[4] + s[2] > x0 && s[5] < y1 && s[5] + s[3] > y0) list.push({ type: "object", index: i }); });
    else if (layer === "unit") raw.spawns.forEach((s, i) => { const p = cellCenter(s.row, s.col); if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) list.push({ type: "spawn", index: i }); });
    selection.setMany(list); syncSel();
  };
  let histTimer = 0, lastSnap = null, pendingLabel = null;
  const snapshot = () => (raw ? JSON.parse(JSON.stringify(raw)) : null);
  function scheduleHistory() {
    if (!raw) return;
    clearTimeout(histTimer);
    histTimer = setTimeout(() => {
      const after = snapshot();
      if (lastSnap && JSON.stringify(after) !== JSON.stringify(lastSnap)) {
        history.push({ map: cur, before: lastSnap, after, label: pendingLabel || "编辑" });
        pendingLabel = null;
        lastSnap = after;
        buildToolbar();
      }
    }, 350);
  }
  function undo() { clearTimeout(histTimer); const e = history.undo(); if (!e) return; maps[e.map] = attachLegacyViews(e.before); loadMap(e.map, true); }
  function redo() { clearTimeout(histTimer); const e = history.redo(); if (!e) return; maps[e.map] = attachLegacyViews(e.after); loadMap(e.map, true); }

  // ---------- 布局 ----------
  main.classList.add("mapmode");
  const toolbarEl = h("div", { class: "ed-map-toolbar" });
  const paletteEl = h("div", { class: "ed-palette" });
  const wrap = h("div", { class: "ed-map-wrap" });
  const cv = h("canvas", { class: "ed-mapcv" });
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  wrap.append(cv);
  main.append(toolbarEl, paletteEl, wrap, h("div", { class: "ed-hint" },
    "左键使用当前工具；右键或中键拖动平移；「选择」状态下左键只点选本层内容；地面的贴图、装饰的类别、单位属性都在右侧栏直接编辑。"));

  const mark = (label) => { if (label) pendingLabel = label; opts.onChange && opts.onChange(cur); scheduleHistory(); };
  const h3 = t => h("h3", null, t);
  const hint = (t, st) => h("div", { class: "ed-hint", style: st || "margin:5px 0" }, t);
  const field = (label, ctl) => h("div", { class: "ed-field" }, h("label", null, label), ctl);
  const textIn = (val, on) => { const i = h("input", { type: "text", value: val == null ? "" : val }); i.oninput = () => on(i.value); return i; };
  const numIn = (val, on) => { const i = h("input", { type: "number", value: val == null ? 0 : val }); i.oninput = () => on(Number(i.value)); return i; };
  const btn = (label, cls, on) => h("button", { class: "ed-btn" + (cls ? " " + cls : ""), onclick: on }, label);
  const imgSrc = p => images[p] || assetURL(p);
  const npcById = id => npcs.find(n => n.id === id);

  // ---------- 图鉴 ----------
  const groundTiles = (A.atlasJson && A.atlasJson.order ? A.atlasJson.order : []).map((_, i) => ({
    index: i, sx: (i % A.atlasJson.cols) * TILE_W, sy: Math.floor(i / A.atlasJson.cols) * TILE_H,
  }));
  brush.tile = groundTiles[0] || { sx: 0, sy: 0, index: 0 };

  let palette = [];
  function buildPaletteData() {
    const seen = new Set(); palette = [];
    const add = o => { const key = JSON.stringify(o.sprite); if (seen.has(key)) return; seen.add(key); palette.push({ sprite: o.sprite.slice(), tiles: (o.tiles || []).map(t => t.slice()) }); };
    for (const n of names) { const m = maps[n]; if (m && m.objects) for (const o of m.objects) add(o); }
    palette.sort((a, b) => a.sprite[2] * a.sprite[3] - b.sprite[2] * b.sprite[3]);
  }
  const groundTileIndex = c => groundTiles.findIndex(t => t.sx === c.sx && t.sy === c.sy);
  const paletteIndexOf = s => palette.findIndex(p => p.sprite[0] === s[0] && p.sprite[1] === s[1] && p.sprite[2] === s[2] && p.sprite[3] === s[3]);

  function standSrc(model) {
    const ch = A.chars && A.chars[model]; if (!ch) return null;
    const blocks = ch.stand || ch.walk; if (!blocks) return null;
    const block = blocks[4 % blocks.length] || blocks[0]; if (!block || !block.length) return null;
    return imgSrc("assets/role/" + block[0].replace(/\.bmp$/, ".png"));
  }
  function unitThumb(d, size) {
    const src = d ? standSrc((d.model || "").replace(/\.pmg$/, "")) : null;
    return src ? h("img", { src, style: "max-width:" + size + "px;max-height:" + size + "px;image-rendering:pixelated", onerror: ev => { ev.target.style.visibility = "hidden"; } })
               : h("span", { class: "ed-hint", style: "margin:0" }, "?");
  }
  function unitGrid(selectedId, onPick) {
    const grid = h("div", { class: "ed-thumbgrid" });
    for (const d of npcs) {
      const cell = h("div", { class: "ed-thumbcell" + (d.id === selectedId ? " on" : ""), title: "编号 " + d.id, onclick: () => onPick(d.id) });
      cell.append(unitThumb(d, 50));
      cell.append(h("span", null, d.name || ("#" + d.id)));
      grid.append(cell);
    }
    return grid;
  }

  // ---------- 地图加载 ----------
  function loadMap(name, keepHistory) {
    if (!keepHistory) { history.clear(); clearTimeout(histTimer); }
    cur = name; raw = maps[name]; clearSel(); byKey.clear();
    if (!raw) { draw(); buildSide(); return; }
    for (const c of raw.cells) byKey.set(c.row + "," + c.col, c);
    if (!raw.spawns) raw.spawns = [];
    hoverCell = null; hoverObj = -1; drag = null;
    for (const s of raw.spawns) { const d = npcById(s.npc); if (d && d.model) preloadChar(d.model.replace(/\.pmg$/, "")); }
    lastSnap = snapshot();
    buildPaletteData();
    centerCamera();
    buildToolbar(); buildPalette(); buildSide(); draw();
  }

  function bounds() {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const c of raw.cells) {
      if (c.dx < minX) minX = c.dx; if (c.dy < minY) minY = c.dy;
      if (c.dx + TILE_W > maxX) maxX = c.dx + TILE_W; if (c.dy + TILE_H > maxY) maxY = c.dy + TILE_H;
    }
    for (const o of raw.objects) { const s = o.sprite;
      if (s[4] < minX) minX = s[4]; if (s[5] < minY) minY = s[5];
      if (s[4] + s[2] > maxX) maxX = s[4] + s[2]; if (s[5] + s[3] > maxY) maxY = s[5] + s[3];
    }
    if (minX > maxX) { minX = 0; minY = 0; maxX = 640; maxY = 480; }
    return { minX, minY, maxX, maxY };
  }
  function centerCamera() {
    const b = bounds();
    let cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    if (raw.entry) { const p = cellCenter(raw.entry[0] || 0, raw.entry[1] || 0); cx = p.x; cy = p.y; }
    cam.x = cx - (CW / 2) / cam.zoom; cam.y = cy - (CH / 2) / cam.zoom;
  }

  function scheduleDraw() { if (drawT) return; drawT = setTimeout(() => { drawT = 0; draw(); }, 200); }

  // 画布上的 NPC 站立帧（用 getImg + 锚点）。
  function npcStandFrame(model) {
    const ch = A.chars && A.chars[model]; if (!ch) return null;
    const blocks = ch.stand || ch.walk; if (!blocks) return null;
    const block = blocks[4 % blocks.length] || blocks[0]; if (!block || !block.length) return null;
    const name = block[0];
    const im = getImg("assets/role/" + name.replace(/\.bmp$/, ".png"));
    if (!im) { scheduleDraw(); return null; }
    const a = (A.anchors && A.anchors[name]) || [im.width / 2, im.height];
    return { im, a, name };
  }

  function objectPlacement(cell, tpl, depth) {
    if (!tpl || !cell) return null;
    const s = tpl.sprite;
    const nxa = Math.round(cell.dx + TILE_W / 2 - s[2] / 2);
    const nya = Math.round(cell.dy + TILE_H / 2 - s[3]);
    return buildObject(tpl, nxa, nya, depth);
  }
  function buildObject(tpl, nxa, nya, depth) {
    const s = tpl.sprite, dxd = nxa - s[4], dyd = nya - s[5];
    return { sprite: [s[0], s[1], s[2], s[3], nxa, nya], tiles: (tpl.tiles || []).map(t => [t[0], t[1], t[2] + dxd, t[3] + dyd]), layer: depth || 0 };
  }
  function moveObjectTo(o, nx, ny) {
    const s = o.sprite, dx = nx - s[4], dy = ny - s[5];
    s[4] = nx; s[5] = ny;
    for (const t of (o.tiles || [])) { t[2] += dx; t[3] += dy; }
  }
  function setObjectTemplate(o, tpl) {
    const s = o.sprite, cx = s[4] + s[2] / 2, cy = s[5] + s[3];
    const t = tpl.sprite;
    const nxa = Math.round(cx - t[2] / 2), nya = Math.round(cy - t[3]);
    const dxd = nxa - t[4], dyd = nya - t[5];
    o.sprite = [t[0], t[1], t[2], t[3], nxa, nya];
    o.tiles = (tpl.tiles || []).map(tt => [tt[0], tt[1], tt[2] + dxd, tt[3] + dyd]);
  }

  // ---------- 坐标 / 命中 ----------
  function worldAt(ev) {
    const r = cv.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / cam.zoom + cam.x, y: (ev.clientY - r.top) / cam.zoom + cam.y };
  }
  function cellAt(ev) {
    const w = worldAt(ev);
    const c = worldToCell(w.x, w.y);
    if (c.row < 0 || c.col < 0 || c.row >= raw.width || c.col >= raw.width) return null;
    return byKey.get(c.row + "," + c.col) || null;
  }
  function spawnAt(w) {
    const R = 12 / cam.zoom;
    for (let i = raw.spawns.length - 1; i >= 0; i--) {
      const s = raw.spawns[i], p = cellCenter(s.row, s.col);
      if (Math.hypot(w.x - p.x, w.y - (p.y - 6)) < R) return { index: i, row: s.row, col: s.col };
    }
    return null;
  }
  function objAt(w) {
    const order = sortedObjects();
    for (let k = order.length - 1; k >= 0; k--) {
      const { o, i } = order[k], s = o.sprite;
      if (w.x >= s[4] && w.x <= s[4] + s[2] && w.y >= s[5] && w.y <= s[5] + s[3]) return { index: i, o };
    }
    return null;
  }
  function entryAt(w) {
    if (!raw.entry) return null;
    const p = cellCenter(raw.entry[0] || 0, raw.entry[1] || 0);
    return Math.hypot(w.x - p.x, w.y - (p.y - 4)) < 12 / cam.zoom ? { row: raw.entry[0], col: raw.entry[1] } : null;
  }
  const inSprite = (s, w) => w.x >= s[4] && w.x <= s[4] + s[2] && w.y >= s[5] && w.y <= s[5] + s[3];

  // ---------- 绘制 ----------
  function sortedObjects() {
    return raw.objects.map((o, i) => ({ o, i })).sort((a, b) => {
      const sa = a.o.sprite, sb = b.o.sprite;
      return (sa[5] + sa[3] + (a.o.layer || 0) * 100000) - (sb[5] + sb[3] + (b.o.layer || 0) * 100000);
    });
  }
  function diamond(dx, dy) {
    ctx.beginPath();
    ctx.moveTo(dx + 32, dy); ctx.lineTo(dx + 64, dy + 16); ctx.lineTo(dx + 32, dy + 32); ctx.lineTo(dx, dy + 16); ctx.closePath();
  }
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0a0b0d"; ctx.fillRect(0, 0, CW, CH);
    if (!raw) return;
    const x0 = cam.x, y0 = cam.y, x1 = cam.x + CW / cam.zoom, y1 = cam.y + CH / cam.zoom;
    ctx.save();
    ctx.scale(cam.zoom, cam.zoom); ctx.translate(-cam.x, -cam.y);
    for (const c of raw.cells) {
      if (c.dx + TILE_W < x0 || c.dx > x1 || c.dy + TILE_H < y0 || c.dy > y1) continue;
      ctx.drawImage(A.atlas, c.sx, c.sy, TILE_W, TILE_H, c.dx, c.dy, TILE_W, TILE_H);
    }
    // 装饰：悬停高亮 / 选中高光
    for (const { o, i } of sortedObjects()) {
      const s = o.sprite;
      if (s[4] + s[2] < x0 || s[4] > x1 || s[5] + s[3] < y0 || s[5] > y1) continue;
      const isSel = selection.has({ type: "object", index: i });
      const isHov = layer === "decor" && hoverObj === i && !isSel;
      if (isSel || isHov) {
        const sil = silhouette(A.obj, s[0], s[1], s[2], s[3], isSel ? "#ffd75e" : "#8fd0ff", "o:" + s[0] + "," + s[1] + "," + s[2] + "," + s[3]);
        for (const [ox, oy] of OFFS) ctx.drawImage(sil, s[4] + ox, s[5] + oy);
      }
      ctx.drawImage(A.obj, s[0], s[1], s[2], s[3], s[4], s[5], s[2], s[3]);
    }
    // 碰撞层叠加
    if (layer === "collide") {
      for (const c of raw.cells) {
        if (c.dx + TILE_W < x0 || c.dx > x1 || c.dy + TILE_H < y0 || c.dy > y1) continue;
        diamond(c.dx, c.dy);
        ctx.fillStyle = c.flag === 0 ? "rgba(210,50,50,0.40)" : "rgba(80,200,120,0.10)";
        ctx.fill();
      }
    }
    // 标记层叠加
    if (layer === "mark") {
      for (const c of raw.cells) {
        if (c.dx + TILE_W < x0 || c.dx > x1 || c.dy + TILE_H < y0 || c.dy > y1) continue;
        const isEntry = raw.entry && raw.entry[0] === c.row && raw.entry[1] === c.col;
        let col = null;
        if (c.trigger) col = "rgba(240,208,96,0.5)";
        if (c.map) col = "rgba(80,220,120,0.5)";
        if (isEntry) col = "rgba(63,169,245,0.5)";
        if (!col) continue;
        diamond(c.dx, c.dy); ctx.fillStyle = col; ctx.fill();
      }
    }
    // 入口点
    if (raw.entry) {
      const p = cellCenter(raw.entry[0] || 0, raw.entry[1] || 0);
      const isSel = sel && sel.type === "entry";
      ctx.beginPath(); ctx.arc(p.x, p.y - 4, isSel ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = "#3fa9f5"; ctx.fill();
      ctx.strokeStyle = isSel ? "#ffd75e" : "#fff"; ctx.lineWidth = (isSel ? 2.5 : 1.5) / cam.zoom; ctx.stroke();
      ctx.fillStyle = "#dff1ff"; ctx.font = "11px sans-serif"; ctx.fillText("入口", p.x + 10, p.y - 2);
    }
    // 单位：站立帧 + 选中高光
    for (let i = 0; i < raw.spawns.length; i++) {
      const s = raw.spawns[i], p = cellCenter(s.row, s.col);
      if (p.x < x0 - 96 || p.x > x1 + 96 || p.y < y0 - 140 || p.y > y1 + 96) continue;
      const d = npcById(s.npc);
      const fr = d ? npcStandFrame((d.model || "").replace(/\.pmg$/, "")) : null;
      const isSel = selection.has({ type: "spawn", index: i });
      if (fr) {
        const ix = Math.round(p.x - fr.a[0]), iy = Math.round(p.y - fr.a[1]);
        if (isSel) {
          const sil = silhouette(fr.im, 0, 0, fr.im.width, fr.im.height, "#ffd75e", "c:" + fr.name);
          for (const [ox, oy] of OFFS) ctx.drawImage(sil, ix + ox, iy + oy);
        }
        ctx.drawImage(fr.im, ix, iy);
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y - 6, 6, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? "#ffd75e" : "#ff8c1a"; ctx.fill();
        ctx.strokeStyle = "#000"; ctx.lineWidth = 1 / cam.zoom; ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fillStyle = "#ff8c1a"; ctx.fill();
      ctx.fillStyle = isSel ? "#ffe9a8" : "#ffd75e"; ctx.font = "11px sans-serif";
      ctx.fillText(npcName(s.npc), p.x + 8, p.y - 2);
    }
    // 选中格子
    if (sel && sel.type === "cell") { const c = byKey.get(sel.row + "," + sel.col); if (c) { diamond(c.dx, c.dy); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2 / cam.zoom; ctx.stroke(); } }
    // 悬停预览（仅放置/涂抹工具）
    if (hoverCell) {
      const hc = hoverCell;
      ctx.globalAlpha = 0.55;
      if (layer === "ground" && tool === "paint") {
        ctx.drawImage(A.atlas, brush.tile.sx, brush.tile.sy, TILE_W, TILE_H, hc.dx, hc.dy, TILE_W, TILE_H);
      } else if (layer === "decor" && tool === "place") {
        const pl = objectPlacement(hc, palette[brush.obj], brush.depth);
        if (pl) ctx.drawImage(A.obj, pl.sprite[0], pl.sprite[1], pl.sprite[2], pl.sprite[3], pl.sprite[4], pl.sprite[5], pl.sprite[2], pl.sprite[3]);
      } else if (layer === "unit" && tool === "place") {
        const d = npcById(brush.npc);
        const fr = d ? npcStandFrame((d.model || "").replace(/\.pmg$/, "")) : null;
        const p = cellCenter(hc.row, hc.col);
        if (fr) ctx.drawImage(fr.im, Math.round(p.x - fr.a[0]), Math.round(p.y - fr.a[1]));
        else { ctx.beginPath(); ctx.arc(p.x, p.y - 6, 8, 0, Math.PI * 2); ctx.fillStyle = "#ff8c1a"; ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      diamond(hc.dx, hc.dy); ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5 / cam.zoom; ctx.stroke();
    }
    // 框选矩形
    if (marquee) {
      const mx0 = Math.min(marquee.x0, marquee.x1), my0 = Math.min(marquee.y0, marquee.y1);
      const mw = Math.abs(marquee.x1 - marquee.x0), mh = Math.abs(marquee.y1 - marquee.y0);
      ctx.fillStyle = "rgba(240,208,96,0.12)"; ctx.fillRect(mx0, my0, mw, mh);
      ctx.strokeStyle = "#f0d060"; ctx.lineWidth = 1.5 / cam.zoom; ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
      ctx.strokeRect(mx0, my0, mw, mh); ctx.setLineDash([]);
    }
    ctx.restore();
    // 顶部信息
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgba(255,255,255,0.65)"; ctx.font = "11px sans-serif";
    const toolName = ({ paint: "刷地面", place: "放置", select: "选择", delete: "删除", entry: "设置入口" })[tool] || tool;
    ctx.fillText("地图：" + cur + "  (" + raw.width + "×" + raw.width + ")  层：" + (LAYERS.find(l => l[0] === layer) || [])[1] + "  工具：" + toolName + "  缩放 " + cam.zoom.toFixed(2), 8, 16);
  }

  // ---------- 工具动作 ----------
  function apply(cell) {
    if (!cell) return;
    let label = "编辑";
    if (layer === "ground") { cell.sx = brush.tile.sx; cell.sy = brush.tile.sy; label = "刷地面"; }
    else if (layer === "collide") { cell.flag = 0; label = "刷碰撞"; }
    mark(label);
  }
  function placeObject(cell) {
    const obj = objectPlacement(cell, palette[brush.obj], brush.depth);
    if (!obj) return;
    raw.objects.push(obj);
    setSel({ type: "object", index: raw.objects.length - 1 });
    mark("放置装饰");
  }

  // ---------- 鼠标 ----------
  cv.addEventListener("contextmenu", e => e.preventDefault());
  cv.addEventListener("mousedown", e => {
    const w = worldAt(e);
    const cell = cellAt(e);
    if (e.button === 2) {
    // ---- 右键删除（多选时删全部选中）----
      if (layer === "decor" && sel && sel.type === "object") {
        const o = raw.objects[sel.index];
        if (o && inSprite(o.sprite, w)) { if (selIndexes("object").length > 1) deleteSelection(); else { raw.objects.splice(sel.index, 1); clearSel(); mark("删除装饰"); buildSide(); draw(); } return; }
      }
      if (layer === "unit") {
        if (sel && sel.type === "spawn") {
          const s = raw.spawns[sel.index];
          if (s) { const p = cellCenter(s.row, s.col); if (Math.hypot(w.x - p.x, w.y - (p.y - 6)) < 12 / cam.zoom) { if (selIndexes("spawn").length > 1) deleteSelection(); else { raw.spawns.splice(sel.index, 1); clearSel(); mark("删除单位"); buildSide(); draw(); } return; } }
        }
        if (sel && sel.type === "entry" && entryAt(w)) { raw.entry = null; clearSel(); mark("删除入口"); buildSide(); draw(); return; }
      }
      panning = true; panStart = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
      rClick = { x: e.clientX, y: e.clientY, moved: false, cell };
      return;
    }
    if (e.button === 1) { panning = true; panStart = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y }; return; }
    if (e.button !== 0) return;

    if (layer === "ground") {
      if (tool === "paint") { if (cell) { setSel({ type: "cell", row: cell.row, col: cell.col }); painting = true; lastCell = cell; apply(cell); } }
      else setSel(cell ? { type: "cell", row: cell.row, col: cell.col } : null);
    } else if (layer === "decor") {
      if (tool === "place") { if (cell) placeObject(cell); }
      else if (tool === "delete") { const ob = objAt(w); if (ob) { raw.objects.splice(ob.index, 1); clearSel(); mark(); } }
      else {
        const ob = objAt(w);
        if (ob) {
          if (e.ctrlKey || e.metaKey || e.shiftKey) toggleSel({ type: "object", index: ob.index });
          else { setSel({ type: "object", index: ob.index }); drag = { kind: "object", index: ob.index, offX: w.x - ob.o.sprite[4], offY: w.y - ob.o.sprite[5], sp0: ob.o.sprite.slice(), tiles0: (ob.o.tiles || []).map(t => t.slice()) }; }
        } else { clearSel(); marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y }; }
      }
    } else if (layer === "collide") {
      if (cell) { setSel({ type: "cell", row: cell.row, col: cell.col }); painting = true; lastCell = cell; cell.flag = 0; mark("刷碰撞"); }
    } else if (layer === "mark") {
      setSel(cell ? { type: "cell", row: cell.row, col: cell.col } : null);
    } else if (layer === "unit") {
      if (tool === "place") {
        if (cell && !raw.spawns.some(s => s.row === cell.row && s.col === cell.col)) { raw.spawns.push({ npc: brush.npc, row: cell.row, col: cell.col }); mark(); }
        setSel(raw.spawns.length ? { type: "spawn", index: raw.spawns.length - 1 } : null);
      } else if (tool === "entry") {
        if (cell) { raw.entry = [cell.row, cell.col]; setSel({ type: "entry" }); mark(); }
      } else {
        const sp = spawnAt(w);
        if (sp) {
          if (e.ctrlKey || e.metaKey || e.shiftKey) toggleSel({ type: "spawn", index: sp.index });
          else { setSel({ type: "spawn", index: sp.index }); drag = { kind: "spawn", index: sp.index }; }
        } else if (entryAt(w)) { setSel({ type: "entry" }); drag = { kind: "entry" }; }
        else { clearSel(); marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y }; }
      }
    }
    buildSide(); draw();
  });

  const onWinMove = e => {
    if (panning && panStart) {
      if (rClick && (Math.abs(e.clientX - rClick.x) > 4 || Math.abs(e.clientY - rClick.y) > 4)) rClick.moved = true;
      cam.x = panStart.cx - (e.clientX - panStart.x) / cam.zoom; cam.y = panStart.cy - (e.clientY - panStart.y) / cam.zoom; draw(); return;
    }
    if (marquee) { const w = worldAt(e); marquee.x1 = w.x; marquee.y1 = w.y; draw(); return; }
    if (drag) {
      const w = worldAt(e);
      if (drag.kind === "object") {
        const o = raw.objects[drag.index];
        if (o) {
          const nx = Math.round(w.x - drag.offX), ny = Math.round(w.y - drag.offY);
          if (nx !== o.sprite[4] || ny !== o.sprite[5]) {
            const dx = nx - drag.sp0[4], dy = ny - drag.sp0[5];
            o.sprite[4] = nx; o.sprite[5] = ny;
            o.tiles = (drag.tiles0 || []).map(t => [t[0], t[1], t[2] + dx, t[3] + dy]);
            drag.moved = true; mark(); draw();
          }
        }
      } else {
        const cell = cellAt(e);
        if (cell) {
          if (drag.kind === "spawn") { const s = raw.spawns[drag.index]; if (s && (s.row !== cell.row || s.col !== cell.col)) { s.row = cell.row; s.col = cell.col; drag.moved = true; mark(); draw(); } }
          else if (drag.kind === "entry") { if (!raw.entry || raw.entry[0] !== cell.row || raw.entry[1] !== cell.col) { raw.entry = [cell.row, cell.col]; drag.moved = true; mark(); draw(); } }
        }
      }
      return;
    }
    if (painting) {
      const cell = cellAt(e);
      if (cell && cell !== lastCell) { lastCell = cell; setSel({ type: "cell", row: cell.row, col: cell.col }); apply(cell); buildSide(); draw(); }
    }
  };
  const onWinUp = e => {
    if (rClick && !rClick.moved && e.button === 2) {
      if (layer === "collide" && rClick.cell) { rClick.cell.flag = 1; setSel({ type: "cell", row: rClick.cell.row, col: rClick.cell.col }); mark(); buildSide(); draw(); }
      else if (layer !== "collide" && layer !== "mark" && tool !== "select") { tool = "select"; buildToolbar(); draw(); }
    }
    // 拖动结束后刷新右侧坐标输入
    if (drag && drag.moved) buildSide();
    if (marquee) { marqueeSelect(); marquee = null; buildSide(); draw(); }
    rClick = null; drag = null;
    painting = false; panning = false; panStart = null; lastCell = null;
  };
  window.addEventListener("mousemove", onWinMove);
  window.addEventListener("mouseup", onWinUp);
  cv.addEventListener("wheel", e => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const mx = (e.clientX - r.left) / cam.zoom + cam.x, my = (e.clientY - r.top) / cam.zoom + cam.y;
    cam.zoom = Math.max(0.2, Math.min(3, cam.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    cam.x = mx - (e.clientX - r.left) / cam.zoom; cam.y = my - (e.clientY - r.top) / cam.zoom;
    draw();
  }, { passive: false });
  cv.addEventListener("mousemove", e => {
    const c = cellAt(e);
    const hob = layer === "decor" ? objAt(worldAt(e)) : null;
    const oi = hob ? hob.index : -1;
    if (c !== hoverCell || oi !== hoverObj) { hoverCell = c; hoverObj = oi; draw(); }
  });
  cv.addEventListener("mouseleave", () => { if (hoverCell || hoverObj !== -1) { hoverCell = null; hoverObj = -1; draw(); } });

  // Ctrl+C / Ctrl+V：复制粘贴地块选项（标记层）
  const onKey = e => {
    const t = e.target;
    if (t && t.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selection.all().some(k => k.startsWith("object:") || k.startsWith("spawn:"))) { e.preventDefault(); deleteSelection(); }
      return;
    }
    if (layer !== "mark") return;
    if (!mod) return;
    const c = sel && sel.type === "cell" ? byKey.get(sel.row + "," + sel.col) : null;
    if (e.key === "c" || e.key === "C") {
      if (!c) return;
      copiedMark = { trigger: c.trigger, map: c.map, entry: !!(raw.entry && raw.entry[0] === c.row && raw.entry[1] === c.col) };
      markMsg = "已复制地块选项（脚本/直传/入口）"; buildSide(); e.preventDefault();
    } else if (e.key === "v" || e.key === "V") {
      if (!c || !copiedMark) return;
      c.trigger = copiedMark.trigger; c.map = copiedMark.map;
      if (copiedMark.entry) raw.entry = [c.row, c.col];
      markMsg = "已粘贴地块选项"; mark(); buildSide(); draw(); e.preventDefault();
    }
  };
  window.addEventListener("keydown", onKey);

  // ---------- 自适应 ----------
  let palT = 0;
  function resize() {
    const w = wrap.clientWidth, hh = wrap.clientHeight;
    if (!w || !hh) return;
    if (w !== CW || hh !== CH) { CW = w; CH = hh; cv.width = w; cv.height = hh; ctx.imageSmoothingEnabled = false; }
    draw();
    clearTimeout(palT); palT = setTimeout(() => buildPalette(), 120);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  // ---------- 调色板工厂 ----------
  function makeGroundPalette(avail, dw, dh, gap, selIdx, onPick) {
    const n = groundTiles.length;
    const pcols = Math.max(1, Math.floor(avail / (dw + gap)));
    const prows = Math.ceil(n / pcols);
    const pcv = h("canvas", { class: "ed-palette-cv" });
    pcv.width = pcols * (dw + gap); pcv.height = prows * (dh + gap);
    const pc = pcv.getContext("2d"); pc.imageSmoothingEnabled = false;
    for (let i = 0; i < n; i++) {
      const x = (i % pcols) * (dw + gap), y = Math.floor(i / pcols) * (dh + gap);
      pc.drawImage(A.atlas, groundTiles[i].sx, groundTiles[i].sy, TILE_W, TILE_H, x, y, dw, dh);
      if (selIdx === i) { pc.strokeStyle = "#f0d060"; pc.lineWidth = 2; pc.strokeRect(x + 1, y + 1, dw - 2, dh - 2); }
    }
    pcv.onclick = e => {
      const r = pcv.getBoundingClientRect();
      const col = Math.floor((e.clientX - r.left) / (dw + gap)), row = Math.floor((e.clientY - r.top) / (dh + gap));
      const i = row * pcols + col; if (i >= 0 && i < n) onPick(i);
    };
    return pcv;
  }
  function makeObjPalette(avail, cell, pad, selIdx, onPick) {
    const pcols = Math.max(1, Math.floor(avail / (cell + pad)));
    const prows = Math.ceil(palette.length / pcols);
    const pcv = h("canvas", { class: "ed-palette-cv" });
    pcv.width = pcols * (cell + pad); pcv.height = prows * (cell + pad);
    const pc = pcv.getContext("2d"); pc.imageSmoothingEnabled = false;
    const rects = [];
    for (let i = 0; i < palette.length; i++) {
      const s = palette[i].sprite, x = (i % pcols) * (cell + pad), y = Math.floor(i / pcols) * (cell + pad);
      const sc = Math.min((cell - 8) / s[2], (cell - 8) / s[3], 1);
      const dw = Math.max(1, s[2] * sc), dh = Math.max(1, s[3] * sc);
      pc.drawImage(A.obj, s[0], s[1], s[2], s[3], x + (cell - dw) / 2, y + (cell - dh) / 2, dw, dh);
      if (selIdx === i) { pc.strokeStyle = "#f0d060"; pc.lineWidth = 2; pc.strokeRect(x + 1, y + 1, cell - 2, cell - 2); }
      rects.push({ i, x, y, w: cell, h: cell });
    }
    pcv.onclick = e => {
      const r = pcv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const hit = rects.find(q => px >= q.x && px < q.x + q.w && py >= q.y && py < q.y + q.h);
      if (hit) onPick(hit.i);
    };
    return pcv;
  }
  // 对象精灵的逐列 alpha 底边、地基线编辑等已抽到 ./decor-line.js
  function tilePreview(sx, sy, scale) {
    const a = A.atlas;
    return h("div", { class: "ed-tileimg", style: "width:" + TILE_W * scale + "px;height:" + TILE_H * scale + "px;background-image:url(assets/atlas.png);background-repeat:no-repeat;background-size:" + (a.width * scale) + "px " + (a.height * scale) + "px;background-position:" + (-sx * scale) + "px " + (-sy * scale) + "px" });
  }

  // ---------- 工具栏 ----------
  function resetTool() { tool = DEFAULT_TOOL[layer]; }
  function buildToolbar() {
    clear(toolbarEl);
    const mapSel = h("select", { onchange: () => loadMap(mapSel.value) });
    for (const n of names) mapSel.append(h("option", { value: n }, n));
    mapSel.value = cur;
    const undoBtn = h("button", { class: "ed-btn", onclick: () => undo() }, "撤销");
    undoBtn.disabled = !history.canUndo();
    const redoBtn = h("button", { class: "ed-btn", onclick: () => redo() }, "重做");
    redoBtn.disabled = !history.canRedo();
    toolbarEl.append(h("div", { class: "ed-tools" }, h("span", null, "地图"), mapSel, undoBtn, redoBtn));
    const chips = h("div", { class: "ed-tools" });
    for (const [k, l] of LAYERS) chips.append(h("span", {
      class: "ed-chip" + (layer === k ? " on" : ""),
      onclick: () => { layer = k; clearSel(); hoverObj = -1; resetTool(); buildToolbar(); buildPalette(); buildSide(); draw(); },
    }, l));
    toolbarEl.append(chips);

    const sub = h("div", { class: "ed-tools" });
    const tbtn = (k, l) => h("span", { class: "ed-chip" + (tool === k ? " on" : ""), onclick: () => { tool = k; buildToolbar(); draw(); } }, l);
    if (layer === "ground") {
      sub.append(tbtn("select", "选择"), tbtn("paint", "刷地面"));
    } else if (layer === "decor") {
      sub.append(tbtn("select", "选择"), tbtn("place", "放置装饰"), tbtn("delete", "删除装饰"));
      if (tool === "place") {
        const dep = h("input", { type: "number", value: brush.depth, style: "width:70px", min: 0 });
        dep.oninput = () => { brush.depth = Math.max(0, Number(dep.value) || 0); };
        sub.append(h("span", null, "深度层"), dep);
        sub.append(h("span", { class: "ed-hint", style: "margin:0" }, "0=普通（按底边排序），1及以上=覆盖在角色之上"));
      }
    } else if (layer === "collide") {
      sub.append(h("span", { class: "ed-hint", style: "margin:0" }, "左键点/拖 = 加碰撞 · 右键点 = 去碰撞 · 右键拖动 = 平移"));
    } else if (layer === "mark") {
      sub.append(h("span", { class: "ed-hint", style: "margin:0" }, "点选地块后在右侧编辑脚本 / 直传 / 入口；Ctrl+C / Ctrl+V 复制粘贴地块选项"));
    } else if (layer === "unit") {
      sub.append(tbtn("select", "选择"), tbtn("place", "放置单位"), tbtn("entry", "设置入口"));
    }
    cv.style.cursor = (layer === "collide" || layer === "mark" || tool === "select") ? "default" : "crosshair";
    toolbarEl.append(sub);
  }

  // ---------- 素材调色板 ----------
  function buildPalette() {
    clear(paletteEl);
    const avail = (paletteEl.clientWidth || main.clientWidth || 800) - 14;
    if (layer === "ground") {
      paletteEl.append(h("div", { class: "ed-palette-title" }, "地面图块（点击选择，然后在画布上涂抹）"));
      paletteEl.append(makeGroundPalette(avail, 48, 24, 2, brush.tile.index, i => { brush.tile = groundTiles[i]; buildPalette(); }));
    } else if (layer === "decor") {
      paletteEl.append(h("div", { class: "ed-palette-title" }, "装饰素材（点击选择，然后在画布上放置）"));
      paletteEl.append(makeObjPalette(avail, 68, 4, brush.obj, i => { brush.obj = i; buildPalette(); }));
    } else if (layer === "unit") {
      paletteEl.append(h("div", { class: "ed-palette-title" }, "选择要放置的单位（点击缩略图）"));
      paletteEl.append(unitGrid(brush.npc, id => { brush.npc = id; buildPalette(); }));
    } else {
      paletteEl.append(h("div", { class: "ed-hint", style: "margin:0" }, "当前层直接在画布上操作，无需素材。"));
    }
  }

  // ---------- 右侧详情 ----------
  function mapProps() {
    side.append(h3("地图属性"));
    side.append(field("显示名", textIn(raw.name || "", v => { raw.name = v; mark(); })));
    side.append(field("音乐", textIn(raw.music || "", v => { raw.music = v; mark(); })));
    side.append(h3("操作"));
    side.append(hint("在画布上按当前层点选部件即可编辑。右键或中键拖动平移，滚轮缩放。"));
  }
  function groundSection(c) {
    side.append(h3("地面格子"));
    side.append(hint("行 " + c.row + "　列 " + c.col));
    side.append(field("当前贴图", tilePreview(c.sx, c.sy, 2)));
    side.append(h3("更换贴图"));
    side.append(makeGroundPalette(side.clientWidth - 24, 32, 16, 1, groundTileIndex(c), i => {
      const t = groundTiles[i]; c.sx = t.sx; c.sy = t.sy; brush.tile = t; mark(); buildPalette(); buildSide(); draw();
    }));
  }
  function decorSection(o) {
    const s = o.sprite;
    side.append(h3("装饰物"));
    side.append(hint("精灵 " + s[2] + "×" + s[3] + "（按住左键可拖动移动）"));
    side.append(field("X", numIn(s[4], v => { moveObjectTo(o, v, s[5]); mark(); draw(); })));
    side.append(field("Y", numIn(s[5], v => { moveObjectTo(o, s[4], v); mark(); draw(); })));
    side.append(field("深度层", numIn(o.layer || 0, v => { o.layer = Math.max(0, v); mark(); draw(); })));
    side.append(field("深度微调", numIn(o.bias || 0, v => { o.bias = Number(v) || 0; mark(); draw(); })));
    side.append(hint("排序键 = 地基线在玩家所在 x 处的 y + 深度层×100000 + 深度微调。数值越大越晚绘制（越靠前）"));
    side.append(field("深度模式", modeControl(s, o.tiles, tplOf(s), TILE_W, (rebuild) => { mark(); if (rebuild) buildSide(); draw(); })));
    if (decorState(tplOf(s)) === "line") side.append(h("div", { class: "ed-row" }, btn("恢复自动地基线", "", () => { delete tplOf(s).line; mark(); buildSide(); draw(); })));
    side.append(h3("图片（拖控制点/空白加点/右键删点；黄线可越出贴图）"));
    side.append(makeLineEditor(s, o.tiles, tplOf(s), TILE_W, side.clientWidth - 30, () => { mark(); draw(); }));
    side.append(hint("黄线=地基线（同一贴图跨地图共用模板；可越出贴图）；青线=头顶最高线（其上→覆盖层，永远遮挡玩家）"));
    side.append(h3("更换类别"));
    side.append(makeObjPalette(side.clientWidth - 24, 52, 4, paletteIndexOf(s), i => { setObjectTemplate(o, palette[i]); mark(); buildSide(); draw(); }));
    side.append(h("div", { class: "ed-row" }, btn("删除装饰", "danger", () => { raw.objects.splice(sel.index, 1); clearSel(); mark(); buildSide(); draw(); })));
  }
  function collideSection() {
    side.append(h3("碰撞编辑"));
    side.append(hint("左键点或拖动 = 加碰撞；右键点 = 去碰撞；右键拖动 = 平移。"));
    const c = sel && sel.type === "cell" ? byKey.get(sel.row + "," + sel.col) : null;
    if (c) side.append(hint("行 " + c.row + "　列 " + c.col + "：" + (c.flag === 1 ? "可走" : "阻挡")));
  }
  function markSection() {
    side.append(h3("地块标记"));
    side.append(hint("左键点选地块后在下方编辑；Ctrl+C 复制、Ctrl+V 粘贴到其他地块。"));
    const c = sel && sel.type === "cell" ? byKey.get(sel.row + "," + sel.col) : null;
    if (!c) { side.append(hint("未选中地块")); return; }
    side.append(hint("行 " + c.row + "　列 " + c.col));
    const ss = h("select", { onchange: () => { c.trigger = Number(ss.value); mark(); draw(); } });
    ss.append(h("option", { value: 0 }, "（无）"));
    for (const k in (opts.transitions || {})) ss.append(h("option", { value: k }, k + " " + opts.transitions[k]));
    ss.value = c.trigger;
    side.append(field("脚本触发", ss));
    const ms = h("select", { onchange: () => { c.map = Number(ms.value); mark(); draw(); } });
    ms.append(h("option", { value: 0 }, "（无）"));
    for (const k in (opts.mapsIndex || {})) ms.append(h("option", { value: k }, k + " " + opts.mapsIndex[k]));
    ms.value = c.map;
    side.append(field("地图直传", ms));
    const isEntry = raw.entry && raw.entry[0] === c.row && raw.entry[1] === c.col;
    const ec = h("input", { type: "checkbox" }); ec.checked = !!isEntry;
    ec.onchange = () => { if (ec.checked) raw.entry = [c.row, c.col]; else if (isEntry) raw.entry = null; mark(); draw(); };
    side.append(field("设为入口点", ec));
    side.append(hint(markMsg || "Ctrl+C 复制当前地块选项，Ctrl+V 粘贴到其他地块"));
  }
  function unitSection() {
    if (sel.type === "spawn") {
      const s = raw.spawns[sel.index];
      if (!s) { clearSel(); mapProps(); return; }
      side.append(h3("单位 #" + (sel.index + 1)));
      side.append(hint("按住左键拖动可移动；右键点已选中的单位可删除"));
      side.append(field("行", numIn(s.row, v => { s.row = v; mark(); draw(); })));
      side.append(field("列", numIn(s.col, v => { s.col = v; mark(); draw(); })));
      side.append(h3("类型（点击缩略图更换）"));
      side.append(unitGrid(s.npc, id => { s.npc = id; mark(); buildSide(); draw(); }));
      const tpl = npcById(s.npc);
      if (tpl) {
        const instMode = !!s.overrides;
        side.append(h3("单位属性：" + (tpl.name || ("#" + tpl.id))));
        const toggle = h("input", { type: "checkbox" });
        toggle.checked = instMode;
        toggle.onchange = () => { if (toggle.checked) s.overrides = s.overrides || {}; else delete s.overrides; mark(); buildSide(); draw(); };
        side.append(field("本实例独立配置（覆盖模板）", toggle));
        if (instMode) {
          side.append(hint("只保存与模板不同的字段，其余继承模板。"));
          side.append(h("div", { class: "ed-row" }, btn("重置为模板", "danger", () => { delete s.overrides; mark(); buildSide(); draw(); })));
        }
        const host = h("div");
        side.append(host);
        // 实例模式：编辑合并视图，把改动字段镜像进 overrides；模板模式：直接编辑共享模板。
        const working = instMode ? JSON.parse(JSON.stringify({ ...tpl, ...s.overrides })) : tpl;
        renderNpcPanel(host, working, {
          images, models, itemNames, skillNames, scripts: scriptNames, factionOptions, aiOptions,
          portraits: [...new Set(npcs.map(n => n.portrait).filter(Boolean))],
          onChange: f => {
            if (instMode && f && f.k) s.overrides[f.k] = JSON.parse(JSON.stringify(working[f.k]));
            mark(); draw();
          },
          rerender: () => buildSide(),
        });
      } else side.append(hint("没有编号为 " + s.npc + " 的 NPC 定义，请到「NPC」页新增。"));
      side.append(h("div", { class: "ed-row" }, btn("删除单位", "danger", () => { raw.spawns.splice(sel.index, 1); clearSel(); mark(); buildSide(); draw(); })));
    } else if (sel.type === "entry") {
      const e = raw.entry || [0, 0];
      side.append(h3("入口点"));
      side.append(hint("按住左键拖动入口点可移动"));
      side.append(field("行", numIn(e[0], v => { raw.entry = [v, e[1]]; mark(); draw(); })));
      side.append(field("列", numIn(e[1], v => { raw.entry = [e[0], v]; mark(); draw(); })));
      side.append(h("div", { class: "ed-row" }, btn("清除入口", "danger", () => { raw.entry = null; clearSel(); mark(); buildSide(); draw(); })));
    }
  }
  // 装饰物缩略图（截取对象精灵区域）
  function objThumb(s, size) {
    const sc = Math.min(size / s[2], size / s[3]);
    const c = h("canvas"); c.width = Math.max(1, Math.round(s[2] * sc)); c.height = Math.max(1, Math.round(s[3] * sc));
    const cx = c.getContext("2d"); cx.imageSmoothingEnabled = false;
    try { cx.drawImage(A.obj, s[0], s[1], s[2], s[3], 0, 0, c.width, c.height); } catch (e) { }
    return c;
  }

  // 当前地图的装饰物列表（点选即选中，右侧可编辑其深度模式/地基线）
  function decorList() {
    side.append(h3("装饰物列表 (" + raw.objects.length + ")"));
    if (!raw.objects.length) { side.append(hint("本图没有装饰物")); return; }
    const grid = h("div", { class: "ed-thumbgrid" });
    raw.objects.forEach((o, i) => {
      const s = o.sprite;
      const tpl = tplOf(s);
      const st = decorState(tpl);
      const cell = h("div", { class: "ed-thumbcell" + (sel && sel.type === "object" && sel.index === i ? " on" : ""), onclick: () => { setSel({ type: "object", index: i }); buildSide(); draw(); } });
      cell.append(objThumb(s, 52));
      cell.append(h("span", null, "#" + (i + 1)));
      cell.append(h("span", { class: "dim" }, s[2] + "×" + s[3] + " · " + (st === "single" ? "单一" : (st === "line" ? "手画" : "自动"))));
      grid.append(cell);
    });
    side.append(grid);
  }

  function unitList() {
    side.append(h3("单位列表 (" + raw.spawns.length + ")"));
    const grid = h("div", { class: "ed-thumbgrid" });
    raw.spawns.forEach((s, i) => {
      const d = npcById(s.npc);
      const cell = h("div", { class: "ed-thumbcell" + (sel && sel.type === "spawn" && sel.index === i ? " on" : ""), onclick: () => { setSel({ type: "spawn", index: i }); buildSide(); draw(); } });
      cell.append(unitThumb(d, 50));
      cell.append(h("span", null, d ? d.name : ("#" + s.npc)));
      cell.append(h("span", { class: "dim" }, "(" + s.row + "," + s.col + ")"));
      grid.append(cell);
    });
    side.append(grid);
  }

  function multiSection(label, type) {
    const n = selIndexes(type).length;
    side.append(h3(label + "：已选 " + n + " 个"));
    side.append(hint("Ctrl/Shift + 左键 增减选择；空白处拖动框选；Delete 或右键选中项可删除。"));
    side.append(h("div", { class: "ed-row" },
      btn("删除选中", "danger", () => deleteSelection()),
      btn("清空选择", null, () => { clearSel(); buildSide(); draw(); })));
  }

  function buildSide() {
    clear(side);
    if (!raw) { side.append(hint("未找到地图数据。")); return; }
    const cell = sel && sel.type === "cell" ? byKey.get(sel.row + "," + sel.col) : null;
    let shown = false;
    if (layer === "decor" && selIndexes("object").length > 1) { multiSection("装饰物", "object"); shown = true; }
    else if (layer === "unit" && selIndexes("spawn").length > 1) { multiSection("单位", "spawn"); shown = true; }
    else if (layer === "ground" && cell) { groundSection(cell); shown = true; }
    else if (layer === "decor" && sel && sel.type === "object" && raw.objects[sel.index]) { decorSection(raw.objects[sel.index]); shown = true; }
    else if (layer === "collide") { if (cell) { collideSection(); shown = true; } }
    else if (layer === "mark") { if (cell) { markSection(); shown = true; } }
    else if (layer === "unit" && sel && (sel.type === "spawn" || sel.type === "entry")) { unitSection(); shown = true; }
    if (!shown) mapProps();
    if (layer === "unit") unitList();
    else if (layer === "decor") decorList();
  }

  // ---------- 启动 ----------
  buildPaletteData();
  buildToolbar();
  buildSide();
  loadMap(cur);
  requestAnimationFrame(() => { resize(); buildPalette(); });

  return {
    draw, loadMap,
    destroy() {
      ro.disconnect();
      clearTimeout(palT); clearTimeout(drawT);
      window.removeEventListener("mousemove", onWinMove);
      window.removeEventListener("mouseup", onWinUp);
      window.removeEventListener("keydown", onKey);
      main.classList.remove("mapmode");
    },
  };
}
