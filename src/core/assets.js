// 图片 / JSON 的异步加载与缓存。
//
// 资源根（ASSET_ROOT）：代码里用**稳定逻辑键** "assets/xxx" 引用资源；
// 实际物理路径 = `<版本根>/assets/xxx`。这样切换数据版本时无需改任何调用点。
//   - 默认版本：versions/default/assets/...
//   - 编辑器版本：versions/<id>/assets/...（磁盘版本）或浏览器本地补丁版本（逻辑键保持不变）
// 逻辑键（"assets/..."）也用于「版本对图片素材的覆盖」查表，保持向后兼容。
import { A } from "./state.js";

const IMG = {}, PENDING = {};
// 当前数据版本对图片素材的覆盖：逻辑键 -> data URL。
let ASSET_OVERRIDES = {};
// 当前资源根前缀（不含尾斜杠）。固定指向原版只读版本。
const ASSET_ROOT = "versions/default";

export function getAssetRoot() { return ASSET_ROOT; }

export function setAssetOverrides(map) {
  ASSET_OVERRIDES = map || {};
  // 覆盖变化后清空图片缓存，让后续 getImg 重新加载新素材。
  for (const k in IMG) delete IMG[k];
  for (const k in PENDING) delete PENDING[k];
}

// 逻辑键 -> 物理路径。覆盖优先（编辑器内联 dataURL / IDB 键）。
// 兼容两类调用：以 "assets/" 开头的逻辑键（走版本根），以及已经是完整路径的键。
export function assetURL(key) {
  if (key == null) return key;
  if (ASSET_OVERRIDES[key]) return ASSET_OVERRIDES[key];
  const s = String(key);
  if (s.startsWith("assets/")) return ASSET_ROOT + "/" + s;
  if (s.startsWith("/") || /^[a-z]+:\/\//i.test(s) || s.startsWith("data:") || s.startsWith("blob:")) return s;
  return s;
}
// 向后兼容别名（旧代码 / 编辑器可能引用 resolve）。
export const resolve = assetURL;

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
    im.src = assetURL(path);
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
  im.src = assetURL(path);
  return null;
}

export function loadImg(p) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = assetURL(p); });
}

// 读取 JSON：逻辑键 "assets/xxx.json" 会解析到当前版本根。
export const loadJSON = p => fetch(assetURL(p)).then(r => r.json());

// 解析音频 / 任意资源路径（供 audio.js 等使用）。
export const assetPath = assetURL;

// 预载某角色模型的所有帧（走低并发队列，不阻塞、不挤占 UI 图片）。
export function preloadChar(model) {
  const ch = A.chars && A.chars[model]; if (!ch) return;
  for (const a in ch) for (const block of ch[a]) for (const f of block)
    preload("assets/role/" + f.replace(/\.bmp$/, ".png"));
}
