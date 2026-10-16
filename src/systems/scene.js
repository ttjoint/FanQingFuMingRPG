// 非游玩场景的流程控制：片头闪屏 → 标题菜单 → 结局 / 关于。ctx 由调用方注入。
// 原版 game.ini 的 [music]/[FlashWindow*]/[background]/[result] 配置由 build_assets.py 导出为 assets/game.json。
import { playBGM } from "./audio.js";
import { startScript } from "../script/vm.js";

export function titleMusic(ctx) { const A = ctx.assets; return (A.game && A.game.music && A.game.music.start) || ""; }
export function endMusic(ctx) { const A = ctx.assets; return (A.game && A.game.music && A.game.music.end) || titleMusic(ctx); }
export function flashPics(ctx) { const A = ctx.assets; return (A.game && A.game.flash && A.game.flash.length) ? A.game.flash : []; }
export function endPic(ctx) { const A = ctx.assets; return (A.game && A.game.endpic) || ""; }

// 启动时先播片头闪屏与标题音乐。
export function enterBoot(ctx) {
  const G = ctx.state;
  G.scene = "flash"; G.flashStep = 0; G.flashT = 0; G.pendingEnd = false;
  playBGM(G, titleMusic(ctx));
}

// 片头结束 / 跳过：进入标题菜单。
// opts.music=true 时强制切回标题音乐（主角死亡后回到菜单时用）。
export function enterMenu(ctx, opts) {
  const G = ctx.state;
  G.scene = "menu"; G.flashT = 0; G.savePanel = false; G.deathT = 0;
  if ((opts && opts.music) || !G.bgm || !G.bgmSrc) playBGM(G, titleMusic(ctx));
}

// 开始新游戏前：按当前配置重置主角与进度（这样编辑器改的初始数值会生效）。
export function resetNewGame(ctx) {
  const G = ctx.state, p = ctx.config.player;
  G.stats = { hp: p.hpMax, hpMax: p.hpMax, mp: p.mpMax, mpMax: p.mpMax, exp: 0, expNext: p.expNext,
    level: p.level, money: p.money, moral: p.moral, honor: p.honor, attack: p.attack, defence: p.defence, hit: p.hit };
  G.skills = (p.startSkills || []).slice(); G.skill = p.startSkill || G.skills[0];
  G.hotbar = new Array(9).fill(null); G.pack = []; G.packOpen = false;
  G.equip = { Wu: null, Jia: null, Shi1: null, Shi2: null }; G.cursor = null; G.shop = null;
  G.missions = {}; G.vars = {}; G.notes = []; G.factions = []; G.love = {}; G.vips = {}; G.inventory = {};
  G.ground = []; G.effects = []; G.fx = []; G.uiFx = null; G.moveMarker = null; G.gameOver = false; G.currentMap = null; G.map = null;
  G.player = null;   // 丢弃旧主角对象，避免上一次阵亡的 dead/动画状态被带进新游戏
  G.tip = null; G.panel = null; G.dialog = null; G.script = null; G.triggerCD = 0; G.lastCell = null;
  G.deathT = 0;
}

// 开始新游戏：真正启动 main.gsp（其第一条就是 LoadInitialMap）。
export function startGame(ctx) {
  const G = ctx.state;
  G.scene = "game"; G.savePanel = false; G.pendingEnd = false; G.dialog = null; G.script = null;
  resetNewGame(ctx);
  startScript(ctx, "main.gsp");
}

// 结局：end.png + 结局音乐 + 结局评价称号。
export function showEnding(ctx) {
  const G = ctx.state;
  G.scene = "ending"; G.savePanel = false; G.dialog = null; G.script = null;
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
