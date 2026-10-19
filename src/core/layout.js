// UI 布局常量与命中测试（纯几何 + 少量状态读取）。
// input 与 render 都依赖这里，保证“画在哪”和“点在哪”使用同一套坐标。
//
// 布局来源有两条路：
//   1) 可编辑 UI 配置（content/ui 的 ui 域）——通过 installUiLayout() 注入。
//      命中测试优先使用它，于是“在编辑器里挪动背包面板”后点击区域会跟着走。
//   2) 下面这些硬编码常量——仅作**兜底**（UI 未注入时，例如早期引导画面）。
// 两份不能同时生效，否则画和点会错位；注入后以配置为准。
import { G } from "./state.js";
import { VW, VH } from "./constants.js";

// ---- 可编辑 UI 布局注入 ----
// 存的是 content/ui.js 已规整过的 { components: [...] }。
let _ui = null;
/** 注入 UI 配置（每帧从 render 侧读取，无需重新装配）。 */
export function installUiLayout(ui) { _ui = ui || null; }

// 按 id 取元件（未注入则 null）。
function comp(id) {
  if (!_ui || !Array.isArray(_ui.components)) return null;
  return _ui.components.find(c => c.id === id && c.visible !== false) || null;
}

// 元件左上角的屏幕坐标（锚点规则与 content/ui.js 的 resolvePos 一致）。
// 这里重复实现一份（而不是 import）是因为 core/ 不能依赖 content/；
// 一致性由 test/ui.test.mjs 里的对照用例保证。
function compPos(c) {
  const a = c.anchor || "topLeft";
  let ox = 0, oy = 0;
  if (a === "topRight") { ox = VW - c.w; oy = 0; }
  else if (a === "bottomLeft") { ox = 0; oy = VH - c.h; }
  else if (a === "bottomRight") { ox = VW - c.w; oy = VH - c.h; }
  else if (a === "center") { ox = (VW - c.w) / 2; oy = (VH - c.h) / 2; }
  return { x: Math.round(ox + c.x), y: Math.round(oy + c.y) };
}

// 元件第 i 格（slotgrid）的屏幕矩形。
function compSlot(c, i) {
  const p = compPos(c);
  const col = i % c.cols, row = Math.floor(i / c.cols);
  return { x: p.x + c.padX + col * c.pitch, y: p.y + c.padY + row * c.pitch, w: c.slotW, h: c.slotH };
}

// ---- 标题菜单 ----
// 菜单按钮已搬进页面文档（content/pageDefault.js 的 defaultPages() →
// versions/<id>/assets/pages.json），坐标/图片/动作全部可配置。
// 原先这里的 MENU_BUTTONS 常量与 menuHit() 已删除：
//   · 绘制走 render/scene-ui.js 的 drawPage（复用 ui.js 的 resolvePos）
//   · 命中走 content/page.js 的 pageHit（复用 ui.js 的 hitTop）
//   · 两个入口按钮「数据版本」「编辑内容」已上移到引擎入口页（launcher/）
// 旧值仍由 content/pageDefault.js 保留（作为默认页面数据），
// 一致性由 test/page.test.mjs 守着。

// ---- 商店 / 背包面板（共用 packpanel.png，200×300，5 列格）----
// 商店置于屏幕左侧，背包在其右侧，二者并排（各 200 宽，中间 12px 间隔）。
export const PACK_BOX = { x: 220, y: 60, w: 200, h: 300 };
export const SHOP_BOX = { x: 8, y: 60, w: 200, h: 300 };
export const SHOP_COLS = 5, SHOP_ROWS = 5, PANEL_SLOT = 40;

export function shopSlotPos(i) { return { x: SHOP_BOX.x + 8 + (i % SHOP_COLS) * PANEL_SLOT, y: SHOP_BOX.y + 28 + Math.floor(i / SHOP_COLS) * PANEL_SLOT }; }
// packpanel 底部正中的空格（43×18，刚好放下 closebtn.png）= 关闭按钮
export function shopCloseBtn() { return { x: SHOP_BOX.x + 78, y: SHOP_BOX.y + 274, w: 43, h: 18 }; }

// 快捷栏 1~9 在 userpanel.bmp 上的真实格子（首格 x=6，间距 37，宽 35）
export const HOTBAR_X0 = 6, HOTBAR_DX = 37, HOTBAR_Y = 61, HOTBAR_W = 35, HOTBAR_H = 35;

// 右下角功能按钮（playerpanel.ini：property/note/rr/mission/menu，各 34x34，y=61）
export const FN_BUTTONS = [
  { k: "attr", img: "属性", x: 454 },
  { k: "note", img: "记事", x: 491 },
  { k: "honor", img: "荣辱", x: 528 },
  { k: "mission", img: "任务", x: 565 },
  { k: "menu", img: "菜单", x: 602 },
];
export const FN_BUTTON_Y = 61, FN_BUTTON_SIZE = 34;
export function fnButtonAt(sx, sy) {
  const Y = VH - 100;
  for (const b of FN_BUTTONS)
    if (sx >= b.x && sx < b.x + FN_BUTTON_SIZE && sy >= Y + FN_BUTTON_Y && sy < Y + FN_BUTTON_Y + FN_BUTTON_SIZE) return b.k;
  return null;
}

// 公开给 render/ 使用的工具：取元件的屏幕矩形与格子矩形。
// 返回 null 表示“配置里没有这个元件”（调用方自行回退）。
export function uiRect(id) {
  const c = comp(id);
  if (!c) return null;
  const p = compPos(c);
  return { x: p.x, y: p.y, w: c.w, h: c.h };
}

// 面板矩形：优先取可编辑 UI 配置（ui.json 里的 id），缺配置时回退硬编码默认。
// 这是把“硬编码面板”逐步搬进 UI 配置的统一入口：搬一个面板只需在 ui.json 加一个
// 元件 + 把调用处的常量换成 uiBox("xxx.panel", DEFAULT_BOX)。
//
// layout.js 在 core/ 下，不能 import content/ 的 ui 数据，所以这里只能读
// installUiLayout() 注入的已规整配置（渲染层每帧注入）。
export function uiBox(id, fallback) {
  const r = uiRect(id);
  return r || fallback;
}

// 面板内部的行/按钮矩形：它们相对面板左上角定位，所以面板被挪动时自动跟随。
// rect 是行相对面板的偏移与尺寸 {dx, dy, w, h}。
export function uiRow(box, def) {
  return { x: box.x + def.dx, y: box.y + def.dy, w: def.w != null ? def.w : box.w - (def.dx * 2), h: def.h };
}
export function uiSlotRect(id, i) {
  const c = comp(id);
  if (!c) return null;
  const r = compSlot(c, i);
  return r;
}
export function uiComp(id) { return comp(id); }

// 商店面板矩形：优先取可编辑配置里的 shop.panel 元件。
function shopRect() {
  const c = comp("shop.panel");
  if (c) { const p = compPos(c); return { x: p.x, y: p.y, w: c.w, h: c.h }; }
  return SHOP_BOX;
}
export function insideShop(x, y) { const b = shopRect(); return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h; }
export function insideShopClose(x, y) {
  const c = comp("shop.close");
  const b = c ? (() => { const p = compPos(c); return { x: p.x, y: p.y, w: c.w, h: c.h }; })() : shopCloseBtn();
  return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
}
export function insideDialog(x, y) { return x >= 90 && x < 460 && y >= 15 && y < 365; }   // 头像 + dlgpanel

// 返回鼠标下的格子（hotbar / equip / pack / shop），无则 null
const EQUIP_KEYS = ["Shi1", "Wu", "Jia", "Shi2"];

// 在某个 slotgrid 元件里命中第几格（越界/未命中返回 -1）。
function hitGrid(c, sx, sy, count) {
  const total = Math.min(count, c.cols * c.rows);
  for (let i = 0; i < total; i++) {
    const r = compSlot(c, i);
    if (sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h) return i;
  }
  return -1;
}

export function slotAt(sx, sy) {
  // ---- 优先：可编辑 UI 配置 ----
  if (_ui) {
    if (G.shop) {
      const g = comp("shop.grid");
      if (g && insideShop(sx, sy)) {
        const i = hitGrid(g, sx, sy, G.shop.goods.length);
        if (i >= 0) return { kind: "shop", key: i };
      }
    }
    const hb = comp("hud.hotbar");
    if (hb) { const i = hitGrid(hb, sx, sy, 9); if (i >= 0) return { kind: "hotbar", key: i }; }
    const eq = comp("hud.equip");
    if (eq) { const i = hitGrid(eq, sx, sy, EQUIP_KEYS.length); if (i >= 0) return { kind: "equip", key: EQUIP_KEYS[i] }; }
    if (G.packOpen) {
      const pk = comp("pack.grid");
      if (pk) { const i = hitGrid(pk, sx, sy, G.pack.length); if (i >= 0) return { kind: "pack", key: i }; }
    }
    return null;
  }

  // ---- 兜底：硬编码（UI 未注入时）----
  const Y = VH - 100;
  if (G.shop) {
    const total = SHOP_COLS * SHOP_ROWS;
    if (insideShop(sx, sy)) for (let i = 0; i < Math.min(G.shop.goods.length, total); i++) {
      const p = shopSlotPos(i);
      if (sx >= p.x && sx < p.x + 38 && sy >= p.y && sy < p.y + 38) return { kind: "shop", key: i };
    }
  }
  for (let i = 0; i < 9; i++) { const x = HOTBAR_X0 + i * HOTBAR_DX; if (sx >= x && sx < x + HOTBAR_DX && sy >= Y + HOTBAR_Y && sy < Y + HOTBAR_Y + HOTBAR_H) return { kind: "hotbar", key: i }; }
  for (const [k, x] of /** @type {[string, number][]} */ ([["Shi1", 492], ["Wu", 530], ["Jia", 566], ["Shi2", 603]]))
    if (sx >= x && sx < x + 35 && sy >= Y + 12 && sy < Y + 47) return { kind: "equip", key: k };
  if (G.packOpen) for (let i = 0; i < G.pack.length; i++) {
    const gx = PACK_BOX.x + 8 + (i % 5) * 40, gy = PACK_BOX.y + 28 + Math.floor(i / 5) * 40;
    if (sx >= gx && sx < gx + 40 && sy >= gy && sy < gy + 40) return { kind: "pack", key: i };
  }
  return null;
}

export function entryOf(slot) {
  if (!slot) return null;
  if (slot.kind === "hotbar") return G.hotbar[slot.key];
  if (slot.kind === "pack") return G.pack[slot.key];
  if (slot.kind === "equip") return G.equip[slot.key];
  return null;
}

// 鼠标悬停格子对应的物品（包括商店格）
export function displayEntry(slot) {
  if (!slot) return null;
  if (slot.kind === "shop") { const name = G.shop && G.shop.goods[slot.key]; return name ? { name, count: 1, fromShop: true } : null; }
  return entryOf(slot);
}

// ---- 系统设置面板（音量 + 系统菜单）----
// 绘制（render/panels.js）与命中测试（本文件）共用这一份坐标，避免两处各写一遍对不上。
// 面板矩形优先取 ui.json 的 settings.panel；缺配置时用这套默认几何。
// 注意：这是**函数**而不是常量——配置注入后坐标可能变，常量会把旧值定死。
export const SETTINGS_DEFAULT = { w: 380, h: 320, x: (VW - 380) / 2, y: 80 };
export function settingsBox() { return uiBox("settings.panel", SETTINGS_DEFAULT); }
export function settingsBar() {
  const B = settingsBox();
  return { x: B.x + 110, w: 220 };
}
export function settingsButtons() {
  const B = settingsBox();
  return [
    { k: "resume", label: "回到游戏", x: B.x + 30, y: B.y + 236, w: 150, h: 30 },
    { k: "save", label: "读档 / 存档", x: B.x + 200, y: B.y + 236, w: 150, h: 30 },
    { k: "quit", label: "退出游戏", x: B.x + 30, y: B.y + 274, w: B.w - 60, h: 30 },
  ];
}
// 兼容旧引用（常量形式）：值来自默认几何，不随配置变化。
// 新代码请用 settingsBox()/settingsBar()/settingsButtons()。
export const SETTINGS_BAR = { x: SETTINGS_DEFAULT.x + 110, w: 220 };
export const SETTINGS_BTN = [
  { k: "resume", label: "回到游戏", x: SETTINGS_DEFAULT.x + 30, y: SETTINGS_DEFAULT.y + 236, w: 150, h: 30 },
  { k: "save", label: "读档 / 存档", x: SETTINGS_DEFAULT.x + 200, y: SETTINGS_DEFAULT.y + 236, w: 150, h: 30 },
  { k: "quit", label: "退出游戏", x: SETTINGS_DEFAULT.x + 30, y: SETTINGS_DEFAULT.y + 274, w: 320, h: 30 },
];

// 设置面板的命中测试：音量条 / 静音 / 系统菜单按钮。
export function settingsHit(x, y) {
  if (!G.settingsPanel) return null;
  const px = settingsBox().x, py = settingsBox().y;
  const bx = settingsBar().x, bw = settingsBar().w;
  // 系统菜单按钮优先（它们在面板下方，与音量区不重叠，但顺序更明确）
  for (const b of settingsButtons()) {
    if (x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return { k: b.k };
  }
  if (y >= py + 62 && y < py + 78 && x >= bx && x < bx + bw) return { k: "bgm" };
  if (y >= py + 112 && y < py + 128 && x >= bx && x < bx + bw) return { k: "sfx" };
  if (y >= py + 142 && y < py + 164) {
    if (x >= bx && x < bx + 80) return { k: "mutBgm" };
    if (x >= bx + 120 && x < bx + 200) return { k: "mutSfx" };
  }
  return null;
}
