// 指示系统：每帧计算「鼠标悬停/选中」的视觉指示（纯数据，渲染层读取）。
// 产出 g.uiFx = { target: unit|null, interact: unit|null, move: marker|null, item: groundItem|null }
//
// - target  : 敌对单位（可攻击）→ 脚下红圈
// - interact: 可交互 NPC（有脚本或有货物背包）→ 脚下蓝圈
// - move    : 玩家点击地面移动的落点 → 光圈动画（带 remaining 计时）
// - item    : 鼠标划过/选中的地面物品 → 高亮
//
// 该模块只做判定与状态维护，绘制交由 render/effects.js（保证 input/render 使用同一套数据）。
import { CFG } from "../core/config.js";
import { canAttack } from "../engine/faction.js";

// 鼠标下的单位（世界坐标，带半径）。
export function unitAt(state, wx, wy, radius) {
  const r = radius != null ? radius : 22;
  const p = state.player;
  for (const n of state.npcs || []) {
    if (n.dead) continue;
    if (Math.hypot(wx - n.x, wy - (n.y - 12)) < r) return n;
  }
  if (p && !p.dead && Math.hypot(wx - p.x, wy - (p.y - 12)) < r) return p;
  return null;
}

// NPC 是否「可交互」：带脚本（对话）或有货物背包（商店）。
export function isInteractable(n) {
  if (!n) return false;
  if (n.script) return true;
  if (n.inventory && ((n.inventory.stock && n.inventory.stock.length) || n.inventory.auto)) return true;
  return false;
}

// 计算当前帧的指示数据。
export function computeIndicators(ctx) {
  const g = ctx.state;
  const fx = (CFG && CFG.fx) || {};
  const ui = { target: null, interact: null, move: g.moveMarker || null, item: null };
  if (fx.uiRings !== false && g.scene === "game" && !g.shop && !g.dialog && !g.script) {
    const m = g.mouse;
    const wx = m.wx, wy = m.wy;
    const u = unitAt(g, wx, wy);
    if (u && u !== g.player) {
      if (canAttack(g.player || {}, u)) ui.target = u;
      else if (isInteractable(u)) ui.interact = u;
    }
    // 地面物品高亮：鼠标划过，或已被玩家选中准备拾取。
    for (let i = (g.ground || []).length - 1; i >= 0; i--) {
      const gr = g.ground[i];
      if (Math.hypot(wx - gr.x, wy - gr.y) < 20 || (g.player && g.player.pickup === gr)) { ui.item = gr; break; }
    }
  }
  g.uiFx = ui;
  return ui;
}

// 记录一次点击移动落点（供 input 调用）。
export function setMoveMarker(g, x, y) {
  const fx = (CFG && CFG.fx) || {};
  if (fx.moveMarker === false) return;
  g.moveMarker = { x, y, t: 0, life: 0.5 };
}

// 推进落点光圈计时。
export function tickIndicators(g, dt) {
  const m = g.moveMarker;
  if (!m) return;
  m.t += dt;
  if (m.t >= (m.life || 0.5)) g.moveMarker = null;
}
