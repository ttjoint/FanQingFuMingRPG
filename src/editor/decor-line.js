// 装饰物“地基线”编辑器（作用于**跨地图共享的模板** target）：可在预览上手动描绘黄线（地基线），
// 青线（头顶最高线）自动跟随；也可切回“自动下凸包”或“整体单一深度”。
// 画布四向留白：黄线可画到贴图之外（如拖到贴图下方），青线随之覆盖整幅 → 完全遮蔽。
import { h } from "./dom.js";
import { A } from "../core/state.js";
import { baseLineFromBottom, lowerHull, lineToArray } from "../engine/depth.js";
import { playerHeadHeight } from "../world/map.js";

const MX = 48, MT = 24, MB = 100;   // 画布四周留白（像素，未缩放）

const _bc = new Map();
// 对象精灵的逐列 alpha 底边（源本地 y；-1=无像素），带缓存
export function spriteBottom(s) {
  const key = s[0] + "," + s[1] + "," + s[2] + "," + s[3];
  if (_bc.has(key)) return _bc.get(key);
  let out = null;
  try {
    const c = document.createElement("canvas"); c.width = s[2]; c.height = s[3];
    const cx = c.getContext("2d"); cx.drawImage(A.obj, s[0], s[1], s[2], s[3], 0, 0, s[2], s[3]);
    const d = cx.getImageData(0, 0, s[2], s[3]).data;
    out = new Int16Array(s[2]).fill(-1);
    for (let x = 0; x < s[2]; x++) for (let y = s[3] - 1; y >= 0; y--) if (d[(y * s[2] + x) * 4 + 3] > 8) { out[x] = y; break; }
  } catch (e) { out = null; }
  _bc.set(key, out); return out;
}

export function tileXRange(tiles, s, tileW) {
  let x0 = Infinity, x1 = -Infinity;
  for (const t of (tiles || [])) { const lx = t[2] - s[4]; if (lx < x0) x0 = lx; if (lx + tileW > x1) x1 = lx + tileW; }
  return [x0, x1];
}

// 用自动拟合的下凸包顶点作为手画线的初始控制点
export function seedLine(tpl, s, tiles, tileW) {
  const bottom = spriteBottom(s);
  if (!bottom) { tpl.line = [[0, s[3]], [s[2], s[3]]]; return; }
  const [x0, x1] = tileXRange(tiles, s, tileW);
  const pts = [];
  for (let x = Math.max(0, Math.floor(x0)); x < Math.min(s[2], Math.ceil(x1)); x++) if (bottom[x] >= 0) pts.push([x, bottom[x]]);
  const hull = pts.length >= 2 ? lowerHull(pts) : null;
  tpl.line = (hull && hull.length >= 2) ? hull.map(p => [p[0], p[1]]) : [[0, s[3]], [s[2], s[3]]];
}

// 当前有效地基线逐列 y（手画优先，否则自动）
export function currentBaseArray(tpl, s, tiles, tileW) {
  if (Array.isArray(tpl.line) && tpl.line.length) return lineToArray(tpl.line, s[2]);
  const bottom = spriteBottom(s); if (!bottom) return null;
  const [x0, x1] = tileXRange(tiles, s, tileW);
  return baseLineFromBottom(bottom, x0, x1);
}

export function decorState(tpl) { return tpl.single ? "single" : (Array.isArray(tpl.line) && tpl.line.length ? "line" : "auto"); }

export function makeLineEditor(s, tiles, tpl, tileW, maxW, onChange) {
  const sc = Math.max(0.5, Math.min(3.5, maxW / (s[2] + 2 * MX), 220 / (s[3] + MT + MB)));
  const c = h("canvas", { class: "ed-objcanvas" });
  c.width = Math.max(1, Math.round((s[2] + 2 * MX) * sc)); c.height = Math.max(1, Math.round((s[3] + MT + MB) * sc));
  const cx = c.getContext("2d");
  const X = lx => (MX + lx) * sc, Y = ly => (MT + ly) * sc;
  const redraw = () => {
    cx.imageSmoothingEnabled = false;
    cx.clearRect(0, 0, c.width, c.height);
    // 贴图边框（示意可越界的画布区域）
    cx.strokeStyle = "rgba(150,160,170,0.35)"; cx.setLineDash([3, 3]);
    cx.strokeRect(X(0), Y(0), s[2] * sc, s[3] * sc); cx.setLineDash([]);
    cx.drawImage(A.obj, s[0], s[1], s[2], s[3], X(0), Y(0), s[2] * sc, s[3] * sc);
    // 地基格 x 范围
    const [tx0, tx1] = tileXRange(tiles, s, tileW);
    if (isFinite(tx0)) { cx.strokeStyle = "rgba(150,160,170,0.5)"; cx.setLineDash([3, 3]); cx.beginPath(); cx.moveTo(X(tx0), Y(0)); cx.lineTo(X(tx0), Y(s[3])); cx.moveTo(X(tx1), Y(0)); cx.lineTo(X(tx1), Y(s[3])); cx.stroke(); cx.setLineDash([]); }
    if (decorState(tpl) === "single") {
      let mb = -Infinity; for (const t of (tiles || [])) mb = Math.max(mb, t[3] + 32);
      const y = Y(mb - 16 - s[5]);
      cx.strokeStyle = "#b9c2cc"; cx.setLineDash([4, 3]); cx.beginPath(); cx.moveTo(0, y); cx.lineTo(c.width, y); cx.stroke(); cx.setLineDash([]);
      return;
    }
    const base = currentBaseArray(tpl, s, tiles, tileW); if (!base) return;
    const playerH = playerHeadHeight(A);
    const stroke = (col, fn) => { cx.strokeStyle = col; cx.lineWidth = 1.5; cx.beginPath(); let st = false; for (let x = 0; x < base.length; x++) { if (base[x] < 0) { st = false; continue; } const px = X(x), py = Y(fn(base[x])); if (!st) { cx.moveTo(px, py); st = true; } else cx.lineTo(px, py); } cx.stroke(); };
    stroke("#f0d060", y => y);
    stroke("#5fd0e0", y => y - playerH);
    if (Array.isArray(tpl.line) && tpl.line.length) for (const p of tpl.line) { cx.fillStyle = "#f0d060"; cx.beginPath(); cx.arc(X(p[0]), Y(p[1]), 3.5, 0, Math.PI * 2); cx.fill(); cx.strokeStyle = "#000"; cx.lineWidth = 1; cx.stroke(); }
  };
  redraw();
  if (decorState(tpl) === "single") return c;
  const toLocal = ev => { const r = c.getBoundingClientRect(); return { x: (ev.clientX - r.left) / sc - MX, y: (ev.clientY - r.top) / sc - MT }; };
  const clampX = v => Math.max(-MX, Math.min(s[2] + MX, v));
  const clampY = v => Math.max(-MT, Math.min(s[3] + MB, v));
  const ptAt = (x, y) => { const L = tpl.line || []; const tol = 13 / sc; for (let i = 0; i < L.length; i++) if (Math.hypot(L[i][0] - x, L[i][1] - y) <= tol) return i; return -1; };
  // 按 x 去重（重复 x 会让分段插值跳变）
  const dedupe = L => { L.sort((a, b) => a[0] - b[0]); for (let i = L.length - 1; i > 0; i--) if (Math.abs(L[i][0] - L[i - 1][0]) < 0.5) L.splice(i, 1); };
  let drag = -1, pendingAdd = null;
  c.onpointerdown = ev => {
    if (ev.button !== 0) return;
    c.setPointerCapture(ev.pointerId);
    const p = toLocal(ev);
    const i = ptAt(p.x, p.y);
    pendingAdd = null;
    if (i >= 0) drag = i; else pendingAdd = p;   // 命中控制点→拖动；否则暂记“候选加点”
    redraw();
  };
  c.onpointermove = ev => {
    const p = toLocal(ev);
    if (drag >= 0) { tpl.line[drag] = [clampX(p.x), clampY(p.y)]; redraw(); return; }
    if (pendingAdd && Math.hypot(p.x - pendingAdd.x, p.y - pendingAdd.y) > 8 / sc) pendingAdd = null;   // 拖动→不当成单击
  };
  c.onpointerup = () => {
    if (drag >= 0) { drag = -1; dedupe(tpl.line); onChange && onChange(); redraw(); return; }
    if (pendingAdd) {                             // 单击空白处 → 加点（去重）
      const p = pendingAdd; pendingAdd = null;
      if (!Array.isArray(tpl.line) || !tpl.line.length) seedLine(tpl, s, tiles, tileW);
      const x = clampX(p.x), y = clampY(p.y);
      if (!tpl.line.some(q => Math.hypot(q[0] - x, q[1] - y) < 5)) { tpl.line.push([x, y]); dedupe(tpl.line); onChange && onChange(); }
      redraw();
    }
  };
  c.oncontextmenu = ev => { ev.preventDefault(); const p = toLocal(ev); const i = ptAt(p.x, p.y); if (i >= 0 && Array.isArray(tpl.line) && tpl.line.length > 1) { tpl.line.splice(i, 1); dedupe(tpl.line); onChange && onChange(); redraw(); } };
  return c;
}

export function modeControl(s, tiles, tpl, tileW, onChange) {
  const sel = h("select", {
    onchange: () => {
      const v = sel.value;
      if (v === "single") { tpl.single = true; delete tpl.line; }
      else if (v === "line") { delete tpl.single; if (!Array.isArray(tpl.line) || !tpl.line.length) seedLine(tpl, s, tiles, tileW); }
      else { delete tpl.single; delete tpl.line; }
      onChange && onChange(true);
    },
  });
  sel.append(h("option", { value: "auto" }, "自动地基线（下凸包）"));
  sel.append(h("option", { value: "line" }, "手画地基线"));
  sel.append(h("option", { value: "single" }, "整体单一深度（树木等）"));
  sel.value = decorState(tpl);
  return sel;
}
