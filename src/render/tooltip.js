// 鼠标旁的物品信息提示框。
import { G } from "../core/state.js";
import { VW, VH, ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { itemByName } from "../core/registry.js";
import { slotAt, displayEntry } from "../core/layout.js";

export function itemInfoLines(it) {
  const L = [it.name];
  if (it.price > 0) L.push("价格：" + it.price + " 文");
  if (it.reqLevel > 0) L.push("等级限制：" + it.reqLevel);
  if (it.hp) L.push("生命 +" + it.hp);
  if (it.mp) L.push("精力 +" + it.mp);
  if (it.attack) L.push("攻击 +" + it.attack);
  if (it.defence) L.push("防御 +" + it.defence);
  if (it.attrA) L.push("命中 +" + it.attrA);
  if (it.desc) L.push(it.desc);
  return L;
}

export function drawTooltip() {
  if (G.savePanel || G.settingsPanel) return;
  const slot = slotAt(G.mouse.sx, G.mouse.sy);
  const entry = displayEntry(slot);
  if (!entry) return;
  const it = itemByName(entry.name);
  if (!it) return;
  const lines = itemInfoLines(it);
  ctx.font = "12px 'Microsoft YaHei',SimHei,sans-serif";
  const MAXW = 210;   // 过长的描述/名称截断，避免提示框超出屏幕
  for (let i = 0; i < lines.length; i++) {
    if (ctx.measureText(lines[i]).width <= MAXW) continue;
    let s = lines[i];
    while (s.length && ctx.measureText(s + "…").width > MAXW) s = s.slice(0, -1);
    lines[i] = s + "…";
  }
  let tw = 0; for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width);
  const pad = 8, lh = 16;
  const bw = tw + pad * 2 + 30, bh = lines.length * lh + pad * 2 - 4;
  let x = G.mouse.sx + 18, y = G.mouse.sy + 12;
  if (x + bw > VW) x = G.mouse.sx - bw - 8;
  if (x < 2) x = 2;
  if (y + bh > VH) y = VH - bh - 4;
  if (y < 2) y = 2;
  ctx.fillStyle = "rgba(12,10,8,0.94)"; ctx.fillRect(x, y, bw, bh);
  ctx.strokeStyle = "#b8a468"; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, bw - 1, bh - 1);
  const im = it.icon ? getImg("assets/items_icons/" + it.icon.replace(/\.bmp$/, ".png")) : null;
  if (im) ctx.drawImage(im, x + pad, y + pad + 2, 28, 28);
  const tx = x + pad + (im ? 34 : 0);
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? "#ffe9a8" : (i === 1 && it.price > 0 ? "#9fd0ff" : "#d8d0b8");
    ctx.fillText(l, tx, y + pad + 11 + i * lh);
  });
}
