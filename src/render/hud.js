// HUD：底部状态面板、快捷栏、装备栏、光标持物。
//
// 布局来自内容里的 ui 配置（content/ui.js），不再是这里的硬编码坐标。
// 元件按 z 升序绘制；每个 kind 由一个 draw* 函数负责。
// 默认配置（versions/default/assets/ui.json）与改造前的硬编码逐像素一致，
// 由 test/ui.test.mjs 守着——所以这次改造不改变任何视觉结果。
import { G } from "../core/state.js";
import { VW, VH, ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { itemByName, skillByName } from "../core/registry.js";
import { resolvePos, slotRect } from "../content/ui.js";
import { getRuntime } from "../runtime/context.js";
import { installUiLayout } from "../core/layout.js";


// P5：视图层的状态入口。
// 允许调用方显式传入运行时（rt）或游戏状态（g），不传则回退到当前全局实例。
// 这样离屏渲染/单测可以喂一份独立状态，而不必改全局单例。
function stateOf(x) {
  if (!x) return G;
  if (x.state) return x.state;      // runtime ctx
  return x;                          // 直接是游戏状态
}

// 取当前 UI 配置。内容缺失时返回 null（不画任何元件），
// 这比“退回一份硬编码”更容易发现装配问题。
function uiOf(rt) {
  rt = rt || getRuntime();
  const c = rt && rt.content;
  return (c && c.ui) || null;
}

// 按 z 升序返回可见元件（同 z 保持加入顺序，与 hitTop 的判定一致）。
function sortedComps(ui) {
  if (!ui || !Array.isArray(ui.components)) return [];
  return ui.components
    .map((c, i) => ({ c, i }))
    .filter(x => x.c.visible)
    .sort((a, b) => (a.c.z - b.c.z) || (a.i - b.i))
    .map(x => x.c);
}

const EQUIP_KEYS = ["Shi1", "Wu", "Jia", "Shi2"];

// 绑定键 -> 当前值。未识别的绑定返回 null（元件不画）。
function bindValue(bind, st) {
  switch (bind) {
    case "stats.hp": return { cur: st.hp, max: st.hpMax };
    case "stats.mp": return { cur: st.mp, max: st.mpMax || 1 };
    case "stats.exp": return { cur: st.exp, max: st.expNext || 1 };
    case "stats.level": return st.level;
    case "stats.money": return st.money;
    default: return null;
  }
}

export function drawHUD(rt) {
  const G = stateOf(rt);
  const ui = uiOf(rt);
  // 把同一份配置交给命中测试（core/layout.js 的 slotAt/insideShop），
  // 保证“画在哪”和“点在哪”永远同源——否则改了布局就会出现点不中的格子。
  installUiLayout(ui);
  const comps = sortedComps(ui);
  for (const c of comps) {
    const p = resolvePos(c, VW, VH);
    if (c.kind === "panel") drawPanel(c, p);
    else if (c.kind === "bar") drawBar(c, p);
    else if (c.kind === "label") drawLabel(c, p);
    else if (c.kind === "button") drawButton(c, p);
    else if (c.kind === "image") drawImage(c, p);
    else if (c.kind === "slotgrid") drawSlotGrid(c);
  }
}

function drawPanel(c, p) {
  const im = c.img ? getImg(c.img) : null;
  if (im) { ctx.drawImage(im, p.x, p.y, c.w || im.width, c.h || im.height); return; }
  // 无贴图时画一个可辨认的底（不再静默“什么都不画”，便于排查缺图）
  ctx.fillStyle = "rgba(18,14,10,0.9)";
  ctx.fillRect(p.x, p.y, c.w, c.h);
}

function drawBar(c, p) {
  const st = G.stats;
  const v = bindValue(c.bind, st);
  if (!v) return;
  ctx.fillStyle = c.bg || "#111";
  ctx.fillRect(p.x, p.y, c.w, c.h);
  const ratio = Math.max(0, Math.min(1, v.cur / (v.max || 1)));
  ctx.fillStyle = c.color || "#c0392b";
  ctx.fillRect(p.x, p.y, Math.round(c.w * ratio), c.h);
  // 数值写在栏内部（居中、带描边，保证叠在彩色条上仍可读）
  if (c.text === "value") {
    const t = Math.round(v.cur) + " / " + Math.round(v.max);
    ctx.font = "9px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(t, p.x + c.w / 2, p.y + c.h / 2 + 0.5);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(t, p.x + c.w / 2, p.y + c.h / 2 + 0.5);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
}

function drawLabel(c, p) {
  const st = G.stats;
  const v = bindValue(c.bind, st);
  const txt = c.text ? c.text + (v == null ? "" : v) : (v == null ? "" : String(v));
  if (!txt) return;
  ctx.fillStyle = c.color || "#ffd75e";
  ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(txt, p.x + c.w / 2, p.y + c.h);
  ctx.textAlign = "left";
}

function drawButton(c, p) {
  const im = c.img ? getImg(c.img) : null;
  if (im) ctx.drawImage(im, p.x, p.y, c.w, c.h);
  // 技能图标：绑定了 skill.icon 时叠在按钮上，并在右侧写技能名
  if (c.bind === "skill.icon") {
    const sk = skillByName(G, G.skill);
    if (sk && sk.icon) {
      const ic = getImg("assets/skill_icons/" + sk.icon.replace(/\.bmp$/, ".png"));
      if (ic) ctx.drawImage(ic, p.x, p.y, c.w, c.h);
    }
    ctx.fillStyle = "#e8e0c8"; ctx.font = "11px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(sk ? sk.name : G.skill, p.x + c.w + 4, p.y + c.h / 2 + 4);
  }
}

function drawImage(c, p) {
  const im = c.img ? getImg(c.img) : null;
  if (im) ctx.drawImage(im, p.x, p.y, c.w || im.width, c.h || im.height);
}

function drawSlotGrid(c) {
  if (c.bind === "inventory.hotbar") {
    for (let i = 0; i < c.cols * c.rows; i++) {
      const r = slotRect(c, i, VW, VH);
      drawItemSlot(G.hotbar && G.hotbar[i], r.x, r.y, r.w, r.h);
    }
    return;
  }
  if (c.bind === "equipment") {
    for (let i = 0; i < EQUIP_KEYS.length; i++) {
      const r = slotRect(c, i, VW, VH);
      drawItemSlot(G.equip && G.equip[EQUIP_KEYS[i]], r.x, r.y, r.w, r.h);
    }
    return;
  }
  if (c.bind === "inventory.pack") {
    if (!G.packOpen) return;              // 背包未打开时不画内容
    for (let i = 0; i < (G.pack ? G.pack.length : 0); i++) {
      const r = slotRect(c, i, VW, VH);
      if (i >= c.cols * c.rows) break;
      drawItemSlot(G.pack[i], r.x, r.y, r.w, r.h);
    }
    return;
  }
  // 功能按钮：hud.fn 这类无绑定的格子，按序号取 assets/ui/<img>.png
  if (!c.bind) {
    const names = ["属性", "记事", "荣辱", "任务", "菜单"];
    for (let i = 0; i < Math.min(c.cols * c.rows, names.length); i++) {
      const r = slotRect(c, i, VW, VH);
      const im = getImg("assets/ui/" + names[i] + ".png");
      if (im) ctx.drawImage(im, r.x, r.y, r.w, r.h);
    }
  }
}

// 商店格由 shop-ui.js 画（它需要处理售罄/悬停等状态），这里不重复。
export function drawItemSlot(entry, x, y, w, h) {
  if (!entry) return;
  const it = itemByName(G, entry.name);
  const im = it && it.icon ? getImg("assets/items_icons/" + it.icon.replace(/\.bmp$/, ".png")) : null;
  if (im) ctx.drawImage(im, x + 3, y + 3, w - 6, h - 6);
  if (entry.count > 1) { ctx.fillStyle = "#ffe9a8"; ctx.font = "10px sans-serif"; ctx.fillText(String(entry.count), x + w - 14, y + h - 4); }
}

export function drawCursorItem(rt) {
  const G = stateOf(rt);
  if (!G.cursor) return;
  const it = itemByName(G, G.cursor.name);
  const im = it && it.icon ? getImg("assets/items_icons/" + it.icon.replace(/\.bmp$/, ".png")) : null;
  if (im) ctx.drawImage(im, G.mouse.sx - 16, G.mouse.sy - 16, 32, 32);
}
