// 页面域（PageDoc）：把"全屏页面"变成数据，而不是 render/scene-ui.js 里的 switch 分支。
//
// 为什么需要这一层：
//   在此之前，标题菜单、片头闪屏、关于、结局、告别这 5 个页面全部写死在
//   render/scene-ui.js 的 `switch (G.scene)` 里，按钮坐标又各自硬编码在
//   core/layout.js 的 MENU_BUTTONS。结果是：
//     · 每个版本的菜单长得一模一样，换不了（原版复刻 OK，新版本不行）
//     · 加一个"通关评分页"要同时改 switch、layout、input 三处
//     · 编辑器完全看不见这些页面
//
// 设计：一个页面 = 一份 JSON 文档。
//
//   {
//     "id": "title",
//     "kind": "menu",                        ← 页面类型（决定交互语义）
//     "background": "assets/ui/mainmenu.png",
//     "music": "music/start.mp3",
//     "items": [ ...ui.js 同款元件... ]       ← 复用 UI 元件的坐标/绘制体系
//   }
//
// 页面类型（PAGE_KINDS）：
//   "menu"   选单页：items 里的 button 有 action，点击触发
//   "flash"  闪屏页：按 flash 数组依次淡入淡出，可点击跳过
//   "board"  图文页：一张背景 + 可选文本（关于 / 告别这类"点一下返回"的页）
//   "score"  结算页：背景 + 数据槽位（通关评分）
//
// 与 ui.js 的关系：
//   页面里的 items 用**同一套元件模型**（kind/anchor/x/y/w/h/img/文本），
//   因此 normalizeUiComponent / resolvePos / hitComponent 全部直接复用，
//   编辑器的 UI 标签页将来可以顺带编辑页面。这不是巧合——菜单按钮本来就是
//   "会画出来的可点区域"，和 HUD 按钮没有本质区别。
import { normalizeUiComponent, resolvePos, hitComponent, hitTop, slotRect } from "./ui.js";

/** 页面类型。render/page-ui.js 按 kind 决定怎么画、input 怎么响应。 */
export const PAGE_KINDS = ["menu", "flash", "board", "score"];

/** 按钮动作类型。
 *  - "start"     开始新游戏
 *  - "load"      打开读档面板
 *  - "scene"     切到另一个页面（to: 页面 id）
 *  - "surface"   打开一个 UI 表面（to: surfaces.js 的 surface id）
 *  - "exit"      告别页（关闭游戏 / 回到引擎入口）
 *  - "editor"    打开编辑器（仅本地可用，引擎入口已提供，页面里可选）
 *  - "version"   打开版本管理（同上）
 *  - "none"      无动作（纯展示）
 */
export const PAGE_ACTIONS = ["start", "load", "scene", "surface", "exit", "editor", "version", "none"];

/** 元件动作的默认值。 */
const DEF_ACTION = { type: "none", to: "" };

function normAction(a) {
  if (a == null) return { ...DEF_ACTION };
  if (typeof a === "string") return PAGE_ACTIONS.includes(a) ? { type: a, to: "" } : { ...DEF_ACTION };
  const type = PAGE_ACTIONS.includes(a.type) ? a.type : "none";
  return { type, to: String(a.to || "") };
}

/** 文本行（board / score 页正文）。 */
function normLine(l) {
  if (typeof l === "string") return { text: l, x: 0, y: 0, size: 13, color: "#f0e0b0", align: "left" };
  const o = l || {};
  const align = ["left", "center", "right"].includes(o.align) ? o.align : "left";
  return {
    text: String(o.text == null ? "" : o.text),
    x: Number(o.x) || 0,
    y: Number(o.y) || 0,
    size: Number(o.size) > 0 ? Number(o.size) : 13,
    color: typeof o.color === "string" ? o.color : "#f0e0b0",
    align,
  };
}

/** 闪屏条目：兼容 "a.png" 与 { file, duration }。 */
function normFlash(x, defDur) {
  const d = defDur == null ? 2 : defDur;
  if (x == null) return null;
  if (typeof x === "string") return { file: x, duration: d };
  const o = x || {};
  const file = String(o.file || o.name || "");
  if (!file) return null;
  return { file, duration: Number(o.duration) > 0 ? Number(o.duration) : d };
}

/**
 * 规整一份页面文档。幂等（规整过的再规整结果不变）。
 * @param {any} p
 * @returns {any}
 */
export function normalizePage(p) {
  const o = p || {};
  const kind = PAGE_KINDS.includes(o.kind) ? o.kind : "board";
  const items = Array.isArray(o.items)
    ? o.items.map(it => {
        const c = normalizeUiComponent(it || {});
        c.action = normAction((it || {}).action);
        return c;
      })
    : [];
  // 闪屏页的图片序列：items 之外单独一份，因为它的播放是"按时间推进"而非"静态排布"。
  const flash = Array.isArray(o.flash) ? o.flash.map(x => normFlash(x, o.flashDuration)).filter(Boolean) : [];
  const lines = Array.isArray(o.lines) ? o.lines.map(normLine) : [];
  return {
    id: String(o.id || ""),
    kind,
    // 背景图：assets/ui/*.png，允许省略扩展名（见 page-ui.js 的 ui()）
    background: String(o.background || ""),
    // 背景音乐：assets/ 下的相对路径
    music: String(o.music || ""),
    // 进入该页时是否清空所有 UI 表面（菜单页要，结算页要；闪屏页无所谓）
    closeSurfaces: o.closeSurfaces !== false,
    // 点任意处是否跳过/返回（board / flash 常用）
    clickAnywhere: !!o.clickAnywhere,
    flash,
    lines,
    items,
    // 数据槽位（score 页）：把运行时数据绑定到文本
    slots: Array.isArray(o.slots) ? o.slots.map(s => ({
      bind: String((s && s.bind) || ""),
      label: String((s && s.label) || ""),
      x: Number(s && s.x) || 0,
      y: Number(s && s.y) || 0,
      size: Number(s && s.size) > 0 ? Number(s && s.size) : 14,
      color: typeof (s && s.color) === "string" ? s.color : "#f2ead0",
    })) : [],
  };
}

/**
 * 规整页面表（Record<id, PageDoc> + 顺序）。
 * @param {any} pages
 */
export function normalizePages(pages) {
  const src = Array.isArray(pages) ? pages : (pages && typeof pages === "object" ? Object.values(pages) : []);
  const out = [];
  const seen = new Set();
  for (const p of src) {
    const d = normalizePage(p);
    if (!d.id || seen.has(d.id)) continue;
    seen.add(d.id);
    out.push(d);
  }
  return out;
}

/** 按 id 取页面。 */
export function pageById(pages, id) {
  if (!Array.isArray(pages)) return null;
  return pages.find(p => p.id === id) || null;
}

/** 页面里可点击的元件（从上层往下，与 hitTop 同序）。 */
export function pageHit(page, x, y, VW, VH) {
  if (!page || !page.items.length) return null;
  return hitTop({ components: page.items }, x, y, VW, VH);
}

// 重新导出，页面层与 UI 层共用同一套几何，避免调用方两处 import。
export { resolvePos, hitComponent, slotRect };

/** 默认页面 id（版本未指定 initialPage 时的兜底）。 */
export const DEFAULT_PAGE_ID = "title";
