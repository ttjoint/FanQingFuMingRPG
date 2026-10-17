// 装饰物（地图 objects）的缩略图工具。
//
// 装饰物**不是独立图片文件**：所有地图物件共用一张图集 `assets/obj.png`，
// 每个 object 的 sprite 是 `[sx, sy, sw, sh, dxa, dya]`（见 renderer 里的绘制），
// 前四项是图集内的源矩形，后两项是屏幕落点。所以装饰物预览必须
// 「从大图上切一块」，不能直接把 sprite[0] 当文件名去加载 —— 那会 forever 404。

import { assetURL } from "../core/assets.js";
import { getRuntime } from "../runtime/context.js";

const objCache = new Map();   // src -> Promise<HTMLImageElement|null>

function loadImg(src) {
  if (objCache.has(src)) return objCache.get(src);
  const p = new Promise(resolve => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
  objCache.set(src, p);
  return p;
}

/** 装饰物图集路径（与 renderer 用的 A.obj 同源）。 */
export function decorAtlasPath() {
  let atl = null;
  try { atl = getRuntime && getRuntime().assets && getRuntime().assets.obj; } catch { atl = null; }
  if (atl && atl.src) return atl.src;
  return assetURL("assets/obj.png");
}

/**
 * 生成一个「从图集切出来的装饰物缩略图」canvas。
 * @param {{sprite:number[], polygon?:number[][]}} tpl
 * @param {{max?:number, pad?:number}} [opts]
 * @returns {HTMLCanvasElement}
 */
export function decorThumb(tpl, opts) {
  const o = opts || {};
  const max = o.max || 40;
  const s = (tpl && tpl.sprite) || [0, 0, 0, 0, 0, 0];
  const sw = Math.max(1, s[2] | 0), sh = Math.max(1, s[3] | 0);
  const k = Math.min(max / sw, max / sh, 1);
  const w = Math.max(1, Math.round(sw * k)), hgt = Math.max(1, Math.round(sh * k));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = hgt;
  cv.style.width = w + "px";
  cv.style.height = hgt + "px";
  const ctx = cv.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    loadImg(decorAtlasPath()).then(im => {
      if (!im) return;
      try { ctx.drawImage(im, s[0], s[1], sw, sh, 0, 0, w, hgt); } catch { /* 越界忽略 */ }
    });
  }
  return cv;
}

/**
 * 大图预览（右侧详情用）：把整块 sprite 放到一个固定高度的容器里，等比缩放。
 * @param {{sprite:number[]}} tpl
 * @param {number} [boxW] 容器宽度
 * @param {number} [boxH] 容器高度
 */
export function decorPreview(tpl, boxW, boxH) {
  const s = (tpl && tpl.sprite) || [0, 0, 0, 0, 0, 0];
  const sw = Math.max(1, s[2] | 0), sh = Math.max(1, s[3] | 0);
  const W = boxW || 260, Hh = boxH || 180;
  const k = Math.min(W / sw, Hh / sh);
  const w = Math.max(1, Math.round(sw * k)), hgt = Math.max(1, Math.round(sh * k));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = hgt;
  cv.className = "ed-decor-big";
  cv.style.width = w + "px";
  cv.style.height = hgt + "px";
  // 棋盘格底，方便看清透明区域
  cv.style.background = "repeating-conic-gradient(#2a2f38 0% 25%, #1e222a 0% 50%) 50%/12px 12px";
  const ctx = cv.getContext("2d");
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    loadImg(decorAtlasPath()).then(im => {
      if (!im) return;
      try { ctx.drawImage(im, s[0], s[1], sw, sh, 0, 0, w, hgt); } catch { /* 越界忽略 */ }
    });
  }
  return cv;
}
