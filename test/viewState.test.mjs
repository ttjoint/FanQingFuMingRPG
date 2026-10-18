// 视图层的状态注入契约（P5）。
//
// render/input 原先直接 import 全局 A 与 G。assets 部分是纯数据，必须能注入；
// state 部分（input.js 的 100+ 处 G.xxx）用"绑定一次"的方式处理。
//
// 这里验证的是**契约**而不是绘制结果：
//   - 各 draw 函数接受 rt 并声明用 stateOf(rt) 取状态
//   - render() 把 rt 透传下去
//   - input 绑定后所有 G 读写都作用在绑定实例上
// 绘制结果由 E2E 的像素护栏负责。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = p => readFileSync(path.join(ROOT, p), "utf8");

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

// render/input 不得再 import 全局 A（check-arch 规则 6 的镜像断言）
export function noViewImportsGlobalAssets() {
  const files = ["src/render/tooltip.js", "src/render/shop-ui.js", "src/render/hud.js",
                 "src/render/renderer.js", "src/render/effects.js", "src/render/panels.js",
                 "src/render/scene-ui.js", "src/render/dialog-ui.js",
                 "src/input/input.js", "src/input/slots.js"];
  for (const f of files) {
    assert(!stateImports(read(f)).includes("A"), f + " 不应 import 全局 A");
  }
}

// 元件的绘制函数都应接受 rt，并用 stateOf(rt) 取状态
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
      assert(sh.body.includes("stateOf(rt)"), f + " 的 " + fn + " 应在函数体开头用 stateOf(rt) 取状态");
    }
  }
}

// render() 必须把 rt 透传下去，否则各绘制函数仍会各自回退到全局
export function renderPassesRtDown() {
  const t = read("src/render/renderer.js");
  assert(/export function render\(rt\)/.test(t), "render 应接受 rt");
  for (const fn of ["drawHUD", "drawPanels", "drawPack", "drawShop", "drawTooltip", "drawScene"]) {
    assert(t.includes(fn + "(rt)"), "render 应把 rt 传给 " + fn);
  }
  // 不应再出现旧的整串无参调用
  assert(!t.includes("drawHUD();"), "render 不应再以无参形式调用 drawHUD");
}

// input.js 的绑定：入口收 rt，所有 G 读写都经当前绑定
export function inputBindsRuntime() {
  const t = read("src/input/input.js");
  assert(t.includes("export function addInput(rt)"), "addInput 应收 rt");
  assert(t.includes("bindState(rt)"), "addInput 应绑定状态");
  assert(t.includes("BOUND || GLOBAL_STATE"), "未绑定时应回退全局（保持既有行为）");
  // 不能再直接 import 全局 G（否则绑定形同虚设）
  assert(!stateImports(t).includes("G"), "input.js 不应 import 全局 G");
}

// 绑定后的读写必须落在绑定实例上，而不是全局
export function bindingRedirectsState() {
  const t = read("src/input/input.js");
  assert(t.includes("const G = new Proxy"), "应以 Proxy 转发 G 的读写");
  assert(t.includes("set(_t, k, v)"), "Proxy 应把写入转发给绑定实例");
  assert(t.includes("get(_t, k)"), "Proxy 应把读取转发给绑定实例");
}

// main.js 必须把 runtime 传进去，否则绑定永远不生效
export function mainInjectsRuntime() {
  const t = read("src/main.js");
  assert(t.includes("addInput(runtime)"), "main 应把 runtime 传给 addInput");
  assert(t.includes("render(runtime)"), "main 应把 runtime 传给 render");
}
