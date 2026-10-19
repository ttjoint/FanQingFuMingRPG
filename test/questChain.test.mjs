// 内容连通性测试：每个**收集类**任务的目标物品，必须至少有一个可获得来源。
//
// 为什么需要这条测试（实测踩到的 P0）：
//   默认版本里「学艺1」要求 6 颗豹牙，「收集猴皮」要求 5 张猴皮，
//   但花豹/野猴的 drops 从来没录进 npcs.json —— 玩家打一辈子也拿不到，
//   **主线在第一章就永久卡死**（学艺1 → 学艺2 → 灭门 → 扬州 是单链）。
//
//   这类"数据缺一条就卡死"的问题，靠跑通一段流程发现不了（要打到那一步），
//   所以把它变成静态检查：
//     任务目标物品 ∈ {怪物掉落 ∪ 脚本赠送 ∪ 商店货物}
//
//   type=1 的击杀类任务不走这条规则（目标是被打死的单位名，不是物品）。
import { strict as assert } from "assert";
import fs from "fs";

const NPCS = new URL("../versions/default/assets/npcs.json", import.meta.url);
const ITEMS = new URL("../versions/default/assets/items.json", import.meta.url);
const SCRIPTS = new URL("../versions/default/assets/scripts.json", import.meta.url);

const loadArr = u => {
  const j = JSON.parse(fs.readFileSync(u, "utf8"));
  return Array.isArray(j) ? j : Object.values(j);
};

export function collectMissionTargets() {
  const scripts = JSON.parse(fs.readFileSync(SCRIPTS, "utf8"));
  const out = [];
  // AddMission("名字","描述", type,"目标", need,...)  type=0 收集 / type=1 击杀
  const re = /AddMission\("([^"]+)","((?:[^"\\]|\\.)*)",(\d+),"([^"]+)",(\d+)/g;
  for (const [file, body] of Object.entries(scripts)) {
    let m;
    while ((m = re.exec(body))) {
      out.push({ mission: m[1], type: Number(m[3]), target: m[4], need: Number(m[5]), script: file });
    }
  }
  return out;
}

export function itemSources() {
  const src = new Map();
  const add = (item, how) => {
    if (!src.has(item)) src.set(item, []);
    src.get(item).push(how);
  };
  for (const n of loadArr(NPCS)) {
    for (const d of (n.drops || [])) add(d.name, "drop:" + n.name);
    // 商店 / 携带货物
    for (const g of (n.inventory || n.goods || [])) {
      const nm = typeof g === "string" ? g : (g && g.name);
      if (nm) add(nm, "shop:" + n.name);
    }
  }
  const scripts = JSON.parse(fs.readFileSync(SCRIPTS, "utf8"));
  const re = /AddPlayerItem\("([^"]+)"/g;
  for (const [file, body] of Object.entries(scripts)) {
    let m;
    while ((m = re.exec(body))) add(m[1], "script:" + file);
  }
  return src;
}

export function collectMissionsAllHaveSources() {
  const src = itemSources();
  const missing = collectMissionTargets()
    .filter(t => t.type === 0)
    .filter(t => !src.has(t.target))
    .map(t => `${t.mission}(需 ${t.target}×${t.need}, 来自 ${t.script})`);
  assert.deepEqual(missing, [],
    "以下收集类任务的目标物品没有任何来源（怪物掉落/脚本赠送/商店），玩家将永久卡关：\n  " + missing.join("\n  "));
}

export function dropsReferenceRealItems() {
  const names = new Set(loadArr(ITEMS).map(i => i && i.name).filter(Boolean));
  const bad = [];
  for (const n of loadArr(NPCS)) {
    for (const d of (n.drops || [])) {
      if (!names.has(d.name)) bad.push(`${n.name} 掉落不存在的物品「${d.name}」`);
      if (!(d.chance > 0 && d.chance <= 100)) bad.push(`${n.name}/${d.name} chance=${d.chance} 越界`);
      if (!(d.min >= 1)) bad.push(`${n.name}/${d.name} min=${d.min} 非法`);
      if (d.max != null && d.max < d.min) bad.push(`${n.name}/${d.name} max<min`);
    }
  }
  assert.deepEqual(bad, [], "掉落表引用了不存在的物品或区间非法：\n  " + bad.join("\n  "));
}

export function keyDropsPresent() {
  // 这两条是主线/支线硬依赖，专门锁住，避免以后重排数据时又被抹掉。
  const npcs = loadArr(NPCS);
  const has = (npc, item) => {
    const n = npcs.find(x => x.name === npc);
    return !!(n && (n.drops || []).some(d => d.name === item));
  };
  assert.ok(has("花豹", "豹牙"), "花豹必须掉豹牙（学艺1 主线需要 6 颗）");
  assert.ok(has("野猴", "猴皮"), "野猴必须掉猴皮（二婶支线需要 5 张）");
  assert.ok(has("野猴", "猴肉"), "野猴应掉猴肉（原版设定：猴子掉皮和肉）");
  assert.ok(has("花豹", "豹肉"), "花豹应掉豹肉（原版设定：豹子掉牙和肉）");
  assert.ok(has("强盗", "金创药"), "强盗应掉金创药（原版设定）");
  assert.ok(has("强盗", "乌木剑"), "强盗应掉乌木剑（原版设定）");
  assert.ok(has("强盗", "武者之戒"), "强盗应掉初级戒指（原版设定）");
}

export function scriptGiftsExist() {
  // 脚本赠送的物品也必须真实存在，否则相当于"给了个空"。
  const names = new Set(loadArr(ITEMS).map(i => i && i.name).filter(Boolean));
  const scripts = JSON.parse(fs.readFileSync(SCRIPTS, "utf8"));
  const re = /AddPlayerItem\("([^"]+)"/g;
  const bad = [];
  for (const [file, body] of Object.entries(scripts)) {
    let m;
    while ((m = re.exec(body))) if (!names.has(m[1])) bad.push(`${file} 赠送不存在的物品「${m[1]}」`);
  }
  assert.deepEqual(bad, [], "脚本引用了不存在的物品：\n  " + bad.join("\n  "));
}

// ---- 击杀害任务交付（P0 回归）----
// 症状（实机复现）：学艺2 打到 1/1 后 state=1，交差对话跑完 state 仍是 1，
// CheckMission 永远读到 1 → 学艺3 永不出现，主线断在龙家庄。
// 根因：type=1 没有物品可扣，syncMissions 只管 type=0，所以 1→2 无人推进。
//
// 这里只测 CheckMission 这一条指令的语义，所以用最小 G（不建 runtime：
// runtime/context.js 依赖 DOM，node 测试环境里没有 document）。
export async function killMissionDelivers() {
  const { execCall } = await import("../src/script/vm.js");

  const G = {
    vars: {}, missions: {}, stats: {}, skills: [], factions: [], love: {},
    inventory: { 猴皮: 5 }, tip: "", tipT: 0, time: 0, script: null,
  };
  const ctx = { state: G, assets: { scripts: {}, items: [] } };
  const N = (v) => ({ t: "num", v: String(v) });
  const S = (v) => ({ t: "str", v: String(v) });
  const V = (v) => ({ t: "var", v: String(v) });
  const run = (name, ...args) => { for (const _ of execCall(ctx, name, args)) { /* 丢弃对话步 */ } };

  // 击杀任务已打到 1/1，引擎把 state 置为 1（combat.js 的实际行为）
  G.missions["学艺2"] = { name: "学艺2", desc: "杀山贼头目", type: 1, target: "山贼头目", need: 1, got: 1, state: 1 };

  // 第一次 CheckMission：脚本要读到 1 才能进交付分支
  run("CheckMission", S("学艺2"), V("i"));
  assert.equal(G.vars.i, 1, "第一次应读到 1（可交差），交付分支要能命中");
  assert.equal(G.missions["学艺2"].state, 2, "交付分支跑过后状态应变为已完成(2)");

  // 第二次 CheckMission：应是 2，避免反复交差
  run("CheckMission", S("学艺2"), V("i"));
  assert.equal(G.vars.i, 2, "交付后应读到 2");

  // 未接的任务仍返回 4（表示"未满足前置"），保持旧行为
  run("CheckMission", S("不存在的任务"), V("j"));
  assert.equal(G.vars.j, 4, "未接任务应返回 4");

  // 收集类（type=0）不受影响：state=4 时读到 4 且状态不变
  G.missions["收集猴皮"] = { name: "收集猴皮", desc: "打5张猴皮", type: 0, target: "猴皮", need: 5, got: 0, state: 4 };
  run("CheckMission", S("收集猴皮"), V("k"));
  assert.equal(G.vars.k, 4, "收集任务不该被击杀交付钩子改动");
  assert.equal(G.missions["收集猴皮"].state, 4, "收集任务状态不变");

  // 已交付的收集任务（state=2）读到 2，也不该被改动
  G.missions["收集猴皮"].state = 2;
  run("CheckMission", S("收集猴皮"), V("k"));
  assert.equal(G.vars.k, 2, "已交付的收集任务读到 2");
  assert.equal(G.missions["收集猴皮"].state, 2, "已交付状态保持");
}
