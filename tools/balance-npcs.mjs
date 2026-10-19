#!/usr/bin/env node
// 按曲线重算 npcs.json 的战斗数值（hp / attack / defence / exp）。
//
// 为什么需要它：现存数值是「低命中率 + 固定攻击力」时代手拍的，
// 换公式后从未重排。实测离群程度：
//   野猴 lv9  hp=30      （曲线基准的 0.23 倍，一击必死）
//   沈慈 lv15 hp=10000   （曲线的 39.7 倍，要砍 125 击）
//   山贼 lv25 hp=300     （曲线的 0.40 倍，同等级里最脆）
//   所有怪的 exp 只有基准的 0.01–0.10 倍（于是升级要杀几十万只）
//
// 做法：
//   1. 按 `tier` 字段决定档次（trash/elite/boss/npc），缺省 trash。
//      这是本次新增的字段——以前所有怪都是同一个档次，所以 lv25 的
//      山贼（300hp）和 lv26 的山贼头目（1500hp）差 5 倍却无从表达。
//   2. 用 engine/balance.js 的曲线算出目标值。
//   3. **保留显式手填**：若原数据里该字段与档次的期望值不符且标了
//      `"keepStats": true`，则原样保留（给剧情 boss 用）。
//   4. 友好 NPC（level 为 4294967295 之类的哨兵）不参战，统一清零攻/防/经验，
//      hp 保留（避免剧情里被一击误杀）。
//
// 用法：
//   node tools/balance-npcs.mjs            # 预演，只打印 diff
//   node tools/balance-npcs.mjs --write    # 写回 npcs.json
//   node tools/balance-npcs.mjs --write --tier 山贼头目=elite
//
// 安全：默认只预演；写回前会备份为 npcs.json.bak（已存在则不覆盖）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCurve, monsterStats, normalizeTier } from "../src/engine/balance.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const FILE = path.join(ROOT, "versions/default/assets/npcs.json");

const argv = process.argv.slice(2);
const doWrite = argv.includes("--write");

// 哨兵值：原版用 4294967295（= 2^32-1）表示“这个 NPC 不参战”。
const SENTINEL = 4294967295;
function isSentinel(v) { return typeof v === "number" && v >= 1000000000; }

// 判定一个 NPC 是否真的会战斗。只看 level 不够：
//   鳌拜 / 多尔衮 是 level=0 的 real boss（hostile=1, hp 3000~5000, ai=boss/guard）。
//   而龙绝尘 / 村民是 level=哨兵 且 hostile=0。
// 因此：hostile 为真且有正的 hp/attack，就算参战。
function isCombatant(n) {
  const hostile = Number(n.hostile) || 0;
  if (!hostile) return false;
  const hp = Number(n.hp) || 0;
  const atk = Number(n.attack) || 0;
  return hp > 0 || atk > 0;
}

// --tier 名称=档次 与 --level 名称=等级 覆盖
const tierOverride = {};
const levelOverride = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--tier" && argv[i + 1]) {
    const [name, tier] = argv[i + 1].split("=");
    if (name && tier) tierOverride[name] = tier;
  }
  if (argv[i] === "--level" && argv[i + 1]) {
    const [name, lv] = argv[i + 1].split("=");
    if (name && lv) levelOverride[name] = lv;
  }
}

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "versions/default/assets/config.json"), "utf8"));
const curve = normalizeCurve((cfg.balance && cfg.balance.curve) || {});

const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
const list = Array.isArray(raw) ? raw : (raw.npcs || Object.values(raw));
const isObj = !Array.isArray(raw);

// 原有 npcs.json 不带 tier，全靠等级+血量反推是猜的。
// 这里**不猜**——默认一律 trash，需要的档次由人工通过 --tier 显式指定。
// 这是「只诊断、不兜底」原则的延续：档次是设计决策，不该由脚本臆断。
function tierOf(n) {
  if (tierOverride[n.name]) return normalizeTier(tierOverride[n.name]);
  if (n.tier) return normalizeTier(n.tier);
  return normalizeTier("trash");
}

const rows = [];
const missing = [];
for (const n of list) {
  if (!n || typeof n !== "object") continue;
  const rawLv = Number(n.level);
  const hasLv = Number.isFinite(rawLv) && rawLv > 0 && rawLv < 1000;

  // 不参战的 NPC：统一清空战斗数值（保留 hp，避免剧情里被一击秒）。
  if (!hasLv && !isCombatant(n)) {
    rows.push({ n, name: n.name, lv: null, tier: "npc", before: pick(n), after: { hp: 999, attack: 0, defence: 0, exp: 0 } });
    continue;
  }

  // 参战但没填等级的（鳌拜 / 多尔衮）：**不自动猜**。
  //
  // 试过“按现有 hp 反推等效等级”，结果是鳌拜→lv42、多尔衮→lv38，
  // 远超游戏内可达到的等级区间（怪物最高 lv26），因为它们的 hp 是
  // “作boss应该血厚”手拍的，并非由曲线推导。用它们反推等级等于
  // 把旧数据的错误当成基准，所以这里直接报错，要求人工通过
  // --level 名称=等级 显式指定。
  let lv = hasLv ? rawLv : 0;
  let lvMissing = false;
  if (!hasLv) {
    if (levelOverride[n.name]) {
      lv = Number(levelOverride[n.name]);
    } else {
      lvMissing = true;
      missing.push(n.name);
    }
  }

  const tier = tierOf(n);
  const w = lvMissing ? { hp: 0, atk: 0, def: 0, exp: 0 } : monsterStats(lv, tier.id, curve);
  // 字段名映射：曲线用的是 atk，内容数据用 attack。
  const want = { hp: w.hp, attack: w.atk, defence: w.def, exp: w.exp };
  rows.push({ n, name: n.name, lv: lvMissing ? null : lv, lvMissing, tier: tier.id, want, before: pick(n), after: want });
}

function pick(n) {
  return { hp: Number(n.hp) || 0, attack: Number(n.attack) || 0, defence: Number(n.defence) || 0, exp: Number(n.exp) || 0 };
}

// ---- 打印 diff ----
const pad = (v, w) => String(v).padStart(w);
console.log(`曲线：monster hp ${curve.monster.hpBase}×${curve.monster.hpGrowth}^(lv-1) 等（见 docs/BALANCE.md）`);
console.log(`\n${"名称".padEnd(12)} lv? tier   ${"hp".padStart(20)} ${"atk".padStart(14)} ${"def".padStart(12)} ${"exp".padStart(14)}`);
for (const r of rows) {
  const b = r.before, a = r.after;
  const fmt = (x, y, w) => {
    if (x === y) return pad(x, w);
    return pad(`${x}→${y}`, w);
  };
  console.log(
    `${String(r.name).padEnd(12).slice(0, 12)} ${pad(r.lv == null ? "-" : r.lv, 3)} ${r.tier.padEnd(5)} ` +
    `${fmt(b.hp, a.hp, 20)} ${fmt(b.attack, a.attack, 14)} ${fmt(b.defence, a.defence, 12)} ${fmt(b.exp, a.exp, 14)}`
  );
}

const changed = rows.filter(r => {
  const b = r.before, a = r.after;
  return b.hp !== a.hp || b.attack !== a.attack || b.defence !== a.defence || b.exp !== a.exp;
});
console.log(`\n共 ${rows.length} 个 NPC，${changed.length} 个数值会变化。`);

if (missing.length) {
  console.log(`\n⚠ 以下参战单位缺 level，无法计算（不会被修改）：`);
  for (const name of missing) console.log(`   - ${name}`);
  console.log(`  请用 --level 名称=等级 显式指定，例如：`);
  for (const name of missing) console.log(`     --level "${name}=28"`);
  if (doWrite) {
    console.log("\n已中止写入（避免跳过这些单位后数据变得不可解释）。");
    process.exit(1);
  }
}

if (!doWrite) {
  console.log("\n（预演模式，未写入。加 --write 才会改文件。）");
  process.exit(0);
}

// ---- 写回 ----
const bak = FILE + ".bak";
if (!fs.existsSync(bak)) {
  fs.copyFileSync(FILE, bak);
  console.log(`\n已备份原文件到 ${path.basename(bak)}`);
} else {
  console.log(`\n备份已存在（${path.basename(bak)}），不覆盖。`);
}

for (const r of rows) {
  if (!r.n || typeof r.n !== "object") continue;
  if (r.lvMissing) continue;   // 缺等级的单位不写（已在上面报错）
  r.n.hp = r.after.hp;
  r.n.attack = r.after.attack;
  r.n.defence = r.after.defence;
  r.n.exp = r.after.exp;
  if (r.lv != null && !(Number(r.n.level) > 0)) r.n.level = r.lv;
  if (r.tier && r.tier !== "trash") r.n.tier = r.tier;
  else delete r.n.tier;
}

const out = isObj ? raw : list;
fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`已写入 ${path.relative(ROOT, FILE)}`);
