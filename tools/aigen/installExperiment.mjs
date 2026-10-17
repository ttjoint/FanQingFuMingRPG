// 把 AI 生成的素材装进 versions/aitest/ 实验版本。
//
// 素材来源：_aigen/exp/cand/*.png（由 cli.mjs batch 生成，已视觉复核 9/9 合格）
// 目标：versions/aitest/assets/ 下，按游戏约定的路径与命名落盘。
//
// 命名约定（与 default 版本一致）：
//   assets/role/<名>.png        单位精灵，由 chars.json 引用
//   assets/face/<名>.png        头像 63×80
//   assets/skill_icons/<名>.png 技能图标 34×34
//   assets/projectile/<名>.png  投射物帧（注意：目录名是单数 projectile，
//                               见 src/engine/projectile.js 的注释与 editor 的引用）
//   assets/props/<名>.png       场景装饰物
//
// 用法：node tools/aigen/installExperiment.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePNG, encodePNG } from "./png.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CAND = path.join(ROOT, "_aigen/exp/cand");
const VER = path.join(ROOT, "versions/aitest");
const DEF = path.join(ROOT, "versions/default/assets");   // 原版资源（合并基底）
const ASSETS = path.join(VER, "assets");

const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJSON = (p, o) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(o, null, 2) + "\n");
};
const copyPNG = (src, dst) => {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  const im = decodePNG(fs.readFileSync(dst));
  return im.width + "x" + im.height;
};

// ---------------------------------------------------------------- 单位精灵
// chars.json 的结构是 chars[model][action][dir] = [帧文件名...]
// 本项目里「单帧 stand」是既有做法（清兵/二叔等 20+ 角色都只有 stand 单帧），
// 因此实验版本让 8 个方向都指向同一张 AI 图即可。
const UNITS = [
  { model: "石傀", png: "unit_石傀.png", portrait: "face_石傀.png" },
  { model: "游魂", png: "unit_游魂.png", portrait: "face_游魂.png" },
];

// icon 文件名必须与 skills.json 里的 icon 字段一致（不加前缀）——
// 因为 main.js 预加载用的是 assets/skill_icons/<icon>，而版本的覆盖映射
// 按「逻辑路径」匹配，多一层前缀就会 404 回退到原版目录。
// iconSrc：候选目录里的源文件；icon：落到 assets/skill_icons/ 的目标名（须与 skills.json 一致）
const SKILLS = [
  { name: "震地波", iconSrc: "skill_震地波.png", icon: "震地波.png", frames: ["震地波_p1.png", "震地波_p2.png", "震地波_p3.png"], src: ["proj_震地波1.png", "proj_震地波2.png", "proj_震地波3.png"] },
  { name: "魂火", iconSrc: "skill_魂火.png", icon: "魂火.png", frames: ["魂火_p1.png", "魂火_p2.png", "魂火_p3.png"], src: ["proj_魂火1.png", "proj_魂火2.png", "proj_魂火3.png"] },
];

const PROPS = [
  { src: "prop_rock.png", dst: "rock_a.png" },
  { src: "prop_stump.png", dst: "stump.png" },
  { src: "prop_brazier.png", dst: "brazier.png" },
];

const log = [];

for (const u of UNITS) {
  const dst = path.join(ASSETS, "role", u.png);
  log.push(["role/" + u.png, copyPNG(path.join(CAND, u.png), dst)]);
  const p = path.join(ASSETS, "face", u.portrait);
  log.push(["face/" + u.portrait, copyPNG(path.join(CAND, u.portrait), p)]);
}
for (const s of SKILLS) {
  log.push(["skill_icons/" + s.icon, copyPNG(path.join(CAND, s.iconSrc), path.join(ASSETS, "skill_icons", s.icon))]);
  s.frames.forEach((f, i) => {
    log.push(["projectile/" + f, copyPNG(path.join(CAND, s.src[i]), path.join(ASSETS, "projectile", f))]);
  });
}
for (const p of PROPS) {
  log.push(["props/" + p.dst, copyPNG(path.join(CAND, p.src), path.join(ASSETS, "props", p.dst))]);
}

// ---------------------------------------------------------------- chars.json
// 单帧 stand × 8 方向。dir 索引 0..7，帧名带 _d<N> 后缀便于排查。
//
// **必须基于原版 chars.json 合并**，不能只写新增单位：
// 版本 assets/ 是「覆盖」而非「追加」，只写 2 个新模型会把原版 30 个
// 全部冲掉 —— 结果是玩家(role)、所有原版 NPC 都找不到贴图，
// 任何地图上一个人都看不见（真实踩过的坑）。
const chars = readJSON(path.join(DEF, "chars.json"));
for (const u of UNITS) {
  const frame = u.png.replace(/\.png$/, ".png");   // 渲染器会自动 .bmp→.png
  chars[u.model] = {
    stand: Array.from({ length: 8 }, (_, d) => [frame]),
  };
}
writeJSON(path.join(ASSETS, "chars.json"), chars);

console.log("=== 素材落盘 ===");
for (const [f, d] of log) console.log(" ", f, d);
console.log("\n=== chars.json ===");
for (const k in chars) console.log(" ", k, "stand 方向数", chars[k].stand.length);
console.log("\n版本目录:", VER);

// 落盘后刷新版本清单，保证静态部署能发现该版本。
import("./gen-versions-index.mjs").then((m) => m.writeVersionsIndex()).catch(() => {});
