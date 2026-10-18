// 物品栏 / 装备栏 / 背包 / 升级。运行时状态 g 由调用方注入。
//
// 条目模型：{ name, count, inst? }
//   - inst 为空：旧的堆叠条目（可同名累加）。
//   - inst 存在：单件实例（count 恒为 1），带独立词缀/强化/耐久，不与其他条目堆叠。
// name 始终是「模板」主键（itemByName 可解析）。
import { itemByName } from "../core/registry.js";
import { setBonusTotal } from "../engine/uniqueItem.js";
import { getRuntime } from "../runtime/context.js";
import { CFG } from "../core/config.js";
import { syncMissions } from "./missions.js";
import { instanceStats, equipSlotOf, canStack as canStackEntries, normalizeInstance,
  socketGem as socketGemPure, unsocketGem as unsocketGemPure, canSocket,
  enhance as enhancePure, canEnhance, enhanceCost, wearDurability, isBroken,
  ELEMENT_MOD_KEYS } from "../engine/item.js";

// 条目的合并键：有实例的条目彼此不可合并（各自独立）。
function sameKind(a, b) {
  if (!a || !b) return false;
  if (a.inst || b.inst) return false;
  return a.name === b.name;
}

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
  // 拥有“包裹（PackItem）”道具时自动开启背包；名称与格数来自配置。
  const packItem = (CFG.inventory && CFG.inventory.packItem) || "包裹";
  const packSize = (CFG.inventory && CFG.inventory.packSize) || 25;
  if (!g.pack.length && countItem(g, packItem) > 0) g.pack = new Array(packSize).fill(null);
  for (let i = 0; i < g.pack.length; i++) if (!g.pack[i]) return { kind: "pack", i };
  return null;
}

export function setSlot(g, kind, key, val) {
  if (kind === "hotbar") g.hotbar[key] = val;
  else if (kind === "pack") g.pack[key] = val;
  else if (kind === "equip") g.equip[key] = val;
}

// 归一化一个「条目」：兼容旧的纯 name 字符串 / {name,count} / {name,count,inst}。
export function normalizeEntry(e) {
  if (!e) return null;
  if (typeof e === "string") return { name: e, count: 1 };
  if (!e.name) return null;
  const o = { name: e.name, count: e.count == null ? 1 : e.count };
  if (e.inst) { o.inst = normalizeInstance(e.inst); o.count = 1; }
  return o;
}

// 能否再容纳 count 个该物品（可叠放物品已有同类堆也算能）
export function canAddItem(g, name, cnt) {
  const it = itemByName(g, name) || {};
  const stackable = it.stackable !== false;
  if (stackable) for (const list of [g.hotbar, g.pack]) for (const s of list) if (s && !s.inst && s.name === name) return true;
  return !!freeSlot(g);
}

// 加入物品。entryOrName 可为字符串（兼容旧调用）/ {name,count} / {name,count,inst}。
export function addItem(g, entryOrName, cnt) {
  const entry = normalizeEntry(typeof entryOrName === "string" ? { name: entryOrName, count: cnt || 1 } : entryOrName);
  if (!entry) return;
  if (!entry.inst && entry.count < 0) { removeItem(g, entry.name, -entry.count); return; }
  const it = itemByName(g, entry.name) || {};
  const stackable = !entry.inst && it.stackable !== false;
  if (stackable) {
    for (const list of [g.hotbar, g.pack]) for (const s of list) {
      if (s && !s.inst && s.name === entry.name) {
        const max = it.maxStack || 99;
        if (s.count < max) { const take = Math.min(entry.count, max - s.count); s.count += take; entry.count -= take; }
        if (entry.count <= 0) { reindex(g); syncMissions(g, entry.name); return; }
      }
    }
  }
  // 剩余部分逐格放入（实例按各自条目放置）。
  while (entry.count > 0) {
    const free = freeSlot(g);
    if (!free) { g.tip = "背包已满，丢弃 " + entry.name; g.tipT = 2; break; }
    if (entry.inst) { setSlot(g, free.kind, free.i, { name: entry.name, count: 1, inst: entry.inst }); entry.count = 0; }
    else {
      const max = it.maxStack || 99;
      const put = Math.min(entry.count, max);
      setSlot(g, free.kind, free.i, { name: entry.name, count: put });
      entry.count -= put;
    }
    reindex(g); syncMissions(g, entry.name);
  }
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
    if (s && s.name === name) { const it = itemByName(g, name); if (it) applyBonus(g, it, -1); g.equip[k] = null; need--; if (need <= 0) break; } }
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
    g.stats.attack += L.attack; g.stats.defence += L.defence;
    g.stats.attackSpeed = (g.stats.attackSpeed || 0) + (L.attackSpeed || 0);
    g.tip = "升级！等级 " + g.stats.level; g.tipT = 4;
  }
}

// ---- 装备加成 ----
// 兼容旧签名：applyBonus(g, it, sign)（it 为模板）；新签名还可传 entry 以计入词缀。
export function applyBonus(g, it, sign, entry) {
  if (!it) return;
  // 已损坏的装备不再提供属性。
  if (sign > 0 && entry && isBroken(entry, it)) return;
  const st = entry ? instanceStats(entry, it, CFG.itemEnhance) : { atk: it.attack || 0, def: it.defence || 0, hit: it.attrA || 0 };
  g.stats.attack += sign * (st.atk || 0);
  g.stats.defence += sign * (st.def || 0);
  // 旧的"命中"属性已废除（命中改为距离判定），装备上的 hit 加成转投攻速，
  // 避免老物品数据/hit 字段变成"加了但没有任何效果"的废属性。
  g.stats.attackSpeed = (g.stats.attackSpeed || 0) + sign * (st.hit || 0);
  // 元素加成/抗性（P0）：直接累加到玩家身上供 engine/damage.js 读取。
  //
  // 这两个字段是**读取方早就写好、写入方一直缺失**的典型：
  // applyDamageBonus / resistOf 都已实现并带单测，但没有任何地方给
  // g.dmgBonus / g.resist 赋过值，于是所有元素词缀“写了等于没写”。
  // 与 stats 一样用 ±sign 增量维护，不出错就无需全量重算。
  applyElementBonus(g, st, sign);
}

// 把一份 instanceStats 的元素字段按 sign 增（+1）/减（-1）到 p 上。
// dmgXxx 累加成 g.dmgBonus[type]（百分数），resXxx 累加成 g.resist[type]。
function applyElementBonus(g, st, sign) {
  if (!st) return;
  const touched = [];
  for (const k of ELEMENT_MOD_KEYS || []) { if (st[k]) touched.push(k); }
  if (!touched.length) return;
  for (const k of touched) {
    const v = sign * (st[k] || 0);
    if (k.startsWith("res")) {
      const t = k.slice(3).toLowerCase();
      const cur = resistMapOf(g);
      const nv = (cur[t] || 0) + v;
      // 归零就删键：避免背包反复穿脱后 g.resist 里堆一堆 0。
      if (nv) cur[t] = nv; else delete cur[t];
      g.resist = cur;
    } else {
      const t = k.slice(3).toLowerCase();
      if (!g.dmgBonus) g.dmgBonus = {};
      const nv = (g.dmgBonus[t] || 0) + v;
      if (nv) g.dmgBonus[t] = nv; else delete g.dmgBonus[t];
    }
  }
}

// 把 g.resist 归一成 { type: value } 映射（兼容旧的数字/数组写法）。
function resistMapOf(g) {
  const r = g.resist;
  if (!r) return {};
  if (typeof r === "number") return r ? { all: r } : {};
  if (Array.isArray(r)) {
    const out = {};
    for (const e of r) {
      if (!e) continue;
      const t = e.type || "all";
      out[t] = (out[t] || 0) + (typeof e.value === "number" ? e.value : 0);
    }
    return out;
  }
  if (typeof r === "object") return { ...r };
  return {};
}

// 套装加成（P4）：按已穿件数算阶梯加成，把差额补进 stats。
// 用"减旧值 + 加新值"而不是全量重算 stats ——
// stats 里还混着升级/药水/任务给的永久值，全量重算会把它们抹掉。
// 记录上次加成在 G.setBonusApplied，只动差额。
export function applySetBonus(g, A) {
  // A 可选：调用方没传时自己取运行时（equipFrom 的签名被 input/slots 各处复用，
  // 逐个改签名不如在这里兜一层）。
  if (!A) { try { A = getRuntime(); } catch (e) { A = null; } }
  // 运行时把内容表挂在 content 上（rt.content.sets），不是 rt.sets。
  const sets = (A && (A.sets || (A.content && A.content.sets))) || [];
  if (!sets.length) return;
  const worn = [];
  for (const k in (g.equip || {})) { const e = g.equip[k]; if (e && e.name) worn.push(e.name); }
  const total = setBonusTotal(sets, worn).mods;
  const prev = g.setBonusApplied || {};
  // mods 的键名与 stats 的字段名**不一致**：mods 用 atk/def，stats 用
  // attack/defence。直接 stats[key] 会写出 stats.atk 这种没人读的字段
  // （加成"生效了"但面板和战斗都不变）。
  const MAP = { atk: "attack", def: "defence", hp: "hp", mp: "mp" };
  const put = (key) => {
    const d = (total[key] || 0) - (prev[key] || 0);
    const st = MAP[key];
    if (d && st) g.stats[st] = (g.stats[st] || 0) + d;
  };
  put("atk"); put("def"); put("hp"); put("mp");
  // 与 applyBonus 保持一致：hit（命中）与 spd（攻速）都转投人物攻速。
  const spdD = ((total.hit || 0) - (prev.hit || 0)) + ((total.spd || 0) - (prev.spd || 0));
  if (spdD) g.stats.attackSpeed = (g.stats.attackSpeed || 0) + spdD;
  g.setBonusApplied = { ...total };
}

// 装备槽位：模板的 equipSlot 优先（weapon/armor/trinket），映射到装备栏的 Wu/Jia/Shi1/Shi2。
export function equipSlotFor(g, it) {
  const slot = equipSlotOf(it);
  if (slot === "weapon" || slot === "Wu") return "Wu";
  if (slot === "armor" || slot === "Jia") return "Jia";
  if (slot === "trinket" || slot === "Shi1" || slot === "Shi2")
    return (g.equip.Shi1 && !g.equip.Shi2) ? "Shi2" : "Shi1";
  return null;
}

export function equipFrom(g, entry, kind, key) {
  const it = itemByName(g, entry.name), target = equipSlotFor(g, it);
  if (!target) { g.tip = "无法装备"; g.tipT = 2; return; }
  // 取出一件（实例条目整件取出；堆叠条目减一）。
  const moved = entry.inst ? { name: entry.name, count: 1, inst: entry.inst } : { name: entry.name, count: 1 };
  entry.count -= 1; if (entry.count <= 0) setSlot(g, kind, key, null);
  const old = g.equip[target];
  if (old) { const f = freeSlot(g); if (f) setSlot(g, f.kind, f.i, old); }
  g.equip[target] = moved;
  applyBonus(g, it, +1, moved); applySetBonus(g); reindex(g);
  g.tip = "装备 " + entry.name; g.tipT = 2;
}

export function useEntry(g, entry, kind, key) {
  if (!entry) return;
  const it = itemByName(g, entry.name); if (!it) return;
  const kindTag = it.kind || (it.type === 1 ? "weapon" : it.type === 2 ? "armor" : it.type === 3 ? "trinket" : it.type === 0 ? "consumable" : it.type === 4 ? "scroll" : it.type === 7 ? "pack" : "misc");
  if (kindTag === "consumable") {
    // 使用效果数据化：优先 it.use，其次回退 to 旧 hp/mp 字段。
    const u = it.use || {};
    const hp = u.hp != null ? u.hp : (it.hp || 0);
    const mp = u.mp != null ? u.mp : (it.mp || 0);
    if (hp) g.stats.hp = Math.min(g.stats.hpMax, g.stats.hp + hp);
    if (mp) g.stats.mp = Math.min(g.stats.mpMax, g.stats.mp + mp);
    entry.count--; if (entry.count <= 0) setSlot(g, kind, key, null);
    reindex(g); syncMissions(g, entry.name);
    g.tip = "使用 " + entry.name; g.tipT = 2;
  } else if (kindTag === "weapon" || kindTag === "armor" || kindTag === "trinket") {
    if (kind === "equip") {
      applyBonus(g, it, -1, entry); setSlot(g, kind, key, null); applySetBonus(g);
      const f = freeSlot(g); if (f) setSlot(g, f.kind, f.i, entry);
      reindex(g); g.tip = "卸下 " + entry.name; g.tipT = 2;
    } else equipFrom(g, entry, kind, key);
  } else if (kindTag === "scroll") {
    // 技能书：learn 为目标技能名（缺省用物品名，兼容旧数据）。
    const learn = (it.use && it.use.learn) || entry.name;
    if (!g.skills.includes(learn)) { g.skills.push(learn); g.skill = learn; }
    entry.count--; if (entry.count <= 0) setSlot(g, kind, key, null);
    reindex(g); g.tip = "学会 " + learn; g.tipT = 2;
  } else if (kindTag === "pack") {
    g.packOpen = !g.packOpen; g.pack = g.pack.length ? g.pack : new Array((CFG.inventory && CFG.inventory.packSize) || 25).fill(null);
  } else {
    g.tip = entry.name + " 无法使用"; g.tipT = 2;
  }
}

export function useItemSlot(g, i) { const s = g.hotbar[i]; if (s) useEntry(g, s, "hotbar", i); }

// ---- 镶嵌 / 强化 / 耐久 ----
// 装备中条目的属性变更需「先减旧加成、再应用变更、再加新加成」，否则面板数值会漂移。
function findEquipKey(g, entry) {
  for (const k in g.equip) if (g.equip[k] === entry) return k;
  return null;
}
function withStatRefresh(g, entry, mutate) {
  const key = findEquipKey(g, entry);
  const it = itemByName(g, entry.name);
  if (key && it) applyBonus(g, it, -1, entry);   // 减掉旧值
  const r = mutate();
  if (key && it) applyBonus(g, it, +1, entry);   // 加回新值
  if (key && it) applySetBonus(g);
  reindex(g);
  return r;
}

// 把背包里的一颗宝石（条目）镶嵌到目标装备的孔中。
export function socketInto(g, equipEntry, gemEntry, gemKind, gemKey) {
  if (!equipEntry || !gemEntry) return false;
  const r = canSocket(equipEntry, gemEntry);
  if (!r.ok) { g.tip = r.reason; g.tipT = 2; return false; }
  if (findEquipKey(g, equipEntry) != null) {
    withStatRefresh(g, equipEntry, () => socketGemPure(equipEntry, gemEntry));
  } else socketGemPure(equipEntry, gemEntry);
  // 消耗一颗宝石。
  if (gemKind && gemKey != null) {
    const slot = gemKind === "hotbar" ? g.hotbar[gemKey] : gemKind === "pack" ? g.pack[gemKey] : null;
    if (slot) { slot.count -= 1; if (slot.count <= 0) setSlot(g, gemKind, gemKey, null); }
  } else removeItem(g, gemEntry.name, 1);
  g.tip = "镶嵌 " + gemEntry.name; g.tipT = 2;
  reindex(g);
  return true;
}

// 从装备指定孔取出宝石 → 返回宝石条目（调用方负责放入背包）。
export function unsocketFrom(g, equipEntry, slotIdx) {
  if (!equipEntry) return null;
  let gem = null;
  if (findEquipKey(g, equipEntry) != null) {
    gem = withStatRefresh(g, equipEntry, () => unsocketGemPure(equipEntry, slotIdx));
  } else gem = unsocketGemPure(equipEntry, slotIdx);
  if (!gem) { g.tip = "该孔没有宝石"; g.tipT = 2; return null; }
  const f = freeSlot(g);
  if (f) setSlot(g, f.kind, f.i, gem); else { g.tip = "背包已满，宝石丢失"; g.tipT = 2; return null; }
  reindex(g);
  g.tip = "取下 " + gem.name; g.tipT = 2;
  return gem;
}

// 强化：花费金币 +1，返回是否成功。
export function enhanceEntry(g, entry) {
  const cfg = Object.assign({}, CFG.items, CFG.itemEnhance);
  const r = canEnhance(entry, cfg);
  if (!r.ok) { g.tip = r.reason; g.tipT = 2; return false; }
  const cost = enhanceCost(itemByName(g, entry.name), entry.inst.enhance, cfg);
  if ((g.stats.money || 0) < cost) { g.tip = "金币不足（需 " + cost + "）"; g.tipT = 2; return false; }
  g.stats.money -= cost;
  if (findEquipKey(g, entry) != null) withStatRefresh(g, entry, () => enhancePure(entry, cfg));
  else enhancePure(entry, cfg);
  g.tip = "强化成功 +" + entry.inst.enhance; g.tipT = 2;
  reindex(g);
  return true;
}

// 磨损装备（命中/被击时调用）；装备磨损会同步降低其属性。
export function wearEquip(g, key, amount) {
  const e = g.equip[key];
  if (!e || !e.inst) return;
  const it = itemByName(g, e.name);
  const before = isBroken(e, it), dur = e.inst.durability;
  if (!dur) return;
  withStatRefresh(g, e, () => wearDurability(e, amount));
  if (e.inst.durability !== dur && !before && isBroken(e, it)) {
    g.tip = e.name + " 已损坏"; g.tipT = 2;
  }
}

// 供外部（掉落 / 商店）判断两个条目是否可堆叠合并。
export { canStackEntries };
