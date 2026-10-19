// 全屏页面绘制：标题 / 片头 / 关于 / 结算 / 告别。
//
// 页面是**数据**（assets/pages.json → content/page.js 的 PageDoc），不再是
// 本文件里的 switch 分支。新增一个页面 = 加一份 JSON，无需改代码。
//
// 绘制分三层，顺序固定：
//   1) 背景（page.background 或纯黑）
//   2) 页面内容（lines / slots / flash 序列）
//   3) items 元件（与 ui.js 同一套模型，走 resolvePos/hitComponent）
// 最后画鼠标悬停高亮。
import { stateOf } from "./frame.js";
import { VW, VH, ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { getRuntime } from "../runtime/context.js";
import { flashPics, flashDurations, pageIdOf } from "../systems/scene.js";
import { pageById } from "../content/page.js";
import { resolvePos } from "../content/ui.js";

// 把资源名规范成 assets/ui/*.png：允许 "mainmenu"、"end.bmp"、"end.png"、
// 以及完整路径 "assets/ui/xxx.png" 四种写法。
function ui(name) {
  if (!name) return null;
  if (/^assets\//.test(name)) return getImg(name.replace(/\.bmp$/i, ".png"));
  if (/\.bmp$/i.test(name)) name = name.replace(/\.bmp$/i, ".png");
  else if (!/\.[a-z0-9]+$/i.test(name)) name += ".png";
  return getImg("assets/ui/" + name);
}

/** 取当前版本可用的页面列表（注入 rt 时用它的资源，否则回退全局）。 */
function pagesOf(rt) {
  const r = rt || getRuntime();
  const A = (r && r.assets) || {};
  // A.pages 由 contentToLegacy 带出；再容错一层 content.pages，
  // 这样只注入 content 的测试/工具也能查到页面。
  const pages = A.pages || (r && r.content && r.content.pages) || null;
  return Array.isArray(pages) && pages.length ? pages : null;
}

/** 按 id 取页面；取不到返回 null（调用方回退到硬编码兜底绘制）。 */
export function pageFor(rt, id) {
  return pageById(pagesOf(rt), id);
}

// 提前请求场景图片，避免刚进标题菜单时因图片未加载而黑屏。
export function preloadSceneArt(rt) {
  const r = rt || getRuntime();
  const pages = pagesOf(r) || [];
  for (const p of pages) {
    ui(p.background);
    for (const it of p.items) if (it.img) ui(it.img);
  }
  // 兼容路径：页面文档缺失时仍按老逻辑预载。
  if (!pages.length) {
    ui("mainmenu"); ui("content");
    for (const p of flashPics(r)) ui(p);
  }
  for (const p of flashPics(r)) ui(p);
}

export function drawScene(rt) {
  const G = stateOf(rt);
  const id = pageIdOf(G.scene);
  const page = pageFor(rt, id);
  if (!page) { drawFallback(rt, id); return; }
  drawPage(rt, page, G, id);
}

// ---- 页面渲染 ----

function drawPage(rt, page, G, id) {
  // 1) 背景
  const bg = ui(page.background);
  if (bg) ctx.drawImage(bg, 0, 0, VW, VH);
  else { ctx.fillStyle = id === "title" ? "#101418" : "#000"; ctx.fillRect(0, 0, VW, VH); }

  // 2) 页面类型各自的正文
  if (page.kind === "flash") drawFlashBody(rt, page, G);
  else if (page.kind === "score") drawScoreBody(rt, page, G);
  else if (page.kind === "board") drawLines(rt, page, G);

  // 3) items 元件
  const hover = page.items.length ? hoverItem(page, G) : null;
  for (const c of page.items) {
    const p = resolvePos(c, VW, VH);
    const im = c.img ? getImg(c.img) : null;
    if (im) ctx.drawImage(im, p.x, p.y);
    else drawFallbackButton(c, p);
    if (hover === c) drawHoverRing(p.x, p.y, c.w, c.h);
  }
}

/** 悬停高亮：与改造前 drawMenu 的描边行为一致（外扩 0.5px 的一圈亮框）。 */
function drawHoverRing(x, y, w, h) {
  ctx.strokeStyle = "#ffe07a"; ctx.lineWidth = 1;
  ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
}

/** 元件没有图片时的兜底按钮（纯色块 + 居中文字）。 */
function drawFallbackButton(c, p) {
  const text = c.text || c.label || "";
  ctx.font = (c.size ? c.size + "px" : "13px") + " 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillStyle = c.bg || "rgba(20,16,12,0.78)";
  ctx.fillRect(p.x, p.y, c.w, c.h);
  ctx.strokeStyle = c.color || "#b8a468"; ctx.lineWidth = 1;
  ctx.strokeRect(p.x + .5, p.y + .5, c.w - 1, c.h - 1);
  ctx.fillStyle = c.color || "#ffe9a8";
  ctx.fillText(text, p.x + (c.w - ctx.measureText(text).width) / 2, p.y + c.h - 6);
}

/** 当前鼠标悬停在哪个元件上（无则 null）。 */
function hoverItem(page, G) {
  const x = G.mouse.sx, y = G.mouse.sy;
  // 从上层（z 大 / 靠后）往下找，与 pageHit 同序。
  for (let i = page.items.length - 1; i >= 0; i--) {
    const c = page.items[i];
    const p = resolvePos(c, VW, VH);
    if (x >= p.x && x < p.x + c.w && y >= p.y && y < p.y + c.h) return c;
  }
  return null;
}

/**
 * 文本行绘制。align=center 时 x 视为屏幕中线。
 * baseY：行的 y 是相对 baseY 的偏移（score 页传压条顶边 150，让坐标以
 * "面板内"为基准，与改造前的硬编码直觉一致）；board 页传 0（绝对坐标）。
 */
function drawLinesAt(rt, page, G, baseY) {
  for (const l of page.lines) {
    // 空文本行是"占位"（渲染时按页面类型给默认文案，例如 farewell）。
    let text = l.text;
    if (!text) text = defaultLineText(page.id, G);
    if (!text) continue;
    ctx.font = l.size + "px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.fillStyle = l.color;
    const x = l.align === "center" ? VW / 2 : (l.align === "right" ? VW - l.x : l.x);
    ctx.textAlign = l.align === "center" ? "center" : (l.align === "right" ? "right" : "left");
    ctx.fillText(text, x, baseY + l.y);
  }
  ctx.textAlign = "left";
}

function drawLines(rt, page, G) { drawLinesAt(rt, page, G, 0); }

/** 内置页面在文本为空时的默认文案（保持改造前的样子）。 */
function defaultLineText(pageId, G) {
  if (pageId === "farewell") return "";
  return "";
}

/** 闪屏页：按 flash 序列逐张淡入淡出。 */
function drawFlashBody(rt, page, G) {
  const pics = flashPics(rt || getRuntime());
  const durs = flashDurations(rt || getRuntime());
  if (!pics.length) return;
  const step = Math.min(G.flashStep || 0, pics.length - 1);
  const im = ui(pics[step]);
  const dur = durs[step] || 2;
  if (im) {
    // 淡入 0.5s、淡出 0.5s；时长由页面文档给出。
    const a = Math.min(1, G.flashT / 0.5) * Math.min(1, Math.max(0, (dur - G.flashT) / 0.5));
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.drawImage(im, (VW - im.width) / 2, (VH - im.height) / 2);
    ctx.restore();
  }
  ctx.fillStyle = "rgba(150,150,150,0.7)"; ctx.font = "12px sans-serif";
  ctx.fillText("点击跳过…", 8, VH - 10);
}

/** 结算页：称号 + 统计。文字位置由 lines/slots 声明（相对压条顶边 150），数值来自运行时。 */
function drawScoreBody(rt, page, G) {
  // 半透明压条：改造前是 (80,150,480,200)。作为"内容背景"仍然内置，
  // 因为它是版式的视觉基础而非可配置元件；需要自定义时用 items 加 panel。
  const BASE = 150;
  ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(80, BASE, VW - 160, 200);
  drawLinesAt(rt, page, G, BASE);
  for (const s of page.slots) {
    const val = resolveSlot(rt, s.bind, G);
    const text = s.label + val;
    if (!text) continue;
    ctx.font = s.size + "px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.fillStyle = s.color;
    ctx.textAlign = "center";
    ctx.fillText(text, VW / 2, BASE + s.y);
  }
  ctx.textAlign = "left";
}

/** 把 slot 的 bind 解析成显示文本。未知 bind 返回空串（只诊断不猜）。 */
export function resolveSlot(rt, bind, g) {
  const G = g || stateOf(rt);
  switch (bind) {
    case "result.title": return G.resultTitle || "—";
    case "stats.summary": return "声望 " + (G.stats.honor || 0) + "　等级 " + G.stats.level + "　银两 " + G.stats.money;
    case "stats.honor": return String(G.stats.honor || 0);
    case "stats.level": return String(G.stats.level || 1);
    case "stats.money": return String(G.stats.money || 0);
    case "stats.name": return String((G.stats && G.stats.name) || G.player && G.player.name || "");
    default: return "";
  }
}

// ---- 兜底：页面文档缺失/未知页面 ----

// 已知页面 id 在页面表缺失时的最小可用绘制（不复制改造前的完整版式，
// 只保证"不黑屏、能继续操作"，因为正常数据路径一定带 pages）。
function drawFallback(rt, id) {
  const G = stateOf(rt);
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = "#9a9a9a"; ctx.font = "12px sans-serif";
  ctx.fillText("（页面数据缺失：" + (id || "?") + "）点击返回标题", 8, VH - 10);
  if (G.scene === "flash") {
    // 片头页缺失时也不能卡住：只显示提示，由 update 的计时推进回标题。
    ctx.fillStyle = "#666";
    ctx.fillText("点击跳过…", 8, VH - 26);
  }
}
