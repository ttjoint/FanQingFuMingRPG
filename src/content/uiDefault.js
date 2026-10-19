// 默认 UI 配置：逐像素复刻改造前的硬编码布局。
//
// 这些数值来自 core/layout.js 的常量与 render/hud.js 里的字面坐标。
// 保留它们的意义：**默认配置的渲染结果必须与改造前完全一致**，
// 这样“把硬编码搬进数据”不会在视觉上带来任何回归（test/ui.test.mjs 守着这一点）。
//
// 注意 VW=640 / VH=480 是逻辑分辨率（见 core/constants.js）。
// 逻辑分辨率与旧布局常量在此**就地复制**，而不是 import core/constants.js 或 core/layout.js：
//   - core/constants.js 在模块加载时就取 DOM canvas，content/ 层不该依赖 DOM；
//   - core/layout.js 又反过来依赖 core/state.js 的 G 单例，同样不适合被数据层引入。
// 这些数字是“默认内容”的一部分，复制一份反而让本文件成为纯粹的数据模块。
// 一致性由 test/ui.test.mjs 校验（它直接比对 core/layout.js 的导出值）。
export const VW = 640, VH = 480;

// 底部状态面板高度（userpanel.png 贴在 VH-100）。
const HUD_H = 100;

// 商店 / 背包面板（packpanel.png 200×300，5 列格）。
const PACK_BOX = { x: 220, y: 60, w: 200, h: 300 };
const SHOP_BOX = { x: 8, y: 60, w: 200, h: 300 };
const SHOP_COLS = 5, SHOP_ROWS = 5, PANEL_SLOT = 40;

// 快捷栏 1~9（userpanel.bmp 首格 x=6，间距 37，宽 35）。
const HOTBAR_X0 = 6, HOTBAR_DX = 37, HOTBAR_Y = 61, HOTBAR_W = 35, HOTBAR_H = 35;

// 右下角功能按钮（playerpanel.ini：各 34×34，y=61，x 从 454 起，步进 37）。
const FN_X0 = 454, FN_Y = 61, FN_SIZE = 34, FN_COUNT = 5, FN_DX = 37;

// 底部状态面板高度 100（userpanel.png 贴在 VH-100）。
const HUD_Y = VH - HUD_H;

/**
 * 构建默认 UI 元件列表。
 * 每项都会被 content/ui.js 的 normalizeUiComponent 规整。
 * @returns {any[]}
 */
export function defaultUiComponents() {
  const comps = [];

  // ---- 底部状态面板底图 ----
  // userpanel.png 是整条 640×100 的底图，贴左下。
  comps.push({
    id: "hud.panel", kind: "panel", anchor: "bottomLeft",
    x: 0, y: 0, w: VW, h: 100, z: 100,
    img: "assets/ui/userpanel.png",
  });

  // ---- 三条状态条（render/hud.js 的 bar()）----
  // 原坐标是 Y+48 处的绝对 x；这里换算成相对面板的偏移。
  // 注意：anchor=bottomLeft 已经把 y 算成 VH-h（即 480-7=473）；
  // 旧硬编码是绝对 y=428，所以相对底边的偏移是 428-473 = -45。
  // 一开始这里误写成 HUD_Y+48-HUD_Y（=48），会被锚点再加一次 → 落在 y=521。
  comps.push({
    id: "hud.hp", kind: "bar", anchor: "bottomLeft",
    x: 44, y: 428 - (VH - 7), w: 159, h: 7, z: 110,
    bind: "stats.hp", color: "#c0392b", bg: "#111111", text: "value",
  });
  comps.push({
    id: "hud.mp", kind: "bar", anchor: "bottomLeft",
    x: 259, y: 428 - (VH - 7), w: 159, h: 7, z: 110,
    bind: "stats.mp", color: "#2d7fd0", bg: "#111111", text: "value",
  });
  comps.push({
    id: "hud.exp", kind: "bar", anchor: "bottomLeft",
    x: 475, y: 428 - (VH - 7), w: 159, h: 7, z: 110,
    bind: "stats.exp", color: "#c9a227", bg: "#111111", text: "value",
  });

  // ---- 等级 / 金钱标签 ----
  comps.push({
    id: "hud.level", kind: "label", anchor: "bottomLeft",
    x: 362, y: (HUD_Y + 82) - (VH - 14), w: 80, h: 14, z: 120,
    bind: "stats.level", text: "等级", color: "#ffd75e",
  });
  comps.push({
    id: "hud.money", kind: "label", anchor: "bottomLeft",
    x: 417, y: (HUD_Y + 92) - (VH - 14), w: 80, h: 14, z: 120,
    bind: "stats.money", text: "", color: "#ffd75e",
  });

  // ---- 技能图标按钮 ----
  comps.push({
    id: "hud.skill", kind: "button", anchor: "bottomLeft",
    x: 7, y: (HUD_Y + 10) - (VH - 35), w: 35, h: 35, z: 120,
    bind: "skill.icon", img: "assets/ui/button.png",
  });

  // ---- 快捷栏 1~9（9 个格子，鼠标面板上的真实格子）----
  comps.push({
    id: "hud.hotbar", kind: "slotgrid", anchor: "bottomLeft",
    x: HOTBAR_X0, y: (HUD_Y + HOTBAR_Y) - (VH - HOTBAR_H), w: HOTBAR_DX * 9, h: HOTBAR_H, z: 115,
    cols: 9, rows: 1, pitch: HOTBAR_DX, padX: 0, padY: 0,
    slotW: HOTBAR_W, slotH: HOTBAR_H, bind: "inventory.hotbar",
  });

  // ---- 装备栏（Shi1/Wu/Jia/Shi2）----
  comps.push({
    id: "hud.equip", kind: "slotgrid", anchor: "bottomLeft",
    x: 492, y: (HUD_Y + 12) - (VH - 35), w: 4 * 37, h: 35, z: 115,
    cols: 4, rows: 1, pitch: 37, padX: 0, padY: 0,
    slotW: 35, slotH: 35, bind: "equipment",
  });

  // ---- 右下角功能按钮：属性 / 记事 / 荣辱 / 任务 / 菜单 ----
  comps.push({
    id: "hud.fn", kind: "slotgrid", anchor: "bottomLeft",
    x: FN_X0, y: (HUD_Y + FN_Y) - (VH - FN_SIZE), w: (FN_COUNT - 1) * FN_DX + FN_SIZE, h: FN_SIZE, z: 120,
    cols: FN_COUNT, rows: 1, pitch: FN_DX, padX: 0, padY: 0,
    slotW: FN_SIZE, slotH: FN_SIZE, bind: "",
  });

  // ---- 背包面板 ----
  comps.push({
    id: "pack.panel", kind: "panel", anchor: "topLeft", visibleBind: "packOpen",
    x: PACK_BOX.x, y: PACK_BOX.y, w: PACK_BOX.w, h: PACK_BOX.h, z: 200,
    img: "assets/ui/packpanel.png",
  });
  comps.push({
    id: "pack.grid", kind: "slotgrid", anchor: "topLeft", visibleBind: "packOpen",
    x: PACK_BOX.x, y: PACK_BOX.y, w: PACK_BOX.w, h: PACK_BOX.h, z: 210,
    cols: 5, rows: 5, pitch: PANEL_SLOT, padX: 8, padY: 28,
    slotW: 40, slotH: 40, bind: "inventory.pack",
  });

  // ---- 商店面板 ----
  comps.push({
    id: "shop.panel", kind: "panel", anchor: "topLeft", visibleBind: "shop",
    x: SHOP_BOX.x, y: SHOP_BOX.y, w: SHOP_BOX.w, h: SHOP_BOX.h, z: 200,
    img: "assets/ui/packpanel.png",
  });
  comps.push({
    id: "shop.grid", kind: "slotgrid", anchor: "topLeft", visibleBind: "shop",
    x: SHOP_BOX.x, y: SHOP_BOX.y, w: SHOP_BOX.w, h: SHOP_BOX.h, z: 210,
    cols: SHOP_COLS, rows: SHOP_ROWS, pitch: PANEL_SLOT, padX: 8, padY: 28,
    slotW: 38, slotH: 38, bind: "shop.goods",
  });
  // 关闭按钮：packpanel 底部正中的空格（43×18）。
  comps.push({
    id: "shop.close", kind: "button", anchor: "topLeft", visibleBind: "shop",
    x: SHOP_BOX.x + 78, y: SHOP_BOX.y + 274, w: 43, h: 18, z: 220,
    img: "assets/ui/closebtn.png",
  });

  // ---- 居中弹窗：任务/记事/属性/荣辱 与 存档面板 ----
  // 这两类面板原本把尺寸写死在 render/panels.js 里（420×300 / 460×340，居中
  // 且 y=40）。收进配置后，用户在编辑器里就能移动/缩放它们，而绘制侧
  // 用 uiRect() 读取，改动立刻生效。
  comps.push({
    id: "info.panel", kind: "panel", anchor: "center", visibleBind: "panel",
    x: 0, y: 40 - (VH - 300) / 2, w: 420, h: 300, z: 300,
    bg: "rgba(20,16,12,0.95)", color: "#b8a468",
  });
  comps.push({
    id: "save.panel", kind: "panel", anchor: "center", visibleBind: "savePanel",
    x: 0, y: 40 - (VH - 340) / 2, w: 460, h: 340, z: 300,
    bg: "rgba(18,14,10,0.96)", color: "#b8a468",
  });

  return comps;
}

/** 默认 UI 配置（已规整的形状）。 */
export function defaultUi() {
  return { components: defaultUiComponents() };
}

// 供测试/编辑器做“默认值 vs 硬编码”的逐项比对。
export const DEFAULT_UI_METRICS = {
  VW, VH, HUD_Y, PACK_BOX, SHOP_BOX,
  HOTBAR: { x0: HOTBAR_X0, dx: HOTBAR_DX, y: HOTBAR_Y, w: HOTBAR_W, h: HOTBAR_H },
  FN: { x0: FN_X0, y: FN_Y, size: FN_SIZE, count: FN_COUNT, dx: FN_DX },
};
