// 回归：ChangeMap 出现在脚本中间时，后续语句必须继续执行。
//
// 历史缺陷：src/world/map.js 的 loadMap() 无条件 `G.script = null`。
// 原版 GSP 里 ChangeMap 大量用在脚本**中间**（切图后接着放剧情、发任务），
// 一旦脚本栈被清，stepScript() 下一句就被 `if (!G.script) return` 拦掉，
// 剩下的语句全部静默丢弃。
//
// 实测证据：造脚本 Say→ChangeMap→Say→Say，修复前只播「第1句」「第2句」，
// 「第3句」丢失。受影响最严重的是 鳌拜_死.gsp —— 它 ChangeMap 之后
// 才是 AddMission("保卫扬州")，丢了就主线断死（打完成功却接不到下一环）。
//
// 修复方式：loadMap 只在「非脚本切图」时清脚本栈，用 G._inScriptChangeMap
// 标记区分（ChangeMap 指令执行期间置位，try/finally 复位）。
import { strict as assert } from "assert";
import fs from "fs";
import { parseGSP } from "../src/engine/script/gsp.js";

const MAP_SRC = fs.readFileSync(new URL("../src/world/map.js", import.meta.url), "utf8");
const VM_SRC = fs.readFileSync(new URL("../src/script/vm.js", import.meta.url), "utf8");
const SCRIPTS = JSON.parse(fs.readFileSync(new URL("../versions/default/assets/scripts.json", import.meta.url), "utf8"));

function callNames(src) {
  const names = [];
  (function walk(nodes) {
    for (const n of nodes || []) {
      if (n.type === "call" && n.name !== "end") names.push(n.name);
      if (n.then) walk(n.then);
      if (n.else) walk(n.else);
    }
  })(parseGSP(src));
  return names;
}

export function changeMapKeepsFollowingStatements() {
  // 解析阶段不能丢：ChangeMap 前后的 Say 都必须在 AST 里
  const names = callNames('Say("A","一","NULL")\n\nChangeMap("扬州.map",25,25,1)\n\nSay("A","二","NULL")\n\nSay("A","三","NULL")\n\nend');
  assert.deepEqual(names, ["Say", "ChangeMap", "Say", "Say"], "ChangeMap 前后的 Say 都必须在 AST 里");
}

export function loadMapClearsScriptOnlyOutsideScript() {
  assert.ok(/_inScriptChangeMap/.test(MAP_SRC), "loadMap 需用 _inScriptChangeMap 区分脚本内切图");
  assert.ok(/if \(!G\._inScriptChangeMap\) G\.script = null/.test(MAP_SRC),
    "清脚本栈必须带条件：if (!G._inScriptChangeMap) G.script = null");
  assert.ok(!/^\s{2}G\.script = null;\s/m.test(MAP_SRC), "不得再有无条件的 G.script = null");
}

export function changeMapInstructionSetsFlag() {
  const i = VM_SRC.indexOf('case "ChangeMap"');
  assert.ok(i > 0, "必须存在 ChangeMap 分支");
  const seg = VM_SRC.slice(i, i + 500);
  assert.ok(/_inScriptChangeMap = true/.test(seg), "ChangeMap 执行前要置位标记");
  assert.ok(/finally/.test(seg), "标记要用 try/finally 复位，异常时不能漏掉");
}

export function scriptsWithChangeMapMidwayAreKnown() {
  // 这些脚本在 ChangeMap 之后还有有效指令 —— 正是依赖本修复才不丢剧情。
  // 锁死它们，防止以后有人「优化」掉 _inScriptChangeMap 却没人发现。
  const critical = ["鳌拜_死.gsp", "多尔衮_死.gsp", "清军大营.gsp", "平原到扬州.gsp"];
  for (const name of critical) {
    const src = SCRIPTS[name];
    assert.ok(src, `脚本 ${name} 必须存在`);
    const lines = src.split("\n").filter(l => l.trim());
    const ci = lines.findIndex(l => /ChangeMap\(/.test(l));
    assert.ok(ci >= 0, `${name} 应含 ChangeMap`);
    const after = lines.slice(ci + 1).filter(l => l.trim() && !/^(end|exit)$/.test(l.trim()));
    assert.ok(after.length > 0, `${name} 在 ChangeMap 之后还有 ${after.length} 条语句，依赖脚本栈不被清空`);
  }
}
