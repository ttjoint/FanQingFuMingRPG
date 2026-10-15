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

// 设置面板的命中测试
export function settingsHit(x, y) {
  if (!G.settingsPanel) return null;
  const w = 380, h = 200, px = (VW - w) / 2, py = 80, bx = px + 110, bw = 220;
  if (y >= py + 70 && y < py + 86 && x >= bx && x < bx + bw) return { k: "bgm" };
  if (y >= py + 120 && y < py + 136 && x >= bx && x < bx + bw) return { k: "sfx" };
  if (y >= py + 150 && y < py + 172) {
    if (x >= bx && x < bx + 80) return { k: "mutBgm" };
    if (x >= bx + 90 && x < bx + 170) return { k: "mutSfx" };
  }
  return null;
}
