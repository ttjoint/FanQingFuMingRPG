// 编辑器共享上下文（拆 index.js 的底座）。
//
// 这里唯一容易错、而且错了很难查的点：**getter 必须原样搬过去**。
// index.js 传进来的是 `get mainEl() { return mainEl; }` 这种访问器，
// 因为 mainEl 在 buildShell() 之后才被赋值。如果用 Object.assign 搬运，
// 会立刻求值成初始化那一刻的 undefined，之后永远不更新——
// 表现为拆分出去的页面 `edCtx().mainEl.append(...)` 直接崩溃，
// 而崩的位置离原因很远（在那个页面里，看起来像页面自己的问题）。
import assert from "node:assert/strict";
import { initEditorCtx, edCtx, edProject, edMark } from "../src/editor/ed-ctx.js";

function fresh() {
  // 每个用例先复位成一个干净的上下文
  initEditorCtx({
    ED: null, dirty: false,
    mainEl: undefined,
    mark: () => {},
  });
}

export function gettersStayLive() {
  fresh();
  let mainEl = undefined;
  let marked = 0;
  initEditorCtx({
    get mainEl() { return mainEl; },
    mark: () => { marked++; },
  });
  // 初始化时还没赋值 → 读出来就是 undefined，这是对的
  assert.equal(edCtx().mainEl, undefined);
  // 之后赋值 → 必须能读到新值（Object.assign 搬运会在这里失败）
  mainEl = { tag: "main" };
  assert.equal(edCtx().mainEl.tag, "main");
  assert.equal(edProject(), null);
}

export function plainValuesAreCopied() {
  fresh();
  const ED = { id: "v1" };
  initEditorCtx({ ED });
  assert.equal(edProject().id, "v1");
}

export function markIsCallable() {
  fresh();
  let n = 0;
  initEditorCtx({ mark: () => { n++; } });
  edCtx().mark();
  edCtx().mark();
  assert.equal(n, 2);
}

export function markHelperDoesNotThrow() {
  fresh();
  initEditorCtx({ mark: () => {} });
  edMark();   // 默认实现也必须安全
}

export function ctxIsSingleton() {
  fresh();
  assert.equal(edCtx(), edCtx(), "edCtx 必须返回同一个实例，页面之间共享状态");
}
