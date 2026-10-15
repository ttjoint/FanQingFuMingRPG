// 商店：货源、开关、买入 / 卖出。运行时上下文 ctx 由调用方注入。
import { itemByName } from "../core/registry.js";
import { addItem, canAddItem, setSlot, reindex } from "./inventory.js";
import { syncMissions } from "./missions.js";
import { playSound } from "./audio.js";
import { entryOf } from "../core/layout.js";

export function shopGoods(ctx, n) {
  if (!n) return null;
  const A = ctx.assets;
  if (n.name === "冰糖葫芦贩") return ["冰糖葫芦"];
  if (n.model === "卖药人") return A.items.filter(i => i.type === 0 && (i.hp > 0 || i.mp > 0) && i.price > 0 && (i.name.includes("药") || i.name.includes("水"))).map(i => i.name);
  if (n.model === "卖武器者") return A.items.filter(i => i.type === 1 && i.price > 0).map(i => i.name);
  if (n.model === "卖装备者") return A.items.filter(i => (i.type === 2 || i.type === 3) && i.price > 0).map(i => i.name);
  return null;
}

export function openShop(ctx, n) {
  const G = ctx.state;
  G.shop = { npc: n, goods: shopGoods(ctx, n) }; G.packOpen = false; G.panel = null; G.tip = null; G.tipT = 0;
}

export function closeShop(ctx) {
  const G = ctx.state;
  if (G.cursor) { if (G.cursor.fromShop) G.cursor = null; else { addItem(G, G.cursor.name, G.cursor.count || 1); G.cursor = null; } }
  G.shop = null;
}

export function buyItem(ctx, name, cnt) {
  const G = ctx.state;
  const it = itemByName(name); if (!it) return false;
  cnt = cnt || 1;
  const price = (it.price || 0) * cnt;
  if (G.stats.money < price) { G.tip = "银两不足"; G.tipT = 2; return false; }
  if (!canAddItem(G, name, cnt)) { G.tip = "物品栏已满"; G.tipT = 2; return false; }
  G.stats.money -= price; addItem(G, name, cnt); playSound(G, "buy.wav");
  G.tip = "买入 " + name + " -" + price; G.tipT = 2; return true;
}

// 把光标里的商店商品买进指定格子（空格新建 / 同类堆叠加）
export function buyInto(ctx, slot) {
  const G = ctx.state;
  const c = G.cursor; if (!c || !c.fromShop) return false;
  const it = itemByName(c.name); if (!it) return false;
  const price = it.price || 0;
  if (G.stats.money < price) { G.tip = "银两不足"; G.tipT = 2; return false; }
  const entry = entryOf(slot);
  if (entry) entry.count += 1;
  else setSlot(G, slot.kind, slot.key, { name: c.name, count: 1 });
  G.stats.money -= price; playSound(G, "buy.wav"); reindex(G); syncMissions(G, c.name);
  G.tip = "买入 " + c.name + " -" + price; G.tipT = 2; return true;
}

export function sellCursor(ctx) {
  const G = ctx.state;
  const c = G.cursor; if (!c || c.fromShop) return;
  const it = itemByName(c.name), n = c.count || 1;
  const gain = Math.max(1, Math.floor((it ? it.price : 0) / 2)) * n;
  G.stats.money += gain; G.cursor = null; playSound(G, "sell.wav");
  G.tip = "卖出 " + c.name + " +" + gain; G.tipT = 2; reindex(G);
}
