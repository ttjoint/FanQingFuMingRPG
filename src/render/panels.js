// 各类面板：屏幕提示、任务/记事/技能面板、包裹、存档面板、设置面板。
import { G } from "../core/state.js";
import { VW, VH, ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { wrapText } from "./text.js";
import { drawItemSlot } from "./hud.js";
import { SETTINGS_BOX, SETTINGS_BAR, SETTINGS_BTN, uiRect, uiSlotRect } from "../core/layout.js";
import { PACK_BOX } from "../core/layout.js";
import { SAVE_SLOTS, saveSlotInfo } from "../systems/save.js";
import { getRuntime } from "../runtime/context.js";

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
  // 面板矩形取自可编辑 UI 配置（info.panel）；缺配置时回退旧硬编码。
  const R = uiRect("info.panel") || { x: (VW - 420) / 2, y: 40, w: 420, h: 300 };
  const { w, h, x, y } = R;
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
  // 包裹面板矩形取自可编辑 UI 配置（pack.panel）；缺配置时回退 PACK_BOX。
  const PB = uiRect("pack.panel") || PACK_BOX;
  const px = PB.x, py = PB.y;
  const P = getImg("assets/ui/packpanel.png");
  if (P) ctx.drawImage(P, px, py, PB.w, PB.h);
  else { ctx.fillStyle = "#d8c48c"; ctx.fillRect(px, py, PB.w, PB.h); ctx.strokeStyle = "#7a5a2a"; ctx.strokeRect(px + .5, py + .5, PB.w - 1, PB.h - 1); }
  ctx.fillStyle = "#4a3410"; ctx.font = "bold 13px 'Microsoft YaHei',SimHei,sans-serif"; ctx.fillText("包裹", px + 12, py + 22);
  for (let i = 0; i < G.pack.length; i++) {
    const r = uiSlotRect("pack.grid", i);
    const gx = r ? r.x : px + 8 + (i % 5) * 40;
    const gy = r ? r.y : py + 28 + Math.floor(i / 5) * 40;
    drawItemSlot(G.pack[i], gx, gy, r ? r.w : 38, r ? r.h : 38);
  }
  ctx.fillStyle = "#6a4a20"; ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif"; ctx.fillText("左键拿起 / 右键使用", px + 12, py + 292);
}

// 仓库面板（P4）：叠在包裹右侧，10 列 × 10 行，每格 26px。
// 与包裹同屏显示是有意的——存/取都是"背包 ⇄ 仓库"的移动，分成两屏要点两次开关。
export const STASH_BOX = { x: 12, y: 40, cols: 10, rows: 10, cell: 26, gap: 2 };
const STASH_PAD = 32;

export function stashRect() {
  const { x, y, cols, rows, cell, gap } = STASH_BOX;
  const w = cols * cell + (cols - 1) * gap + STASH_PAD;
  const h = rows * cell + (rows - 1) * gap + STASH_PAD + 18;
  return { x, y, w, h };
}

// 第 i 格的屏幕矩形（绘制与命中共用）。
export function stashSlotRect(i) {
  const { x, y, cols, cell, gap } = STASH_BOX;
  return {
    x: x + 16 + (i % cols) * (cell + gap),
    y: y + 30 + Math.floor(i / cols) * (cell + gap),
    w: cell, h: cell,
  };
}

// 命中测试：返回格子下标或 -1。
export function stashSlotAt(sx, sy) {
  if (!G.stashPanel) return -1;
  const n = (G.stash || []).length;
  for (let i = 0; i < n; i++) {
    const r = stashSlotRect(i);
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return i;
  }
  return -1;
}

export function drawStash() {
  if (!G.stashPanel) return;
  const B = stashRect();
  ctx.fillStyle = "rgba(16,12,8,0.96)"; ctx.fillRect(B.x, B.y, B.w, B.h);
  ctx.strokeStyle = "#b8a468"; ctx.lineWidth = 2; ctx.strokeRect(B.x + 1, B.y + 1, B.w - 2, B.h - 2); ctx.lineWidth = 1;
  ctx.fillStyle = "#f0d060"; ctx.font = "bold 13px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("共享仓库", B.x + 14, B.y + 20);
  const slots = G.stash || [];
  const filled = slots.filter(Boolean).length;
  ctx.fillStyle = "#8a8070"; ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText(filled + " / " + slots.length, B.x + B.w - 60, B.y + 20);
  ctx.fillStyle = "#6a6050"; ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("背包右键 → 存入　仓库左键 → 取出", B.x + 14, B.y + B.h - 8);
  for (let i = 0; i < slots.length; i++) {
    const r = stashSlotRect(i);
    drawItemSlot(slots[i], r.x, r.y, r.w, r.h);
  }
}

// 铁匠面板（P4）：赌博 / 鉴定 / 修理。
// 做成固定按钮列表而不是"对某件装备右键"的菜单，是因为三件事分别作用于
// 「无目标（赌博）」「背包全体（全部鉴定/全部修理）」，用格子菜单表达会更绕。
export const SMITH_BOX = { x: 150, y: 110, w: 340, h: 250 };
const SMITH_ROW_H = 38;
const SMITH_BTN_Y0 = 74;

export function smithRect() { return SMITH_BOX; }

// 三个动作的按钮矩形。返回 [{ id, x, y, w, h }]。
export function smithButtons() {
  const B = SMITH_BOX;
  const ids = ["gamble", "identify", "repair"];
  return ids.map((id, i) => ({ id, x: B.x + 16, y: B.y + SMITH_BTN_Y0 + i * SMITH_ROW_H, w: B.w - 32, h: SMITH_ROW_H - 8 }));
}

// 命中测试：返回按钮 id 或 null。
export function smithButtonAt(sx, sy) {
  if (!G.smithPanel) return null;
  for (const b of smithButtons()) if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return b.id;
  return null;
}

export function drawSmith() {
  if (!G.smithPanel) return;
  const B = SMITH_BOX;
  ctx.fillStyle = "rgba(16,12,8,0.96)"; ctx.fillRect(B.x, B.y, B.w, B.h);
  ctx.strokeStyle = "#b8a468"; ctx.lineWidth = 2; ctx.strokeRect(B.x + 1, B.y + 1, B.w - 2, B.h - 2); ctx.lineWidth = 1;
  ctx.fillStyle = "#f0d060"; ctx.font = "bold 15px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("铁匠", B.x + 16, B.y + 26);
  ctx.fillStyle = "#7a3a10"; ctx.font = "bold 12px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.textAlign = "right"; ctx.fillText("银两 " + G.stats.money, B.x + B.w - 16, B.y + 26); ctx.textAlign = "left";
  // 三类数量提示，让玩家知道"有没有东西可做"
  const wear = (G.pack || []).filter(e => e && e.inst && e.inst.durability != null && e.inst.durability < ((e.inst.maxDurability) || 1e9)).length;
  const unid = (G.pack || []).filter(e => e && e.inst && e.inst.unid).length;
  const lv = (G.stats && G.stats.level) || 1;
  const info = { gamble: "赌一把（Lv" + lv + "）", identify: "鉴定全部（" + unid + "）", repair: "修理全部（" + wear + "）" };
  for (const b of smithButtons()) {
    ctx.fillStyle = "rgba(60,48,28,0.9)"; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = "#8a7040"; ctx.strokeRect(b.x + .5, b.y + .5, b.w - 1, b.h - 1);
    ctx.fillStyle = "#f0e0b0"; ctx.font = "13px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.fillText(info[b.id] || b.id, b.x + 12, b.y + b.h / 2 + 5);
  }
  ctx.fillStyle = "#6a6050"; ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("Esc 关闭", B.x + 16, B.y + B.h - 10);
}

export function drawSavePanel() {
  if (!G.savePanel) return;
  const R = uiRect("save.panel") || { x: (VW - 460) / 2, y: 40, w: 460, h: 340 };
  const { w, h, x, y } = R;
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

// 传送点面板（P4）：按章节列出已解锁的传送点，点击即传送。
// 未解锁的点不显示——列表长了会稀释"我还能去哪儿"的清晰度，只在总数上提示。
export const WP_BOX = { x: 150, y: 50, w: 340, h: 320 };
const WP_ROW_H = 34;

export function drawWaypointPanel() {
  if (!G.waypointPanel) return;
  const { w, h, x, y } = WP_BOX;
  ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = "rgba(18,14,10,0.97)"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#b8a468"; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.lineWidth = 1;
  ctx.fillStyle = "#f0d060"; ctx.font = "bold 16px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("传送点", x + 16, y + 28);
  ctx.fillStyle = "#aaa"; ctx.font = "11px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("点击地名传送　Esc / M 关闭", x + 120, y + 28);

  const targets = waypointRows();
  if (!targets.length) {
    ctx.fillStyle = "#888"; ctx.font = "13px sans-serif";
    ctx.fillText("尚未发现任何传送点。走到传送点所在格即可解锁。", x + 20, y + 70);
  }
  ctx.font = "13px 'Microsoft YaHei',SimHei,sans-serif";
  targets.forEach((t, i) => {
    const ry = y + 48 + i * WP_ROW_H;
    if (ry + WP_ROW_H > y + h - 12) return;   // 超出面板就截断，避免画到面板外
    const here = G.currentMap === t.map;
    ctx.fillStyle = here ? "rgba(90,120,70,0.55)" : "rgba(0,0,0,0.32)";
    ctx.fillRect(x + 12, ry, w - 24, WP_ROW_H - 6);
    ctx.fillStyle = here ? "#bfe08a" : "#ffd75e";
    ctx.fillText(t.name, x + 22, ry + 20);
    ctx.fillStyle = "#9a9080"; ctx.font = "11px sans-serif";
    ctx.fillText(here ? "（当前所在）" : t.map, x + 130, ry + 19);
    ctx.font = "13px 'Microsoft YaHei',SimHei,sans-serif";
  });
}

// 面板命中：返回被点击的传送点（无则 null）。
export function waypointAt(sx, sy) {
  if (!G.waypointPanel) return null;
  const { w, x, y, h } = WP_BOX;
  if (sx < x || sx > x + w || sy < y || sy > y + h) return null;
  const targets = waypointRows();
  for (let i = 0; i < targets.length; i++) {
    const ry = y + 48 + i * WP_ROW_H;
    if (ry + WP_ROW_H > y + h - 12) break;
    if (sy >= ry && sy <= ry + WP_ROW_H - 6) return targets[i];
  }
  return null;
}

// 已解锁目标（绘制与命中共用同一份顺序，避免两处漂移）。
// 从运行时内容读取；拿不到时返回空（面板显示"尚未发现"）。
function waypointRows() {
  // 与 hud.js 同一取值路径：运行时内容里已规整过的传送点表。
  const rt = getRuntime();
  const list = (rt && ((rt.content && rt.content.waypoints) || (rt.assets && rt.assets.waypoints))) || [];
  const un = G.waypoints || {};
  return list.filter(w => un[w.id]);
}

// 系统设置面板：音量 + 系统菜单按钮（回到游戏 / 读档存档 / 退出游戏）。
// 版式常量定义在 core/layout.js（绘制与命中测试共用同一份，避免两处坐标漂移）。
export function drawSettingsPanel() {
  if (!G.settingsPanel) return;
  const { w, h, x, y } = SETTINGS_BOX, bx = SETTINGS_BAR.x, bw = SETTINGS_BAR.w;
  // 半透明遮罩：面板是模态的，压暗背后场景以突出焦点。
  ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = "rgba(18,14,10,0.97)"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#b8a468"; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.lineWidth = 1;
  ctx.fillStyle = "#f0d060"; ctx.font = "bold 16px 'Microsoft YaHei',SimHei,sans-serif"; ctx.fillText("系统设置", x + 16, y + 30);

  const bar = (label, val, by, col) => {
    ctx.fillStyle = "#efe8d8"; ctx.font = "14px 'Microsoft YaHei',SimHei,sans-serif"; ctx.fillText(label, x + 20, by + 14);
    ctx.fillStyle = "#000"; ctx.fillRect(bx, by, bw, 16);
    ctx.fillStyle = col; ctx.fillRect(bx, by, Math.round(bw * val), 16);
    ctx.strokeStyle = "#b8a468"; ctx.strokeRect(bx + .5, by + .5, bw - 1, 15);
    ctx.fillStyle = "#fff"; ctx.font = "11px sans-serif"; ctx.fillText(Math.round(val * 100) + "%", bx + bw + 4, by + 13);
  };
  bar("背景音乐", G.settings.bgm, y + 62, "#7ac0ff");
  bar("音效", G.settings.sfx, y + 112, "#8fbf6a");
  ctx.fillStyle = G.settings.bgm > 0 ? "#8fbf6a" : "#a05050"; ctx.fillRect(bx, y + 142, 80, 22);
  ctx.fillStyle = "#1a140e"; ctx.font = "12px 'Microsoft YaHei',SimHei,sans-serif"; ctx.fillText("音乐静音", bx + 10, y + 157);
  ctx.fillStyle = G.settings.sfx > 0 ? "#8fbf6a" : "#a05050"; ctx.fillRect(bx + 120, y + 142, 80, 22);
  ctx.fillStyle = "#1a140e"; ctx.fillText("音效静音", bx + 130, y + 157);

  // 分隔线 + 系统菜单按钮
  ctx.strokeStyle = "rgba(184,164,104,0.45)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 20, y + 222); ctx.lineTo(x + w - 20, y + 222); ctx.stroke();

  const mx = G.mouse.sx, my = G.mouse.sy;
  for (const b of SETTINGS_BTN) {
    const hover = mx >= b.x && mx < b.x + b.w && my >= b.y && my < b.y + b.h;
    // 退出游戏用暖红，与其它操作区分（不可逆）。
    const base = b.k === "quit" ? (hover ? "#b8644c" : "#8a4a3a") : (hover ? "#c8b070" : "#8fbf6a");
    ctx.fillStyle = b.k === "quit" && !hover ? "rgba(138,74,58,0.85)" : base;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = hover ? "#ffe07a" : "rgba(0,0,0,0.5)"; ctx.lineWidth = hover ? 2 : 1;
    ctx.strokeRect(b.x + .5, b.y + .5, b.w - 1, b.h - 1); ctx.lineWidth = 1;
    ctx.fillStyle = "#1a140e"; ctx.font = "13px 'Microsoft YaHei',SimHei,sans-serif";
    const tw = ctx.measureText(b.label).width;
    ctx.fillText(b.label, b.x + (b.w - tw) / 2, b.y + b.h / 2 + 5);
  }
  ctx.fillStyle = "#888"; ctx.font = "11px sans-serif";
  ctx.fillText("点击或拖动音量条调节　Esc 关闭", x + 20, y + h - 10);
}
