// 图片 / JSON 的异步加载与缓存。
import { A } from "./state.js";

const IMG = {}, PENDING = {};
// 当前数据版本对图片素材的覆盖：资源路径 -> data URL。
let ASSET_OVERRIDES = {};

export function setAssetOverrides(map) {
  ASSET_OVERRIDES = map || {};
  // 覆盖变化后清空图片缓存，让后续 getImg 重新加载新素材。
  for (const k in IMG) delete IMG[k];
  for (const k in PENDING) delete PENDING[k];
}
function resolve(path) { return ASSET_OVERRIDES[path] || path; }

// ---- 后台预载队列（限制并发）----
// 角色帧动辄上百张，若一次性 new Image() 会占满浏览器每域名连接数（~6），
// 使 UI 图片（背包/商店面板等）长期停在 pending。这里用低并发队列慢慢预热，
// 让即时需要的图片通过 getImg 优先拿到连接。
const Q = [];
let active = 0;
const MAX_PRELOAD = 3;
export function preload(path) {
  if (IMG[path] || PENDING[path]) return;
  PENDING[path] = true;   // 预约，避免重复请求
  Q.push(path);
  pump();
}
function pump() {
  while (active < MAX_PRELOAD && Q.length) {
    const path = Q.shift();
    active++;
    const im = new Image();
    im.onload = () => { IMG[path] = im; active--; pump(); };
    im.onerror = () => { IMG[path] = null; active--; pump(); };
    im.src = resolve(path);
  }
}

// 懒加载图片：未加载完成时返回 null，加载完成后进缓存。
export function getImg(path) {
  if (IMG[path]) return IMG[path];
  if (PENDING[path]) return null;
  PENDING[path] = true;
  const im = new Image();
  im.onload = () => { IMG[path] = im; };
  im.onerror = () => { IMG[path] = null; };
  im.src = resolve(path);
  return null;
}

export function loadImg(p) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = resolve(p); });
}

export const loadJSON = p => fetch(p).then(r => r.json());

// 预载某角色模型的所有帧（走低并发队列，不阻塞、不挤占 UI 图片）。
export function preloadChar(model) {
  const ch = A.chars && A.chars[model]; if (!ch) return;
  for (const a in ch) for (const block of ch[a]) for (const f of block)
    preload("assets/role/" + f.replace(/\.bmp$/, ".png"));
}
