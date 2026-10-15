// 物品栏 / 装备栏 / 背包 / 商店格子的点击处理。
import { G } from "../core/state.js";
import { getRuntime } from "../runtime/context.js";
import { itemByName } from "../core/registry.js";
import { setSlot, reindex, applyBonus, equipSlotFor, useEntry } from "../systems/inventory.js";
import { buyItem, buyInto, sellCursor } from "../systems/shop.js";
import { playSound } from "../systems/audio.js";
import { entryOf } from "../core/layout.js";

export function handleSlotClick(slot, button) {
  const rt = getRuntime();
  if (slot.kind === "shop") {
    const name = G.shop.goods[slot.key];
    if (button === 2) { buyItem(rt, name, 1); return; }
    if (!G.cursor) { G.cursor = { name, count: 1, fromShop: true }; playSound(G, "pick_item.wav"); }
    else if (!G.cursor.fromShop) sellCursor(rt);
    else G.cursor = null;                 // 再次点商品格 = 放下（取消拖拽）
    return;
  }
  const entry = entryOf(slot);
  if (button === 2) { if (entry) useEntry(G, entry, slot.kind, slot.key); return; }
  // 手上是从商店拿起的商品：只有“空格或可叠放的同类格”左键才算购入，否则放下
  if (G.cursor && G.cursor.fromShop) {
    if (button !== 0) { G.cursor = null; return; }
    const it = itemByName(G.cursor.name);
    const stackable = it && (it.type === 0 || it.type === 8 || it.type === 4);
    if (!entry || (entry.name === G.cursor.name && stackable)) {
      if (buyInto(rt, slot)) G.cursor = null;
    } else { G.cursor = null; }
    return;
  }
  if (!G.cursor) {
    if (!entry) return;
    if (slot.kind === "equip") { const it = itemByName(entry.name); if (it) applyBonus(G, it, -1); }
    G.cursor = entry; setSlot(G, slot.kind, slot.key, null); reindex(G); playSound(G, "pick_item.wav");
  } else if (!entry) {
    if (G.cursor.fromShop) { if (buyItem(rt, G.cursor.name, 1)) G.cursor = null; return; }
    setSlot(G, slot.kind, slot.key, G.cursor); G.cursor = null; reindex(G); playSound(G, "drop_item.wav");
  } else {
    if (G.cursor.fromShop) { if (buyItem(rt, G.cursor.name, 1)) G.cursor = null; return; }
    if (slot.kind === "equip") {
      const it = itemByName(G.cursor.name), tgt = equipSlotFor(G, it);
      if (tgt !== slot.key) { G.tip = "不能放入该装备格"; G.tipT = 2; return; }
      const ei = itemByName(entry.name); if (ei) applyBonus(G, ei, -1); applyBonus(G, it, +1);
    }
    setSlot(G, slot.kind, slot.key, G.cursor); G.cursor = entry; reindex(G);
  }
}
