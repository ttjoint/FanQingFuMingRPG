// 物品栏 / 装备栏 / 背包 / 商店格子的点击处理。
import { G } from "../core/state.js";
import { stateOf } from "../render/frame.js";
import { storeFromPack } from "../systems/stash.js";
import { getRuntime } from "../runtime/context.js";
import { itemByName } from "../core/registry.js";
import { setSlot, reindex, applyBonus, equipSlotFor, useEntry, socketInto, unsocketFrom, enhanceEntry } from "../systems/inventory.js";
import { buyItem, buyInto, sellCursor } from "../systems/shop.js";
import { playSound } from "../systems/audio.js";
import { entryOf } from "../core/layout.js";


// P5：视图层的状态入口。
// 允许调用方显式传入运行时（rt）或游戏状态（g），不传则回退到当前全局实例。

export function handleSlotClick(slot, button, shift, rt, ctrl) {
  rt = rt || getRuntime();
  const G = stateOf(rt);
  if (slot.kind === "shop") {
    const name = G.shop.goods[slot.key];
    if (button === 2) { buyItem(rt, name, 1); return; }
    if (!G.cursor) { G.cursor = { name, count: 1, fromShop: true }; playSound(G, "pick_item.wav"); }
    else if (!G.cursor.fromShop) sellCursor(rt);
    else G.cursor = null;                 // 再次点商品格 = 放下（取消拖拽）
    return;
  }
  const entry = entryOf(slot);
  if (button === 2) {
    if (!entry) return;
    // 仓库打开时，右键背包物品 = 存入仓库（这时的语境就是整理）。
    // 否则右键仍是"使用/装备"，不改既有手感。
    if (G.stashPanel && slot.kind === "pack") { storeFromPack(rt, Number(slot.key)); return; }
    // 装备格：Shift+右键 = 强化；Ctrl+右键 = 取下一个孔的宝石（从前往后）；
    // 普通右键 = 卸下（沿用原行为）。
    if (slot.kind === "equip" && shift) { enhanceEntry(G, entry); return; }
    if (slot.kind === "equip" && ctrl) {
      // 找第一个有宝石的孔，取下后放进背包（背包满时提示并保留宝石）。
      const socks = entry.inst && entry.inst.sockets;
      if (!socks || !socks.length) { G.tip = "该装备没有孔"; G.tipT = 2; return; }
      const idx = socks.findIndex(Boolean);
      if (idx < 0) { G.tip = "没有可取的宝石"; G.tipT = 2; return; }
      if (unsocketFrom(G, entry, idx)) playSound(G, "drop_item.wav");
      return;
    }
    useEntry(G, entry, slot.kind, slot.key); return;
  }
  // 手上是从商店拿起的商品：只有“空格或可叠放的同类格”左键才算购入，否则放下
  if (G.cursor && G.cursor.fromShop) {
    if (button !== 0) { G.cursor = null; return; }
    const it = itemByName(G, G.cursor.name);
    const stackable = it && (it.type === 0 || it.type === 8 || it.type === 4);
    if (!entry || (entry.name === G.cursor.name && stackable)) {
      if (buyInto(rt, slot)) G.cursor = null;
    } else { G.cursor = null; }
    return;
  }
  if (!G.cursor) {
    if (!entry) return;
    if (slot.kind === "equip") { const it = itemByName(entry.name); if (it) applyBonus(G, it, -1, entry); }
    G.cursor = entry; setSlot(G, slot.kind, slot.key, null); reindex(G); playSound(G, "pick_item.wav");
  } else if (!entry) {
    if (G.cursor.fromShop) { if (buyItem(rt, G.cursor.name, 1)) G.cursor = null; return; }
    setSlot(G, slot.kind, slot.key, G.cursor); G.cursor = null; reindex(G); playSound(G, "drop_item.wav");
  } else {
    if (G.cursor.fromShop) { if (buyItem(rt, G.cursor.name, 1)) G.cursor = null; return; }
    // 手上是宝石、目标是装备：尝试镶嵌（而不是交换）。
    if (slot.kind === "equip") {
      const gemIt = itemByName(G, G.cursor.name);
      if (gemIt && (gemIt.kind === "gem" || gemIt.type === 9)) {
        if (socketInto(G, entry, G.cursor, null, null)) { G.cursor = null; playSound(G, "drop_item.wav"); return; }
        // 镶嵌失败（如孔满）则回落到普通交换提示。
      }
      const it = itemByName(G.cursor.name), tgt = equipSlotFor(G, it);
      if (tgt !== slot.key) { G.tip = "不能放入该装备格"; G.tipT = 2; return; }
      const ei = itemByName(entry.name); if (ei) applyBonus(G, ei, -1, entry); applyBonus(G, it, +1, G.cursor);
    }
    setSlot(G, slot.kind, slot.key, G.cursor); G.cursor = entry; reindex(G);
  }
}
