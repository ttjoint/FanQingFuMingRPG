// 入口页回归：sessionStorage 遗留键不应让刷新后跳过引擎入口页。
//
// 历史：wantedVersion() 会读 sessionStorage 里记的版本，粒度是整个标签页
// 会话 —— 玩家进过一次游戏后，同一标签页刷新/重开就直接跳进游戏，
// 引擎入口页再也看不到。修复：改成模块级变量（编辑器返回不重载页面，
// 本就不需要持久化）；sessionStorage 旧键被忽略。
//
// 这里通过 import 查询参数做静态验证不可行（main.js 是浏览器入口），
// 改为验证源码不再引用 sessionStorage。
import { readFileSync } from "node:fs";

export function entryPageNotSkippedBySessionStorage() {
  const src = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  if (src.includes("sessionStorage")) throw new Error("main.js 不应再用 sessionStorage 记住版本（会导致刷新后跳过入口页）");
  if (!src.includes("let sessionVersion")) throw new Error("main.js 应使用模块级 sessionVersion 变量");
  return;
}

export function quitReturnsToLauncherNotTitle() {
  const src = readFileSync(new URL("../src/input/input.js", import.meta.url), "utf8");
  if (!src.includes("quitToEngine")) throw new Error("退出游戏应走 quitToEngine（回引擎入口页）");
  // 退出必须清掉 ?ver=，否则重载后 wantedVersion() 又直接进游戏
  if (!src.includes('searchParams.delete("ver")')) throw new Error("quitToEngine 必须删除 URL 的 ?ver= 参数，否则重载后又直接进游戏");
  // 不应再调用 enterMenu 当作退出（标题菜单不是引擎入口页）
  const m = src.match(/function quitToEngine[\s\S]{0,900}/);
  if (m && m[0].includes("enterMenu")) throw new Error("quitToEngine 不应回游戏标题菜单");
  return;
}
