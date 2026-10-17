// 实验版本「AI 素材试验场」的构建脚本。
//
// 目标：在一个全新版本里，用 AI 生成的素材搭一个小场景，检验素材是否可用。
// 已知局限（见 tools/aigen/README.md）：模型无法控制具体形状，0/8 画不出剑。
// 因此素材选型遵循「能用/不能指望」表：圆形、块状、对称徽记可用；
// 精细武器/人形/文字不可指望。
//
// 用法：node tools/aigen/buildExperiment.mjs [--dry]
// 产出：versions/aitest/（version.json + patch.json + assets/）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromLegacyMap } from "../../src/content/mapDoc.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEF = path.join(ROOT, "versions/default/assets");
const OUT = path.join(ROOT, "versions/aitest");
const DRY = process.argv.includes("--dry");

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJSON = (p, o) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");
};

// ---------------------------------------------------------------- 场景规划
// 地图格式沿用 default 的 cells/objects/spawns。cells 带 iso 坐标，
// 这里不复制原图瓦片，而是用「纯色地板」方案：cells 留空、由渲染器的
// 无素材兜底画地板（见 src/render/renderer.js 的无素材 fallback）。
const MAP_W = 20;
const MAP_H = 20;

// 敌人：只依赖 AI 能画好的「块状/圆形」形象
const ENEMIES = [
  {
    id: 9001, name: "石傀", model: "石傀.pmg", portrait: "石傀.png",
    hp: 120, attack: 12, defence: 2, level: 1, exp: 20, hostile: 1,
    ai: "bandit", skills: "*/*", talks: [],
    legs: 1,
    drops: [
      { name: "翠玉镯", chance: 70, min: 1, max: 1 },
      { name: "红宝石", chance: 35, min: 1, max: 1 },
    ],
  },
  {
    id: 9002, name: "游魂", model: "游魂.pmg", portrait: "游魂.png",
    hp: 80, attack: 16, defence: 0, level: 1, exp: 30, hostile: 1,
    ai: "bandit", skills: "*/*", talks: [],
    legs: 1,
    drops: [
      { name: "乌木剑", chance: 45, min: 1, max: 1, rarity: 1 },
      { name: "蓝宝石", chance: 40, min: 1, max: 1 },
    ],
  },
];

// 技能：AI 画「符文徽记」这类对称图形成功率较高（圆形/放射状）
const SKILLS = [
  {
    name: "震地波", desc: "石傀的震荡冲击，向目标投出碎石并造成范围伤害。",
    type: 1, range: 6, mp: 8, reqLevel: 0, power: 24,
    sound: "cq.wav", icon: "震地波.png", frames: [],
    projectile: {
      speed: 260, radius: 22, homing: false, pierce: 0,
      frames: ["震地波_p1.png", "震地波_p2.png", "震地波_p3.png"],
    },
  },
  {
    name: "魂火", desc: "游魂吐出的幽蓝鬼火，追踪目标。",
    type: 1, range: 8, mp: 12, reqLevel: 0, power: 30,
    sound: "cq.wav", icon: "魂火.png", frames: [],
    projectile: {
      speed: 380, radius: 18, homing: true, pierce: 0,
      frames: ["魂火_p1.png", "魂火_p2.png", "魂火_p3.png"],
    },
  },
];

// 装饰物：块状石头、树桩、火盆
const PROPS = [
  { key: "rock_a.png", w: 64, h: 64 },
  { key: "stump.png", w: 64, h: 64 },
  { key: "brazier.png", w: 64, h: 64 },
];

// 掉落物图标复用已有宝石/玉佩（已是程序化生成的）
const GROUND_ITEMS = ["红宝石", "蓝宝石", "翠玉镯", "乌木剑"];

// ---------------------------------------------------------------- 地图构造
// iso 坐标公式与 src/core/layout.js 的 GEO 一致：
//   dx = originX + (col - row) * halfW
//   dy = (col + row) * halfH
// 这里只写 cells 的最小必要字段，flag/trigger/map/layer 取地板值。
const HALF_W = 32, HALF_H = 16, ORIGIN_X = 1568;
const iso = (row, col) => ({
  row, col,
  sx: 320, sy: 64,
  dx: ORIGIN_X + (col - row) * HALF_W,
  dy: (col + row) * HALF_H,
  flag: 0, trigger: 0, map: 0, layer: 2,
});

function buildMap() {
  const cells = [];
  for (let row = 0; row < MAP_H; row++)
    for (let col = 0; col < MAP_W; col++) cells.push(iso(row, col));

  // 装饰物：用 iso 位置标记（objects 的 sprite 字段在本实验里留空，
  // 由 assets/effects 或直接贴图渲染；先把坐标占位记录下）
  const objects = [
    { sprite: [0, 0, 64, 64, ORIGIN_X + (2 - 2) * HALF_W, (2 + 2) * HALF_H], tiles: [[0, 0, 0, 0]], soft: "rock_a.png" },
    { sprite: [0, 0, 64, 64, ORIGIN_X + (6 - 3) * HALF_W, (6 + 3) * HALF_H], tiles: [[0, 0, 0, 0]], soft: "stump.png" },
    { sprite: [0, 0, 64, 64, ORIGIN_X + (10 - 14) * HALF_W, (10 + 14) * HALF_H], tiles: [[0, 0, 0, 0]], soft: "brazier.png" },
    { sprite: [0, 0, 64, 64, ORIGIN_X + (15 - 5) * HALF_W, (15 + 5) * HALF_H], tiles: [[0, 0, 0, 0]], soft: "rock_a.png" },
  ];

  const spawns = [
    { npc: 9001, row: 5, col: 6 },
    { npc: 9001, row: 8, col: 12 },
    { npc: 9001, row: 13, col: 8 },
    { npc: 9002, row: 6, col: 15 },
    { npc: 9002, row: 15, col: 14 },
  ];

  return {
    name: "试验场.map",
    width: MAP_W,
    music: "",
    entry: [3, 3],
    cells,
    objects,
    spawns,
  };
}

// ---------------------------------------------------------------- patch 组装
function buildPatch() {
  const npcs = readJSON(path.join(DEF, "npcs.json"));
  const items = readJSON(path.join(DEF, "items.json"));
  const skills = readJSON(path.join(DEF, "skills.json"));
  const mapsIndex = readJSON(path.join(DEF, "maps_index.json"));

  // 新 NPC 追加到表尾（patch 的 content.npcs 按 id 覆盖/新增）
  const npcPatch = {};
  for (const e of ENEMIES) npcPatch[e.id] = e;

  const skillPatch = {};
  for (const s of SKILLS) skillPatch[s.name] = s;

  // maps 的键是「地图名」（mapDocs 以文件名为 key），不是数字 id。
  const MAP_NAME = "试验场";
  const MAP_ID = 90;   // maps_index 里的编号，供传送/触发引用
  const patch = {
    content: {
      npcs: npcPatch,
      skills: skillPatch,
      mapsIndex: Object.assign({}, mapsIndex, { [MAP_ID]: MAP_NAME }),
    },
    // patch.maps 存的是 **MapDoc 格式**（ground/collision/units…），
    // 不是 legacy 的 cells/spawns。applyPatch 会直接 normalizeMapDoc，
    // 所以这里必须先用 fromLegacyMap 转换，否则 units 为空 → 怪物不生成。
    maps: { [MAP_NAME]: fromLegacyMap(buildMap()) },
  };
  return { patch, npcs, items, skills, mapsIndex, MAP_ID, MAP_NAME };
}

// ---------------------------------------------------------------- 主流程
const { patch, MAP_ID, MAP_NAME } = buildPatch();

// 素材清单（供生成脚本消费）
const assetManifest = {
  // 单位：AI 立绘（64×64）
  units: ENEMIES.map((e) => ({ name: e.name, file: e.model.replace(/\.pmg$/, ".png"), subject: e.name === "石傀" ? "a stone golem idol, chunky rock body, glowing eyes" : "a glowing blue spirit wisp, round floating ghost" })),
  portraits: ENEMIES.map((e) => ({ name: e.name, file: e.portrait, subject: e.name === "石傀" ? "stone golem face" : "ghost wisp face" })),
  // 技能图标（34×34）+ 投射物帧（3 帧）
  skillIcons: SKILLS.map((s) => ({ name: s.name, file: s.icon, subject: s.name === "震地波" ? "cracked earth shockwave rune" : "blue ghost flame rune" })),
  projectiles: SKILLS.flatMap((s) => s.projectile.frames.map((f, i) => ({
    skill: s.name, file: f, frame: i,
    subject: s.name === "震地波" ? "flying rock shard ball" : "blue flame orb",
  }))),
  props: PROPS.map((p) => ({ file: p.key, subject: p.key.replace(/_.*$/, "").replace(/\.png$/, "") })),
};

if (DRY) {
  console.log("=== 场景规划 ===");
  console.log("地图:", MAP_NAME, "(id " + MAP_ID + ")", "尺寸", MAP_W + "x" + MAP_H, "cells", MAP_W * MAP_H);
  console.log("敌人:", ENEMIES.map((e) => e.name + "(hp" + e.hp + ")").join(", "));
  console.log("技能:", SKILLS.map((s) => s.name + "(投射物" + s.projectile.frames.length + "帧)").join(", "));
  console.log("装饰:", PROPS.map((p) => p.key).join(", "));
  console.log("掉落:", GROUND_ITEMS.join(", "));
  console.log("\n=== 需生成素材 (" + (assetManifest.units.length + assetManifest.skillIcons.length + assetManifest.projectiles.length + assetManifest.props.length) + " 张) ===");
  for (const k of Object.keys(assetManifest))
    for (const a of assetManifest[k]) console.log(" ", k, a.file, "←", a.subject);
  process.exit(0);
}

writeJSON(path.join(OUT, "version.json"), {
  format: "gsxy.version", version: 1, id: "aitest",
  name: "AI 素材试验场", builtin: false, readonly: false,
  assets: "assets", base: "default", createdAt: Date.now(),
});
writeJSON(path.join(OUT, "patch.json"), patch);
writeJSON(path.join(OUT, "asset-manifest.json"), assetManifest);

// maps_manifest.json 决定 main.js 启动时加载哪些地图文件（按文件名）。
// 版本自己的 assets/ 会覆盖原版同名文件，所以这里写一份「原版 + 试验场」。
const manifest = readJSON(path.join(DEF, "maps_manifest.json"));
if (!manifest.includes(MAP_NAME)) manifest.push(MAP_NAME);
writeJSON(path.join(OUT, "assets/maps_manifest.json"), manifest);

// 刷新 versions/index.json：静态服务器（http.server / nginx / Pages）列不出目录，
// 前端只能靠这个清单发现磁盘版本。不刷新的话新版本在选区里看不到。
import("./gen-versions-index.mjs").then((m) => m.writeVersionsIndex()).catch(() => {});

console.log("已写入", OUT);
console.log("地图:", MAP_NAME, "id:", MAP_ID, "units:", patch.maps[MAP_NAME].units.length, "npcs:", Object.keys(patch.content.npcs).length, "skills:", Object.keys(patch.content.skills).length);
