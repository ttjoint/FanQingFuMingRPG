// 脚本指令诊断：把「静默失败」变成「可定位的警告」。
//
// 背景：GSP 解释器（vm.js）里大量指令是按名字查找单位的，例如
//   DelNPC("沈慈") / ShowNPCTalk("校尉") / SetFaction("山贼","enemy")
// 查找一律用严格相等。一旦脚本里的名字与内容数据不一致（最常见的是空白差异，
// 例如内容里是「沈  慈」两个空格、脚本里写「沈慈」），结果是**什么都不发生**：
// 不报错、不提示、剧情照常往下走，但那个单位还在原地。
//
// 这类 bug 在实机里极难发现（画面正常、无 console 错误），却会留下删不掉的
// 分身、永远无法完成的任务目标。这里提供一套统一的诊断接口：
//   - warnScript(state, msg)  -> 同时写 console.warn 与屏幕提示（开发期可见）
//   - findNpcByName(state, nm) -> 带「名字相近」提示的查找
//
// 设计取舍：**不改数据、不改语义**。名字不一致本身是数据 bug，
// 不应该由运行时擅自「模糊匹配」蒙过去（那会让编辑器里的错误永远暴露不出来）。
// 运行时只负责把它说出来，修数据是编辑器的活（见 content/schema.js 的 lintNames）。

// 把诊断同时送到两个地方：
//   1) console.warn —— 开发者/CI 在控制台能看到
//   2) G.tip + G.tipT —— 玩家/测试也能在画面上看到（复用既有的提示通道）
// 另存一份到 G.scriptWarns，便于 E2E 断言「这次运行到底报了什么」。
const MAX_WARNS = 50;

export function warnScript(state, msg) {
  if (!state) return;
  if (!state.scriptWarns) state.scriptWarns = [];
  // 去重：同一个问题在同一局里通常会被触发很多次（每次对话都跑一遍脚本）
  if (state.scriptWarns.includes(msg)) return;
  if (state.scriptWarns.length < MAX_WARNS) state.scriptWarns.push(msg);
  if (typeof console !== "undefined" && console.warn) console.warn("[脚本] " + msg);
  // 屏幕提示：不要让一条诊断把正要显示的剧情提示顶掉，所以只在没有提示时占用
  if (!state.tip) { state.tip = "脚本：" + msg; state.tipT = 4; }
}

// 按名字找单位，找不到时给出可操作的诊断。
//
// 返回 { npc, warn }：npc 为 null 时 warn 是原因描述。
// 与「模糊匹配」的区别：这里**只诊断、不兜底**。找不到就是找不到。
export function findNpcByName(state, name, what) {
  const list = (state && state.npcs) || [];
  const hit = list.find(n => n.name === name);
  if (hit) return { npc: hit, warn: null };

  // 找不到：构造一条能直接定位问题的描述。
  const squeezed = String(name).replace(/\s+/g, "");
  const near = [...new Set(list.map(n => n.name))]
    .filter(n => String(n).replace(/\s+/g, "") === squeezed);
  let msg = (what || "指令") + " 找不到单位「" + JSON.stringify(name) + "」";
  if (near.length) msg += "；当前地图有名字相近的 " + near.map(n => JSON.stringify(n)).join("/") + "（空白不一致）";
  else msg += "；当前地图没有这个名字";
  return { npc: null, warn: msg };
}

// 给「按名字生成单位」用：模板不存在时诊断。
export function warnMissingNpcTemplate(state, name, what, exists) {
  if (exists) return;
  const msg = (what || "AddNPC") + " 找不到 NPC 模板「" + JSON.stringify(name) + "」，不会生成任何单位";
  warnScript(state, msg);
}

// 读取当前累积的诊断（测试/调试用）。
export function scriptWarnings(state) {
  return ((state && state.scriptWarns) || []).slice();
}

// 清空诊断（切图/读档时调用，避免上一局的诊断混进来）。
export function resetScriptWarnings(state) {
  if (state) state.scriptWarns = [];
}
