// 主渲染：世界（地形 + 对象 + 角色 + 掉落物 + 特效）与所有 UI 的叠加顺序。
import { G, A } from "../core/state.js";
import { VW, VH, ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { itemByName } from "../core/registry.js";
import { drawHUD, drawCursorItem } from "./hud.js";
import { drawDialog } from "./dialog-ui.js";
import { drawTip, drawPanels, drawPack, drawSavePanel, drawSettingsPanel } from "./panels.js";
import { drawShop } from "./shop-ui.js";
import { drawTooltip } from "./tooltip.js";
import { drawScene } from "./scene-ui.js";

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

// 深度排序键：角色的脚底 y。若角色正站在某个建筑/树木的“地基矩形”上（例如门口的格子上），
// 则把它的排序提到该对象之后，使角色显在墙体前面；其他情况（在建筑后面/旁边）保持原样，
// 因此不会像“整体切分”那样把本来该遮挡角色的屋顶/墙抬到角色前面。
export function entitySortY(e) {
  let y = e.y;
  const objs = G.map.objects;
  for (let i = 0; i < objs.length; i++) {
    const f = objs[i].foot;
    if (f && e.x >= f.x0 - 2 && e.x <= f.x1 + 2 && e.y >= f.y0 - 2 && e.y <= f.y1 + 2) {
      if (objs[i].sortY + 0.5 > y) y = objs[i].sortY + 0.5;
    }
  }
  return y;
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

  // 收集可绘制对象（含玩家/NPC/掉落物），按 sortY 排序
  const list = [];
  for (const o of m.objects) {
    const s = o.sprite;
    if (s[4] < camX + VW + 96 && s[4] + s[2] > camX - 96 && s[5] < camY + VH + 96 && s[5] + s[3] > camY - 96)
      list.push(o);
  }
  for (const n of G.npcs) list.push({ sortY: entitySortY(n), npc: n });
  for (const g of G.ground) list.push({ sortY: g.y, ground: g });
  if (G.player) list.push({ sortY: entitySortY(G.player), ent: G.player });
  list.sort((a, b) => a.sortY - b.sortY);
  for (const it of list) {
    if (it.sprite) {
      const s = it.sprite;   // [sx0, sy0, sw, sh, dxa, dya]
      ctx.drawImage(A.obj, s[0], s[1], s[2], s[3], s[4] - camX, s[5] - camY, s[2], s[3]);
    }
    else if (it.ent) drawEntity(it.ent, camX, camY);
    else if (it.npc) drawEntity(it.npc, camX, camY);
    else if (it.ground) drawGroundItem(it.ground, camX, camY);
  }
  // 技能特效（盖在角色之上）
  for (const e of G.effects) {
    const im = getImg("assets/skill/" + e.frames[e.i].replace(/\.bmp$/, ".png"));
    if (im) ctx.drawImage(im, Math.round(e.x - camX - im.width / 2), Math.round(e.y - camY - im.height / 2));
  }
  drawHUD(); drawDialog(); drawPanels(); drawPack(); drawShop(); drawSavePanel(); drawSettingsPanel(); drawTip(); drawCursorItem(); drawTooltip();
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
}

// 地面掉落物：小图标 + 微微上下浮动
export function drawGroundItem(g, camX, camY) {
  if (camX == null) { camX = Math.round(G.cam.x); camY = Math.round(G.cam.y); }
  const it = itemByName(g.name);
  const im = it && it.icon ? getImg("assets/items_icons/" + it.icon.replace(/\.bmp$/, ".png")) : null;
  const bob = Math.sin(G.time * 3 + g.x) * 1.5;
  const x = Math.round(g.x - camX), y = Math.round(g.y - camY + bob);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.ellipse(x, g.y - camY + 3, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (im) ctx.drawImage(im, x - 12, y - 24, 24, 24);
  else { ctx.fillStyle = "#ffd75e"; ctx.fillRect(x - 10, y - 20, 20, 20); }
  if (g.count > 1) { ctx.fillStyle = "#ffe9a8"; ctx.font = "10px sans-serif"; ctx.fillText(String(g.count), x + 6, y - 6); }
}
