// 主渲染：世界（地形 + 对象 + 角色 + 掉落物 + 特效）与所有 UI 的叠加顺序。
import { G, A } from "../core/state.js";
import { VW, VH, ctx, BUILD } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { itemByName } from "../core/registry.js";
import { drawHUD, drawCursorItem } from "./hud.js";
import { drawDialog } from "./dialog-ui.js";
import { drawTip, drawPanels, drawPack, drawSavePanel, drawSettingsPanel, drawWaypointPanel } from "./panels.js";
import { drawShop } from "./shop-ui.js";
import { drawTooltip } from "./tooltip.js";
import { drawScene } from "./scene-ui.js";
import { drawEffect, drawRing, drawMoveMarker, drawGroundItemHighlight, drawIndicatorRings, drawMoveMarkerAt, overEffects, underEffects, topEffects } from "./effects.js";
import { effectPos } from "../engine/effect.js";
import { computeIndicators } from "../systems/indicators.js";
import { getRuntime } from "../runtime/context.js";

export function spriteFor(e) {
  const ch = A.chars[e.model]; if (!ch) return null;
  const blocks = ch[e.action] || ch.stand || ch.walk; if (!blocks) return null;
  const block = blocks[e.dir % blocks.length] || blocks[0]; if (!block || !block.length) return null;
  const name = block[e.frame % block.length];
  const im = getImg("assets/role/" + name.replace(/\.bmp$/, ".png"));
  if (!im) return null;
  return { im, name };
}

// 帧锚点：(x=身体水平中心, y=脚底)。优先用 build_assets.py 生成的 anchors.json；
// 若缺失（例如旧版资源），则实时从 alpha 包围盒算一次并缓存。
const ANCHOR = {};
export function anchorOf(im, name) {
  if (A.anchors && A.anchors[name]) return A.anchors[name];
  if (ANCHOR[name]) return ANCHOR[name];
  let a = [im.width / 2, im.height];
  try {
    const c = document.createElement("canvas");
    c.width = im.width; c.height = im.height;
    const cx = c.getContext("2d");
    cx.drawImage(im, 0, 0);
    const d = cx.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, maxX = -1, maxY = -1;
    for (let y = 0; y < c.height; y++) {
      const off = y * c.width * 4;
      for (let x = 0; x < c.width; x++) if (d[off + x * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    if (maxX >= 0) a = [(minX + maxX) >> 1, maxY + 1];
  } catch (e) { }
  ANCHOR[name] = a; return a;
}

// 深度排序键：角色的脚底 y。装饰物的覆盖层（ROOF_TOP）永远在角色之上，这里无需再提升。
export function entitySortY(e) {
  return e.y;
}

export function render() {
  if (G.scene === "editor" || G.scene === "version") return;   // 这些界面是 DOM 浮层，遮住画布
  // 标题菜单 / 片头 / 结局等非游玩场景：只画场景与存档、设置浮层。
  if (G.scene !== "game") {
    drawScene();
    drawSavePanel();
    drawSettingsPanel();
    drawTip();
    return;
  }
  ctx.fillStyle = "#0a0a0a"; ctx.fillRect(0, 0, VW, VH);
  if (!G.map) { drawHUD(); drawDialog(); return; }
  const m = G.map, cam = G.cam;
  // 整帧只用一个“取整后的相机偏移”。否则地形(大图)、对象、角色各自 Math.round，
  // 会因 cam 小数部分不同而相差 1px，表现为跟随镜头时地面与其他精灵相对晃动。
  const camX = Math.round(cam.x), camY = Math.round(cam.y);
  ctx.drawImage(m.terrain, m.minX - camX, m.minY - camY);

  // 指示数据（红/蓝圈、落点、物品高亮）——每帧重算，渲染层只读。
  computeIndicators(getRuntime());
  // 1) 底层特效（under）：脚底圈、地面标记 —— 永远在所有单位之下。
  drawIndicatorRings(camX, camY);
  drawMoveMarkerAt(camX, camY);
  for (const inst of underEffects(G)) drawEffect(inst, camX, camY);

  // 收集可绘制对象（含玩家/NPC/掉落物），按 sortY 排序（对象已拆成逐格块/覆盖层块）。
  const list = [];
  for (const o of m.objects) {
    const s = o.sprite;
    if (s[4] < camX + VW + 96 && s[4] + s[2] > camX - 96 && s[5] < camY + VH + 96 && s[5] + s[3] > camY - 96)
      list.push(o);
  }
  for (const n of G.npcs) list.push({ sortY: entitySortY(n), npc: n });
  for (const g of G.ground) list.push({ sortY: g.y, ground: g });
  if (G.player) list.push({ sortY: entitySortY(G.player), ent: G.player });
  // 中层特效（over）：与单位一同按底边 y 参与深度排序。
  for (const inst of overEffects(G)) {
    const p = effectPos(inst);
    list.push({ sortY: p.y, fxInst: inst });
  }
  list.sort((a, b) => a.sortY - b.sortY);
  for (const it of list) {
    if (it.sprite) {
      const s = it.sprite;   // [sx0, sy0, sw, sh, dxa, dya]
      if (it.polygon) {      // 沿蓝线（斜线）精确裁剪 → 细腻的斜边遮蔽
        ctx.save();
        ctx.beginPath();
        const p0 = it.polygon[0];
        ctx.moveTo(p0[0] - camX, p0[1] - camY);
        for (let k = 1; k < it.polygon.length; k++) { const p = it.polygon[k]; ctx.lineTo(p[0] - camX, p[1] - camY); }
        ctx.closePath(); ctx.clip();
        ctx.drawImage(A.obj, s[0], s[1], s[2], s[3], s[4] - camX, s[5] - camY, s[2], s[3]);
        ctx.restore();
      } else {
        ctx.drawImage(A.obj, s[0], s[1], s[2], s[3], s[4] - camX, s[5] - camY, s[2], s[3]);
      }
      // 调试：半透明显示覆盖层/基座多边形（按 P 切换）
      if (it.polygon && typeof window !== "undefined" && window.__POLY_DEBUG__) {
        ctx.save();
        ctx.beginPath();
        const q0 = it.polygon[0]; ctx.moveTo(q0[0] - camX, q0[1] - camY);
        for (let k = 1; k < it.polygon.length; k++) { const q = it.polygon[k]; ctx.lineTo(q[0] - camX, q[1] - camY); }
        ctx.closePath();
        ctx.fillStyle = it.roof ? "rgba(80,170,255,0.10)" : "rgba(245,215,90,0.10)";   // 蓝=覆盖层，黄=基座
        ctx.fill();
        ctx.strokeStyle = it.roof ? "rgba(140,210,255,0.9)" : "rgba(255,230,130,0.9)";
        ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
      }
    }
    else if (it.ent) drawEntity(it.ent, camX, camY);
    else if (it.npc) drawEntity(it.npc, camX, camY);
    else if (it.fxInst) drawEffect(it.fxInst, camX, camY);
    else if (it.ground) { drawGroundItem(it.ground, camX, camY); if (G.uiFx && G.uiFx.item === it.ground) drawGroundItemHighlight(it.ground, camX, camY); }
  }
  // 技能特效（盖在角色之上）
  for (const e of G.effects) {
    const im = getImg("assets/skill/" + e.frames[e.i].replace(/\.bmp$/, ".png"));
    if (im) ctx.drawImage(im, Math.round(e.x - camX - im.width / 2), Math.round(e.y - camY - im.height / 2));
  }
  // 弹道（在角色与特效之上，保证可见）
  drawProjectiles(camX, camY);
  // 2) 顶层特效（top）：头顶 buff/称号 —— 永远在最顶层。
  for (const inst of topEffects(G)) drawEffect(inst, camX, camY);
  drawHUD(); drawDialog(); drawPanels(); drawPack(); drawShop(); drawSavePanel(); drawWaypointPanel(); drawSettingsPanel(); drawTip(); drawCursorItem(); drawTooltip();
  if (typeof window !== "undefined" && window.__POLY_DEBUG__) {
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(6, 26, 236, 18);
    ctx.fillStyle = "#8fd0ff"; ctx.font = "12px sans-serif"; ctx.textAlign = "left";
    ctx.fillText("多边形调试（P 关闭）：蓝=覆盖层 黄=基座 ｜ " + BUILD, 10, 39);
  }
  if ((G.player && G.player.dead) || G.gameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = "#c0392b"; ctx.font = "bold 30px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(G.gameOver ? "游戏结束" : "你倒下了…", VW / 2, VH / 2);
    ctx.fillStyle = "#ccc"; ctx.font = "14px sans-serif";
    ctx.fillText("正在返回主菜单…", VW / 2, VH / 2 + 30); ctx.textAlign = "left";
  }
}

export function drawEntity(e, camX, camY) {
  if (camX == null) { camX = Math.round(G.cam.x); camY = Math.round(G.cam.y); }
  // 帧未加载时沿用上一帧，避免角色闪烁（每实体帧缓冲）
  const s = spriteFor(e);
  let im = null, a = null;
  if (s) {
    im = s.im;
    a = anchorOf(im, s.name);
    e._im = im; e._a = a;
  } else if (e._im) { im = e._im; a = e._a; }
  else return;
  const x = Math.round(e.x - camX - a[0]);
  const y = Math.round(e.y - camY - a[1]);
  if (e.dmgT > 0) { ctx.save(); ctx.globalAlpha = 0.85; }
  ctx.drawImage(im, x, y);
  if (e.dmgT > 0) ctx.restore();
  if (e.dead && e.model) { /* 已播放 die 帧 */ }
  if (!e.dead && (e.attackable || (e.hp != null && e.hpMax && e.hp < e.hpMax))) {
    const w = 40, hx = Math.round(e.x - camX - w / 2), hy = y - 6;
    ctx.fillStyle = "#000"; ctx.fillRect(hx, hy, w, 4);
    ctx.fillStyle = e.attackable ? "#c0392b" : "#589b3a";
    ctx.fillRect(hx, hy, Math.round(w * Math.max(0, e.hp) / e.hpMax), 4);
  }
  if (e.talkT > 0) { ctx.fillStyle = "#ffe07a"; ctx.font = "12px sans-serif"; ctx.textAlign = "center"; ctx.fillText("!", e.x - camX, y - 8); ctx.textAlign = "left"; e.talkT -= 0.016; }
  drawBuffIcons(e, camX, y);
}

// 单位头顶的 Buff 图标行（优先用 buff_icons/*.png，缺失时画色块 + 层数）。
const BUFF_FALLBACK = tag => (tag === "buff" ? "#3a7d3a" : "#8a3a3a");
function drawBuffIcons(e, camX, topY) {
  const list = e.buffs;
  if (!list || !list.length) return;
  const SZ = 14, gap = 2;
  let x = Math.round(e.x - camX - (list.length * (SZ + gap) - gap) / 2);
  const yy = topY - 22;
  for (const b of list) {
    const icon = b.icon ? String(b.icon).replace(/\.bmp$/, ".png") : "";
    const im = icon ? getImg("assets/buff_icons/" + icon) : null;
    if (im && im.width) ctx.drawImage(im, x, yy, SZ, SZ);
    else {
      const tag = (b.tags || [])[0] || "";
      ctx.fillStyle = BUFF_FALLBACK(tag); ctx.fillRect(x, yy, SZ, SZ);
      ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.strokeRect(x + 0.5, yy + 0.5, SZ - 1, SZ - 1);
    }
    if ((b.stacks || 1) > 1) {
      ctx.fillStyle = "#fff"; ctx.font = "9px sans-serif"; ctx.textAlign = "right";
      ctx.fillText(String(b.stacks), x + SZ, yy + SZ); ctx.textAlign = "left";
    }
    x += SZ + gap;
  }
}

// 投射物贴图的绘制尺寸。
// 素材是 64x64 画布且内容满幅，必须显式缩放，否则视觉上比角色还大。
// 直径按 radius 推算后再乘一个美术系数，并夹在最小/最大值之间。
const PROJ_ART_SCALE = 0.75;   // radius -> 绘制半径的系数
const PROJ_MIN = 14;           // 最小绘制直径(px)
const PROJ_MAX = 40;           // 最大绘制直径(px)

// 弹道：优先画 projectile 帧动画，缺失时退化为发光圆点（保证“无素材可见”）。
export function drawProjectiles(camX, camY) {
  const list = G.projectiles;
  if (!list || !list.length) return;
  if (camX == null) { camX = Math.round(G.cam.x); camY = Math.round(G.cam.y); }
  for (const p of list) {
    const x = Math.round(p.x - camX), y = Math.round(p.y - camY);
    const fname = p.frames && p.frames.length ? p.frames[p.frame % p.frames.length] : null;
    const im = fname ? getImg("assets/projectile/" + String(fname).replace(/\.bmp$/, ".png")) : null;
    if (im) {
      // 投射物贴图按 skill.projectile.radius 缩放到屏幕直径，而不是 1:1 原图。
      // 素材普遍是 64x64、内容几乎满幅，1:1 画出来比角色(内容约 48px 宽)还大一圈。
      // diameter = radius * 2 * PROJ_ART_SCALE，并夹在 [PROJ_MIN, PROJ_MAX] 之间，
      // 保证任何尺寸的素材都得到"小球"外观。
      const dia = Math.max(PROJ_MIN, Math.min(PROJ_MAX, (p.radius || 12) * 2 * PROJ_ART_SCALE));
      const sz = Math.round(dia);
      ctx.drawImage(im, Math.round(x - sz / 2), Math.round(y - sz / 2), sz, sz);
      continue;
    }
    // 默认占位：一团带光晕的小球（无素材也能观察弹道轨迹）
    const r = Math.max(3, Math.min(14, p.radius * 0.6));
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
    g.addColorStop(0, "rgba(255,240,180,0.95)");
    g.addColorStop(0.5, "rgba(255,180,60,0.7)");
    g.addColorStop(1, "rgba(255,120,0,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2, 0, Math.PI * 2); ctx.fill();
  }
}

// 地面掉落物：小图标 + 微微上下浮动
export function drawGroundItem(g, camX, camY) {
  if (camX == null) { camX = Math.round(G.cam.x); camY = Math.round(G.cam.y); }
  const it = itemByName(g.name);
  const im = it && it.icon ? getImg("assets/items_icons/" + it.icon.replace(/\.bmp$/, ".png")) : null;
  const bob = Math.sin(G.time * 3 + g.x) * 1.5;
  const x = Math.round(g.x - camX), y = Math.round(g.y - camY + bob);
  // 稀有度光柱：实例/稀有物品在地面时更醒目
  const rc = it && it.rarity && it.rarity !== "common" ? it.rarity : null;
  if (rc) {
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const grd = ctx.createLinearGradient(x, g.y - camY - 34, x, g.y - camY + 4);
    const col = rc === "unique" ? "255,138,61" : rc === "rare" ? "255,215,94" : "111,179,255";
    grd.addColorStop(0, "rgba(" + col + ",0)");
    grd.addColorStop(1, "rgba(" + col + ",0.35)");
    ctx.fillStyle = grd; ctx.fillRect(x - 10, g.y - camY - 34, 20, 38);
    ctx.restore();
  }
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.ellipse(x, g.y - camY + 3, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (im) ctx.drawImage(im, x - 12, y - 24, 24, 24);
  else { ctx.fillStyle = "#ffd75e"; ctx.fillRect(x - 10, y - 20, 20, 20); }
  if (g.count > 1) { ctx.fillStyle = "#ffe9a8"; ctx.font = "10px sans-serif"; ctx.fillText(String(g.count), x + 6, y - 6); }
}
