// 架构检查：把分层依赖规则变成可执行约束（CI / 本地均可跑）。
//   node tools/check-arch.mjs
// 规则：
//  1) 运行时状态由 runtime/context.js 拥有；core/state.js 只做兼容再导出。
//  2) engine/ 为纯层：不得依赖 systems/world/render/input/editor/runtime，且不得含 DOM/BOM。
//  3) content/ 不得依赖 systems/world/render/input/editor/runtime（versions-ui 为 UI 例外）。
import { readdirSync, readFileSync, statSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}
const rel = p => path.relative(ROOT, p).replace(/\\/g, "/");
const read = p => readFileSync(p, "utf8");
const files = walk(path.join(ROOT, "src"));
const issues = [];

// 1) 状态归属
const stateSrc = read(path.join(ROOT, "src/core/state.js"));
if (/stats\s*:/.test(stateSrc) || /export\s+const\s+G\b/.test(stateSrc)) issues.push("core/state.js 不应声明运行时状态（应再导出 runtime/context.js）");
const ctxSrc = read(path.join(ROOT, "src/runtime/context.js"));
for (const name of ["G", "A", "MAPS"]) {
  if (!new RegExp("export\\s+let\\s+" + name + "\\b").test(ctxSrc)) issues.push("runtime/context.js 应声明 export let " + name);
}

// 2) engine 纯层
const UP = /\/(systems|world|render|input|editor|runtime)\//;
for (const f of files.filter(f => rel(f).startsWith("src/engine/"))) {
  const t = read(f);
  for (const m of t.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (UP.test("/" + m[1] + "/") || /core\/state/.test(m[1])) issues.push("engine 依赖上层：" + rel(f) + " -> " + m[1]);
    // 引擎必须通用：不得依赖具体游戏资料（content/）或核心装配（core/）。
    if (/\/content\//.test("/" + m[1] + "/") || /\/core\//.test("/" + m[1] + "/")) issues.push("engine 依赖具体资料：" + rel(f) + " -> " + m[1]);
  }
  if (/\b(document|window|localStorage|indexedDB)\b/.test(t)) issues.push("engine 含 DOM/BOM：" + rel(f));
}

// 3) content 不依赖上层（versions-ui 例外）
for (const f of files.filter(f => rel(f).startsWith("src/content/") && !rel(f).endsWith("versions-ui.js"))) {
  const t = read(f);
  for (const m of t.matchAll(/from\s+["']([^"']+)["']/g)) {
    if (UP.test("/" + m[1] + "/")) issues.push("content 依赖上层：" + rel(f) + " -> " + m[1]);
  }
}

// 4) 逻辑层（systems/world/script）不得直接 import 运行时状态单例（应接收 ctx/g）
for (const f of files.filter(f => /^src\/(systems|world|script)\//.test(rel(f)))) {
  if (/from\s+["'][^"']*core\/state\.js["']/.test(read(f))) issues.push("逻辑层依赖全局状态：" + rel(f));
}

// 5) 数据表查询必须显式传上下文：itemByName(ctx, name) / skillByName(ctx, name)
//    单参形式（依赖全局 A）是迁移期的兼容路径，新代码不许再用——
//    它会让调用方隐式绑到全局状态，正是 P5 要拆掉的东西。
for (const f of files) {
  const t = read(f);
  if (rel(f) === "src/core/registry.js") continue;
  for (const m of t.matchAll(/(itemByName|skillByName)\(\s*(["'`]|[A-Za-z_$][\w$]*\s*[,)])/g)) {
    // 形如 itemByName("xxx") 或 itemByName(x) 单参 = 未传上下文
    const after = m[2];
    const single = /^["'`]/.test(after) || after.includes(")");
    if (single) issues.push("数据表查询未传上下文：" + rel(f) + " -> " + m[1] + "(" + after.replace(/[,)]/g, "") + "…)");
  }
}

// 6) 视图层（render/input）不得直接 import 全局资产表 A。
//    资产表是纯数据，视图层应当由调用方注入（render(rt) / 各 draw 函数收 rt），
//    否则离屏渲染、单测、多实例都无从下手。
for (const f of files.filter(f => /^src\/(render|input)\//.test(rel(f)))) {
  const t = read(f);
  // 只看 import 语句里的具名导入，避免误伤注释与字符串
  for (const m of t.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']*core\/state\.js)["']/g)) {
    if (m[1].split(",").some(x => x.trim() === "A")) {
      issues.push("视图层直接依赖全局 A：" + rel(f));
      break;
    }
  }
}

if (issues.length) {
  console.error("✗ 架构检查未通过：\n- " + issues.join("\n- "));
  process.exit(1);
}
console.log("✓ 架构检查通过（扫描 " + files.length + " 个模块）");
