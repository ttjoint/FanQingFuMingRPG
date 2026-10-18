// 商店：货源、开关、买入 / 卖出。运行时上下文 ctx 由调用方注入。
import { itemByName } from "../core/registry.js";
import { addItem, canAddItem, setSlot, reindex } from "./inventory.js";
import { syncMissions } from "./missions.js";
import { playSound } from "./audio.js";
import { entryOf } from "../core/layout.js";
import { goodsList } from "../engine/inventory.js";
import { CFG } from "../core/config.js";

// 货物背包 / 货源逻辑见 engine/inventory.js（纯函数，可独立测试）。
export { hasGoods, goodsList } from "../engine/inventory.js";

// 商店货源：由单位的「货物背包」组件（inventory）驱动，与 NPC 名称/模型解耦。
// 无背包 / 空背包 = 非商人，返回 null（不会开店）。
export function shopGoods(ctx, n) {
  const inv = n && n.inventory;
  const list = goodsList(inv, ctx.assets.items);
  return list && list.length ? list : null;
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
  const it = itemByName(ctx, name); if (!it) return false;
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
  const it = itemByName(ctx, c.name); if (!it) return false;
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
  const it = itemByName(ctx, c.name), n = c.count || 1;
  const rate = (CFG.economy && CFG.economy.sellRate != null) ? CFG.economy.sellRate : 0.5;
  const gain = Math.max(1, Math.floor((it ? it.price : 0) * rate)) * n;
  G.stats.money += gain; G.cursor = null; playSound(G, "sell.wav");
  G.tip = "卖出 " + c.name + " +" + gain; G.tipT = 2; reindex(G);
}
