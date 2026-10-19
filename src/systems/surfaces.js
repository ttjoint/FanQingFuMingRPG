// UI 表面（面板/弹窗/提示）的统一注册表 + 单一管理器。
//
// 背景：这些界面原先散落在 input.js / systems/*.js / script/vm.js 里，每处各自手工
// 关掉"其它几个"来防止叠层（最多一处手写 6 个置 false），漏一个就叠在一起
// （实测：按 B 打开仓库后再按 Tab，仓库被留在屏幕上而背包盖上来）。
//
// 这里把"有哪些界面、谁能和谁共存、谁在上面"集中成一张表（SURFACES），
// 所有开关都走 openSurface / closeSurface / closeTop，不再逐个字段赋值。
//
// 分层（layer 大的盖在上面）：
//   10 场景层（保存/设置/难度等全屏或半屏窗口）
//   20 功能面板（背包、仓库、铁匠、随从、传送点、商店、信息面板）
//   30 对话（剧本 say/ask）
//   40 瞬时提示（G.tip）
//
// 互斥规则（exclusive 组）：同组同一时刻只允许一个。
// 跨组叠层不是"错"，而是"需要显式声明"——只有 dialogue 允许和 info 共存。

/** 各界面在 G 上对应的字段名（部分界面的"打开"是对象非布尔，见 read/write）。 */
export const SURFACES = /** @type {{id:string,field:string,layer:number,group:string,exclusive:boolean}[]} */ ([
  // layer 10：场景级窗口
  { id: "menu",       field: "savePanel",     layer: 10, group: "screen", exclusive: true },
  { id: "settings",   field: "settingsPanel", layer: 10, group: "screen", exclusive: true },
  // 难度面板是覆盖在游戏画面上的窗口，语义上是游戏内面板（不是设置/菜单这种场景窗口），
  // 放进 panel 组才会和其它面板互斥。
  { id: "difficulty", field: "diffPanel",     layer: 20, group: "panel",  exclusive: true },
  // layer 20：功能面板
  // 背包既能单独打开（Tab），又是仓库界面的组成部分（左背包右仓库）。
  // 它仍属 panel 组（与铁匠/商店等互斥），"与仓库共存"由 COMPANIONS 精确放行。
  { id: "pack",       field: "packOpen",      layer: 20, group: "panel",  exclusive: true },
  { id: "stash",      field: "stashPanel",    layer: 20, group: "panel",  exclusive: true },
  { id: "smith",      field: "smithPanel",    layer: 20, group: "panel",  exclusive: true },
  { id: "merc",       field: "mercPanel",     layer: 20, group: "panel",  exclusive: true },
  { id: "waypoint",   field: "waypointPanel", layer: 20, group: "panel",  exclusive: true },
  { id: "shop",       field: "shop",          layer: 20, group: "panel",  exclusive: true },
  // info 是底层面板（属性/任务/记事/荣辱），值就是当前页名，非空即打开。
  // 它与对话可以共存（对话盖在上面），所以单独成组且不参与 panel 组互斥。
  { id: "info",       field: "panel",         layer: 20, group: "info",   exclusive: true },
  // layer 30：对话
  { id: "dialog",     field: "dialog",        layer: 30, group: "dialog", exclusive: true },
  // layer 40：瞬时提示
  { id: "tip",        field: "tip",           layer: 40, group: "tip",    exclusive: true },
]);

/**
 * 界面之间的"连带打开"关系：打开 key 时同时打开列出的界面，关闭时一起关。
 * 与互斥不同——互斥是"只能有一个"，连带是"必须一起出现"。
 * 例：仓库界面 = 左背包 + 右仓库，两个格子区同屏才可用。
 */
export const COMPANIONS = /** @type {Record<string, string[]>} */ ({
  stash: ["pack"],
});

/**
 * 与当前界面"同属一个操作界面"、因此不算互斥对手的界面。
 * 必须对称：stash 放行 pack，pack 也放行 stash，否则后开的那个会把先开的关掉。
 */
export const SAME_UI = /** @type {Record<string, string[]>} */ ({
  stash: ["pack"],
  pack: ["stash"],
});

const BY_ID = new Map(SURFACES.map(s => [s.id, s]));

/** 取界面定义；未知 id 返回 null（不猜）。 */
export function surfaceDef(id) { return BY_ID.get(id) || null; }

/** 该界面此刻是否打开。 */
export function isOpen(G, id) {
  const s = BY_ID.get(id);
  if (!s || !G) return false;
  const v = G[s.field];
  return v != null && v !== false;
}

/** 当前打开的界面 id 列表，按 layer 升序（渲染顺序即此序）。 */
export function openSurfaces(G) {
  if (!G) return [];
  return SURFACES.filter(s => isOpen(G, s.id)).sort((a, b) => a.layer - b.layer).map(s => s.id);
}

/** 最上层打开的界面 id（Esc/Tab 关闭顺序用）。 */
export function topSurface(G) {
  const list = openSurfaces(G);
  return list.length ? list[list.length - 1] : null;
}

/** 该界面所在互斥组的成员 id。 */
export function groupMembers(group) {
  return SURFACES.filter(s => s.group === group).map(s => s.id);
}

// openSurface 的调用栈（用于连带打开时放行"祖先"界面）。
const OPENING = [];

function clearField(G, s) {
  // tip 的关闭要连同倒计时一起清，否则残留的 tipT 会让别处误判。
  if (s.id === "tip") { G.tip = null; G.tipT = 0; return; }
  G[s.field] = null;
}

/**
 * 打开某界面：先关掉同组其它界面（互斥），再置位。
 * value 可以是 true（布尔型界面）或具体对象/字符串（shop / info 这类值型界面）。
 * @param {any} G 游戏状态
 * @param {string} id 界面 id
 * @param {any} [value]
 */
export function openSurface(G, id, value = true) {
  const s = BY_ID.get(id);
  if (!s || !G) return false;
  if (s.exclusive) {
    // 本次调用链上"正在被连带打开"的界面不能算"他人"：
    // 开仓库 → 连带开背包时，背包的互斥清理不能反过来把仓库关掉。
    const keep = [...(COMPANIONS[id] || []), ...(SAME_UI[id] || []), ...OPENING];
    for (const other of SURFACES) {
      if (other.group !== s.group || other.id === id || keep.includes(other.id)) continue;
      // 走 closeSurface 而不是 clearField：要触发连带清理
      // （否则关掉仓库后它的随属背包会孤零零留在屏幕上）。
      if (isOpen(G, other.id)) closeSurface(G, other.id);
    }
  }
  G[s.field] = value === true ? true : value;
  // 连带打开（如仓库需要左侧背包同屏）。
  const deps = (COMPANIONS[id] || []).filter(dep => !isOpen(G, dep));
  if (deps.length) {
    OPENING.push(id);
    try { for (const dep of deps) openSurface(G, dep); }
    finally { OPENING.pop(); }
  }
  return true;
}

/** 关闭某界面。 */
export function closeSurface(G, id) {
  const s = BY_ID.get(id);
  if (!s || !G) return false;
  clearField(G, s);
  // 关闭宿主时连带关掉随属界面，避免"仓库关了、背包还开着"的半截状态。
  for (const dep of COMPANIONS[id] || []) {
    if (isOpen(G, dep)) closeSurface(G, dep);
  }
  return true;
}

/** 关掉最上层的界面，返回是否关掉了东西。 */
export function closeTop(G) {
  const top = topSurface(G);
  if (!top) return false;
  closeSurface(G, top);
  return top;
}

/** 关掉所有界面（切图/读档/回菜单时用）。keep 里的 id 保留。 */
export function closeAll(G, keep = []) {
  if (!G) return;
  for (const s of SURFACES) {
    if (keep.includes(s.id)) continue;
    if (isOpen(G, s.id)) clearField(G, s);
  }
}

/**
 * 切换某界面的开关（按钮/快捷键的通用语义：已开则关，未开则开）。
 * 返回切换后是否打开。
 */
export function toggleSurface(G, id, opts = {}) {
  const s = BY_ID.get(id);
  if (!s || !G) return false;
  if (isOpen(G, id)) { closeSurface(G, id); return false; }
  // 开之前先跑调用方的业务守卫（例如"没有传送点不允许打开"）。
  if (typeof opts.beforeOpen === "function" && opts.beforeOpen() === false) return false;
  openSurface(G, id, opts.value === undefined ? true : opts.value);
  if (typeof opts.afterOpen === "function") opts.afterOpen();
  return true;
}
