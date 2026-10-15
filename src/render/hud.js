// HUD：底部状态面板、快捷栏、装备栏、光标持物。
import { G } from "../core/state.js";
import { VW, VH, ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { itemByName, skillByName } from "../core/registry.js";
import { HOTBAR_X0, HOTBAR_DX, HOTBAR_Y, HOTBAR_W, HOTBAR_H } from "../core/layout.js";

export function drawHUD() {
  const st = G.stats, Y = VH - 100;
  const P = getImg("assets/ui/userpanel.png");
  if (P) ctx.drawImage(P, 0, Y);
  else { ctx.fillStyle = "rgba(18,14,10,0.9)"; ctx.fillRect(0, Y, VW, 100); }
  const bar = (x, y, w, h, cur, max, col) => {
    ctx.fillStyle = "#111"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col; ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, cur / max))), h);
  };
  // 坐标按 res/ini.agp 的 playerpanel.ini
  bar(44, Y + 48, 159, 7, st.hp, st.hpMax, "#c0392b");
  bar(259, Y + 48, 159, 7, st.mp, st.mpMax || 1, "#2d7fd0");
  bar(475, Y + 48, 159, 7, st.exp, st.expNext || 1, "#c9a227");
  ctx.font = "11px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillStyle = "#ffe9a8";
  ctx.fillText(`${st.hp} / ${st.hpMax}`, 48, Y + 45);
  ctx.fillText(`${Math.round(st.mp)} / ${st.mpMax}`, 263, Y + 45);
  ctx.fillText(`${st.exp} / ${st.expNext}`, 479, Y + 45);
  ctx.fillStyle = "#ffd75e"; ctx.font = "11px 'Microsoft YaHei',SimHei,sans-serif";
  // 等级写在中间的装饰框内（playerpanel.ini levelLbl 363,70），金钱值写在烘培的“金钱”字样下方
  ctx.fillText("等级 " + st.level, 363, Y + 81);
  ctx.fillText(String(st.money), 418, Y + 91);
  // 技能图标按钮 (playerpanel.ini skillButton 7,10)
  const sk = skillByName(G.skill);
  const bt = getImg("assets/ui/button.png");
  if (bt) ctx.drawImage(bt, 7, Y + 10, 35, 35);
  if (sk && sk.icon) { const ic = getImg("assets/skill_icons/" + sk.icon.replace(/\.bmp$/, ".png")); if (ic) ctx.drawImage(ic, 7, Y + 10, 35, 35); }
  ctx.fillStyle = "#e8e0c8"; ctx.font = "11px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText(sk ? sk.name : G.skill, 46, Y + 28);
  // 快捷栏 1~9：对齐 userpanel.bmp 里 9 个格子（首格 x=6，间距 37，宽 35）
  for (let i = 0; i < 9; i++) drawItemSlot(G.hotbar[i], HOTBAR_X0 + i * HOTBAR_DX, Y + HOTBAR_Y, HOTBAR_W, HOTBAR_H);
  // 装备（playerpanel.ini weaponButtons：Shi1=492 Wu=530 Jia=566 Shi2=603, y=12）
  for (const [k, x] of [["Shi1", 492], ["Wu", 530], ["Jia", 566], ["Shi2", 603]])
    drawItemSlot(G.equip[k], x, Y + 12, 35, 35);
}

export function drawItemSlot(entry, x, y, w, h) {
  if (!entry) return;
  const it = itemByName(entry.name);
  const im = it && it.icon ? getImg("assets/items_icons/" + it.icon.replace(/\.bmp$/, ".png")) : null;
  if (im) ctx.drawImage(im, x + 3, y + 3, w - 6, h - 6);
  if (entry.count > 1) { ctx.fillStyle = "#ffe9a8"; ctx.font = "10px sans-serif"; ctx.fillText(String(entry.count), x + w - 14, y + h - 4); }
}

export function drawCursorItem() {
  if (!G.cursor) return;
  const it = itemByName(G.cursor.name);
  const im = it && it.icon ? getImg("assets/items_icons/" + it.icon.replace(/\.bmp$/, ".png")) : null;
  if (im) ctx.drawImage(im, G.mouse.sx - 16, G.mouse.sy - 16, 32, 32);
}
