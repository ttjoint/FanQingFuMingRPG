// 物品栏 / 装备栏 / 背包 / 升级。运行时状态 g 由调用方注入。
import { itemByName } from "../core/registry.js";
import { CFG } from "../core/config.js";
import { syncMissions } from "./missions.js";

export function countItem(g, name) {
  let n = 0;
  for (const s of g.hotbar) if (s && s.name === name) n += s.count;
  for (const s of g.pack) if (s && s.name === name) n += s.count;
  for (const k in g.equip) if (g.equip[k] && g.equip[k].name === name) n += 1;
  return n;
}

export function reindex(g) {
  g.inventory = {};
  for (const s of g.hotbar) if (s) g.inventory[s.name] = (g.inventory[s.name] || 0) + s.count;
  for (const s of g.pack) if (s) g.inventory[s.name] = (g.inventory[s.name] || 0) + s.count;
  for (const k in g.equip) if (g.equip[k]) g.inventory[g.equip[k].name] = (g.inventory[g.equip[k].name] || 0) + 1;
}

export function freeSlot(g) {
  for (let i = 0; i < 9; i++) if (!g.hotbar[i]) return { kind: "hotbar", i };
  // 拥有“包裹”时自动开启 16 格背包
  if (!g.pack.length && countItem(g, "包裹") > 0) g.pack = new Array(25).fill(null);
  for (let i = 0; i < g.pack.length; i++) if (!g.pack[i]) return { kind: "pack", i };
  return null;
}

export function setSlot(g, kind, key, val) {
  if (kind === "hotbar") g.hotbar[key] = val;
  else if (kind === "pack") g.pack[key] = val;
  else if (kind === "equip") g.equip[key] = val;
}

// 能否再容纳 count 个该物品（可叠放物品已有同类堆也算能）
export function canAddItem(g, name, cnt) {
  const it = itemByName(name) || {};
  const stackable = it.type === 0 || it.type === 8 || it.type === 4;
  if (stackable) for (const list of [g.hotbar, g.pack]) for (const s of list) if (s && s.name === name) return true;
  return !!freeSlot(g);
}

export function addItem(g, name, cnt) {
  if (!name) return;
  cnt = cnt || 1;
  if (cnt < 0) { removeItem(g, name, -cnt); return; }
  const it = itemByName(name) || {};
  const stackable = it.type === 0 || it.type === 8 || it.type === 4;
  if (stackable) {
    for (const list of [g.hotbar, g.pack]) for (const s of list) if (s && s.name === name) { s.count += cnt; reindex(g); syncMissions(g, name); return; }
  }
  const free = freeSlot(g);
  if (free) { setSlot(g, free.kind, free.i, { name, count: cnt }); reindex(g); syncMissions(g, name); return; }
  g.tip = "背包已满，丢弃 " + name; g.tipT = 2;
}

export function removeItem(g, name, cnt) {
  let need = cnt || 1;
  for (const list of [g.hotbar, g.pack]) for (let i = 0; i < list.length; i++) {
    const s = list[i]; if (!s || s.name !== name) continue;
    const take = Math.min(need, s.count); s.count -= take; need -= take;
    if (s.count <= 0) list[i] = null;
    if (need <= 0) break;
  }
  if (need > 0) for (const k in g.equip) { const s = g.equip[k];
    if (s && s.name === name) { const it = itemByName(name); if (it) applyBonus(g, it, -1); g.equip[k] = null; need--; if (need <= 0) break; } }
  reindex(g); syncMissions(g, name);
}

export function addExp(g, n) {
  g.stats.exp += n;
  const L = CFG.levelUp;
  while (g.stats.exp >= g.stats.expNext && g.stats.level < (L.maxLevel || 99)) {
    g.stats.exp -= g.stats.expNext;
    g.stats.level++;
    g.stats.expNext = Math.round(g.stats.expNext * L.expMul + L.expAdd);
    g.stats.hpMax += L.hpMax; g.stats.mpMax += L.mpMax;
    if (L.healOnLevel !== false) { g.stats.hp = g.stats.hpMax; g.stats.mp = g.stats.mpMax; }
    g.stats.attack += L.attack; g.stats.defence += L.defence; g.stats.hit += L.hit;
    g.tip = "升级！等级 " + g.stats.level; g.tipT = 4;
  }
}

// ---- 装备加成 ----
export function applyBonus(g, it, sign) {
  if (!it) return;
  g.stats.attack += sign * (it.attack || 0);
  g.stats.defence += sign * (it.defence || 0);
  g.stats.hit += sign * (it.attrA || 0);
}

export function equipSlotFor(g, it) {
  if (it.type === 1) return "Wu";
  if (it.type === 2) return "Jia";
  if (it.type === 3) return (g.equip.Shi1 && !g.equip.Shi2) ? "Shi2" : "Shi1";
  return null;
}

export function equipFrom(g, entry, kind, key) {
  const it = itemByName(entry.name), target = equipSlotFor(g, it);
  if (!target) { g.tip = "无法装备"; g.tipT = 2; return; }
  entry.count--; if (entry.count <= 0) setSlot(g, kind, key, null);
  const old = g.equip[target];
  if (old) { const f = freeSlot(g); if (f) setSlot(g, f.kind, f.i, old); }
  g.equip[target] = { name: entry.name, count: 1 };
  applyBonus(g, it, +1); reindex(g);
  g.tip = "装备 " + entry.name; g.tipT = 2;
}

export function useEntry(g, entry, kind, key) {
  if (!entry) return;
  const it = itemByName(entry.name); if (!it) return;
  if (it.type === 0) {
    if (it.hp) g.stats.hp = Math.min(g.stats.hpMax, g.stats.hp + it.hp);
    if (it.mp) g.stats.mp = Math.min(g.stats.mpMax, g.stats.mp + it.mp);
    entry.count--; if (entry.count <= 0) setSlot(g, kind, key, null);
    reindex(g); syncMissions(g, entry.name);
    g.tip = "使用 " + entry.name; g.tipT = 2;
  } else if (it.type === 1 || it.type === 2 || it.type === 3) {
    if (kind === "equip") {
      applyBonus(g, it, -1); setSlot(g, kind, key, null);
      const f = freeSlot(g); if (f) setSlot(g, f.kind, f.i, { name: entry.name, count: 1 });
      reindex(g); g.tip = "卸下 " + entry.name; g.tipT = 2;
    } else equipFrom(g, entry, kind, key);
  } else if (it.type === 4) {
    if (!g.skills.includes(entry.name)) { g.skills.push(entry.name); g.skill = entry.name; }
    entry.count--; if (entry.count <= 0) setSlot(g, kind, key, null);
    reindex(g); g.tip = "学会 " + entry.name; g.tipT = 2;
  } else if (it.type === 7) {
    g.packOpen = !g.packOpen; g.pack = g.pack.length ? g.pack : new Array(25).fill(null);
  } else {
    g.tip = entry.name + " 无法使用"; g.tipT = 2;
  }
}

export function useItemSlot(g, i) { const s = g.hotbar[i]; if (s) useEntry(g, s, "hotbar", i); }
