// 各类面板：屏幕提示、任务/记事/技能面板、包裹、存档面板、设置面板。
import { G } from "../core/state.js";
import { VW, VH, ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { wrapText } from "./text.js";
import { drawItemSlot } from "./hud.js";
import { settingsBox, settingsBar, settingsButtons, uiRect, uiSlotRect, uiBox } from "../core/layout.js";
import { PACK_BOX } from "../core/layout.js";
import { SAVE_SLOTS, saveSlotInfo } from "../systems/save.js";
import { normalizeDifficulties } from "../engine/difficulty.js";
import { mercList, mercInfo } from "../systems/merc.js";
import { getRuntime } from "../runtime/context.js";
import { stateOf } from "./frame.js";


export function drawTip(rt) {
  const G = stateOf(rt);
  if (G.tipT <= 0 || !G.tip) return;
  ctx.font = "13px sans-serif";
  const w = ctx.measureText(G.tip).width + 24;
  ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect((VW - w) / 2, 72, w, 26);
  ctx.strokeStyle = "#8a7a50"; ctx.strokeRect((VW - w) / 2 + .5, 72.5, w - 1, 25);
  ctx.fillStyle = "#ffe9a8"; ctx.textAlign = "center"; ctx.fillText(G.tip, VW / 2, 90); ctx.textAlign = "left";
}

export function drawPanels(rt) {
  const G = stateOf(rt);
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

export function drawPack(rt) {
  const G = stateOf(rt);
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
    drawItemSlot(G.pack[i], gx, gy, r ? r.w : 38, r ? r.h : 38, rt);
  }
  ctx.fillStyle = "#6a4a20"; ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif"; ctx.fillText("左键拿起 / 右键使用", px + 12, py + 292);
}

// 仓库面板（P4）：叠在包裹右侧，10 列 × 10 行，每格 26px。
// 与包裹同屏显示是有意的——存/取都是"背包 ⇄ 仓库"的移动，分成两屏要点两次开关。
export const STASH_BOX = { x: 12, y: 40, cols: 10, rows: 10, cell: 26, gap: 2 };
const STASH_PAD = 32;

// 仓库面板矩形：优先取 ui.json 的 stash.panel（编辑器可挪动/改尺寸），
// 缺配置时回退 STASH_BOX 算出的默认值。
export function stashRect() {
  const { cols, rows, cell, gap } = STASH_BOX;
  const w = cols * cell + (cols - 1) * gap + STASH_PAD;
  const h = rows * cell + (rows - 1) * gap + STASH_PAD + 18;
  return uiBox("stash.panel", { x: STASH_BOX.x, y: STASH_BOX.y, w, h });
}

// 第 i 格的屏幕矩形（绘制与命中共用）。
// 格子按面板左上角 + 内边距定位，所以面板被配置挪动后格子自动跟随。
export function stashSlotRect(i) {
  const { cols, cell, gap } = STASH_BOX;
  const B = stashRect();
  return {
    x: B.x + 16 + (i % cols) * (cell + gap),
    y: B.y + 30 + Math.floor(i / cols) * (cell + gap),
    w: cell, h: cell,
  };
}

// 命中测试：返回格子下标或 -1。
// 仓库格命中。rt 可选（不传回退全局，与旧行为一致）。
export function stashSlotAt(sx, sy, rt) {
  const G = stateOf(rt);
  if (!G.stashPanel) return -1;
  const n = (G.stash || []).length;
  for (let i = 0; i < n; i++) {
    const r = stashSlotRect(i);
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return i;
  }
  return -1;
}

export function drawStash(rt) {
  const G = stateOf(rt);
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
    drawItemSlot(slots[i], r.x, r.y, r.w, r.h, rt);
  }
}

// 铁匠面板（P4）：赌博 / 鉴定 / 修理。
// 做成固定按钮列表而不是"对某件装备右键"的菜单，是因为三件事分别作用于
// 「无目标（赌博）」「背包全体（全部鉴定/全部修理）」，用格子菜单表达会更绕。
export const SMITH_BOX = { x: 150, y: 110, w: 340, h: 250 };
const SMITH_ROW_H = 38;
const SMITH_BTN_Y0 = 74;

// 铁匠面板矩形：优先取 ui.json 的 smith.panel。
export function smithRect() { return uiBox("smith.panel", SMITH_BOX); }

// 三个动作的按钮矩形。返回 [{ id, x, y, w, h }]。
// 相对面板左上角定位，面板被配置挪动后按钮自动跟随。
export function smithButtons() {
  const B = smithRect();
  const ids = ["gamble", "identify", "repair"];
  return ids.map((id, i) => ({ id, x: B.x + 16, y: B.y + SMITH_BTN_Y0 + i * SMITH_ROW_H, w: B.w - 32, h: SMITH_ROW_H - 8 }));
}

// 命中测试：返回按钮 id 或 null。
// 铁匠按钮命中。rt 可选（不传回退全局）。
export function smithButtonAt(sx, sy, rt) {
  const G = stateOf(rt);
  if (!G.smithPanel) return null;
  for (const b of smithButtons()) if (sx >= b.x && sx <= b.x + b.w && sy >= b.y && sy <= b.y + b.h) return b.id;
  return null;
}

export function drawSmith(rt) {
  const G = stateOf(rt);
  if (!G.smithPanel) return;
  const B = smithRect();
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

// 难度选择面板（P4）：一个小列表，显示当前档与各项倍率。
export const DIFF_BOX = { x: 190, y: 130, w: 260, h: 190 };
const DIFF_ROW_H = 44;

// 难度列表。
//
// 参数名改成 rt 更准确：原来的名字叫 ctx，但它并不是 canvas 2d 上下文，
// 而是运行时上下文（取 config.difficulties）——叫 ctx 极易误读成画布。
// 同时补上第三种入参形态：直接传 g 也能拿到 difficulty（旧的 ctx && ctx.config 写法
// 对 g 无能为力），由 stateOf 统一解析。
export function diffRows(rt) {
  // 渲染层不直接拿列表，走配置（编辑器可改难度表）。
  const st = stateOf(rt);
  const cfg = (rt && rt.config) || (rt && rt.assets && rt.assets.config) ||
              (st && st.config) || null;
  const list = (cfg && cfg.difficulties) || null;
  const arr = normalizeDifficulties(list);
  const cur = (st && st.difficulty) || "normal";
  return arr.map(d => ({ ...d, current: d.id === cur }));
}

// 难度面板矩形：优先取 ui.json 的 difficulty.panel。
export function diffRect() { return uiBox("difficulty.panel", DIFF_BOX); }

export function diffRowRect(i) {
  const B = diffRect();
  return { x: B.x + 12, y: B.y + 46 + i * DIFF_ROW_H, w: B.w - 24, h: DIFF_ROW_H - 8 };
}

// 难度行命中。rt 可选（不传回退全局）。
// 注意：这里把 rt 透传给 diffRows，而不是让它内部再去 getRuntime()——
// 否则即使调用方注入了状态，行列表仍取自全局运行时，两半数据来源不一致。
export function diffRowAt(sx, sy, rt) {
  const G = stateOf(rt);
  if (!G.diffPanel) return -1;
  const rows = diffRows(rt || getRuntime());
  for (let i = 0; i < rows.length; i++) {
    const r = diffRowRect(i);
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return i;
  }
  return -1;
}

export function drawDifficulty(rt) {
  const G = stateOf(rt);
  if (!G.diffPanel) return;
  const B = diffRect();
  ctx.fillStyle = "rgba(16,12,8,0.96)"; ctx.fillRect(B.x, B.y, B.w, B.h);
  ctx.strokeStyle = "#b8a468"; ctx.lineWidth = 2; ctx.strokeRect(B.x + 1, B.y + 1, B.w - 2, B.h - 2); ctx.lineWidth = 1;
  ctx.fillStyle = "#f0d060"; ctx.font = "bold 14px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("难度", B.x + 14, B.y + 26);
  const rows = diffRows(rt || getRuntime());
  rows.forEach((d, i) => {
    const r = diffRowRect(i);
    ctx.fillStyle = d.current ? "rgba(120,90,30,0.9)" : "rgba(50,40,24,0.85)";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = d.current ? "#e0c060" : "#7a6438";
    ctx.strokeRect(r.x + .5, r.y + .5, r.w - 1, r.h - 1);
    ctx.fillStyle = d.current ? "#ffe98a" : "#e0d0a0";
    ctx.font = "bold 13px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.fillText(d.name, r.x + 10, r.y + 18);
    ctx.fillStyle = "#9a8e78"; ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.fillText("血×" + d.hp + "  伤×" + d.damage + "  经验×" + d.exp + "  掉落×" + d.drop, r.x + 10, r.y + 32);
  });
}

// 随从面板（P4）：未招募时列出可招募项，已招募则显示状态 + 遣散。
export const MERC_BOX = { x: 170, y: 100, w: 300, h: 250 };
const MERC_ROW_H = 52;

// 随从面板矩形：优先取 ui.json 的 merc.panel。
export function mercRect() { return uiBox("merc.panel", MERC_BOX); }

export function mercRowRect(i) {
  const B = mercRect();
  return { x: B.x + 12, y: B.y + 44 + i * MERC_ROW_H, w: B.w - 24, h: MERC_ROW_H - 8 };
}

// 当前面板的可点击行：未招募 = 可招募列表；已招募 = [遣散]。
// 随从行命中。rt 可选（不传回退全局）。
export function mercRowAt(sx, sy, rt) {
  const G = stateOf(rt);
  if (!G.mercPanel) return -1;
  for (let i = 0; i < 4; i++) {
    const r = mercRowRect(i);
    if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return i;
  }
  return -1;
}

export function drawMercPanel(rt) {
  const G = stateOf(rt);
  if (!G.mercPanel) return;
  const B = mercRect();
  ctx.fillStyle = "rgba(16,12,8,0.96)"; ctx.fillRect(B.x, B.y, B.w, B.h);
  ctx.strokeStyle = "#b8a468"; ctx.lineWidth = 2; ctx.strokeRect(B.x + 1, B.y + 1, B.w - 2, B.h - 2); ctx.lineWidth = 1;
  ctx.fillStyle = "#f0d060"; ctx.font = "bold 14px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("随从", B.x + 14, B.y + 26);
  ctx.fillStyle = "#7a3a10"; ctx.font = "bold 11px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.textAlign = "right"; ctx.fillText("银两 " + G.stats.money, B.x + B.w - 14, B.y + 26); ctx.textAlign = "left";

  const info = mercInfo(getRuntime());
  if (info) {
    // 已招募：显示状态
    const r = mercRowRect(0);
    ctx.fillStyle = "rgba(60,48,28,0.9)"; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "#8a7040"; ctx.strokeRect(r.x + .5, r.y + .5, r.w - 1, r.h - 1);
    ctx.fillStyle = "#f0e0b0"; ctx.font = "bold 13px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.fillText(info.def.name, r.x + 10, r.y + 20);
    ctx.fillStyle = "#9a8e78"; ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif";
    if (info.dead) {
      ctx.fillText(info.state === "ready" ? "倒下了（可归队 " + info.reviveCost + "）" : "倒下了（" + Math.ceil(20 - info.deadT) + "s 后可归队）", r.x + 10, r.y + 36);
    } else {
      ctx.fillText("气血 " + info.hp + "/" + info.hpMax + "　下次薪水 " + Math.ceil(info.nextFeeIn) + "s", r.x + 10, r.y + 36);
    }
    const r2 = mercRowRect(1);
    ctx.fillStyle = "rgba(70,40,30,0.9)"; ctx.fillRect(r2.x, r2.y, r2.w, r2.h);
    ctx.strokeStyle = "#a06050"; ctx.strokeRect(r2.x + .5, r2.y + .5, r2.w - 1, r2.h - 1);
    ctx.fillStyle = "#f0c0b0"; ctx.font = "13px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.fillText("遣散（不退款）", r2.x + 10, r2.y + 20);
    // 薪水提示
    ctx.fillStyle = "#6a6050"; ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.fillText("每 60 秒扣薪水；钱不够会自动离开。", B.x + 14, B.y + B.h - 10);
    return;
  }
  // 未招募：可招募列表
  const list = mercList(getRuntime());
  list.slice(0, 3).forEach((m, i) => {
    const r = mercRowRect(i);
    ctx.fillStyle = "rgba(60,48,28,0.9)"; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "#8a7040"; ctx.strokeRect(r.x + .5, r.y + .5, r.w - 1, r.h - 1);
    ctx.fillStyle = "#f0e0b0"; ctx.font = "bold 13px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.fillText(m.name, r.x + 10, r.y + 18);
    ctx.fillStyle = "#9a8e78"; ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.fillText("气血 " + m.hp + "　攻 " + m.atk + "　薪酬 " + m.fee + "/分", r.x + 10, r.y + 32);
    ctx.fillStyle = "#e0c060"; ctx.textAlign = "right";
    ctx.fillText(m.price + " 两", r.x + r.w - 10, r.y + 18); ctx.textAlign = "left";
  });
  ctx.fillStyle = "#6a6050"; ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("点击招募；Esc 关闭", B.x + 14, B.y + B.h - 10);
}

export function drawSavePanel(rt) {
  const G = stateOf(rt);
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

// 传送点面板矩形：优先取 ui.json 的 waypoint.panel。
export function wpRect() { return uiBox("waypoint.panel", WP_BOX); }

export function drawWaypointPanel(rt) {
  const G = stateOf(rt);
  if (!G.waypointPanel) return;
  const { w, h, x, y } = wpRect();
  ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, VW, VH);
  ctx.fillStyle = "rgba(18,14,10,0.97)"; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "#b8a468"; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.lineWidth = 1;
  ctx.fillStyle = "#f0d060"; ctx.font = "bold 16px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("传送点", x + 16, y + 28);
  ctx.fillStyle = "#aaa"; ctx.font = "11px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("点击地名传送　Esc / M 关闭", x + 120, y + 28);

  const targets = waypointRows(rt);
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
// 传送点行命中。rt 可选（不传回退全局）。
export function waypointAt(sx, sy, rt) {
  const G = stateOf(rt);
  if (!G.waypointPanel) return null;
  const { w, x, y, h } = wpRect();
  if (sx < x || sx > x + w || sy < y || sy > y + h) return null;
  const targets = waypointRows(rt);
  for (let i = 0; i < targets.length; i++) {
    const ry = y + 48 + i * WP_ROW_H;
    if (ry + WP_ROW_H > y + h - 12) break;
    if (sy >= ry && sy <= ry + WP_ROW_H - 6) return targets[i];
  }
  return null;
}

// 已解锁目标（绘制与命中共用同一份顺序，避免两处漂移）。
// 从运行时内容读取；拿不到时返回空（面板显示"尚未发现"）。
// rt 可选：此前它一边 getRuntime() 取列表、一边读全局 G.waypoints，
// 两半数据来自不同来源；传入 rt 后统一（不传则维持旧行为）。
function waypointRows(rt) {
  // 与 hud.js 同一取值路径：运行时内容里已规整过的传送点表。
  const r = rt || getRuntime();
  const G = stateOf(rt);
  const list = (r && ((r.content && r.content.waypoints) || (r.assets && r.assets.waypoints))) || [];
  const un = G.waypoints || {};
  return list.filter(w => un[w.id]);
}

// 系统设置面板：音量 + 系统菜单按钮（回到游戏 / 读档存档 / 退出游戏）。
// 版式常量定义在 core/layout.js（绘制与命中测试共用同一份，避免两处坐标漂移）。
export function drawSettingsPanel(rt) {
  const G = stateOf(rt);
  if (!G.settingsPanel) return;
  const { w, h, x, y } = settingsBox();
  const bx = settingsBar().x, bw = settingsBar().w;
  const btns = settingsButtons();
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
  for (const b of btns) {
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
