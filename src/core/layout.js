// UI 布局常量与命中测试（纯几何 + 少量状态读取）。
// input 与 render 都依赖这里，保证“画在哪”和“点在哪”使用同一套坐标。
import { G } from "./state.js";
import { VW, VH } from "./constants.js";

// ---- 标题菜单 ----
// 原版 mainmenu.ini 的按钮坐标（按钮图 80×18）。
export const MENU_BUTTONS = [
  { k: "start", img: "start", x: 43, y: 439 },
  { k: "load", img: "load", x: 197, y: 439 },
  { k: "about", img: "about", x: 351, y: 439 },
  { k: "exit", img: "exit", x: 506, y: 439 },
  { k: "version", text: "数据版本", x: 8, y: 8, w: 200, h: 22 },
  { k: "editor", text: "编辑内容", x: 534, y: 8, w: 96, h: 22, local: true },
];
export function menuHit(sx, sy) {
  for (const b of MENU_BUTTONS) {
    const w = b.w || 80, h = b.h || 18;
    if (sx >= b.x && sx < b.x + w && sy >= b.y && sy < b.y + h) return b.k;
  }
  return null;
}

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

export function insideShop(x, y) { return x >= SHOP_BOX.x && x < SHOP_BOX.x + SHOP_BOX.w && y >= SHOP_BOX.y && y < SHOP_BOX.y + SHOP_BOX.h; }
export function insideShopClose(x, y) { const b = shopCloseBtn(); return x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h; }
export function insideDialog(x, y) { return x >= 90 && x < 460 && y >= 15 && y < 365; }   // 头像 + dlgpanel

// 返回鼠标下的格子（hotbar / equip / pack / shop），无则 null
export function slotAt(sx, sy) {
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
export const SETTINGS_BOX = { w: 380, h: 320, x: (VW - 380) / 2, y: 80 };
export const SETTINGS_BAR = { x: SETTINGS_BOX.x + 110, w: 220 };
export const SETTINGS_BTN = [
  { k: "resume", label: "回到游戏", x: SETTINGS_BOX.x + 30, y: SETTINGS_BOX.y + 236, w: 150, h: 30 },
  { k: "save", label: "读档 / 存档", x: SETTINGS_BOX.x + 200, y: SETTINGS_BOX.y + 236, w: 150, h: 30 },
  { k: "quit", label: "退出游戏", x: SETTINGS_BOX.x + 30, y: SETTINGS_BOX.y + 274, w: 320, h: 30 },
];

// 设置面板的命中测试：音量条 / 静音 / 系统菜单按钮。
export function settingsHit(x, y) {
  if (!G.settingsPanel) return null;
  const px = SETTINGS_BOX.x, py = SETTINGS_BOX.y, bx = SETTINGS_BAR.x, bw = SETTINGS_BAR.w;
  // 系统菜单按钮优先（它们在面板下方，与音量区不重叠，但顺序更明确）
  for (const b of SETTINGS_BTN) {
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
