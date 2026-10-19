import { normalizeNpc, normalizeConfig, validateContent, CONTENT_VERSION } from "../src/content/schema.js";
import { assert, assertEq } from "./helpers.mjs";

export function npcDefaults() {
  const n = normalizeNpc({ id: 5, name: "x" });
  assertEq(n.speed, 45);
  assertEq(n.runSpeed, 70);
  assert(Array.isArray(n.drops) && n.drops.length === 0, "drops 应为空数组");
  assert(Array.isArray(n.skills), "skills 应为数组");
}

export function npcSkillsPollution() {
  // 旧数据里 skills 是错位的台词文本，规整后应被过滤为空
  const n = normalizeNpc({ id: 1, skills: "原来是之望啊！\n你娘跟我" });
  assertEq(n.skills, []);
}

export function configMerge() {
  const c = normalizeConfig({ player: { hpMax: 999 } });
  assertEq(c.player.hpMax, 999);
  assertEq(c.levelUp.expMul, 1.5);
  assertEq(c.combat.rangeMin, 40);
}

export function validateClean() {
  const issues = validateContent({ schemaVersion: CONTENT_VERSION, npcs: {}, items: {}, skills: {}, scripts: {} });
  assertEq(issues, []);
}

export function dropsNormalized() {
  const n = normalizeNpc({ id: 2, drops: [{ name: "猴皮" }, { name: "", count: 3 }] });
  assertEq(n.drops.length, 1);
  assertEq(n.drops[0].count, 1);
}

// ---- 内容 lint（schema.js）----
// 结构校验（validateContent）只能发现 id/类型不对；下面这些是「合法 JSON、
// 但游戏行为明显错误」的情况，必须靠 lint 才能暴露。
import { lintContent, lintContentDetailed, lintNames, lintNumbers, lintAiRefs, lintDropRefs, lintEmptyDrops, lintScriptRefs } from "../src/content/schema.js";

export function lintNamesCatchesWhitespace() {
  const issues = lintNames([{ id: 1, name: "沈慈" }, { id: 39, name: "沈  慈" }], "NPC");
  assert(issues.some(s => s.includes("连续空白")), "应报连续空白：" + issues.join(" / "));
  assert(issues.some(s => s.includes("沈慈")), "应给出规整后的建议名");
}

export function lintNamesCatchesDuplicate() {
  const issues = lintNames([{ id: 1, name: "甲" }, { id: 2, name: "甲" }], "NPC");
  assert(issues.some(s => s.includes("重复")), "应报重名：" + issues.join(" / "));
}

export function lintNamesCleanPasses() {
  assertEq(lintNames([{ id: 1, name: "孙之望" }, { id: 2, name: "龙绝尘" }], "NPC"), []);
}

export function lintNumbersCatchesSentinel() {
  const issues = lintNumbers([{ name: "校尉", level: 4294967295 }], "NPC");
  assert(issues.some(s => s.includes("哨兵值")), "应报 0xFFFFFFFF：" + issues.join(" / "));
}

export function lintNumbersCatchesNegativeAndNaN() {
  const issues = lintNumbers([{ name: "A", hp: -5 }, { name: "B", attack: NaN }], "NPC");
  assert(issues.some(s => s.includes("负数")), "应报负数");
  assert(issues.some(s => s.includes("不是有效数字")), "应报 NaN");
}

export function lintNumbersCleanPasses() {
  assertEq(lintNumbers([{ name: "A", level: 3, hp: 100, attack: 20, defence: 5, exp: 11 }], "NPC"), []);
}

export function lintAiRefsCatchesMissing() {
  const ais = [{ id: "bandit" }, { id: "soldier" }];
  const issues = lintAiRefs([{ name: "山贼", ai: "bandit" }, { name: "鬼", ai: "ghost" }], ais);
  assertEq(issues.length, 1, "只应报一条：" + issues.join(" / "));
  assert(issues[0].includes("ghost"), "应指名缺失的 AI");
}

// AI 表里 id 是标识、name 是显示名：用显示名匹配会全部误报
export function lintAiRefsUsesIdNotName() {
  const ais = [{ id: "bandit", name: "强盗（主动）" }];
  assertEq(lintAiRefs([{ name: "山贼", ai: "bandit" }], ais), [], "按 id 匹配应通过");
  assert(lintAiRefs([{ name: "山贼", ai: "强盗（主动）" }], ais).length === 1, "按显示名不应被当作有效引用");
}

export function lintDropRefsCatchesMissing() {
  const items = [{ name: "金创药" }];
  const issues = lintDropRefs([{ name: "山贼", drops: [{ name: "金创药" }, { name: "屠龙刀" }] }], items);
  assertEq(issues.length, 1);
  assert(issues[0].includes("屠龙刀"), "应指名缺失的物品");
}

export function lintEmptyDropsOnlyForFighters() {
  // 只有能打的（attack>0）才提示；村民不该刷屏
  const issues = lintEmptyDrops([
    { name: "村民", attack: 0 },
    { name: "清兵", attack: 80 },
  ]);
  assertEq(issues.length, 1, "只有 attack>0 的才提示：" + issues.join(" / "));
  assert(issues[0].includes("清兵"));
}

export function lintScriptRefsCatchesWhitespaceMismatch() {
  // 数据里只有「沈慈」，脚本里写「沈 慈」-> 运行时会生成一个删不掉的同名变体
  const scripts = { "a.gsp": 'AddNPC("沈 慈",19,9)\nDelNPC("沈慈")' };
  const issues = lintScriptRefs(scripts, [{ name: "沈慈" }]);
  assertEq(issues.length, 1, "只应报 AddNPC 那条：" + issues.join(" / "));
  assert(issues[0].includes("AddNPC"), "应指明指令");
  assert(issues[0].includes("空白不一致"), "应提示空白相近：" + issues[0]);
}

export function lintScriptRefsCatchesMissingUnit() {
  const scripts = { "a.gsp": 'DelNPC("查无此人")' };
  const issues = lintScriptRefs(scripts, [{ name: "孙之望" }]);
  assertEq(issues.length, 1);
  assert(issues[0].includes("查无此人"));
}

export function lintScriptRefsIgnoresNonUnitCalls() {
  // Say/LoadMap 等不是按名引用单位，不该被检查
  const scripts = { "a.gsp": 'Say("龙绝尘","你好")\nLoadMap("孙家庄.map",1,1,5)' };
  assertEq(lintScriptRefs(scripts, [{ name: "孙之望" }]), []);
}

export function lintContentDetailedLevels() {
  const d = lintContentDetailed({
    npcs: [{ id: 1, name: "沈  慈", level: 4294967295, attack: 80 }],
    items: [], ais: [], scripts: {},
  });
  const errs = d.filter(x => x.level === "error"), warns = d.filter(x => x.level === "warning");
  assert(errs.some(x => x.msg.includes("连续空白")), "脏名应为 error");
  assert(warns.some(x => x.msg.includes("哨兵值")), "哨兵值应为 warning");
  assert(warns.some(x => x.msg.includes("没有掉落表")), "空掉落应为 warning");
}

export function lintContentPrefixes() {
  const msgs = lintContent({ npcs: [{ id: 1, name: "甲  甲" }], items: [], ais: [], scripts: {} });
  assert(msgs.some(m => m.startsWith("[错误]")), "error 应带前缀：" + msgs.join(" / "));
}

// ---- validateContent：地图尺寸自洽 + lint 开关 ----

// 非方形地图：图层长度必须等于 w*h 而不是 w*w（否则 flags 会静默错行）
export function validateRectMapLayerLength() {
  const ok = validateContent({
    schemaVersion: CONTENT_VERSION, npcs: {}, items: {}, skills: {}, scripts: {},
    mapDocs: { rect: { width: 5, height: 3, ground: new Array(15).fill([0, 0]), collision: new Array(15).fill(1) } },
  }, null, { lint: false });
  assertEq(ok, [], "长宽一致的 5×3 图应通过：" + ok.join(" / "));

  const bad = validateContent({
    schemaVersion: CONTENT_VERSION, npcs: {}, items: {}, skills: {}, scripts: {},
    // 长度按旧习惯写成 w*w = 25，实际应为 15
    mapDocs: { rect: { width: 5, height: 3, ground: new Array(25).fill([0, 0]) } },
  }, null, { lint: false });
  assert(bad.some(s => s.includes("ground") && s.includes("5×3")), "应报 ground 长度不符：" + bad.join(" / "));
}

export function validateMapSizeInvalid() {
  const issues = validateContent({
    schemaVersion: CONTENT_VERSION, npcs: {}, items: {}, skills: {}, scripts: {},
    mapDocs: { bad: { width: 0, height: 0 } },
  }, null, { lint: false });
  assert(issues.some(s => s.includes("尺寸非法")), "应报尺寸非法：" + issues.join(" / "));
}

// lint 默认开：脏名会出现在 validateContent 的结果里
export function validateRunsLintByDefault() {
  const c = { schemaVersion: CONTENT_VERSION, npcs: { "1": { id: 1, name: "甲  甲" } }, items: {}, skills: {}, scripts: {} };
  const on = validateContent(c, null);
  assert(on.some(s => s.includes("连续空白")), "默认应跑 lint：" + on.join(" / "));
  const off = validateContent(c, null, { lint: false });
  assert(!off.some(s => s.includes("连续空白")), "lint:false 应关掉：" + off.join(" / "));
}

// 非 strict 只报 error；strict 把 warning 也算上
export function validateStrictIncludesWarnings() {
  const c = { schemaVersion: CONTENT_VERSION, npcs: { "1": { id: 1, name: "清兵", attack: 80, level: 4294967295 } }, items: {}, skills: {}, scripts: {} };
  const normal = validateContent(c, null);
  const strict = validateContent(c, null, { strict: true });
  assert(!normal.some(s => s.includes("哨兵值")), "非 strict 不应报 warning：" + normal.join(" / "));
  assert(strict.some(s => s.includes("哨兵值")), "strict 应报 warning：" + strict.join(" / "));
  assert(strict.length > normal.length, "strict 结果应更多");
}
