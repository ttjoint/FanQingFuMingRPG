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

// ---- 后台预载队列（分优先级、限并发、空闲时持续消化）----
// 目标：素材在后台“陆续加载出来”，而不是等到用的时候才现拉。
//
// 为什么不能一口气全排：角色帧共 2809 张 / 17MB，浏览器每域名连接数只有 ~6，
// 一次性堆上去会挤占即时请求（见下方“开局 NPC 隐形”的历史坑）。
//
// 所以这里是一个带优先级的持续预载器：
//   P0  即时（getImg 自己拉，不经过队列，永远最快）
//   P1  当前地图/当前可见单位需要的帧（进图时排）
//   P2  玩家自身的动作帧（走动/战斗时就会用到）
//   P3  全局素材：物品图标、技能图标、UI、全部角色模型的静止帧
//   P4  全部剩余角色帧（真正“闲时暖机”）
// 低优先级永远排在高优先级后面；每张图加载完后自动续泵，直到队列排空。
const LEVELS = 5;
const Q = [[], [], [], [], []];   // Q[0] 不用于后台（即时请求不走队列）
const QUEUED = {};                 // path -> 所在队列的 level（去重）
let active = 0;
// 即时请求要给至少留一条连接，所以后台并发上限设得很小。
// 真实网络下这已经足够：2809 张 × 平均 6KB，限 2 并发也就几十秒。
const MAX_PRELOAD = 2;

function nextPath() {
  for (let lv = 1; lv < LEVELS; lv++) {
    const q = Q[lv];
    while (q.length) {
      const p = q.shift();
      if (QUEUED[p] === undefined) continue;   // 已被即时请求接管
      delete QUEUED[p];
      if (IMG[p]) continue;                    // 已经加载好了
      return p;
    }
  }
  return null;
}

// 排入后台预载。level 1..4，默认 4（最低优先级）。
export function preload(path, level) {
  const lv = level == null ? LEVELS - 1 : Math.max(1, Math.min(LEVELS - 1, level));
  if (IMG[path] || PENDING[path] || QUEUED[path] !== undefined) return;
  QUEUED[path] = lv;
  Q[lv].push(path);
  pump();
}
// 即时请求已开始加载该路径 → 把队列里的同名任务作废。
function cancelQueued(path) {
  delete QUEUED[path];
}

function pump() {
  while (active < MAX_PRELOAD) {
    const path = nextPath();
    if (!path) return;
    active++;
    const im = new Image();
    const done = () => { active--; pump(); };
    im.onload = () => { IMG[path] = im; done(); };
    im.onerror = () => { IMG[path] = null; done(); };
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

// 预载某角色模型的帧。
//
// level：后台队列优先级（1 最高，4 最低）。
//   1 = 当前地图的单位（进图时排，最可能被看到）
//   2 = 玩家自己的动作帧
//   3 = 其它角色的静止帧
//   4 = 其它角色的剩余帧（闲时暖机）
//
// onlyStand：只排站立帧。
export function preloadChar(model, opts) {
  const o = typeof opts === "boolean" ? { onlyStand: opts } : (opts || {});
  const level = o.level == null ? 3 : o.level;
  const onlyStand = !!o.onlyStand;
  const ch = A.chars && A.chars[model]; if (!ch) return;
  const push = (a) => { for (const block of ch[a]) for (const f of block)
    preload("assets/role/" + f.replace(/\.bmp$/, ".png"), a === "stand" ? level : level + 1); };
  const actions = Object.keys(ch);
  // stand 先排：只要静止帧到位，单位就能正确显示（走动时再补动作帧）。
  actions.sort((a, b) => (a === "stand" ? -1 : b === "stand" ? 1 : 0));
  for (const a of actions) {
    if (onlyStand && a !== "stand") continue;
    push(a);
  }
}

// 全部角色模型的帧（全量暖机，最低优先级）。
//
// 实机问题：以前只有主角的站立帧会被预载，其余素材全靠 getImg 临用现拉，
// 表现为“走动时动作帧一张一张卡出来”“进新地图敌人立绘半天不出来”。
// 现在把全部模型的帧排到最低优先级，玩家真正在看的东西依然优先，
// 空闲连接会被用来把剩下的图陆续拉完。
export function preloadAllChars(skipModel) {
  if (!A.chars) return;
  for (const m of Object.keys(A.chars)) {
    if (skipModel && skipModel(m)) continue;
    preloadChar(m, { level: 3 });
  }
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
  for (const q of Q) q.length = 0;
  active = 0;
}
export function __pendingQueueForTest() { return Q.flat(); }
