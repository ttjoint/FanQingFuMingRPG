// 标题菜单 / 片头闪屏 / 关于 / 结局 的绘制。
import { G } from "../core/state.js";
import { stateOf } from "./frame.js";
import { VW, VH, ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { getRuntime } from "../runtime/context.js";
import { flashPics, endPic } from "../systems/scene.js";
import { MENU_BUTTONS, menuHit } from "../core/layout.js";
import { isEditorAvailable, activeId, versionName } from "../content/store.js";


// P5：视图层的状态入口。
// 允许调用方显式传入运行时（rt）或游戏状态（g），不传则回退到当前全局实例。

// 把资源名规范成 assets/ui/*.png：允许 "mainmenu"、"end.bmp"、"end.png" 三种写法。
function ui(name) {
  if (!name) return null;
  if (/\.bmp$/i.test(name)) name = name.replace(/\.bmp$/i, ".png");
  else if (!/\.[a-z0-9]+$/i.test(name)) name += ".png";
  return getImg("assets/ui/" + name);
}

// 提前请求场景图片，避免刚进标题菜单时因图片未加载而黑屏。
export function preloadSceneArt() {
  ui("mainmenu"); ui("content"); ui(endPic(getRuntime()));
  for (const p of flashPics(getRuntime())) ui(p);
  for (const b of MENU_BUTTONS) if (b.img) ui(b.img);
}

export function drawScene(rt) {
  const G = stateOf(rt);
  switch (G.scene) {
    case "flash": return drawFlash(rt);
    case "menu": return drawMenu(rt);
    case "about": return drawAbout();
    case "ending": return drawEnding(rt);
    case "farewell": return drawFarewell();
    default: ctx.fillStyle = "#000"; ctx.fillRect(0, 0, VW, VH);
  }
}

// 下面几个内部函数靠外层 drawScene 遮蔽的 G 读取状态（词法作用域，注入已生效），
// 但它们各自还会 getRuntime() 去取资源（图片名等）。补上 rt 透传，
// 让"状态"与"资源"两份数据跟随同一个来源；不传时仍回退全局，保持旧行为。
function drawFlash(rt) {
  const G = stateOf(rt);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, VW, VH);
  const pics = flashPics(rt || getRuntime());
  const name = pics[Math.min(G.flashStep, pics.length - 1)];
  const im = ui(name);
  if (im) {
    // 简单的淡入淡出（每次闪屏 2s）
    const a = Math.min(1, G.flashT / 0.5) * Math.min(1, Math.max(0, (2 - G.flashT) / 0.5));
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.drawImage(im, (VW - im.width) / 2, (VH - im.height) / 2);
    ctx.restore();
  }
  ctx.fillStyle = "rgba(150,150,150,0.7)"; ctx.font = "12px sans-serif";
  ctx.fillText("点击跳过…", 8, VH - 10);
}

function drawMenu(rt) {
  const G = stateOf(rt);
  const bg = ui("mainmenu");
  if (bg) ctx.drawImage(bg, 0, 0, VW, VH);
  else { ctx.fillStyle = "#101418"; ctx.fillRect(0, 0, VW, VH); }
  for (const b of MENU_BUTTONS) {
    if (b.local && !isEditorAvailable()) continue;
    const w = b.w || 80, h = b.h || 18;
    if (b.img) { const im = ui(b.img); if (im) ctx.drawImage(im, b.x, b.y); }
    else {
      let text = b.k === "version" ? ("数据版本：" + versionName(activeId())) : (b.text || "");
      ctx.font = "13px 'Microsoft YaHei',SimHei,sans-serif";
      while (text.length > 2 && ctx.measureText(text).width > w - 16) text = text.slice(0, -1);
      ctx.fillStyle = "rgba(20,16,12,0.78)"; ctx.fillRect(b.x, b.y, w, h);
      ctx.strokeStyle = "#b8a468"; ctx.lineWidth = 1; ctx.strokeRect(b.x + .5, b.y + .5, w - 1, h - 1);
      ctx.fillStyle = "#ffe9a8";
      ctx.fillText(text, b.x + (w - ctx.measureText(text).width) / 2, b.y + h - 6);
    }
    if (menuHit(G.mouse.sx, G.mouse.sy) === b.k) {
      ctx.strokeStyle = "#ffe07a"; ctx.lineWidth = 1;
      ctx.strokeRect(b.x - 0.5, b.y - 0.5, w + 1, h + 1);
    }
  }
  ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "11px sans-serif";
  ctx.fillText("网页移植版 · 左键选择", 8, VH - 8);
}

function drawAbout() {
  const bg = ui("content");
  if (bg) ctx.drawImage(bg, 0, 0, VW, VH);
  else { ctx.fillStyle = "#0c0c0c"; ctx.fillRect(0, 0, VW, VH); }
  ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.font = "12px sans-serif";
  ctx.fillText("点击返回标题", 8, VH - 10);
}

function drawEnding(rt) {
  const G = stateOf(rt);
  const bg = ui(endPic(rt || getRuntime()));
  if (bg) ctx.drawImage(bg, 0, 0, VW, VH);
  else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, VW, VH); }
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(80, 150, VW - 160, 200);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd75e"; ctx.font = "bold 30px \"Microsoft YaHei\",sans-serif";
  ctx.fillText("游戏结束", VW / 2, 210);
  ctx.fillStyle = "#f2ead0"; ctx.font = "18px \"Microsoft YaHei\",sans-serif";
  ctx.fillText("你的江湖称号：" + (G.resultTitle || "—"), VW / 2, 260);
  ctx.fillStyle = "#9fe08f"; ctx.font = "14px sans-serif";
  ctx.fillText("声望 " + (G.stats.honor || 0) + "　等级 " + G.stats.level + "　银两 " + G.stats.money, VW / 2, 295);
  ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.font = "12px sans-serif";
  ctx.fillText("点击返回标题", VW / 2, 330);
  ctx.textAlign = "left";
}

function drawFarewell() {
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, VW, VH);
  ctx.textAlign = "center";
  ctx.fillStyle = "#f2ead0"; ctx.font = "24px \"Microsoft YaHei\",sans-serif";
  ctx.fillText("感谢游玩《国殇之血色狼烟》", VW / 2, VH / 2 - 10);
  ctx.fillStyle = "#9a9a9a"; ctx.font = "13px sans-serif";
  ctx.fillText("可直接关闭页面，或点击返回标题", VW / 2, VH / 2 + 26);
  ctx.textAlign = "left";
}
