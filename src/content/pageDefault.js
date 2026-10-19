// 默认页面文档：逐像素复刻改造前的硬编码页面。
//
// 改造前这 5 个页面写死在 render/scene-ui.js 的 switch 里，按钮坐标硬编码在
// core/layout.js 的 MENU_BUTTONS。现在它们是数据，但**默认数据的渲染结果必须
// 与改造前完全一致**——否则"把硬编码搬进数据"就带来了视觉回归。
//
// 一致性由 test/page.test.mjs 守着（直接比对 MENU_BUTTONS 的旧值）。
//
// 与 uiDefault.js 一样，本文件是**纯数据模块**：不 import core/（core 依赖 DOM 与 G 单例），
// VW/VH 就地复制。
export const VW = 640, VH = 480;

/** 原版 mainmenu.ini 的按钮坐标（按钮图 80×18）。顺序与旧 MENU_BUTTONS 一致。 */
const MENU_BTNS = [
  { k: "start", img: "start", x: 43,  y: 439, action: { type: "start" } },
  { k: "load",  img: "load",  x: 197, y: 439, action: { type: "load" } },
  { k: "about", img: "about", x: 351, y: 439, action: { type: "scene", to: "about" } },
  { k: "exit",  img: "exit",  x: 506, y: 439, action: { type: "exit" } },
];

/**
 * @returns {any[]} 页面列表（顺序即优先级，不影响按 id 查找）
 */
export function defaultPages() {
  return [
    // ---- 标题页：背景 mainmenu.png + 4 个原版按钮 ----
    // 注意：改造前的「数据版本」「编辑内容」两个按钮**已移除**。
    // 它们本质是引擎入口的职责（选哪个版本、开哪个版本的编辑器），
    // 现在由 src/launcher/ 的引擎入口页提供，不再混在游戏世界里。
    {
      id: "title",
      kind: "menu",
      background: "assets/ui/mainmenu.png",
      items: MENU_BTNS.map(b => ({
        id: "title." + b.k,
        kind: "button",
        anchor: "topLeft",
        x: b.x, y: b.y, w: 80, h: 18,
        img: "assets/ui/" + b.img + ".png",
        action: b.action,
      })),
    },

    // ---- 片头闪屏：team.bmp → kouhao.bmp，各 2 秒，可点击跳过 ----
    // 图片序列来自 game.json 的 flash（保持兼容），此页只声明"怎么播"。
    {
      id: "flash",
      kind: "flash",
      background: "",
      clickAnywhere: true,
      flashDuration: 2,
    },

    // ---- 关于页：整屏 content.png，点任意处返回标题 ----
    {
      id: "about",
      kind: "board",
      background: "assets/ui/content.png",
      clickAnywhere: true,
      lines: [{ text: "点击返回标题", x: 8, y: 470, size: 12, color: "rgba(255,255,255,0.8)" }],
    },

    // ---- 通关结算页：end.bmp 底图 + 称号与统计 ----
    // 改造前这些文字的位置写在 drawEnding 里（80/150 的半透明面板等）。
    // 现在用 slots 表达"把哪个运行时数据放在哪"，数值来源见 page-ui.js 的 resolveSlot。
    {
      id: "ending",
      kind: "score",
      background: "assets/ui/end.png",
      clickAnywhere: true,
      // 坐标与改造前 drawEnding 的硬编码一致：
      //   「游戏结束」 y=210；称号 y=260；统计 y=295；点击返回 y=330。
      // score 页的 lines/slots 以"压条顶边 150"为基准再偏移（见 page-ui.js），
      // 所以这里写 60/110/145/180，绘制时 +150。
      lines: [
        { text: "游戏结束", x: 0, y: 60, size: 30, color: "#ffd75e", align: "center" },
        { text: "点击返回标题", x: 0, y: 180, size: 12, color: "rgba(255,255,255,0.75)", align: "center" },
      ],
      slots: [
        { bind: "result.title", label: "你的江湖称号：", x: 0, y: 110, size: 18, color: "#f2ead0" },
        { bind: "stats.summary", label: "", x: 0, y: 145, size: 14, color: "#9fe08f" },
      ],
      items: [],
    },

    // ---- 告别页：纯黑 + 一行字 ----
    {
      id: "farewell",
      kind: "board",
      background: "",
      clickAnywhere: true,
      lines: [{ text: "", x: 0, y: 0, size: 13, color: "#fff", align: "center" }],
    },
  ];
}

/** 默认页面表（已规整前的原始形状，交给 normalizePages 处理）。 */
export function defaultPageTable() {
  return { pages: defaultPages(), initial: "flash" };
}
