// 系统层：铁匠（赌博 / 鉴定 / 修理）。负责读写 G、扣金币、发提示。
// 纯计算在 engine/smith.js，掉落实例生成复用 engine/lootTable.js。
import { makeDropInstance } from "../engine/lootTable.js";
import { rollRarity } from "../engine/lootScale.js";
import {
  repairCost, repairEntry, repairAllCost, isUnidentified, identifyCost,
  identifyEntry, gamblePrice, gamblePool,
} from "../engine/smith.js";
import { addItem, reindex, freeSlot } from "./inventory.js";
import { playSound } from "./audio.js";

// 打开/关闭铁匠面板（与商店、存档、仓库、传送点互斥）。
export function toggleSmith(ctx, force) {
  const G = ctx.state;
  const want = force == null ? !G.smithPanel : !!force;
  G.smithPanel = want;
  if (want) { G.shop = null; G.savePanel = false; G.waypointPanel = false; G.stashPanel = false; }
  return want;
}

// 物品模板（ctx.assets.items 是数组）。
function defOf(ctx, name) {
  const items = (ctx.assets && ctx.assets.items) || [];
  return items.find(x => x && x.name === name) || null;
}

// 玩家身上所有带耐久的物品：[{ entry, def, where }]。
// 遍历装备格 + 背包（热键栏里的通常也能用，但修理只对装备/背包做——
// 热键栏放的是消耗品，给它修耐久没有意义）。
export function wearables(ctx) {
  const G = ctx.state;
  const out = [];
  const push = (e, where) => {
    if (!e || !e.inst) return;
    const def = defOf(ctx, e.name);
    if (repairCost(e, def, ctx.config) > 0) out.push({ entry: e, def, where });
  };
  for (const k in (G.equip || {})) push(G.equip[k], "equip:" + k);
  for (const e of (G.pack || [])) push(e, "pack");
  return out;
}

// 全部修理。返回 { ok, cost, count }。
export function repairAll(ctx) {
  const G = ctx.state;
  const list = wearables(ctx);
  const total = repairAllCost(list, ctx.config);
  if (!total) { G.tip = "没有需要修理的装备"; G.tipT = 2; return { ok: false, cost: 0, count: 0 }; }
  if ((G.stats.money || 0) < total) { G.tip = "银两不足（需 " + total + "）"; G.tipT = 2; return { ok: false, cost: total, count: 0 }; }
  G.stats.money -= total;
  let n = 0;
  // 钱已经扣过了，这里传剩余余额即可。**不能传 Infinity**：
  // engine/smith.js 的 num(Infinity) 会退化成 0（Number.isFinite 判定），
  // 导致每件都被判"金币不足"，钱扣了东西却没修。
  for (const it of list) {
    const r = repairEntry(it.entry, it.def, ctx.config, G.stats.money);
    if (r.ok) n++;
  }
  reindex(G);
  playSound(G, "buy.wav");
  G.tip = "修理 " + n + " 件 -" + total; G.tipT = 2;
  return { ok: true, cost: total, count: n };
}

// 单件修理（UI 点到某格时用）。slot 形如 { kind, key }。
export function repairSlot(ctx, slot) {
  const G = ctx.state;
  const entry = slotEntry(G, slot);
  if (!entry) return { ok: false, cost: 0, reason: "空格" };
  const def = defOf(ctx, entry.name);
  const cost = repairCost(entry, def, ctx.config);
  if (!cost) { G.tip = "无需修理"; G.tipT = 1.5; return { ok: false, cost: 0, reason: "无需修理" }; }
  const r = repairEntry(entry, def, ctx.config, G.stats.money || 0);
  if (r.ok) { G.stats.money -= r.cost; reindex(G); playSound(G, "buy.wav"); G.tip = "修理 " + entry.name + " -" + r.cost; G.tipT = 2; }
  else { G.tip = r.reason + "（需 " + r.cost + "）"; G.tipT = 2; }
  return r;
}

// 取某格上的 entry（与 layout 的 entryOf 同语义，但避免 input 依赖）。
function slotEntry(G, slot) {
  if (!slot) return null;
  if (slot.kind === "equip") return (G.equip || {})[slot.key] || null;
  if (slot.kind === "pack") return (G.pack || [])[Number(slot.key)] || null;
  if (slot.kind === "hotbar") return (G.hotbar || [])[Number(slot.key)] || null;
  return null;
}

// 鉴定单件。
export function identifySlot(ctx, slot) {
  const G = ctx.state;
  const entry = slotEntry(G, slot);
  if (!entry) return { ok: false, cost: 0, reason: "空格" };
  const r = identifyEntry(entry, ctx.config, G.stats.money || 0);
  if (r.ok) {
    if (r.cost > 0) G.stats.money -= r.cost;
    playSound(G, "pick_item.wav");
    G.tip = "鉴定 " + entry.name + (r.cost > 0 ? " -" + r.cost : ""); G.tipT = 2;
  } else { G.tip = r.reason; G.tipT = 2; }
  return r;
}

// 鉴定背包里所有未鉴定物品。
export function identifyAll(ctx) {
  const G = ctx.state;
  const list = (G.pack || []).filter(e => isUnidentified(e));
  if (!list.length) { G.tip = "没有待鉴定的物品"; G.tipT = 2; return { ok: false, cost: 0, count: 0 }; }
  let total = 0;
  for (const e of list) total += identifyCost(e, ctx.config);
  if ((G.stats.money || 0) < total) { G.tip = "银两不足（需 " + total + "）"; G.tipT = 2; return { ok: false, cost: total, count: 0 }; }
  let n = 0;
  // 同上：不要传 Infinity（num(Infinity) 会变成 0）。
  for (const e of list) if (identifyEntry(e, ctx.config, G.stats.money).ok) n++;
  G.stats.money -= total;
  playSound(G, "pick_item.wav");
  G.tip = "鉴定 " + n + " 件 -" + total; G.tipT = 2;
  return { ok: true, cost: total, count: n };
}

// 赌博：付钱换一件未鉴定装备。
// 与掉落的区别：掉落有确定来源，赌博是纯概率投入，产出必带 unid 标记
// （所以玩家开局看不到词缀，得再花一次鉴定费——金币有两级去处）。
export function gamble(ctx, rng) {
  const G = ctx.state;
  const r = typeof rng === "function" ? rng : Math.random;
  const price = gamblePrice(G.stats.level, ctx.config);
  const pool = gamblePool(ctx.assets.items);
  if (!pool.length) { G.tip = "没有可赌博的物品"; G.tipT = 2; return { ok: false, price, name: null }; }
  if ((G.stats.money || 0) < price) { G.tip = "银两不足（需 " + price + "）"; G.tipT = 2; return { ok: false, price, name: null }; }
  // freeSlot 返回槽位对象（不是下标），无空格时为 null。
  if (!freeSlot(G)) { G.tip = "物品栏已满"; G.tipT = 2; return { ok: false, price, name: null }; }
  const def = pool[Math.floor(r() * pool.length) % pool.length];
  const rarity = rollRarity(G.stats.level, r);
  const inst = makeDropInstance(def, { rarity }, r, ctx.assets.affixes || [], null);
  inst.unid = true;                       // 赌博产物一定未鉴定
  G.stats.money -= price;
  addItem(G, { name: def.name, count: 1, inst });
  reindex(G);
  playSound(G, "buy.wav");
  G.tip = "赌得 " + def.name + " -" + price; G.tipT = 2.5;
  return { ok: true, price, name: def.name, rarity };
}
