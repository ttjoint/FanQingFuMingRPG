#!/usr/bin/env node
// 数值报告：把「玩家成长 / 怪物强度 / TTK / 升级所需击杀」打成可读的表。
//
// 为什么需要它：战斗数值曾经在换公式之后**长期失准**而没人发现——
// 沈慈 10000hp（要砍 125 击）旁边躺着山贼 300hp（3 击），
// 26 级升级要杀 103 万只同级怪。肉眼读 JSON 是看不出这些的。
// 任何涉及数值的改动都应先跑一遍本脚本。
//
// 用法：
//   node tools/balance-report.mjs                # 用曲线 + 真实 npcs.json
//   node tools/balance-report.mjs --curve-only   # 只看曲线，不读内容
//   node tools/balance-report.mjs --json         # 输出 JSON（供 CI/对比）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeCurve, curveAt, monsterStats, playerStats, expToNext,
  hitsToKill, armorKAt, TIERS, normalizeTier,
} from "../src/engine/balance.js";
import { damageRangeMitigation, armorMitigation } from "../src/engine/skill.js";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const ASSETS = path.join(ROOT, "versions/default/assets");

const argv = process.argv.slice(2);
const wantJson = argv.includes("--json");
const curveOnly = argv.includes("--curve-only");

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(ASSETS, name), "utf8")); }
  catch (e) { return fallback; }
}
function asArray(v, key) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v[key])) return v[key];
  if (v && typeof v === "object") return Object.values(v);
  return [];
}

const cfg = readJson("config.json", {});
const curve = normalizeCurve((cfg.balance && cfg.balance.curve) || cfg.curve);

// 每击平均伤害：用 mitigation 模型的区间中点（与实机默认一致）。
function avgHit(atk, power, def, lv) {
  const [lo, hi] = damageRangeMitigation(atk, power || 0, def, 0.25, { armorK: armorKAt(lv, curve) });
  return (lo + hi) / 2;
}

// ---- 1) 曲线表 ----
function curveTable(maxLv) {
  const rows = [];
  for (let lv = 1; lv <= maxLv; lv++) {
    const p = playerStats(lv, curve);
    const m = monsterStats(lv, "trash", curve);
    const ttk = hitsToKill(m.hp, avgHit(p.attack, 0, m.def, lv));
    const cut = armorMitigation(p.defence, armorKAt(lv, curve));
    const mHit = Math.max(1, Math.round(m.atk * (1 - cut)));
    const survive = hitsToKill(p.hpMax, mHit);
    const need = expToNext(lv, curve);
    const kills = m.exp > 0 ? Math.ceil(need / m.exp) : Infinity;
    rows.push({ lv, ...p, monster: m, ttk, survive, need, kills });
  }
  return rows;
}

// ---- 2) 真实怪物表 ----
function realMonsters() {
  const npcs = asArray(readJson("npcs.json", []), "npcs");
  const out = [];
  for (const n of npcs) {
    const lv = Number(n.level);
    // 友好 NPC 用 4294967295 之类的哨兵值表示“不参战”，跳过。
    if (!Number.isFinite(lv) || lv <= 0 || lv > 1000) continue;
    const tier = normalizeTier(n.tier);
    const ref = monsterStats(lv, tier.id, curve);
    const hp = Number(n.hp) || 0;
    const atk = Number(n.attack) || 0;
    const def = Number(n.defence) || 0;
    const exp = Number(n.exp) || 0;
    const p = playerStats(lv, curve);
    const ttk = hitsToKill(hp, avgHit(p.attack, 0, def, lv));
    const cut = armorMitigation(p.defence, armorKAt(lv, curve));
    const mHit = Math.max(1, Math.round(atk * (1 - cut)));
    const survive = atk > 0 ? hitsToKill(p.hpMax, mHit) : Infinity;
    out.push({
      name: n.name, lv, tier: tier.id, hp, atk, def, exp, ttk, survive,
      ref,
      // 与曲线基准的偏离倍数（帮助发现“手拍”的离群值）
      hpOff: ref.hp ? hp / ref.hp : 0,
      atkOff: ref.atk ? atk / ref.atk : 0,
      expOff: ref.exp ? exp / ref.exp : 0,
    });
  }
  return out.sort((a, b) => a.lv - b.lv || a.name.localeCompare(b.name));
}

const maxLv = Math.min(curve.maxLevel, 30);
const rows = curveTable(maxLv);

if (wantJson) {
  console.log(JSON.stringify({ curve, rows, monsters: curveOnly ? [] : realMonsters() }, null, 2));
  process.exit(0);
}

const pad = (v, w) => String(v).padStart(w);
function header(title) { console.log("\n" + title); }

header(`=== 曲线参数（config.balance.curve，缺省用 engine/balance.js 默认值）===`);
console.log(JSON.stringify(curve, null, 2));

header("=== 玩家 vs 同级普通怪 ===");
console.log(" lv | 玩家atk def hpMax mpMax | 怪hp atk def exp | 击杀 | 存活 | 升级需exp | 需击杀数");
for (const r of rows) {
  const m = r.monster;
  console.log(
    `${pad(r.lv, 3)} | ${pad(r.attack, 7)} ${pad(r.defence, 3)} ${pad(r.hpMax, 5)} ${pad(r.mpMax, 5)} | ` +
    `${pad(m.hp, 4)} ${pad(m.atk, 3)} ${pad(m.def, 3)} ${pad(m.exp, 4)} | ` +
    `${pad(r.ttk, 4)} | ${pad(r.survive, 4)} | ${pad(r.need, 9)} | ${r.kills}`
  );
}

// 达标检查：目标见 docs/BALANCE.md §2.1
const ttks = rows.map(r => r.ttk);
const kills = rows.map(r => r.kills).filter(Number.isFinite);
const surv = rows.map(r => r.survive).filter(Number.isFinite);
header("=== 达标检查（目标值见 docs/BALANCE.md）===");
const check = (name, arr, lo, hi) => {
  const min = Math.min(...arr), max = Math.max(...arr);
  const ok = min >= lo && max <= hi;
  console.log(`  ${ok ? "✓" : "✗"} ${name}: ${min}–${max}（目标 ${lo}–${hi}）`);
  return ok;
};
let allOk = true;
allOk = check("TTK 击杀数", ttks, 3, 6) && allOk;
allOk = check("玩家存活击数", surv, 10, 20) && allOk;
allOk = check("每级所需击杀数", kills, 8, 60) && allOk;

if (!curveOnly) {
  const mon = realMonsters();
  header(`=== 真实怪物（versions/default/assets/npcs.json，共 ${mon.length} 只可战斗单位）===`);
  console.log("名称           lv tier   hp   atk  def  exp | 击杀 存活 | hp偏离 atk偏离 exp偏离");
  for (const m of mon) {
    const flag = (m.hpOff > 4 || m.hpOff < 0.25 || m.expOff > 4 || m.expOff < 0.25) ? "  ← 离群" : "";
    console.log(
      `${String(m.name).padEnd(12).slice(0, 12)} ${pad(m.lv, 3)} ${m.tier.padEnd(5)} ` +
      `${pad(m.hp, 4)} ${pad(m.atk, 5)} ${pad(m.def, 4)} ${pad(m.exp, 4)} | ` +
      `${pad(m.ttk, 4)} ${pad(m.survive, 4)} | ` +
      `${pad(m.hpOff.toFixed(2), 6)} ${pad(m.atkOff.toFixed(2), 7)} ${pad(m.expOff.toFixed(2), 7)}${flag}`
    );
  }

  const outliers = mon.filter(m => m.hpOff > 4 || m.hpOff < 0.25 || m.expOff > 4 || m.expOff < 0.25);
  header(`=== 与曲线基准偏离 >4× 或 <0.25× 的怪物：${outliers.length} 只 ===`);
  for (const m of outliers) console.log(`  ${m.name}（lv${m.lv}）hp×${m.hpOff.toFixed(2)} exp×${m.expOff.toFixed(2)}`);
}

header("=== 结论 ===");
console.log(allOk ? "  曲线曲线指标全部达标。" : "  有指标未达标，调整 engine/balance.js 的 DEFAULT_CURVE 或 config.balance.curve。");
process.exit(allOk ? 0 : 1);
