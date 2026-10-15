// 地面掉落物：投掷、查询、拾取。运行时状态 g 由调用方注入。
import { itemByName } from "../core/registry.js";
import { addItem, canAddItem } from "../systems/inventory.js";
import { playSound } from "../systems/audio.js";

export function dropGround(g, name, x, y, count) {
  if (!itemByName(name)) return;
  const jx = (Math.random() - 0.5) * 22, jy = (Math.random() - 0.5) * 10;
  g.ground.push({ name, count: count || 1, x: x + jx, y: y + jy, t: 0 });
}

export function groundAt(g, wx, wy) {
  for (let i = g.ground.length - 1; i >= 0; i--) {
    const gr = g.ground[i];
    if (Math.hypot(wx - gr.x, wy - gr.y) < 20) return gr;
  }
  return null;
}

export function pickupGround(g, gr) {
  if (!gr) return false;
  if (g.ground.indexOf(gr) < 0) return false;
  if (!canAddItem(g, gr.name, gr.count || 1)) { g.tip = "物品栏已满，无法拾取"; g.tipT = 2; return false; }
  addItem(g, gr.name, gr.count || 1);
  const i = g.ground.indexOf(gr); if (i >= 0) g.ground.splice(i, 1);
  playSound(g, "pick_item.wav");
  g.tip = "拾取 " + gr.name; g.tipT = 1.5;
  return true;
}
