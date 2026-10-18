// 编辑器共享上下文（P5 拆分 index.js 的底座）。
//
// 背景：index.js 已经 1500+ 行，且所有标签页都直接闭包引用同几个变量
// （mainEl / ED / mark / assetSrc / assetSrc2 ...）。要按页拆分，
// 先得把这几个"会话级"状态从闭包里搬出来，变成可导入的单一实例。
//
// 约定：
//   - 只放**编辑器会话状态**与最通用的取值函数（不要放某个标签页专属的）。
//   - 页面模块通过 `edCtx()` 拿快照，不要各自 import index.js（会成环）。
//   - index.js 在启动时 `initEditorCtx(...)` 一次。
import { A } from "../core/state.js";
import { assetURL } from "../core/assets.js";
import { h } from "./dom.js";

let state = {
  root: null,
  ED: null,
  dirty: false,
  curTab: "maps",
  mainEl: null,
  sideEl: null,
  statusEl: null,
  mapEditor: null,
  mark: () => {},
  roleSrc: () => null,
  assetSrc: p => p,
};

// index.js 启动时调用：把自己闭包里的初始值交出来，之后的读写都走这里。
//
// ⚠ 必须用 defineProperties 而不是 Object.assign —— 传进来的是 getter
// （`get mainEl() { return mainEl; }`），Object.assign 会**立刻求值**并写成
// 普通属性，于是拿到的是初始化那一刻的 undefined，之后再也不更新。
// 表现为：拆分出去的页面 `edCtx().mainEl.append(...)` 直接崩。
export function initEditorCtx(next) {
  for (const k of Object.keys(next)) {
    const d = Object.getOwnPropertyDescriptor(next, k);
    // getter 原样搬过来（保持"每次读都拿最新值"）；普通值直接覆盖。
    // 注意 defineProperty 不能同时给 get 与 value，必须分支。
    const desc = d.get
      ? { get: d.get, configurable: true, enumerable: true }
      : { value: next[k], configurable: true, enumerable: true, writable: true };
    Object.defineProperty(state, k, desc);
  }
  return state;
}

// 页面模块读取当前会话状态。每次调用都拿最新值（不要缓存）。
export function edCtx() {
  return state;
}

// 常用句柄的快捷读取（页面里用得多，避免到处 `edCtx().ED`）。
export function edProject() { return state.ED; }
export function edMain() { return state.mainEl; }
export function edMark() { state.mark(); }

// 资源覆盖解析：assets 路径 → dataURL（有上传覆盖时），否则原路径。
export function assetSrc(p) {
  const ED = state.ED;
  return (ED && ED.images && ED.images[p]) || assetURL(p);
}

// 行走图缩略图：由角色模型名推导首帧图片。
export function roleSrc(model) {
  const m = String(model || "").replace(/\.pmg$/, "");
  const ch = A.chars && A.chars[m];
  if (!ch) return null;
  const blocks = ch.stand || ch.walk;
  const b = blocks && blocks[0] && blocks[0];
  return (b && b.length) ? assetSrc("assets/role/" + b[0].replace(/\.bmp$/, ".png")) : null;
}

// 缩略图 URL：值可能是纯文件名（老数据）也可能是完整 assets/ 路径。
export function assetSrc2(ref, dir) {
  if (!ref) return null;
  const s = String(ref);
  if (/^(data:|blob:|https?:)/i.test(s)) return s;
  if (s.startsWith("assets/")) return assetSrc(s);
  return assetSrc("assets/" + String(dir).replace(/\/$/, "") + "/" + s.replace(/\.bmp$/i, ".png"));
}

// ---------- 表单小工具 ----------
// 这些原先散在 index.js 里，被多个标签页共用；拆页后放这里最合适。
export const rfield = (label, ctl) => h("div", { class: "ed-row" }, h("label", null, label), ctl);
export const rhint = t => h("div", { class: "ed-hint" }, t);
export function rnum(val, on) {
  const i = h("input", { type: "number", value: val });
  i.oninput = () => on(Number(i.value) || 0);
  return i;
}
