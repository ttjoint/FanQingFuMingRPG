// 输入：鼠标 / 键盘，包含世界点击（移动、攻击、对话）、物品拖拽、UI 交互分发。
import { G } from "../core/state.js";
import { VW, cv } from "../core/constants.js";
import { screenPos, worldToCell, walkable, cellCenter } from "../core/utils.js";
import { nearestWalkable, findPath, pathToWorld } from "../world/pathfinding.js";
import { groundAt, dropGround } from "../world/ground.js";
import { canAddItem, useItemSlot, reindex } from "../systems/inventory.js";
import { skillByName } from "../core/registry.js";
import { castSelf } from "../systems/combat.js";
import { shopGoods, openShop, closeShop, sellCursor } from "../systems/shop.js";
import { advanceDialog, startScript, openSay } from "../script/vm.js";
import { slotAt, insideShop, insideShopClose, insideDialog, settingsHit, menuHit } from "../core/layout.js";
import { handleSlotClick } from "./slots.js";
import { saveBtnAt, saveSlot, loadSlot } from "../systems/save.js";
import { applyVolumes, playSound } from "../systems/audio.js";
import { enterMenu, startGame, flashPics } from "../systems/scene.js";
import { getRuntime } from "../runtime/context.js";
import { isEditorAvailable } from "../content/store.js";

export function npcAt(wx, wy) {
  for (let i = G.npcs.length - 1; i >= 0; i--) {
    const n = G.npcs[i]; if (n.dead) continue;
    if (Math.abs(wx - n.x) < 26 && wy > n.y - 60 && wy < n.y + 8) return n;
  }
  return null;
}

// 标题菜单 / 片头 / 结局等非游玩场景的点击分发。
export function handleSceneClick(sx, sy) {
  if (G.scene === "flash") {
    if (G.flashStep < flashPics(getRuntime()).length - 1) { G.flashStep++; G.flashT = 0; } else enterMenu(getRuntime());
    return;
  }
  if (G.scene === "about" || G.scene === "ending" || G.scene === "farewell") { enterMenu(getRuntime()); return; }
  if (G.scene === "menu") {
    const k = menuHit(sx, sy);
    if (k === "start") startGame(getRuntime());
    else if (k === "load") G.savePanel = true;
    else if (k === "about") G.scene = "about";
    else if (k === "exit") { G.scene = "farewell"; if (G.bgm) G.bgm.pause(); }
    else if (k === "version") import("../content/versions-ui.js").then(m => m.openVersionManager());
    else if (k === "editor") { if (!isEditorAvailable()) return; import("../editor/index.js").then(m => m.openEditor()).catch(e => { console.error(e); G.tip = "编辑器加载失败"; G.tipT = 3; }); }
  }
}

export function handleLeft(wx, wy) {
  const p0 = G.player;
  const g = groundAt(G, wx, wy);
  if (g) {                                  // 点地面掉落物：走近并自动拾取
    if (!p0) return;
    if (!canAddItem(G, g.name, g.count || 1)) { G.tip = "物品栏已满，无法拾取"; G.tipT = 2; return; }
    p0.pickup = g;
    const c = worldToCell(g.x, g.y);
    const t = nearestWalkable(getRuntime(), c.row, c.col) || c;
    const cc = worldToCell(p0.x, p0.y);
    const path = findPath(getRuntime(), cc.row, cc.col, t.row, t.col);
    if (path) { p0.target = null; p0.path = pathToWorld(path); p0.speed = 90; p0.running = false; }
    return;
  }
  if (p0) p0.pickup = null;
  const sk = skillByName(G.skill);
  const n = npcAt(wx, wy);
  if (sk && sk.type === 0 && !n) { castSelf(getRuntime()); return; }
  if (n) {
    if (n.attackable) { if (G.player) { G.player.target = n; G.player.running = true; G.player.path = null; G.player.atkT = 0; } }
    else { // 友善 NPC：仅走近，不攻击
      const c = worldToCell(n.x, n.y);
      const p = nearestWalkable(getRuntime(), c.row, c.col);
      if (p && G.player) { const cc = worldToCell(G.player.x, G.player.y);
        const path = findPath(getRuntime(), cc.row, cc.col, p.row, p.col);
        if (path) { G.player.target = null; G.player.path = pathToWorld(path); G.player.speed = 90; G.player.running = false; } }
    }
    return;
  }
  const c = worldToCell(wx, wy);
  const onCell = !!(G.map && walkable(c.row, c.col));
  const p = onCell ? c : nearestWalkable(getRuntime(), c.row, c.col);
  if (!p || !G.player) return;
  G.player.target = null;
  G.player.running = true;
  const cc = worldToCell(G.player.x, G.player.y);
  const path = findPath(getRuntime(), cc.row, cc.col, p.row, p.col);
  // 点的是可走格 → 停在鼠标的精确位置；否则退回最近可走格中心
  if (path) { G.player.path = pathToWorld(path, onCell ? { x: wx, y: wy } : null); G.player.speed = 150; }
}

export function handleRight(wx, wy) {
  const n = npcAt(wx, wy);
  if (n && !n.dead) {
    if (n.attackable) {
      const line = n.talks && n.talks.length ? n.talks[Math.floor(Math.random() * n.talks.length)] : "";
      if (line) openSay(getRuntime(), n.name, line.replace(/\\n/g, "\n"), n.portrait);
      else { G.tip = n.name + "：……"; G.tipT = 2; }
      return;
    }
    const goods = shopGoods(getRuntime(), n);
    if (goods) { if (G.shop && G.shop.npc === n) closeShop(getRuntime()); else openShop(getRuntime(), n); return; }
    if (!G.script && !G.dialog) {
      if (n.script) startScript(getRuntime(), n.script);
      else if (n.talks && n.talks.length) { const line = n.talks[Math.floor(Math.random() * n.talks.length)]; openSay(getRuntime(), n.name, line.replace(/\\n/g, "\n"), n.portrait); }
      else { G.tip = n.name + "：……"; G.tipT = 2; }
    }
    return;
  }
  const c = worldToCell(wx, wy);
  const onCell = !!(G.map && walkable(c.row, c.col));
  const p = onCell ? c : nearestWalkable(getRuntime(), c.row, c.col);
  if (!p || !G.player) return;
  G.player.target = null;
  G.player.running = false;
  const cc = worldToCell(G.player.x, G.player.y);
  const path = findPath(getRuntime(), cc.row, cc.col, p.row, p.col);
  if (path) { G.player.path = pathToWorld(path, onCell ? { x: wx, y: wy } : null); G.player.speed = 90; }
}

export function cycleSkill(d) {
  if (!G.skills.length) return;
  let i = G.skills.indexOf(G.skill);
  i = (i + d + G.skills.length) % G.skills.length;
  G.skill = G.skills[i]; G.tip = "技能：" + G.skill; G.tipT = 2;
}

export function addInput() {
  cv.addEventListener("mousedown", e => {
    const sp = screenPos(e.clientX, e.clientY);
    const w = { x: sp.x + G.cam.x, y: sp.y + G.cam.y };
    G.mouse.sx = sp.x; G.mouse.sy = sp.y; G.mouse.wx = w.x; G.mouse.wy = w.y;
    if (G.bgm && G.bgm.paused && G.bgmSrc && G.settings.bgm > 0) G.bgm.play().catch(() => { });
    const sh = settingsHit(sp.x, sp.y);
    if (sh) {
      const bw = 220, bx = (VW - 380) / 2 + 110;
      if (sh.k === "bgm") G.settings.bgm = Math.max(0, Math.min(1, (sp.x - bx) / bw));
      else if (sh.k === "sfx") G.settings.sfx = Math.max(0, Math.min(1, (sp.x - bx) / bw));
      else if (sh.k === "mutBgm") G.settings.bgm = G.settings.bgm > 0 ? 0 : 0.6;
      else if (sh.k === "mutSfx") G.settings.sfx = G.settings.sfx > 0 ? 0 : 0.8;
      applyVolumes(getRuntime()); return;
    }
    if (G.settingsPanel) return;
    const sb = saveBtnAt(getRuntime(), sp.x, sp.y);
    if (sb) { if (sb.act === "save") saveSlot(getRuntime(), sb.i); else loadSlot(getRuntime(), sb.i); return; }
    if (G.savePanel) { if (G.scene === "menu") G.savePanel = false; return; }
    if (G.scene !== "game") { handleSceneClick(sp.x, sp.y); return; }
    if (G.dialog) {
      // 点中对话窗体内部 = 继续；点窗体以外的地板 = 中断对话
      if (insideDialog(sp.x, sp.y)) { if (G.dialog.kind === "say") advanceDialog(getRuntime()); return; }
      G.dialog = null; G.script = null;
      return;
    }
    if (G.gameOver) return;
    const slot = slotAt(sp.x, sp.y);
    if (slot) { handleSlotClick(slot, e.button); return; }
    if (G.shop && insideShopClose(sp.x, sp.y)) { closeShop(getRuntime()); G.hold = null; return; }   // 底部“关闭”按钮
    if (G.shop && insideShop(sp.x, sp.y)) {   // 商店窗内非格子：商品拖拽=放下，背包物品=卖出
      if (G.cursor) { if (G.cursor.fromShop) G.cursor = null; else sellCursor(getRuntime()); }
      return;
    }
    if (G.shop) { if (e.button === 0) { closeShop(getRuntime()); G.hold = null; return; } }          // 点地板 = 关商店
    // 光标拿着背包物品时，左键点地板 = 丢下
    if (e.button === 0 && G.cursor && !G.cursor.fromShop) {
      const c = worldToCell(w.x, w.y);
      const p = (G.map && walkable(c.row, c.col)) ? c : nearestWalkable(getRuntime(), c.row, c.col);
      if (p) {
        const pos = cellCenter(p.row, p.col);
        dropGround(G, G.cursor.name, pos.x, pos.y, G.cursor.count || 1);
        G.cursor = null; reindex(G); playSound(G, "drop_item.wav");
      }
      return;
    }
    const onNpc = !!npcAt(w.x, w.y);
    if (e.button === 0) { handleLeft(w.x, w.y); if (!onNpc) { G.hold = 0; G.holdCell = null; G.holdTarget = null; } }
    else if (e.button === 2) { handleRight(w.x, w.y); if (!onNpc) { G.hold = 2; G.holdCell = null; G.holdTarget = null; } }
  });
  window.addEventListener("mouseup", () => { G.hold = null; G.holdCell = null; G.holdTarget = null; });
  cv.addEventListener("contextmenu", e => e.preventDefault());
  cv.addEventListener("mousemove", e => {
    const sp = screenPos(e.clientX, e.clientY);
    G.mouse.sx = sp.x; G.mouse.sy = sp.y; G.mouse.wx = sp.x + G.cam.x; G.mouse.wy = sp.y + G.cam.y;
  });
  window.addEventListener("keydown", e => {
    if (G.scene === "editor" || G.scene === "version") return;   // 编辑器/版本界面自己处理键盘
    if (G.scene !== "game") {
      if (G.scene === "flash" && (e.key === "Enter" || e.key === " ")) handleSceneClick(0, 0);
      else if (G.scene === "menu" && (e.key === "Enter" || e.key === " ")) startGame(getRuntime());
      else if (e.key === "Escape") enterMenu(getRuntime());
      return;
    }
    if (G.dialog) {
      if (G.dialog.kind === "say" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); advanceDialog(getRuntime()); }
      else if (G.dialog.kind === "ask") { if (e.key === "y" || e.key === "Y") advanceDialog(getRuntime(), 1); else if (e.key === "n" || e.key === "N") advanceDialog(getRuntime(), 0); }
      return;
    }
    if (e.key >= "1" && e.key <= "9") { useItemSlot(G, +e.key - 1); return; }
    if (e.key === "F5" || e.key === "F8") { G.savePanel = !G.savePanel; e.preventDefault(); return; }
    if (e.key === "F10") { G.settingsPanel = !G.settingsPanel; e.preventDefault(); return; }
    if (e.key === "Tab") { G.packOpen = !G.packOpen; if (G.packOpen && !G.pack.length) G.pack = new Array(25).fill(null); e.preventDefault(); return; }
    if (e.key === "F4") { G.panel = G.panel === "mission" ? null : "mission"; return; }
    if (e.key === "F1") { G.panel = G.panel === "note" ? null : "note"; return; }
    if (e.key === "q" || e.key === "Q") cycleSkill(-1);
    if (e.key === "e" || e.key === "E") cycleSkill(1);
    if (e.key === "r" || e.key === "R") castSelf(getRuntime());
    if (e.key === "Escape") { G.panel = null; G.packOpen = false; G.savePanel = false; G.settingsPanel = false; if (G.shop) closeShop(getRuntime()); else G.cursor = null; }
  });
}
