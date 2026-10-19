// 非游玩场景的流程控制：片头闪屏 → 标题菜单 → 结局 / 关于。ctx 由调用方注入。
// 原版 game.ini 的 [music]/[FlashWindow*]/[background]/[result] 配置由 build_assets.py 导出为 assets/game.json。
import { levelSnapshot } from "../engine/balance.js";
import { playBGM } from "./audio.js";
import { startScript } from "../script/vm.js";
import { closeAll } from "./surfaces.js";
import { pageById, DEFAULT_PAGE_ID } from "../content/page.js";

export function titleMusic(ctx) { const A = ctx.assets; return (A.game && A.game.music && A.game.music.start) || ""; }
export function endMusic(ctx) { const A = ctx.assets; return (A.game && A.game.music && A.game.music.end) || titleMusic(ctx); }
// 片头闪屏条目：兼容两种写法 ——
//   旧："team.bmp"                        （固定 2 秒）
//   新：{ file: "team.bmp", duration: 3 }  （可单独设时长）
export function flashItem(x, defDur) {
  const d = defDur == null ? 2 : defDur;
  if (x == null) return { file: "", duration: d };
  if (typeof x === "string") return { file: x, duration: d };
  return { file: String(x.file || x.name || ""), duration: Number(x.duration) > 0 ? Number(x.duration) : d };
}
// 片头图片序列：优先取页面文档的 flash 列表（新数据可独立配置），
// 缺省回退 game.json 的 flash（原版数据兼容）。
export function flashPics(ctx) {
  const A = ctx.assets;
  const pages = (A && A.pages) || null;
  const page = pageById(pages, "flash");
  if (page && page.flash.length) return page.flash.map(f => f.file);
  const arr = (A.game && A.game.flash && A.game.flash.length) ? A.game.flash : [];
  return arr.map(x => flashItem(x, 2).file).filter(Boolean);
}
// 片头每张的时长（秒）：与 flashPics 同源，避免两处各读一份。
export function flashDurations(ctx) {
  const A = ctx.assets;
  const page = pageById(pagesOfAssets(ctx), "flash");
  if (page && page.flash.length) return page.flash.map(f => f.duration);
  const arr = (A.game && A.game.flash && A.game.flash.length) ? A.game.flash : [];
  return arr.map(x => flashItem(x, 2).duration);
}
export function endPic(ctx) {
  const A = ctx.assets;
  const page = pageById(pagesOfAssets(ctx), "ending");
  if (page && page.background) return page.background;
  return (A.game && A.game.endpic) || "";
}

// 页面表取值：A.pages 由 contentToLegacy 带出；容错 content.pages
// （只注入 content 的工具/测试也能工作）。
function pagesOfAssets(ctx) {
  const A = (ctx && ctx.assets) || {};
  const pages = A.pages || (ctx && ctx.content && ctx.content.pages) || null;
  return Array.isArray(pages) && pages.length ? pages : null;
}

// 页面表现法：G.scene 现在存的是**页面 id**（"title"/"flash"/"about"/...），
// 不再是 render 层的 switch 分支名。页面长什么样由 assets/pages.json 决定，
// 见 content/page.js。旧代码里的 "menu" 是 "title" 的别名（见 PAGE_ALIAS）。
//
// 为什么保留 G.scene 这个字段而不改名：它被 input/render/systems 共 40+ 处引用，
// 改名只会制造大面积无意义 diff；语义已经通过 alias 表收敛到页面 id。
const PAGE_ALIAS = { menu: "title" };

// 版本指定的启动页；未指定时从片头开始（与改造前一致）。
export function initialPageId(ctx) {
  const A = ctx.assets;
  const pages = pagesOfAssets(ctx);
  const want = (A && A.initialPage) || (A && A.content && A.content.initialPage) || "";
  if (want && pageById(pages, want)) return want;
  // 未指定或指定的页面不存在：依次回退 flash → title → 第一个页面 → 默认 id。
  for (const id of ["flash", DEFAULT_PAGE_ID]) if (pageById(pages, id)) return id;
  return (pages && pages[0] && pages[0].id) || DEFAULT_PAGE_ID;
}

/** 页面 id（把旧别名 "menu" 归一到 "title"）。 */
export function pageIdOf(scene) {
  if (!scene) return "";
  return PAGE_ALIAS[scene] || scene;
}

// 片头闪屏「已看过」标记。切换数据版本会整页 reload，没有这个标记的话
// 每次改版本都要重看一遍片头——玩家只想回到标题菜单。
const SEEN_FLASH_KEY = "gsxy_seen_flash";

// 启动：进入版本指定的初始页面。若初始页是片头且已看过，直接跳到标题页。
// opts.force=true 可强制重播（例如「重新观看片头」）。
export function enterBoot(ctx, opts) {
  const G = ctx.state;
  let seen = false;
  try { seen = localStorage.getItem(SEEN_FLASH_KEY) === "1"; } catch (e) { }
  playBGM(G, titleMusic(ctx));
  const first = initialPageId(ctx);
  // 只有"初始页就是片头"时才谈得上跳过；版本若指定别的页，直接进。
  const isFlash = first === "flash";
  if (isFlash && seen && !(opts && opts.force)) { enterMenu(ctx); return; }
  G.scene = first; G.flashStep = 0; G.flashT = 0; G.deathT = 0; G.pendingEnd = false;
  closeAll(G);
  if (isFlash) { try { localStorage.setItem(SEEN_FLASH_KEY, "1"); } catch (e) { } }
}

// 片头结束 / 跳过 / 任意页返回：进入标题页。
// opts.music=true 时强制切回标题音乐（主角死亡后回到菜单时用）。
export function enterMenu(ctx, opts) {
  const G = ctx.state;
  G.scene = "title"; G.flashT = 0; G.deathT = 0; closeAll(G);
  if ((opts && opts.music) || !G.bgm || !G.bgmSrc) playBGM(G, titleMusic(ctx));
}

// 开始新游戏前：按当前配置重置主角与进度（这样编辑器改的初始数值会生效）。
//
// 开启 config.balance.mode = "curve" 时，起始数值与 expNext 都改由
// engine/balance.js 的曲线给出——否则会出现“初始 expNext 是旧值 500，
// 而升一级后 expNext 突变成曲线值”的断点（玩家看到一条莫名的经验跳跃）。
export function resetNewGame(ctx) {
  const G = ctx.state, p = ctx.config.player;
  const curveMode = !!(ctx.config.balance && ctx.config.balance.mode === "curve");
  // hpMax/mpMax/attack/defence 在 curve 模式下也按曲线取（lv1 基准）。
  const snap = curveMode ? levelSnapshot(Number(p.level) || 1, ctx.config.balance.curve) : null;
  const hpMax = snap ? snap.hpMax : p.hpMax;
  const mpMax = snap ? snap.mpMax : p.mpMax;
  const attack = snap ? snap.attack : p.attack;
  const defence = snap ? snap.defence : p.defence;
  const expNext = snap ? snap.expNext : p.expNext;
  G.stats = { hp: hpMax, hpMax, mp: mpMax, mpMax, exp: 0, expNext,
    level: p.level, money: p.money, moral: p.moral, honor: p.honor, attack, defence, attackSpeed: p.attackSpeed };
  G.skills = (p.startSkills || []).slice(); G.skill = p.startSkill || G.skills[0];
  G.hotbar = new Array(9).fill(null); G.pack = []; G.packOpen = false;
  G.equip = { Wu: null, Jia: null, Shi1: null, Shi2: null }; G.cursor = null; G.shop = null;
  G.missions = {}; G.vars = {}; G.notes = []; G.factions = []; G.love = {}; G.vips = {}; G.inventory = {};
  G.ground = []; G.effects = []; G.fx = []; G.uiFx = null; G.moveMarker = null; G.gameOver = false; G.currentMap = null; G.map = null;
  // 场景级瞬时状态全清：不只在切图时清，重新开局时也必然清一遍。
  // npcs 置空后由 startScript 的 LoadInitialMap 重新 spawn（归位 + 满血）。
  G.npcs = []; G.projectiles = []; G.lockTarget = null; closeAll(G);
  G.player = null;   // 丢弃旧主角对象，避免上一次阵亡的 dead/动画状态被带进新游戏
  G.script = null; G.triggerCD = 0; G.lastCell = null;
  G.deathT = 0;
  // 传送点解锁进度（P4）：属于"永久进度"，随存档走；新游戏从空开始。
  // 起始地图的传送点会在玩家踩上去时自动解锁（见 systems/waypoint.js）。
  G.waypoints = {};
  // 难度默认普通档。存档会覆盖它（读档时写回 G.difficulty）。
  G.difficulty = "normal";
  G.mercenary = null;         // 随从不跨周目继承（新开局重新招募）
}

// 开始新游戏：真正启动 main.gsp（其第一条就是 LoadInitialMap）。
export function startGame(ctx) {
  const G = ctx.state;
  G.scene = "game"; G.pendingEnd = false; G.script = null; closeAll(G);
  resetNewGame(ctx);
  startScript(ctx, "main.gsp");
}

// 结局：end.png + 结局音乐 + 结局评价称号。
export function showEnding(ctx) {
  const G = ctx.state;
  G.scene = "ending"; G.script = null; closeAll(G);
  G.resultTitle = resultTitle(ctx);
  playBGM(G, endMusic(ctx));
}

export function resultTitle(ctx) {
  const G = ctx.state, A = ctx.assets;
  const list = (A.game && A.game.result) || [];
  const score = G.stats.honor || 0;
  for (const r of list) if (score >= r.lower && score < r.upper) return r.name;
  return list.length ? list[list.length - 1].name : "";
}
