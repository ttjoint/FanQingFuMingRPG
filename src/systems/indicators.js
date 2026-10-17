// 指示系统：每帧计算「鼠标悬停/选中」的视觉指示（纯数据，渲染层读取）。
// 产出 g.uiFx = { target: unit|null, interact: unit|null, move: marker|null, item: groundItem|null, locked: unit|null }
//
// 两类指示要区分开：
//   - 悬停（hover）：鼠标移到单位上时的临时高亮，移开即消失。
//   - 锁定（lock）  ：点击后**持久**选中的目标，脚下画圈（敌对红 / 友好蓝），
//                     直到右键空地、目标死亡、切图、离开视野才解除。
//                     锁定目标是后续技能释放的默认指定对象。
//
// - target  : 敌对单位（可攻击）→ 脚下红圈
// - interact: 可交互 NPC（有脚本或有货物背包）→ 脚下蓝圈
// - move    : 玩家点击地面移动的落点 → 光圈动画（带 remaining 计时）
// - item    : 鼠标划过/选中的地面物品 → 高亮
//
// 该模块只做判定与状态维护，绘制交由 render/effects.js（保证 input/render 使用同一套数据）。
import { CFG } from "../core/config.js";
import { canAttack, isHostile } from "../engine/faction.js";

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

// 单位是否仍在视野内（用于解除锁定）。
// 以玩家为中心，超出约一个屏幕半径即视为「离开屏幕范围」。
export const LOCK_VIEW_RADIUS = 560;

// 解除锁定。reason 仅用于调试/tip。
export function clearLock(g, _reason) {
  if (!g) return;
  g.lockTarget = null;
}

// 解除锁定的条件判定：目标死亡 / 已不存在 / 超出视野 / 切图。
export function lockValid(g) {
  const t = g && g.lockTarget;
  if (!t) return false;
  if (t.dead) return false;
  const inNpcs = (g.npcs || []).includes(t);
  const isPlayer = t === g.player;
  if (!inNpcs && !isPlayer) return false;          // 已离开当前场景（切图/移除）
  if (isPlayer) return false;                      // 玩家自己不可作为锁定目标
  const p = g.player;
  if (p && !p.dead) {
    if (Math.hypot(t.x - p.x, t.y - p.y) > LOCK_VIEW_RADIUS) return false;   // 离开屏幕范围
  }
  return true;
}

// 设置锁定目标（左键/右键点中单位时调用）。返回是否锁定成功。
export function setLock(g, u) {
  if (!g || !u || u === g.player || u.dead) return false;
  g.lockTarget = u;
  return true;
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
  // 每帧校验锁定是否仍然有效（死亡/离开视野/切图都会在此解除）。
  if (g.lockTarget && !lockValid(g)) g.lockTarget = null;
  const locked = g.lockTarget || null;
  const ui = { target: null, interact: null, move: g.moveMarker || null, item: null, locked: null };
  // 锁定圈**不受对话框/商店/脚本影响**：右键对话时锁定圈必须保持。
  // （旧实现把 ui.locked 写在 !g.dialog 分支里，一按右键对话圈就没）
  // 解除条件只有三个：目标死亡、目标离开视野、切图/重建场景。
  if (locked && g.scene === "game") ui.locked = locked;
  if (fx.uiRings !== false && g.scene === "game" && !g.shop && !g.dialog && !g.script) {
    const m = g.mouse;
    const wx = m.wx, wy = m.wy;
    const u = unitAt(g, wx, wy);
    if (u && u !== g.player) {
      if (isHostile(g.player || {}, u, (ctx.assets && ctx.assets.factionTable) || null)) ui.target = u;
      else if (isInteractable(u)) ui.interact = u;
    }
    // 锁定目标：持久画圈，不受鼠标是否悬停影响。
    // **任何**存活单位都应能锁定并显示圈：敌对红圈，其余蓝圈。
    // （早先只认"敌对 or 可交互"，导致中立的普通 NPC 锁上了却不画圈。）

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
