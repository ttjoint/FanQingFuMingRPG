// UI 内容域：把“界面由谁画、画在哪、显示什么”变成**数据**而非硬编码。
//
// 为什么需要这一层：
//   在此之前全部 UI 坐标写死在 core/layout.js（约 10 组常量）与 render/* 里，
//   于是状态栏、物品栏、商店栏都**无法增删或移动**——编辑器也改不了。
//   这一层把每个可编辑元件描述成一条记录，render/input 都读它，
//   编辑器则把它当作可拖拽的画布对象。
//
// 坐标体系：
//   x/y 相对 anchor 指定的锚点，单位是逻辑像素（VW=640 / VH=480 坐标系）。
//   anchor 决定元件随窗口缩放时贴哪条边，这样“右下角快捷栏”不会因分辨率变化跑位。
//
// 与 layout.js 的关系：
//   core/layout.js 的硬编码常量保留为 defaultUi() 的取值来源，
//   因此“默认配置”渲染结果与今天逐像素一致（有回归测试守着）。

/** 元件种类。render 层按 kind 决定怎么画。 */
export const UI_KINDS = ["panel", "bar", "slotgrid", "button", "label", "image"];

/** 锚点：决定 x/y 相对哪个角。 */
export const UI_ANCHORS = ["topLeft", "topRight", "bottomLeft", "bottomRight", "center"];

/** 绑定：元件显示什么运行时数据。 */
// 可见性绑定表：组件的显隐来源。
// 空串 = 恒可见（配合 visible 开关）。
// 新增绑定需在 render/hud.js 的 visibleOf 里同步实现求值。
export const VIS_BINDS = [
  "",             // 恒可见（由 visible 开关控制）
  "packOpen",     // 背包是否打开（G.packOpen）
  "shop",         // 商店是否打开（G.shop 非空）
  "stashPanel",   // 共享仓库（G.stashPanel）
  "waypointPanel",// 传送点面板
  "smithPanel",   // 铁匠铺
  "mercPanel",    // 随从面板
  "savePanel",    // 存档面板
  "settingsPanel",// 设置面板
  "dialog",       // 对话进行中
  "panel",        // 通用面板（任务/记事/属性/荣辱，G.panel 非空）
];

export const UI_BINDS = [
  "",              // 不绑定（纯装饰）
  "stats.hp", "stats.mp", "stats.exp",
  "stats.level", "stats.money",
  "inventory.hotbar", "inventory.pack", "shop.goods",
  "equipment", "skill.icon",
];

// 绘制归属：元件由谁画。
//
// 背景（真实 bug）：pack.panel / shop.panel 既被 drawHUD 的通用循环画，
// 又被 drawPack / drawShop 画——同一张底图同坐标画两遍，且两份代码各自
// 维护标题、提示文字，职责不清。只靠 id 前缀猜测“这个元件归谁”太脆，
// 所以把归属写成字段：
//   "hud"  —— drawHUD 的通用循环（panel/bar/label/button/image/slotgrid）
//   "none" —— 不由通用循环画，由专用绘制函数独占（drawPack / drawShop 等）
// 专用函数需要读它的矩形时用 uiRect(id)，仍与配置同源。
export const UI_DRAWN_BY = ["hud", "none"];

const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : (v == null || v === "" ? d : Number(v) || d));
const str = (v, d = "") => (v == null ? d : String(v));
const bool = (v, d = false) => (v == null ? d : !!v);

/**
 * 规整单个 UI 元件。未知字段保留（向前兼容）。
 * @param {any} c
 * @returns {any}
 */
export function normalizeUiComponent(c) {
  const o = clone(c) || {};
  o.id = str(o.id, "");
  o.kind = UI_KINDS.includes(o.kind) ? o.kind : "panel";
  o.anchor = UI_ANCHORS.includes(o.anchor) ? o.anchor : "topLeft";
  o.x = num(o.x, 0);
  o.y = num(o.y, 0);
  o.w = Math.max(0, num(o.w, 0));
  o.h = Math.max(0, num(o.h, 0));
  o.z = num(o.z, 0);
  o.img = str(o.img, "");
  o.text = str(o.text, "");
  o.bind = UI_BINDS.includes(o.bind) ? o.bind : "";
  // 可见性绑定：组件显隐由游戏状态驱动（hud.js 的 visibleOf 求值）。
  // 这是 P1 改造遗漏的一环：pack.panel / shop.panel 被搬进 ui.json 后，
  // 原来存在于 drawPack/drawShop 里的 packOpen / shop 守卫没有跟过来，
  // 导致背包与商店面板从 P1 起常驻屏幕（“进游戏多出一个关不掉的 UI 框”）。
  o.visibleBind = VIS_BINDS.includes(o.visibleBind) ? o.visibleBind : "";
  // 绘制归属：默认由 drawHUD 的通用循环画；"none" 表示专用函数独占。
  o.drawnBy = UI_DRAWN_BY.includes(o.drawnBy) ? o.drawnBy : "hud";
  o.visible = bool(o.visible, true);
  // slotgrid 专用：格子布局。
  if (o.kind === "slotgrid") {
    o.cols = Math.max(1, Math.floor(num(o.cols, 5)));
    o.rows = Math.max(1, Math.floor(num(o.rows, 5)));
    o.pitch = Math.max(1, num(o.pitch, 40));
    o.padX = num(o.padX, 8);
    o.padY = num(o.padY, 28);
    o.slotW = Math.max(1, num(o.slotW, 38));
    o.slotH = Math.max(1, num(o.slotH, 38));
  }
  // bar 专用：颜色。
  if (o.kind === "bar") {
    o.color = str(o.color, "#c0392b");
    o.bg = str(o.bg, "#111111");
    o.text = str(o.text, "");
  }
  return o;
}

/**
 * 规整整份 UI 配置：{ components: [...] }。
 * 也接受裸数组（便于手写数据）。
 * @param {any} ui
 * @returns {{components: any[]}}
 */
export function normalizeUi(ui) {
  let list = [];
  if (Array.isArray(ui)) list = ui;
  else if (ui && Array.isArray(ui.components)) list = ui.components;
  else if (ui && typeof ui === "object") {
    // 也接受 { id: component } 的映射写法
    list = Object.keys(ui).map(k => ({ id: k, ...ui[k] }));
  }
  const seen = new Set();
  const components = list
    .filter(c => c && typeof c === "object")
    .map(c => normalizeUiComponent(c))
    // id 必须唯一；缺失或重复的按出现顺序补 uid，保证选择/命中测试有稳定键。
    .map((c, i) => {
      if (!c.id || seen.has(c.id)) {
        let n = i;
        while (seen.has("ui" + n)) n++;
        c.id = "ui" + n;
      }
      seen.add(c.id);
      return c;
    });
  return { components };
}

/**
 * 按 id 查找元件。
 * @param {{components:any[]}|null} ui
 * @param {string} id
 * @returns {any|null}
 */
export function uiComponent(ui, id) {
  if (!ui || !Array.isArray(ui.components)) return null;
  return ui.components.find(c => c.id === id) || null;
}

/**
 * 把锚点相对坐标解析成逻辑屏幕坐标（左上角）。
 * @param {any} c 元件
 * @param {number} VW 逻辑宽
 * @param {number} VH 逻辑高
 * @returns {{x:number, y:number}}
 */
export function resolvePos(c, VW, VH) {
  const a = c.anchor || "topLeft";
  let ox = 0, oy = 0;
  if (a === "topRight") { ox = VW - c.w; oy = 0; }
  else if (a === "bottomLeft") { ox = 0; oy = VH - c.h; }
  else if (a === "bottomRight") { ox = VW - c.w; oy = VH - c.h; }
  else if (a === "center") { ox = (VW - c.w) / 2; oy = (VH - c.h) / 2; }
  return { x: Math.round(ox + c.x), y: Math.round(oy + c.y) };
}

/**
 * 点是否落在元件内（按解析后的屏幕矩形）。
 * @param {any} c
 * @param {number} x
 * @param {number} y
 * @param {number} VW
 * @param {number} VH
 * @returns {boolean}
 */
export function hitComponent(c, x, y, VW, VH) {
  const p = resolvePos(c, VW, VH);
  return x >= p.x && x < p.x + c.w && y >= p.y && y < p.y + c.h;
}

/**
 * 返回命中的最上层元件（z 大者优先；同 z 后加入者优先）。
 * @param {{components:any[]}|null} ui
 * @param {number} x
 * @param {number} y
 * @param {number} VW
 * @param {number} VH
 * @returns {any|null}
 */
export function hitTop(ui, x, y, VW, VH) {
  if (!ui || !Array.isArray(ui.components)) return null;
  let best = null, bestZ = -Infinity, bestI = -1;
  ui.components.forEach((c, i) => {
    if (!c.visible) return;
    if (!hitComponent(c, x, y, VW, VH)) return;
    if (c.z > bestZ || (c.z === bestZ && i > bestI)) { best = c; bestZ = c.z; bestI = i; }
  });
  return best;
}

/**
 * 计算 slotgrid 第 i 格的屏幕矩形。
 * @param {any} c slotgrid 元件
 * @param {number} i 格序号
 * @param {number} VW
 * @param {number} VH
 * @returns {{x:number,y:number,w:number,h:number}}
 */
export function slotRect(c, i, VW, VH) {
  const p = resolvePos(c, VW, VH);
  const col = i % c.cols, row = Math.floor(i / c.cols);
  return {
    x: p.x + c.padX + col * c.pitch,
    y: p.y + c.padY + row * c.pitch,
    w: c.slotW, h: c.slotH,
  };
}
