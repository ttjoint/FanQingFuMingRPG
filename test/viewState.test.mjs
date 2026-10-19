// 视图层的状态注入契约（P5）。
//
// 历史：这个文件最初只有「字符串断言」——读源码看有没有 `stateOf(rt)` 这串字。
// 问题是那种测试**永远通过**，哪怕注入彻底失效。已实测：把
//   const G = stateOf(rt);
// 改成
//   let G = stateOf(rt); G = globalThis.__GLOBAL_STATE_FALLBACK;
// 字符串检查照样全绿，而注入已经死了。
//
// 现在分两层验证：
//   1) 结构层（保留少量 source 断言）：stateOf 只有一份实现，view 层不再各自抄一份；
//   2) 运行时层（主体）：用假 ctx 调用真实绘制/交互函数，喂一份「注入状态」，
//      断言它读的是注入的那份、而不是全局 G。这是能真正抓到注入失效的断言。
//
// 为什么需要 DOM 桩：render → core/constants.js 在模块顶层就执行
// document.getElementById("cv")。这个桩只提供 canvas 2d 上下文的最小形状，
// 并**记录所有 fillText 调用**，用来断言「到底按谁的数据画的」。
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { assertEq } from "./helpers.mjs";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = p => readFileSync(path.join(ROOT, p), "utf8");

// ---- canvas 2d 上下文桩：记录文本，便于判定"画的是谁的数据" ----
//
// 难点：`core/constants.js` 在**模块顶层**执行 cv.getContext("2d") 并把结果存进
// `export const ctx`，而 ESM 模块只求值一次。所以哪个测试文件先 import 它，
// 就决定了全进程共用的那个 ctx 来自谁的桩。
//
// 结论：不靠"抢先建桩"。在下面记录完要测的模块之后，直接对**实际生效**的
// constants.ctx 就地补方法（instrumentCtx），并与本文件的记录数组挂钩。
// 这样无论测试文件执行顺序如何，断言都对准真正被绘制函数使用的那个对象。
const drawn = { texts: [], rects: 0 };

function makeCtx2d() {
  return {
    // 状态（可读写，绘制函数会赋值）
    fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "butt", lineJoin: "miter",
    font: "10px sans-serif", textAlign: "left", textBaseline: "alphabetic",
    globalAlpha: 1, shadowColor: "", shadowBlur: 0, imageSmoothingEnabled: false,
    save() {}, restore() {}, beginPath() {}, closePath() {}, clip() {},
    moveTo() {}, lineTo() {}, arc() {}, rect() {},
    quadraticCurveTo() {}, bezierCurveTo() {}, ellipse() {},
    stroke() {}, fill() {},
    drawImage() {},
    fillRect() { drawn.rects++; }, strokeRect() {}, clearRect() {},
    setTransform() {}, translate() {}, scale() {}, rotate() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: t => ({ width: String(t == null ? "" : t).length * 7 }),
    fillText: (t) => { drawn.texts.push(String(t == null ? "" : t)); },
    strokeText: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData() {}, createPattern: () => null, setLineDash() {},
  };
}

// 把实际生效的 ctx 接到本文件的记录数组上
function instrumentCtx(ctx) {
  if (!ctx) return;
  // 已有桩可能已记录到自己的数组，这里用"包装"而非替换，保留原行为
  const origFillText = typeof ctx.fillText === "function" ? ctx.fillText.bind(ctx) : () => {};
  ctx.fillText = (t, ...rest) => { drawn.texts.push(String(t == null ? "" : t)); return origFillText(t, ...rest); };
  const origFillRect = typeof ctx.fillRect === "function" ? ctx.fillRect.bind(ctx) : () => {};
  ctx.fillRect = (...a) => { drawn.rects++; return origFillRect(...a); };
  // 补齐缺失方法（上一个测试文件的桩可能不全）
  const need = ["save", "restore", "beginPath", "closePath", "clip", "moveTo", "lineTo",
    "arc", "rect", "quadraticCurveTo", "bezierCurveTo", "ellipse", "stroke", "fill",
    "drawImage", "strokeRect", "clearRect", "setTransform", "translate", "scale", "rotate",
    "strokeText", "putImageData", "setLineDash"];
  for (const k of need) if (typeof ctx[k] !== "function") ctx[k] = () => {};
  if (typeof ctx.measureText !== "function") ctx.measureText = t => ({ width: String(t == null ? "" : t).length * 7 });
  if (typeof ctx.getImageData !== "function") ctx.getImageData = () => ({ data: new Uint8ClampedArray(4) });
  if (typeof ctx.createLinearGradient !== "function") ctx.createLinearGradient = () => ({ addColorStop() {} });
}

// 必须在 import 任何 render 模块之前建桩。
//
// 注意：这里**不判断 document 是否已存在就直接装**。
// 原因：`node:test` 把所有测试文件跑在同一个进程里，前面跑过的测试文件
// （如 scriptDiag.test.mjs）可能已经装了一个只满足它自己需要的弱桩（缺 strokeRect 等）。
// 若沿用旧桩，render 的绘制函数就会报 "ctx.strokeRect is not a function"。
// 本文件把自己需要的桩完整装上，保证与运行顺序无关。
function stubDom() {
  const sharedCtx = makeCtx2d();
  const canvas = {
    id: "cv", width: 800, height: 600, style: {},
    getContext: () => sharedCtx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
    addEventListener() {}, removeEventListener() {},
  };
  globalThis.document = {
    getElementById: id => (id === "cv" ? canvas : null),
    createElement: () => canvas,
    querySelector: () => canvas,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    body: { appendChild() {}, style: {}, classList: { add() {}, remove() {} } },
    documentElement: { style: {}, classList: { add() {}, remove() {} } },
  };
  globalThis.window = {
    addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1,
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  };
  globalThis.Image = class { constructor() { this.width = 0; this.height = 0; } addEventListener() {} };
  globalThis.localStorage = globalThis.window.localStorage;
  return sharedCtx;
}
stubDom();

const { stateOf, stateOfStrict } = await import("../src/render/frame.js");
const coreState = await import("../src/core/state.js");
const coreConstants = await import("../src/core/constants.js");
// 把实际生效的 ctx 接上记录数组（见 instrumentCtx 的注释：ESM 缓存决定了它是谁）
instrumentCtx(coreConstants.ctx);
const panels = await import("../src/render/panels.js");
const dialogUi = await import("../src/render/dialog-ui.js");
const sceneUi = await import("../src/render/scene-ui.js");
const shopUi = await import("../src/render/shop-ui.js");
const tooltip = await import("../src/render/tooltip.js");
const hud = await import("../src/render/hud.js");
const floatText = await import("../src/render/floatText.js");

// ---- 结构层 ----

// 从 import { a, b } from "x/core/state.js" 里取出具名导入列表
function stateImports(src) {
  const out = [];
  const RE = /import\s*\{([^}]*)\}\s*from\s*["'][^"']*core\/state\.js["']/g;
  let m;
  while ((m = RE.exec(src))) out.push(...m[1].split(",").map(s => s.trim()).filter(Boolean));
  return out;
}

// 取 "export function NAME(" 的形参列表与函数体开头
function fnShape(src, name) {
  const head = "export function " + name + "(";
  const at = src.indexOf(head);
  if (at < 0) return null;
  const sigEnd = src.indexOf(")", at);
  return {
    params: src.slice(at + head.length, sigEnd).split(",").map(s => s.trim()).filter(Boolean),
    body: src.slice(sigEnd, sigEnd + 300),
  };
}

// stateOf 只应有一份实现（本轮修复的核心：原先 8 份副本 + 1 份变体）
export function stateOfHasSingleDefinition() {
  const dirs = ["src/render", "src/input"];
  const found = [];
  for (const d of dirs) {
    for (const f of readdirSync(path.join(ROOT, d))) {
      if (!f.endsWith(".js")) continue;
      const rel = d + "/" + f;
      const src = read(rel);
      for (const line of src.split("\n")) {
        const t = line.trim();
        if (t.startsWith("//")) continue;   // 排除注释里的示例
        // 只看真正的函数定义（带参数表），排除 stateOfStrict 之类的衍生命名
        if (/^(export\s+)?function stateOf\s*\(/.test(t)) found.push(rel);
      }
    }
  }
  assertEq(found, ["src/render/frame.js"],
    "stateOf 应只有 render/frame.js 一份定义（视图层不得再各自拄副本）");
}

// render/input 不得 import 全局 A
export function noViewImportsGlobalAssets() {
  const files = ["src/render/tooltip.js", "src/render/shop-ui.js", "src/render/hud.js",
                 "src/render/renderer.js", "src/render/effects.js", "src/render/panels.js",
                 "src/render/scene-ui.js", "src/render/dialog-ui.js",
                 "src/input/input.js", "src/input/slots.js"];
  for (const f of files) {
    assert(!stateImports(read(f)).includes("A"), f + " 不应 import 全局 A");
  }
}

// 各绘制函数应接受 rt 参数（保留，但不再作为"注入有效"的证据）
export function drawFunctionsAcceptRt() {
  const targets = {
    "src/render/hud.js": ["drawHUD", "drawCursorItem"],
    "src/render/panels.js": ["drawTip", "drawPanels", "drawPack", "drawStash", "drawSmith",
                             "drawDifficulty", "drawMercPanel", "drawSavePanel",
                             "drawWaypointPanel", "drawSettingsPanel"],
    "src/render/tooltip.js": ["drawTooltip"],
    "src/render/shop-ui.js": ["drawShop"],
    "src/render/dialog-ui.js": ["drawDialog"],
    "src/render/scene-ui.js": ["drawScene"],
  };
  for (const [f, fns] of Object.entries(targets)) {
    const src = read(f);
    for (const fn of fns) {
      const sh = fnShape(src, fn);
      assert(sh, f + " 里找不到 " + fn);
      assert(sh.params.includes("rt"), f + " 的 " + fn + " 应接受 rt 参数");
    }
  }
}

// render() 必须把 rt 透传下去
export function renderPassesRtDown() {
  const t = read("src/render/renderer.js");
  assert(/export function render\(rt\)/.test(t), "render 应接受 rt");
  for (const fn of ["drawHUD", "drawPanels", "drawPack", "drawShop", "drawTooltip", "drawScene"]) {
    assert(t.includes(fn + "(rt)"), "render 应把 rt 传给 " + fn);
  }
  assert(!t.includes("drawHUD();"), "render 不应再以无参形式调用 drawHUD");
}

// input.js 的绑定
export function inputBindsRuntime() {
  const t = read("src/input/input.js");
  assert(t.includes("export function addInput(rt)"), "addInput 应收 rt");
  assert(t.includes("bindState(rt)"), "addInput 应绑定状态");
  assert(t.includes("BOUND || GLOBAL_STATE"), "未绑定时应回退全局（保持既有行为）");
  assert(!stateImports(t).includes("G"), "input.js 不应 import 全局 G");
}

export function bindingRedirectsState() {
  const t = read("src/input/input.js");
  assert(t.includes("const G = new Proxy"), "应以 Proxy 转发 G 的读写");
  assert(t.includes("set(_t, k, v)"), "Proxy 应把写入转发给绑定实例");
  assert(t.includes("get(_t, k)"), "Proxy 应把读取转发给绑定实例");
}

export function mainInjectsRuntime() {
  const t = read("src/main.js");
  assert(t.includes("addInput(runtime)"), "main 应把 runtime 传给 addInput");
  assert(t.includes("render(runtime)"), "main 应把 runtime 传给 render");
}

// ---- 运行时层（真正能抓注入失效）----

// 造一份「注入用」的最小状态，字段值与全局 G 明显不同，便于区分
function mkInjectedState(tag) {
  return {
    tip: tag, tipT: 5,
    panel: null, packOpen: false,
    dialog: { kind: "say", speaker: tag + "-说话人", text: tag + "-台词", portrait: "NULL" },
    scene: "game", flashStep: 0, flashT: 0,
    shop: null, savePanel: false, settingsPanel: false,
    mouse: { x: 0, y: 0, sx: 1, sy: 1, wx: 0, wy: 0 },
    missions: {}, notes: {}, stats: {}, skills: [], skill: null,
    npcs: [], ground: [], player: null, difficulty: "normal",
    factions: [], love: {}, vips: {},
  };
}

// 注入后应画的是注入状态里的文本，而不是全局状态的
export function injectedTipIsDrawnNotGlobal() {
  const G = coreState.G;
  const savedTip = G && G.tip;
  if (G) { G.tip = "全局提示"; G.tipT = 5; }   // 全局也放一个提示，用于区分

  const inj = mkInjectedState("注入提示");
  drawn.texts.length = 0;
  panels.drawTip({ state: inj });

  assert(drawn.texts.includes("注入提示"), "应画出注入状态里的提示，实际画了: " + JSON.stringify(drawn.texts));
  assert(!drawn.texts.includes("全局提示"), "不应画出全局状态里的提示（说明注入失效）");

  if (G) { G.tip = savedTip; }
}

// 传游戏状态对象本身（而非 rt 容器）也应生效
export function stateObjectDirectlyAccepted() {
  const inj = mkInjectedState("直传");
  drawn.texts.length = 0;
  panels.drawTip(inj);
  assert(drawn.texts.includes("直传"), "直接传 g 也应被接受，实际: " + JSON.stringify(drawn.texts));
}

// 不传 rt 时回退全局（P5 之前的既有行为，必须保持）
export function omittedRtFallsBackToGlobal() {
  const G = coreState.G;
  const saved = G && G.tip, savedT = G && G.tipT;
  if (G) { G.tip = "回退全局"; G.tipT = 5; }
  drawn.texts.length = 0;
  panels.drawTip();
  if (G) { G.tip = saved; G.tipT = savedT; }
  if (G) assert(drawn.texts.includes("回退全局"), "不传 rt 时应回退到全局状态");
}

// 对话：注入状态的台词必须被画出来
export function injectedDialogIsDrawn() {
  const inj = mkInjectedState("对白");
  drawn.texts.length = 0;
  dialogUi.drawDialog({ state: inj });
  const joined = drawn.texts.join("|");
  assert(joined.includes("对白-说话人") || joined.includes("对白-台词"),
    "应画出注入状态里的对话，实际: " + joined);
}

// stateOf / stateOfStrict 的语义
export function stateOfSemantics() {
  const g = { tip: "x" };
  assertEq(stateOf(null), coreState.G, "不传时回退全局");
  assertEq(stateOf(g), g, "直接传状态时原样返回");
  assertEq(stateOf({ state: g }), g, "传 rt 容器时取 .state");
  // 关键：g 上若有名为 state 的业务字段，不应被误判成 rt 容器
  const tricky = { state: "字符串不是容器", tip: "t" };
  assertEq(stateOf(tricky), tricky, "g.state 不是对象时不应当作 rt 容器");
  // strict 版本不回退
  assertEq(stateOfStrict(null), null);
  assertEq(stateOfStrict(g), g);
}

// floatText 采用 strict 语义：漏传 rt 时不画（且不回退全局）
export function floatTextDoesNotFallBackToGlobal() {
  const G = coreState.G;
  if (!G) return;
  const savedPlayer = G.player;
  // 把全局状态塞一个带 floats 的玩家
  G.player = { x: 0, y: 0, floats: [{ text: "999", x: 0, y: 0, alpha: 1, age: 0 }] };
  drawn.texts.length = 0;
  floatText.drawFloats();            // 不传 rt
  const withoutRt = drawn.texts.slice();
  drawn.texts.length = 0;
  floatText.drawFloats({ state: G });
  const withRt = drawn.texts.slice();
  G.player = savedPlayer;
  assertEq(withoutRt, [], "floatText 漏传 rt 时不应回退全局（故意不回退，便于发现漏传）");
  assert(withRt.length > 0, "传了 rt 时应画出浮动数字");
}

// 全面的「注入优先」扫描：对每个顶层绘制函数，喂一份空注入状态，
// 断言它不会读到全局状态里的"哨兵"值。
// 做法：在全局 G 上放一个会被画出来的哨兵（tip），调用各绘制函数（注入空状态），
// 若输出里出现哨兵文本，说明该函数绕过了注入。
export function noDrawFunctionReadsGlobalWhenInjected() {
  const G = coreState.G;
  if (!G) return;
  // 把全局里每个面板开关都打开（并在面板内容里放哨兵）：
  // 任何一个函数若绕过注入去读全局，就会把某项画出来 / 命中到非空结果。
  const panelKeys = ["waypointPanel", "stashPanel", "smithPanel", "diffPanel",
                     "mercPanel", "settingsPanel", "savePanel", "packOpen"];
  const saved = { tip: G.tip, tipT: G.tipT, dialog: G.dialog, panel: G.panel, shop: G.shop, scene: G.scene };
  for (const k of panelKeys) saved[k] = G[k];
  G.tip = "SENTINEL"; G.tipT = 99;
  G.dialog = { kind: "say", speaker: "SENTINEL", text: "SENTINEL", portrait: "NULL" };
  G.panel = "mission"; G.missions = { sentinel: { name: "SENTINEL", desc: "SENTINEL", got: 1, need: 2, state: 4 } };
  G.shop = { goods: ["SENTINEL"] };
  G.scene = "menu";
  for (const k of panelKeys) G[k] = true;
  // 命中测试还需要"有内容"才会进循环：仓库格数取自 G.stash.length，
  // 传送点行取自 waypointRows()（运行时内容 ∩ G.waypoints）。两个都给上哨兵。
  const savedStash = G.stash, savedWaypoints = G.waypoints;
  G.stash = [{ name: "SENTINEL" }, { name: "SENTINEL" }];
  G.waypoints = new Proxy({}, { get: () => true, has: () => true });

  const inj = mkInjectedState("注入");
  inj.tipT = 0; inj.tip = null; inj.dialog = null; inj.panel = null; inj.shop = null; inj.scene = "game";
  // 传送点行列表来自 rt.content.waypoints，注入侧也要有一份，
  // 否则"注入态列表为空"会让 waypointAt 永远返回 null，破坏检测失效。
  inj.content = { waypoints: [{ id: "SENTINEL", name: "SENTINEL", map: "SENTINEL", row: 0, col: 0 }] };
  inj.waypoints = {};  // 注入侧未解锁 → 即使读注入也不应命中
  // 把这些面板开关都关掉：如果某个函数读的是全局状态，
  // 就会把全局里的 panel 入口 / 对话框 / 商店哨兵画出来。
  inj.waypointPanel = false; inj.stashPanel = false; inj.smithPanel = false;
  inj.diffPanel = false; inj.mercPanel = false; inj.settingsPanel = false;
  inj.savePanel = false; inj.packOpen = false;

  const calls = [
    ["drawTip", () => panels.drawTip({ state: inj })],
    ["drawPanels", () => panels.drawPanels({ state: inj })],
    ["drawDialog", () => dialogUi.drawDialog({ state: inj })],
    ["drawShop", () => shopUi.drawShop({ state: inj })],
    ["drawTooltip", () => tooltip.drawTooltip({ state: inj })],
    ["drawHUD", () => hud.drawHUD({ state: inj })],
    ["drawPack", () => panels.drawPack({ state: inj })],
    ["drawStash", () => panels.drawStash({ state: inj })],
    ["drawSmith", () => panels.drawSmith({ state: inj })],
    ["drawDifficulty", () => panels.drawDifficulty({ state: inj })],
    ["drawMercPanel", () => panels.drawMercPanel({ state: inj })],
    ["drawWaypointPanel", () => panels.drawWaypointPanel({ state: inj })],
    ["drawSettingsPanel", () => panels.drawSettingsPanel({ state: inj })],
    ["drawScene", () => sceneUi.drawScene({ state: inj })],
  ];

  // 这些命中判定函数本轮新加了 rt 参数（原先是 P5 改造的漏网之鱼）。
  // 注入一个「全部面板关闭」的状态，它们必须一律返回空。
  // 取真实命中区域的中心点，避免"坐标 (0,0) 本来就不在任何格子内"导致的假通过：
  // 之前的写法用 (0,0)，即使函数去读全局也返回空，断言永远成立（等于没测）。
  const mid = r => r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : { x: 0, y: 0 };
  const ps = mid(panels.stashSlotRect(0));
  const pb = mid(panels.smithButtons()[0]);
  const pd = mid(panels.diffRowRect(0));
  const pm = mid(panels.mercRowRect(0));
  // waypointAt 前先让注入侧也解锁，构造"注入侧本可命中"的局面；
  // 若函数去读全局，返回的会是全局那条哨兵。
  // rt 的形状：.state 是游戏状态，.content 是运行时内容（waypointRows 读这里）。
  const injWp = { state: { ...inj, waypoints: { SENTINEL: 1 } }, content: inj.content };
  const hits = [
    ["stashSlotAt", () => panels.stashSlotAt(ps.x, ps.y, { state: inj })],
    ["smithButtonAt", () => panels.smithButtonAt(pb.x, pb.y, { state: inj })],
    ["diffRowAt", () => panels.diffRowAt(pd.x, pd.y, { state: inj })],
    ["mercRowAt", () => panels.mercRowAt(pm.x, pm.y, { state: inj })],
    // 传送点面板无从预先算出具体行，用面板中心
    ["waypointAt", () => { const b = panels.WP_BOX; return panels.waypointAt(b.x + b.w / 2, b.y + 60, injWp); }],
  ];
  const hitLeaked = [];
  for (const [name, fn] of hits) {
    let v;
    try { v = fn(); } catch (e) { v = "throw:" + e.message; }
    const empty = v === null || v === -1;
    if (!empty) hitLeaked.push(name + "→" + JSON.stringify(v));
  }

  const leaked = [];
  for (const [name, fn] of calls) {
    drawn.texts.length = 0;
    try { fn(); } catch (e) { /* 缺资源等不影响本断言 */ }
    if (drawn.texts.some(t => t.includes("SENTINEL"))) leaked.push(name);
  }

  Object.assign(G, saved);
  G.stash = savedStash; G.waypoints = savedWaypoints;
  assertEq(hitLeaked, [], "这些命中函数在注入状态下仍读到了全局状态: " + hitLeaked.join(","));
  assertEq(leaked, [], "这些函数在注入状态下仍读到了全局状态: " + leaked.join(","));
}
