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

// 资源指纹（?v=<token>）：用于让 serve.py 对该资源返回 immutable 缓存。
//
// 背景：以前服务器对所有响应都发 no-store，于是每次刷新都要重传全部
// 474 个请求 / 约 12MB（实测首次与刷新完全相同，304 命中 0 次）。
// 现在服务器按路径分级：只有 URL 带了 ?v= 才允许长期缓存。
//
// 安全性：指纹变了 URL 就变，所以**绝不能**在素材会变的情况下沿用旧指纹。
// 因此这里只接受显式设置的 token（由版本元数据的 updatedAt 派生），
// 默认 null = 不加参数 = 服务器回落到"每次校验"。不猜、不编造。
let ASSET_TOKEN = null;

/**
 * 设置资源指纹。传 null/空会清除（回到"每次校验"的保守模式）。
 * 约定：只在确认素材不会再变时调用（如加载只读的默认版本）。
 */
export function setAssetToken(token) {
  ASSET_TOKEN = token == null || token === "" ? null : String(token);
  // URL 变了，旧缓存里的图片键仍然有效（键是逻辑键），但预载状态需重置，
  // 否则新 URL 永远不发请求。这里保守全清，代价只是下次重拉一遍。
  for (const k in IMG) delete IMG[k];
  for (const k in PENDING) delete PENDING[k];
}

export function getAssetToken() { return ASSET_TOKEN; }

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
  if (s.startsWith("assets/")) return withToken(ASSET_ROOT + "/" + s);
  if (s.startsWith("/") || /^[a-z]+:\/\//i.test(s) || s.startsWith("data:") || s.startsWith("blob:")) return s;
  return withToken(s);
}

// 只在跨源无关的相对路径上附加指纹参数；已有 query 时用 & 连接。
function withToken(url) {
  if (!ASSET_TOKEN) return url;
  if (/^[a-z]+:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return url;
  return url + (url.indexOf("?") >= 0 ? "&" : "?") + "v=" + encodeURIComponent(ASSET_TOKEN);
}
// 向后兼容别名（旧代码 / 编辑器可能引用 resolve）。
export const resolve = assetURL;

// ---- 后台预载队列（限制并发）----
// 角色帧动辄上百张（role 就 360 帧），若一次性 new Image() 会占满浏览器每域名
// 连接数（~6），使 UI 图片（背包/商店面板等）长期停在 pending。这里用低并发
// 队列慢慢预热。
//
// ⚠ 预载队列登记过的路径曾经被 getImg 当成“已在加载中”而直接返回 null，
// 导致排队中的帧在真正轮到之前完全不可用（开局 NPC 全部隐形就是这个后果）。
// 修复：用独立的 QUEUED 集合做去重，不再占用 PENDING；同时给预载让路——
// 一旦某个路径被 getImg 即时请求，就从队列里作废（gen 计数），
// 保证“玩家现在看得见的”总是比“提前热身”优先。
const Q = [];
const QUEUED = {};
let active = 0;
const MAX_PRELOAD = 2;   // 从 3 降为 2：给即时请求留出至少一条连接
let qGen = 0;

export function preload(path) {
  if (IMG[path] || PENDING[path] || QUEUED[path]) return;
  QUEUED[path] = qGen;
  Q.push(path);
  pump();
}
// 即时请求已开始加载该路径 → 把队列里的同名任务作废。
function cancelQueued(path) {
  if (QUEUED[path] === undefined) return;
  delete QUEUED[path];
}
function pump() {
  while (active < MAX_PRELOAD && Q.length) {
    const path = Q.shift();
    const gen = QUEUED[path];
    if (gen === undefined) continue;          // 已被即时请求接管/作废
    delete QUEUED[path];
    if (IMG[path]) continue;                  // 已经加载好了，不用再来一次
    active++;
    const im = new Image();
    im.onload = () => { IMG[path] = im; active--; pump(); };
    im.onerror = () => { IMG[path] = null; active--; pump(); };
    im.src = assetURL(path);
  }
}

// 懒加载图片：未加载完成时返回 null，加载完成后进缓存。
//
// ⚠ 历史上这里有个会让线上“NPC 集体隐形二十几秒”的坑，修复要点：
//   1) 不要和后台预载队列共用 PENDING 的语义。预载队列（preload）一次排进
//      主角全部帧（role 有 360 帧，且其中 60 帧在磁盘上不存在），并发只有 3，
//      在真实网络下要跑十几到几十秒。若即时请求只能排在它后面，玩家开局的
//      画面就是“只有主角、所有 NPC 隐形”。实测（GitHub Pages）：NPC 图要
//      **26 秒**后才加载成功；本地 127.0.0.1 因为极快，根本看不出来。
//   2) 失败（onerror）必须清 PENDING，否则一旦某张图失败过，该路径就**永久**
//      返回 null，连重试的机会都没有（这里 onerror 只写了 IMG[path]=null，
//      PENDING 残留 true，后续全被 `if (PENDING[path]) return null` 拦死）。
//   3) 已判定失败（IMG[path] === null）的路径允许再次尝试，用 FAILED 记次数
//      限制重试，避免抖动时无限刷请求。
const FAILED = {};
const MAX_RETRY = 2;

export function getImg(path) {
  if (IMG[path]) return IMG[path];
  if (IMG[path] === null) {              // 之前失败过：有限次重试
    if ((FAILED[path] || 0) >= MAX_RETRY) return null;
    FAILED[path] = (FAILED[path] || 0) + 1;
  }
  if (PENDING[path]) return null;
  cancelQueued(path);          // 即时请求优先：作废后台队列里的同名预热任务
  PENDING[path] = true;
  const im = new Image();
  // 即时请求优先：用它自己加载，不等后台预载队列（两者共用 PENDING 会让
  // 可见性关键资源被预载饿死）。
  im.onload = () => { delete PENDING[path]; IMG[path] = im; };
  im.onerror = () => { delete PENDING[path]; IMG[path] = null; };
  im.src = assetURL(path);
  return null;
}

export function loadImg(p) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = assetURL(p); });
}

// 读取 JSON：逻辑键 "assets/xxx.json" 会解析到当前版本根。
// JSON 加载。
//
// cache: 这里的选择直接决定了首屏能不能复用缓存（实测 fetch 占了 2.15MB / 33 个请求）。
//   - 带指纹（?v=）的 URL 内容不会变 → force-cache：直接用本地副本，不发请求；
//   - 不带指纹（可写版本、静态部署）→ default：每次向服务器验证，改了立刻可见。
// 不区分这两者的后果是：即使服务器回了 immutable，fetch 刷新时仍会重新拉全文。
export function fetchOpts(url) {
  const fingerprinted = /[?&]v=/.test(url);
  // 断言成 RequestCache：直接返回字符串字面量时 TS 会推断成 string，
  // 而 fetch 的第二参要求具体枚举。
  return /** @type {RequestInit} */ ({ cache: fingerprinted ? "force-cache" : "default" });
}

export const loadJSON = p => {
  const url = assetURL(p);
  return fetch(url, fetchOpts(url)).then(r => r.json());
};

// 解析音频 / 任意资源路径（供 audio.js 等使用）。
export const assetPath = assetURL;

// 预载某角色模型的帧（走低并发队列，不阻塞、不挤占 UI 图片）。
//
// 顺序很重要：**先排静止帧（stand），再排其它动作**。
// role 模型有 360 个帧引用（去重后 300 个文件），如果只按 chars.json 的顺序
// 一股脑往队列里塞，真实网络下（CDN 慢）玩家会先看完“隐形主角/隐形 NPC”好几十秒。
// 而开局实际只需要每个单位的 stand 帧就能把画面画对。
//
// onlyStand: 只排站立帧。开场预热主角用这个——走路/跑步/战斗帧等真正
// 动起来时由 getImg 即时拉，没必要在标题画面就把 300 张全排上。
export function preloadChar(model, onlyStand) {
  const ch = A.chars && A.chars[model]; if (!ch) return;
  const actions = Object.keys(ch);
  if (onlyStand) {
    if (ch.stand) for (const block of ch.stand) for (const f of block)
      preload("assets/role/" + f.replace(/\.bmp$/, ".png"));
    return;
  }
  // stand 优先；其余保持原有相对顺序。
  actions.sort((a, b) => (a === "stand" ? -1 : b === "stand" ? 1 : 0));
  for (const a of actions) for (const block of ch[a]) for (const f of block)
    preload("assets/role/" + f.replace(/\.bmp$/, ".png"));
}

// ---- 仅测试用钩子 ----
// 图片加载全是模块级私有状态，单元测试无法直接观察。这里只开放
// “重置缓存”与“读预载队列快照”两个只读/重置用途，不开任何可以伪造
// 加载结果的入口（避免测试自己造数据把 bug 盖住）。
export function __resetAssetsForTest() {
  for (const k in IMG) delete IMG[k];
  for (const k in PENDING) delete PENDING[k];
  for (const k in FAILED) delete FAILED[k];
  for (const k in QUEUED) delete QUEUED[k];
  Q.length = 0;
  active = 0;
}
export function __pendingQueueForTest() { return Q; }
