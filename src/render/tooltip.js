// 鼠标旁的物品信息提示框。
import { G } from "../core/state.js";
import { VW, VH, ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { itemByName } from "../core/registry.js";
import { slotAt, displayEntry } from "../core/layout.js";
import { displayName, instanceStats, rarityColor } from "../engine/item.js";

export function itemInfoLines(it, entry) {
  const st = entry && entry.inst ? instanceStats(entry, it) : null;
  const L = [entry && entry.inst ? displayName(entry, it) : it.name];
  if (it.rarity && it.rarity !== "common") L.push("稀有度：" + rarityLabel(it.rarity));
  if (it.price > 0) L.push("价格：" + it.price + " 文");
  if (it.reqLevel > 0) L.push("等级限制：" + it.reqLevel);
  const hp = st ? st.hp : it.hp, mp = st ? st.mp : it.mp;
  const atk = st ? st.atk : it.attack, def = st ? st.def : it.defence, hit = st ? st.hit : it.attrA;
  if (hp) L.push("生命 +" + hp);
  if (mp) L.push("精力 +" + mp);
  if (atk) L.push("攻击 +" + atk);
  if (def) L.push("防御 +" + def);
  if (hit) L.push("命中 +" + hit);
  if (entry && entry.inst) {
    for (const af of entry.inst.affixes || []) if (af && af.name) L.push("· " + af.name);
    if (entry.inst.enhance) L.push("强化 +" + entry.inst.enhance);
    if (it.maxDurability) L.push("耐久 " + (entry.inst.durability != null ? entry.inst.durability : it.maxDurability) + "/" + it.maxDurability);
  }
  if (it.desc) L.push(it.desc);
  return L;
}

export function rarityLabel(r) {
  return ({ common: "普通", magic: "精良", rare: "稀有", unique: "传说", quest: "任务" })[r] || r;
}

export function drawTooltip() {
  if (G.savePanel || G.settingsPanel) return;
  const slot = slotAt(G.mouse.sx, G.mouse.sy);
  const entry = displayEntry(slot);
  if (!entry) return;
  const it = itemByName(entry.name);
  if (!it) return;
  const lines = itemInfoLines(it, entry);
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
  const nameColor = it.rarity && it.rarity !== "common" ? rarityColor(it.rarity) : "#ffe9a8";
  lines.forEach((l, i) => {
    ctx.fillStyle = i === 0 ? nameColor : (l.startsWith("· ") ? "#8fe08f" : (i === 1 && it.price > 0 ? "#9fd0ff" : "#d8d0b8"));
    ctx.fillText(l, tx, y + pad + 11 + i * lh);
  });
}
