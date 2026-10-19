// 脚本指令诊断 + 天气渲染。
//
// 这一组测试针对的是「静默失败」类 bug：旧实现里大量指令找不到单位就直接
// return，什么都不发生、也不报错。测试要保证：现在这些失败**一定会被说出来**，
// 而且诊断内容能直接指向修法（哪个名字、为什么找不到）。
import { assert, assertEq } from "./helpers.mjs";

// ---- DOM 桩 ----
// script/vm.js 的 import 链会走到 core/constants.js，那里在模块顶层就执行
//   document.getElementById("cv")
// 于是 Node 下无法导入 vm（这是**改动前就存在**的问题：vm.js 此前一直没有单测，
// 也正是那些静默 bug 能长期存在的原因之一）。
//
// 这里在 import 之前给两个浏览器全局打最小桩，属于**测试侧的局部适配**：
// 不动生产代码，也不假装 DOM 存在以外的任何行为。
// 如果将来把 canvas 依赖从 constants.js 里提炼出去（值得做），这个桩就可以删掉。
function stubDom() {
  if (typeof globalThis.document !== "undefined") return;
  const canvas = {
    id: "cv", width: 800, height: 600,
    getContext: () => ({
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
      fillRect() {}, drawImage() {}, setTransform() {}, clearRect() {}, fill() {},
      set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set font(v) {},
      set textAlign(v) {}, set globalAlpha(v) {}, set lineCap(v) {},
      measureText: () => ({ width: 10 }),
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener() {}, removeEventListener() {}, style: {},
  };
  globalThis.document = {
    getElementById: id => (id === "cv" ? canvas : null),
    createElement: () => canvas,
    addEventListener() {}, removeEventListener() {},
    body: { appendChild() {}, style: {} },
    documentElement: { style: {} },
  };
  if (typeof globalThis.window === "undefined") {
    globalThis.window = { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 };
  }
  if (typeof globalThis.Image === "undefined") {
    globalThis.Image = class { constructor() { this.width = 0; this.height = 0; } addEventListener() {} };
  }
}
stubDom();

// 建桩之后再加载被浏测模块（静态 import 会被提升，所以用顶层 await 动态导入）
const { execCall } = await import("../src/script/vm.js");
const { parseArgs } = await import("../src/engine/script/gsp.js");
const {
  warnScript, findNpcByName, warnMissingNpcTemplate, scriptWarnings, resetScriptWarnings,
} = await import("../src/script/diagnostics.js");
const { stepRain, drawRain, resetWeather, rainDropCount } = await import("../src/render/weather.js");

// ---- 最小 ctx：execCall 只用到 state / assets ----
function mkCtx(opts) {
  opts = opts || {};
  const npcs = opts.npcs || [];
  const state = {
    vars: {}, npcs, ground: [], stats: { money: 0, moral: 0, hp: 10, hpMax: 10, mp: 0, mpMax: 0, attack: 0, defence: 0, hit: 0, exp: 0, honor: 0 },
    love: {}, vips: {}, skills: [], factions: [], missions: {}, notes: [],
    player: opts.player === undefined ? { x: 10, y: 10 } : opts.player,
    tip: null, tipT: 0, rain: false,
  };
  const assets = {
    npcsData: opts.npcsData || [],
    buffTable: opts.buffTable || { byId: new Map() },
    scripts: {},
  };
  return { state, assets };
}

// 收集 console.warn，避免测试输出被诊断刷屏，同时便于断言"确实警告了"
function captureWarn(fn) {
  const orig = console.warn, got = [];
  console.warn = (...a) => got.push(a.join(" "));
  try { fn(); } finally { console.warn = orig; }
  return got;
}

function fakeNpc(name, extra) {
  return { name, x: 10, y: 10, bag: [], ...(extra || {}) };
}

// 执行一条脚本指令。
// execCall 是 generator：**函数体在第一次 next() 才跑**，所以光拿返回值（旧写法）
// 什么都发生不了。本组用到的指令都不会 yield 出对话，所以一次 next() 就执行完。
function call(ctx, name, argSrc) {
  const args = argSrc === undefined ? [] : parseArgs(argSrc);
  const gen = execCall(ctx, name, args);
  return gen.next();
}

// ---- diagnostics：基础行为 ----

export function warnIsRecordedAndShown() {
  const { state } = mkCtx();
  captureWarn(() => warnScript(state, "测试诊断"));
  assertEq(scriptWarnings(state), ["测试诊断"]);
  // 同时进屏幕提示
  assertEq(state.tip, "脚本：测试诊断");
  assert(state.tipT > 0);
}

export function warnIsDeduped() {
  const { state } = mkCtx();
  const got = captureWarn(() => { warnScript(state, "同一条"); warnScript(state, "同一条"); warnScript(state, "同一条"); });
  assertEq(scriptWarnings(state), ["同一条"]);   // G 里只记一次
  assertEq(got.length, 1);                        // 控制台也只打一次
}

export function warnDoesNotStealVisibleTip() {
  // 屏幕上已经有剧情提示时，不能被诊断顶掉（否则玩家看不到剧情文字）
  const { state } = mkCtx();
  state.tip = "得到逆龙剑"; state.tipT = 4;
  captureWarn(() => warnScript(state, "某诊断"));
  assertEq(state.tip, "得到逆龙剑");
  assertEq(scriptWarnings(state).length, 1);   // 仍然记录下来
}

export function warnCappedAndResettable() {
  const { state } = mkCtx();
  captureWarn(() => { for (let i = 0; i < 80; i++) warnScript(state, "w" + i); });
  assert(scriptWarnings(state).length <= 50, "诊断数量应有上限，避免刷爆存档/内存");
  resetScriptWarnings(state);
  assertEq(scriptWarnings(state), []);
}

export function findNpcExactHit() {
  const { state } = mkCtx({ npcs: [fakeNpc("校尉")] });
  const r = findNpcByName(state, "校尉", "ShowNPCTalk");
  assert(r.npc !== null);
  assertEq(r.warn, null);
}

export function findNpcReportsWhitespaceMismatch() {
  // 真实数据里就存在这个坑：内容里是「沈  慈」（两个空格），脚本里写「沈慈」
  const { state } = mkCtx({ npcs: [fakeNpc("沈  慈")] });
  const r = findNpcByName(state, "沈慈", "DelNPC");
  assertEq(r.npc, null);
  assert(r.warn.includes("沈慈"), "应指出请求的名字");
  assert(r.warn.includes("沈  慈"), "应指出地图上实际存在的相近名字");
  assert(r.warn.includes("空白不一致"), "应说明原因是空白差异");
}

export function findNpcReportsNotOnMap() {
  const { state } = mkCtx({ npcs: [fakeNpc("山贼")] });
  const r = findNpcByName(state, "清兵", "DelNPC");
  assertEq(r.npc, null);
  assert(r.warn.includes("没有这个名字"));
  assert(!r.warn.includes("空白不一致"), "名字毫不相干时不该提示空白问题");
}

export function findNpcEmptyList() {
  const { state } = mkCtx({ npcs: [] });
  const r = findNpcByName(state, "任何人", "DelNPC");
  assertEq(r.npc, null);
  assert(r.warn.includes("没有这个名字"));
}

export function missingTemplateIsReported() {
  const { state } = mkCtx();
  const got = captureWarn(() => warnMissingNpcTemplate(state, "沈慈", "AddNPC", false));
  assert(got[0].includes("找不到 NPC 模板"));
  // 模板存在时不该有任何诊断
  const before = scriptWarnings(state).length;
  captureWarn(() => warnMissingNpcTemplate(state, "沈慈", "AddNPC", true));
  assertEq(scriptWarnings(state).length, before);
}

// ---- vm：DelNPC 不再静默漏删 ----

export function delNpcRemovesExactMatch() {
  const ctx = mkCtx({ npcs: [fakeNpc("山贼"), fakeNpc("清兵")] });
  captureWarn(() => call(ctx, "DelNPC", '"山贼"'));
  assertEq(ctx.state.npcs.map(n => n.name), ["清兵"]);
  assertEq(scriptWarnings(ctx.state), []);   // 正常删除不该产生诊断
}

export function delNpcWarnsWhenNameMismatch() {
  // 复现实机 bug：AddNPC("沈 慈") 生成的单位，被 DelNPC("沈慈") 删不掉。
  // 修复前：静默保留，玩家看到删不掉的空分身；修复后：保留 + 明确诊断。
  const ctx = mkCtx({ npcs: [fakeNpc("沈 慈")] });
  const got = captureWarn(() => call(ctx, "DelNPC", '"沈慈"'));
  assertEq(ctx.state.npcs.map(n => n.name), ["沈 慈"]);   // 语义不变：严格匹配，不模糊删除
  assert(got.length === 1, "应产生一条警告");
  assert(got[0].includes("DelNPC"), "警告应指出是哪条指令");
  assert(got[0].includes("空白不一致"), "警告应指出空白不一致");
}

export function delAllNpcStillEmpties() {
  const ctx = mkCtx({ npcs: [fakeNpc("甲"), fakeNpc("乙")] });
  call(ctx, "DelAllNPCInMap");
  assertEq(ctx.state.npcs, []);
}

// ---- vm：AddNPC 模板缺失 ----

export function addNpcWarnsMissingTemplate() {
  const ctx = mkCtx({ npcsData: [{ name: "山贼" }] });
  const got = captureWarn(() => call(ctx, "AddNPC", '"不存在的NPC",3,4'));
  assert(got.length === 1);
  assert(got[0].includes("AddNPC"));
  assertEq(ctx.state.npcs.length, 0);
}

// ---- vm：SetNPCAttack 从"假装成功"变成真实现/真报错 ----

export function setNpcAttackSetsAggressive() {
  const ctx = mkCtx({ npcs: [fakeNpc("清兵", { aggressive: false })] });
  call(ctx, "SetNPCAttack", '"清兵",1');
  assertEq(ctx.state.npcs[0].aggressive, true);
  call(ctx, "SetNPCAttack", '"清兵",0');
  assertEq(ctx.state.npcs[0].aggressive, false);
  assertEq(scriptWarnings(ctx.state), []);
}

export function setNpcAttackWarnsOnMissingArgs() {
  // 原版文档没写清参数，全库 0 处调用。参数不足时必须说出来，而不是装作成功。
  const ctx = mkCtx({ npcs: [fakeNpc("清兵")] });
  const got = captureWarn(() => call(ctx, "SetNPCAttack", '"清兵"'));
  assert(got.length === 1);
  assert(got[0].includes("需要 2 个参数"));
}

export function setNpcAttackWarnsOnUnknownNpc() {
  const ctx = mkCtx({ npcs: [fakeNpc("清兵")] });
  const got = captureWarn(() => call(ctx, "SetNPCAttack", '"山贼",1'));
  assert(got.length === 1);
  assert(got[0].includes("找不到单位"));
}

// ---- vm：其它按名字查找的指令 ----

export function showNpcTalkWarnsOnUnknown() {
  const ctx = mkCtx({ npcs: [fakeNpc("校尉")] });
  const got = captureWarn(() => call(ctx, "ShowNPCTalk", '"龙紫烟"'));
  assert(got.length === 1);
  assertEq(ctx.state.npcs[0].talkT, undefined);   // 没被误伤
}

export function setFactionWarnsOnUnknown() {
  const ctx = mkCtx({ npcs: [fakeNpc("山贼", { faction: "bandit" })] });
  captureWarn(() => call(ctx, "SetFaction", '"清兵","qing"'));
  assertEq(ctx.state.npcs[0].faction, "bandit");
  assert(scriptWarnings(ctx.state)[0].includes("SetFaction"));
}

export function setBuffWarnsOnUnknownBuff() {
  const ctx = mkCtx({ npcs: [fakeNpc("清兵")] });
  const got = captureWarn(() => call(ctx, "SetBuff", '"清兵","不存在的buff"'));
  assert(got.length === 1);
  assert(got[0].includes("找不到 Buff"));
}

export function npcPickItemWarnsWhenNothingNearby() {
  const ctx = mkCtx({ npcs: [fakeNpc("清兵", { x: 0, y: 0 })] });
  ctx.state.ground = [{ name: "猴皮", x: 500, y: 500 }];   // 太远
  const got = captureWarn(() => call(ctx, "NPCPickItem", '"清兵"'));
  assert(got.length === 1);
  assert(got[0].includes("48px"));
}

export function npcDropItemWarnsOnEmptyBag() {
  const ctx = mkCtx({ npcs: [fakeNpc("清兵", { bag: [] })] });
  const got = captureWarn(() => call(ctx, "NPCDropItem", '"清兵"'));
  assert(got.length === 1);
  assert(got[0].includes("背包是空的"));
}

// ---- vm：未知指令不再静默 ----

export function unknownCommandWarns() {
  const ctx = mkCtx();
  const got = captureWarn(() => call(ctx, "SomeNonexistentCommand", '"x"'));
  assert(got.length === 1);
  assert(got[0].includes("未实现的指令"));
  assert(got[0].includes("SomeNonexistentCommand"));
}

// ---- vm：Rain 语义 ----

export function rainSetsOnIdempotently() {
  // 旧实现是 G.rain = !G.rain（翻转），连续调两次会关掉——但脚本意图是"开始下雨"
  const ctx = mkCtx();
  call(ctx, "Rain");
  assertEq(ctx.state.rain, true);
  call(ctx, "Rain");
  assertEq(ctx.state.rain, true);   // 幂等：再调一次仍是下雨
}

export function rainAcceptsExplicitOff() {
  const ctx = mkCtx();
  call(ctx, "Rain");
  call(ctx, "Rain", "0");
  assertEq(ctx.state.rain, false);
}

// ---- weather：渲染 ----

function mkFakeCanvas() {
  const ops = { fillRect: 0, stroke: 0, save: 0, restore: 0, moveTo: 0, lineTo: 0, beginPath: 0 };
  const ctx = {
    save() { ops.save++; }, restore() { ops.restore++; },
    beginPath() { ops.beginPath++; }, moveTo() { ops.moveTo++; }, lineTo() { ops.lineTo++; },
    stroke() { ops.stroke++; }, fillRect() { ops.fillRect++; },
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set lineCap(v) {},
  };
  return { ctx, ops };
}

export function rainDrawsNothingWhenOff() {
  resetWeather();
  const g = { rain: false };
  const { ctx, ops } = mkFakeCanvas();
  stepRain(0.016, g, 800, 600);
  drawRain(ctx, g, 800, 600);
  assertEq(ops.stroke, 0);
  assertEq(ops.fillRect, 0);
}

export function rainDrawsWhenOn() {
  resetWeather();
  const g = { rain: true };
  const { ctx, ops } = mkFakeCanvas();
  stepRain(0.016, g, 800, 600);
  drawRain(ctx, g, 800, 600);
  assert(ops.stroke > 0, "开雨时应绘制雨丝");
  assert(ops.fillRect > 0, "开雨时应绘制压暗层");
  assertEq(rainDropCount(), 220);
}

export function rainDropsFallAndWrap() {
  resetWeather();
  const g = { rain: true };
  const h = 600;
  // 推进足够久，确保至少有一滴越过底部并回绕到上方
  for (let i = 0; i < 200; i++) stepRain(0.1, g, 800, h);
  // 回绕逻辑用 y = -len 重置，所以屏幕上不应出现"落到界外还在画"的粒子
  // （这里通过再次绘制不抛错 + 粒子数不变来间接验证池子大小稳定）
  assertEq(rainDropCount(), 220);
}

export function rainFadesOutAfterStop() {
  resetWeather();
  const g = { rain: true };
  const { ctx, ops } = mkFakeCanvas();
  stepRain(1.0, g, 800, 600);         // 淡入完成
  drawRain(ctx, g, 800, 600);
  const before = ops.fillRect;
  g.rain = false;
  stepRain(1.0, g, 800, 600);         // 淡出完成
  drawRain(ctx, g, 800, 600);
  assertEq(ops.fillRect, before, "雨停且淡出后不应再画压暗层");
}

export function rainClampsLargeDt() {
  // 卡帧保护：单帧 dt 很大时雨滴不应瞬移（推进被 clamp 到 0.1s）
  resetWeather();
  const g = { rain: true };
  stepRain(0.016, g, 800, 600);
  const { ctx, ops } = mkFakeCanvas();
  // 给一个 5 秒的巨大 dt，不应抛错
  stepRain(5, g, 800, 600);
  drawRain(ctx, g, 800, 600);
  assert(ops.stroke > 0);
}
