// 特效渲染：脚底圈（under）、深度排序特效（over）、顶层特效（top）。
// 程序化绘制（圆环/光晕/落点），后续可切换到贴图动画帧（def.texture / def.frames）。
import { G } from "../core/state.js";
import { ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { CFG } from "../core/config.js";
import { effectPos, frameAt, layerWeight, LAYER_UNDER, LAYER_TOP, LAYER_OVER } from "../engine/effect.js";

function alphaOf(inst) {
  // 非循环特效末段淡出。
  if (inst.loop) return inst.alpha == null ? 1 : inst.alpha;
  const life = inst.life || 0.6, t = inst.t;
  const fade = 0.18;
  if (t > life - fade) return Math.max(0, (life - t) / fade) * (inst.alpha == null ? 1 : inst.alpha);
  return inst.alpha == null ? 1 : inst.alpha;
}

// 画一个程序化脚底椭圆圈。
export function drawRing(x, y, color, r, opts) {
  const o = opts || {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;   // 防 NaN 直接抛错
  const rx = Number.isFinite(r) ? r : 18, ry = rx * 0.5;
  ctx.save();
  if (o.alpha != null) ctx.globalAlpha = o.alpha;
  if (o.glow !== false) {
    ctx.globalCompositeOperation = "lighter";
    const grd = ctx.createRadialGradient(x, y, 1, x, y, rx);
    grd.addColorStop(0, "rgba(255,255,255,0)");
    grd.addColorStop(0.75, color);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = (o.alpha != null ? o.alpha : 1) * 0.35;
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.globalAlpha = o.alpha != null ? o.alpha : 1;
  ctx.strokeStyle = color; ctx.lineWidth = o.lineWidth || 2;
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// 落点光圈：由小扩大 + 淡出。
export function drawMoveMarker(camX, camY, mk) {
  const p = (mk.t || 0) / (mk.life || 0.5);
  const r = 8 + 22 * Math.min(1, p);
  const a = Math.max(0, 1 - p);
  drawRing(mk.x - camX, mk.y - camY, (mk.color || "#ffe08a"), r, { alpha: a, lineWidth: 2 });
  drawRing(mk.x - camX, mk.y - camY, (mk.color || "#ffe08a"), 6 + 6 * p, { alpha: a * 0.8, glow: false, lineWidth: 1 });
}

// 程序化形状（无贴图时）。
function drawShape(inst, x, y, color, alpha) {
  const s = inst.scale || 1;
  const shape = inst.def.shape || "sprite";
  if (shape === "ring") { drawRing(x, y, color, 18 * s, { alpha }); return true; }
  if (shape === "glow") {
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = alpha * 0.8;
    const grd = ctx.createRadialGradient(x, y - 6, 1, x, y - 6, 20 * s);
    grd.addColorStop(0, color); grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd; ctx.beginPath(); ctx.ellipse(x, y - 4, 20 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore(); return true;
  }
  if (shape === "marker") { drawMoveMarkerAtScreen(x, y, { t: inst.t, life: inst.life, color }); return true; }
  return false;
}

// 屏幕上直接绘制落点光圈（已知屏幕坐标）。
function drawMoveMarkerAtScreen(sx, sy, mk) {
  const p = Math.min(1, (mk.t || 0) / (mk.life || 0.5));
  const r = 8 + 22 * p;
  const a = Math.max(0, 1 - p);
  drawRing(sx, sy, mk.color || "#ffe08a", r, { alpha: a, lineWidth: 2 });
  drawRing(sx, sy, mk.color || "#ffe08a", 6 + 6 * p, { alpha: a * 0.8, glow: false, lineWidth: 1 });
}

// 绘制单个特效实例（over/top 层）。
export function drawEffect(inst, camX, camY) {
  const p = effectPos(inst);
  const x = Math.round(p.x - camX), y = Math.round(p.y - camY);
  const alpha = alphaOf(inst);
  if (alpha <= 0) return;
  const color = inst.color || inst.def.color || "#ffe08a";
  // 有贴图帧：优先绘制贴图（底边对齐锚点）。
  const frames = inst.def.frames;
  if (frames && frames.length) {
    const f = frames[Math.min(frames.length - 1, frameAt(inst))];
    const im = f ? getImg(f.replace(/\.bmp$/, ".png")) : null;
    if (im) {
      ctx.save(); ctx.globalAlpha = alpha;
      if (inst.def.blend === "lighter") ctx.globalCompositeOperation = "lighter";
      const w = im.width * (inst.scale || 1), h = im.height * (inst.scale || 1);
      if (inst.flip) { ctx.translate(x, y); ctx.scale(-1, 1); ctx.drawImage(im, -w / 2, -h, w, h); }
      else ctx.drawImage(im, x - w / 2, y - h, w, h);
      ctx.restore();
      return;
    }
  }
  // 无贴图：程序化形状。
  if (!drawShape(inst, x, y, color, alpha)) {
    // 兜底：小方块闪光。
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
    ctx.fillRect(x - 4, y - 8, 8, 8); ctx.restore();
  }
}

// 收集需要参与 y 排序的 over 层特效（世界坐标）。
export function overEffects(g) {
  const out = [];
  for (const inst of g.fx || []) if (layerWeight(inst.layer) === 1) out.push(inst);
  return out;
}

export function underEffects(g) {
  const out = [];
  for (const inst of g.fx || []) if (layerWeight(inst.layer) === -1) out.push(inst);
  return out;
}

export function topEffects(g) {
  const out = [];
  for (const inst of g.fx || []) if (layerWeight(inst.layer) === 2) out.push(inst);
  return out;
}

// 地面物品高亮：脚底光环 + 稀有度光柱（划过高亮时）。
export function drawGroundItemHighlight(gr, camX, camY, opts) {
  const o = opts || {};
  const x = Math.round(gr.x - camX), y = Math.round(gr.y - camY);
  const color = o.color || "#ffe08a";
  drawRing(x, y + 3, color, o.radius || 14, { alpha: o.alpha != null ? o.alpha : 0.9, lineWidth: 2 });
}

// 绘制指示圈（红圈/蓝圈）——由 systems/indicators.js 计算，渲染层只负责画。
export function drawIndicatorRings(camX, camY) {
  const ui = G.uiFx; if (!ui) return;
  const rings = (GCRingColors());
  if (ui.target) drawRing(Math.round(ui.target.x - camX), Math.round(ui.target.y - camY + 3), rings.target, 20);
  if (ui.interact) drawRing(Math.round(ui.interact.x - camX), Math.round(ui.interact.y - camY + 3), rings.interact, 20);
}

function GCRingColors() {
  const r = (CFG && CFG.fx && CFG.fx.ring) || {};
  return { target: r.target || "#e04040", interact: r.interact || "#4080ff", move: r.move || "#ffe08a" };
}

export function drawMoveMarkerAt(camX, camY) {
  const mk = G.moveMarker; if (!mk) return;
  const c = GCRingColors();
  drawMoveMarker(camX, camY, { x: mk.x, y: mk.y, t: mk.t, life: mk.life, color: c.move });
}
