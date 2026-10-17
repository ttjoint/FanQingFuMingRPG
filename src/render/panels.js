// 各类面板：屏幕提示、任务/记事/技能面板、包裹、存档面板、设置面板。
import { G } from "../core/state.js";
import { VW, ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { wrapText } from "./text.js";
import { drawItemSlot } from "./hud.js";
import { PACK_BOX } from "../core/layout.js";
import { SAVE_SLOTS, saveSlotInfo } from "../systems/save.js";

export function drawTip() {
  if (G.tipT <= 0 || !G.tip) return;
  ctx.font = "13px sans-serif";
  const w = ctx.measureText(G.tip).width + 24;
  ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect((VW - w) / 2, 72, w, 26);
  ctx.strokeStyle = "#8a7a50"; ctx.strokeRect((VW - w) / 2 + .5, 72.5, w - 1, 25);
  ctx.fillStyle = "#ffe9a8"; ctx.textAlign = "center"; ctx.fillText(G.tip, VW / 2, 90); ctx.textAlign = "left";
}

export function drawPanels() {
  if (!G.panel) return;
  const w = 420, h = 300, x = (VW - w) / 2, y = 40;
  ctx.fillStyle = "rgba(20,16,12,0.95)"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#b8a468"; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.lineWidth = 1;
  ctx.fillStyle = "#f0d060"; ctx.font = "bold 15px sans-serif";
  const title = ({ mission: "任务", note: "记事", attr: "属性", honor: "荣辱" })[G.panel] || "包裹";
  ctx.fillText(title, x + 14, y + 24);
  ctx.font = "13px sans-serif"; ctx.fillStyle = "#e8dcc0";
  let ty = y + 50;
  if (G.panel === "mission") {
    for (const k in G.missions) { const m = G.missions[k];
      ctx.fillText(`【${m.state === 1 ? "可交" : m.state === 4 ? "进行" : "?"}】${m.name}`, x + 14, ty);
      ctx.fillStyle = "#aaa"; ctx.fillText(`${m.desc}  (${m.got}/${m.need})`, x + 28, ty + 18);
      ctx.fillStyle = "#e8dcc0"; ty += 44;
      if (ty > y + h - 20) break;
    }
  } else if (G.panel === "note") {
    G.notes.forEach(n => { ty += wrapText(n, x + 14, ty, w - 28, 18) * 18 + 8; });
  } else if (G.panel === "attr") {
    const st = G.stats;
    const line = t => { ctx.fillText(t, x + 14, ty); ty += 26; };
    line(`等级：${st.level}　　经验：${st.exp} / ${st.expNext}`);
    line(`体力：${st.hp} / ${st.hpMax}　　精力：${Math.round(st.mp)} / ${st.mpMax}`);
    line(`攻击：${st.attack}　　防御：${st.defence}　　命中：${st.hit}`);
    line(`银两：${st.money}　　道德：${st.moral}　　声望：${st.honor}`);
    line(`技能：${G.skills.join("、")}`);
  } else if (G.panel === "honor") {
    const st = G.stats;
    const line = t => { ctx.fillText(t, x + 14, ty); ty += 26; };
    line(`声望：${st.honor}　　道德：${st.moral}`);
    line("门派 / 势力：" + (G.factions.length ? G.factions.join("、") : "（无）"));
    const loves = Object.keys(G.love).filter(k => G.love[k]);
    line("情缘：" + (loves.length ? loves.map(k => k + "(" + G.love[k] + ")").join("、") : "（无）"));
  } else {
    ctx.fillStyle = "#9fd0ff"; ctx.fillText("技能：" + G.skills.join("、"), x + 14, y + 50);
  }
  ctx.fillStyle = "#888"; ctx.font = "11px sans-serif"; ctx.fillText("按 Esc 关闭", x + w - 80, y + 20);
}

export function drawPack() {
  if (!G.packOpen) return;
  const px = PACK_BOX.x, py = PACK_BOX.y;   // packpanel.png 200x300
  const P = getImg("assets/ui/packpanel.png");
  if (P) ctx.drawImage(P, px, py, PACK_BOX.w, PACK_BOX.h);
  else { ctx.fillStyle = "#d8c48c"; ctx.fillRect(px, py, PACK_BOX.w, PACK_BOX.h); ctx.strokeStyle = "#7a5a2a"; ctx.strokeRect(px + .5, py + .5, PACK_BOX.w - 1, PACK_BOX.h - 1); }
  ctx.fillStyle = "#4a3410"; ctx.font = "bold 13px 'Microsoft YaHei',SimHei,sans-serif"; ctx.fillText("包裹", px + 12, py + 22);
  for (let i = 0; i < G.pack.length; i++) {
    const gx = px + 8 + (i % 5) * 40, gy = py + 28 + Math.floor(i / 5) * 40;
    drawItemSlot(G.pack[i], gx, gy, 38, 38);
  }
  ctx.fillStyle = "#6a4a20"; ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif"; ctx.fillText("左键拿起 / 右键使用", px + 12, py + 292);
}

export function drawSavePanel() {
  if (!G.savePanel) return;
  const w = 460, h = 340, x = (VW - w) / 2, y = 40;
  ctx.fillStyle = "rgba(18,14,10,0.96)"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#b8a468"; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.lineWidth = 1;
  ctx.fillStyle = "#f0d060"; ctx.font = "bold 16px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("存档 / 读档", x + 16, y + 28);
  ctx.fillStyle = "#aaa"; ctx.font = "11px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("F5 开关　点击“存/读”", x + 200, y + 28);
  for (let i = 0; i < SAVE_SLOTS; i++) {
    const info = saveSlotInfo(i), sy = y + 52 + i * 44;
    ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.fillRect(x + 12, sy, w - 24, 36);
    ctx.fillStyle = "#ffd75e"; ctx.font = "13px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.fillText("存档 " + (i + 1), x + 20, sy + 24);
    ctx.fillStyle = info ? "#e8e0c8" : "#777"; ctx.font = "12px 'Microsoft YaHei',SimHei,sans-serif";
    let txt = "（空）";
    if (info) { const d = new Date(info.savedAt); txt = (info.map || "?") + "  Lv" + info.level + "  金钱" + info.money + "   " + d.toLocaleString(); }
    ctx.fillText(txt, x + 90, sy + 23);
    const btn = (bx, label, col) => { ctx.fillStyle = col; ctx.fillRect(bx, sy + 4, 44, 28); ctx.fillStyle = "#1a140e"; ctx.font = "13px 'Microsoft YaHei',SimHei,sans-serif"; ctx.fillText(label, bx + 12, sy + 23); };
    btn(x + 300, "存", "#8fbf6a"); btn(x + 356, "读", "#6a9fbf");
  }
  ctx.fillStyle = "#888"; ctx.font = "11px sans-serif"; ctx.fillText("Esc / F5 关闭", x + w - 110, y + h - 12);
}

export function drawSettingsPanel() {
  if (!G.settingsPanel) return;
  const w = 380, h = 200, x = (VW - w) / 2, y = 80, bx = x + 110, bw = 220;
  ctx.fillStyle = "rgba(18,14,10,0.96)"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#b8a468"; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.lineWidth = 1;
  ctx.fillStyle = "#f0d060"; ctx.font = "bold 16px 'Microsoft YaHei',SimHei,sans-serif"; ctx.fillText("设置", x + 16, y + 30);
  const bar = (label, val, by, col) => {
    ctx.fillStyle = "#efe8d8"; ctx.font = "14px 'Microsoft YaHei',SimHei,sans-serif"; ctx.fillText(label, x + 20, by + 14);
    ctx.fillStyle = "#000"; ctx.fillRect(bx, by, bw, 16);
    ctx.fillStyle = col; ctx.fillRect(bx, by, Math.round(bw * val), 16);
    ctx.strokeStyle = "#b8a468"; ctx.strokeRect(bx + .5, by + .5, bw - 1, 15);
    ctx.fillStyle = "#fff"; ctx.font = "11px sans-serif"; ctx.fillText(Math.round(val * 100) + "%", bx + bw + 4, by + 13);
  };
  bar("背景音乐", G.settings.bgm, y + 70, "#7ac0ff");
  bar("音效", G.settings.sfx, y + 120, "#8fbf6a");
  ctx.fillStyle = G.settings.bgm > 0 ? "#8fbf6a" : "#a05050"; ctx.fillRect(bx, y + 150, 80, 22);
  ctx.fillStyle = "#1a140e"; ctx.font = "12px 'Microsoft YaHei',SimHei,sans-serif"; ctx.fillText("音乐静音", bx + 10, y + 165);
  ctx.fillStyle = G.settings.sfx > 0 ? "#8fbf6a" : "#a05050"; ctx.fillRect(bx + 90, y + 150, 80, 22);
  ctx.fillStyle = "#1a140e"; ctx.fillText("音效静音", bx + 100, y + 165);
  ctx.fillStyle = "#888"; ctx.font = "11px sans-serif"; ctx.fillText("点击或拖动音量条调节　Esc 关闭", x + 20, y + h - 12);
}
