// 掉落表纯逻辑（不依赖 DOM、content、core）。
//
// 兼容旧格式：npcs.json 的 drops 项原本是 { name, chance, count }。
// 新格式在同名字段基础上，支持：
//   { name, chance, min, max, count, rarity, affixes }
//     - min/max：数量区间（缺省用 count / 1）
//     - rarity ：强制稀有度（供词缀 roll 判定）
//     - affixes：本次必然追加的词缀 id 列表（可选）
// 掉落判定与实例生成都在此完成，产出的是「条目」{ name, count, inst? }。

import { newInstance, newInstanceId, rollAffixes } from "./item.js";
import { normalizeScale, rollScaled, rollRarity } from "./lootScale.js";

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : (d == null ? 0 : d); }

// 归一化一条掉落定义。
export function normalizeDrop(d) {
  const o = Object.assign({}, d || {});
  o.name = o.name || o.id || "";
  o.chance = o.chance == null ? 100 : num(o.chance, 100);   // 百分比
  o.min = o.min != null ? num(o.min, 1) : (o.count != null ? num(o.count, 1) : 1);
  o.max = o.max != null ? num(o.max, o.min) : o.min;
  if (o.max < o.min) o.max = o.min;
  o.rarity = o.rarity || null;
  o.affixes = Array.isArray(o.affixes) ? o.affixes.slice() : null;
  return o;
}

// 单条掉落判定：返回条目数组（可能为空）。
//
// scale（可选）= { monsterLevel, dropRate, players }，见 engine/lootScale.js。
// 传了就按等级/倍率/人数缩放；不传则是旧的"原样判定"，行为与之前完全一致。
export function rollDrop(d, def, rng, affixPool, scale) {
  const r = typeof rng === "function" ? rng : Math.random;
  const drop = normalizeDrop(d);
  if (!drop.name) return [];
  // 有 scale 时用缩放后的几率；没有则退回原判定，保证旧调用方行为不变。
  if (scale) {
    if (!rollScaled(drop.chance, scale, r)) return [];
  } else if (r() * 100 > drop.chance) return [];
  const span = drop.max - drop.min;
  const count = drop.min + (span > 0 ? Math.floor(r() * (span + 1)) : 0);
  if (count <= 0) return [];
  // 可堆叠且无实例差异 → 单个堆叠条目。
  const stackable = !def || def.stackable !== false;
  const needsInstance = !!(def && def.stackable === false) || !!drop.rarity || !!(drop.affixes && drop.affixes.length) || (def && def.socketCount > 0);
  if (!needsInstance) return [{ name: drop.name, count }];
  // 需要实例：装备类不可堆叠，逐件生成实例。
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ name: drop.name, count: 1, inst: makeDropInstance(def, drop, r, affixPool, scale) });
  }
  return out;
}

export function makeDropInstance(def, drop, rng, affixPool, scale) {
  const r = typeof rng === "function" ? rng : Math.random;
  const inst = newInstance(def, { rand: r, id: newInstanceId(r) });
  // 词缀：显式指定的优先；否则按稀有度从词缀表随机（需传入 affixPool）。
  if (drop && drop.affixes && drop.affixes.length) inst.affixes = drop.affixes.slice();
  else if (affixPool && affixPool.length) {
    // 稀有度优先级：掉落项写死 > 模板写死 > 按怪物等级 roll（有 scale 时）> common。
    // 让"等级越高出好货"这件事自动发生，不必给每件装备手写 rarity。
    const rarity = (drop && drop.rarity) || (def && def.rarity)
      || (scale ? rollRarity(normalizeScale(scale).monsterLevel, r) : "common");
    const got = rollAffixes(affixPool, rarity, r, { slot: def && def.equipSlot });
    if (got.length) inst.affixes = got;
  }
  return inst;
}

// 整表 roll：defs 为 { name -> 模板 } 查询表（可为 null）。affixPool 为词缀定义数组（可选）。
export function rollDrops(drops, defs, rng, affixPool, scale) {
  const out = [];
  for (const d of drops || []) {
    const def = defs && defs[d && (d.name || d.id)];
    const got = rollDrop(d, def, rng, affixPool, scale);
    for (const e of got) mergeOrPush(out, e);
  }
  return out;
}

// 把条目并入结果列表：可堆叠且同名无实例则累加，否则追加。
export function mergeOrPush(list, entry) {
  if (!entry.inst) {
    for (const e of list) {
      if (!e.inst && e.name === entry.name) { e.count += entry.count; return; }
    }
  }
  list.push({ name: entry.name, count: entry.count || 1, inst: entry.inst || undefined });
}
