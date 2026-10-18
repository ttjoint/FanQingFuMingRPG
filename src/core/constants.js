// 画布尺寸、2D 上下文、对白富文本配色等全局常量。
// 这里不依赖任何游戏状态，可被任意层引用。

export const VW = 640, VH = 480;

// 版本标记：每次改动算法可改此串，用来确认浏览器是否真的加载到新代码（控制台会打印）。
export const BUILD = "2026-11-08-todo-cleanup";

export const cv = /** @type {HTMLCanvasElement} */ (document.getElementById("cv"));
export const ctx = cv.getContext("2d");
ctx.imageSmoothingEnabled = false;

// 对白内联标记 <N文字/> 的字体颜色（原游戏用不同颜色区分“任务目标 / 物品·技能名 / 按键”）。
// 数字 -> 颜色，可自行微调；未列出的数字用默认色。
export const TAG_COLORS = { "1": "#ffffff", "2": "#ffd75e", "3": "#9fe08f", "4": "#7ec8ff" };
export const TEXT_COLOR = "#f2ead0";
