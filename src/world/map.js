// 地图数据构建 / 切换 / 玩家落点。ctx 由调用方注入；buildMapData(assets, data) 只依赖资源。
import { VW, VH } from "../core/constants.js";
import { cellCenter } from "../core/utils.js";
import { getImg } from "../core/assets.js";
import { spawnNPC, placeFree } from "./npc.js";
import { playBGM } from "../systems/audio.js";
import { attachAll } from "../engine/ecs.js";
import { buildObjectDrawables, baseLineFromBottom, lineToArray } from "../engine/depth.js";
import { UNIT_COMPONENTS } from "../runtime/components.js";

// 对象精灵的 alpha 底边（逐列取最低不透明像素，返回源本地 y；-1=该列无像素）。
const _alphaBottomCache = new WeakMap();
function alphaBottom(img, sprite) {
  if (!img || !img.width) return null;
  let cached = _alphaBottomCache.get(img);
  if (!cached) { cached = new Map(); _alphaBottomCache.set(img, cached); }
  const key = sprite.slice(0, 4).join(",");
  if (cached.has(key)) return cached.get(key);
  const [sx0, sy0, sw, sh] = sprite;
  let out = null;
  try {
    const c = document.createElement("canvas"); c.width = sw; c.height = sh;
    const cx = c.getContext("2d");
    cx.drawImage(img, sx0, sy0, sw, sh, 0, 0, sw, sh);
    const d = cx.getImageData(0, 0, sw, sh).data;
    out = new Int16Array(sw).fill(-1);
    for (let x = 0; x < sw; x++) for (let y = sh - 1; y >= 0; y--) if (d[(y * sw + x) * 4 + 3] > 8) { out[x] = y; break; }
  } catch (e) { out = null; }
  cached.set(key, out); return out;
}

// 自动地基线：只用“地基格 x 范围”内的 alpha 底边点拟合**下凸包**（凸多边形底边）。
// 下凸包会跨过城门洞这类凹陷，并忽略两侧伸出的房檐（高处小部件属于屋顶）。
function autoBase(img, sprite, tiles, tileW) {
  if (!img || !img.width || !tiles || !tiles.length) return null;
  const bottom = alphaBottom(img, sprite); if (!bottom) return null;
  let tx0 = Infinity, tx1 = -Infinity;
  for (const t of tiles) { const lx = t[2] - sprite[4]; if (lx < tx0) tx0 = lx; if (lx + tileW > tx1) tx1 = lx + tileW; }
  return baseLineFromBottom(bottom, tx0, tx1);
}

// 玩家可见身高（像素）：取站立/行走/奔跑/攻击 × 各方向所有帧的 alpha 包围盒高度最大值 + 余量。
// 蓝线 = 黄线 − 玩家身高；偏小会让“蓝黄间距”比角色贴图矮，导致上身在蓝区外露。
const _imgH = new Map();
function alphaH(im) {
  const k = im.src || (im.width + "x" + im.height);
  if (_imgH.has(k)) return _imgH.get(k);
  let h = im.height;
  try {
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const cx = c.getContext("2d"); cx.drawImage(im, 0, 0);
    const d = cx.getImageData(0, 0, im.width, im.height).data;
    let top = im.height, bot = -1;
    for (let y = 0; y < im.height; y++) { let hit = false; for (let x = 0; x < im.width; x++) if (d[(y * im.width + x) * 4 + 3] > 8) { hit = true; break; } if (hit) { if (y < top) top = y; bot = y; } }
    h = bot >= 0 ? (bot - top + 1) : im.height;
  } catch (e) { }
  _imgH.set(k, h); return h;
}
let _playerH = 0;
export function playerHeadHeight(assets) {
  if (_playerH) return _playerH;
  const ch = assets.chars && assets.chars["role"];
  let h = 0;
  for (const act of ["stand", "walk", "run", "fight"]) {
    const blocks = ch && ch[act]; if (!blocks) continue;
    for (const block of blocks) {
      if (!block || !block.length) continue;
      const im = getImg("assets/role/" + block[0].replace(/\.bmp$/, ".png"));
      if (!im || !im.width) continue;
      const hh = alphaH(im); if (hh > h) h = hh;
    }
  }
  _playerH = (h > 0 ? h : 64) + 8;   // 余量：保证蓝线不低于角色头顶
  return _playerH;
}

// 把 assets/maps/*.json 转成运行时结构：可行走网格、地形离屏画布、对象表。
export function buildMapData(assets, data) {
  const w = data.width;
  const flags = new Uint8Array(w * w);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  const cellOf = new Array(w * w);
  for (const c of data.cells) {
    flags[c.row * w + c.col] = c.flag;
    cellOf[c.row * w + c.col] = c;
  }
  // 对象：一幅对象精灵 = 完整视觉（含上部墙体/屋顶）+ 地基格（tiles，只覆盖底部）。
  // 深度排序交给 engine/depth.js：整幅精灵按 64×32 切块，每块用正下方最近地基格的格心 y。
  const otw = assets.atlasJson.tileW, oth = assets.atlasJson.tileH;
  const objects = [];
  const playerH = playerHeadHeight(assets);
  const tpls = assets.decorTemplates || {};   // 跨地图共享的装饰物模板（按贴图源矩形）
  for (const o of data.objects) {
    // 深度模式（模板优先，其次实例）：整体单一深度 / 手画地基线 / 自动拟合（下凸包）
    const tk = o.sprite[0] + "," + o.sprite[1] + "," + o.sprite[2] + "," + o.sprite[3];
    const tpl = tpls[tk];
    const single = tpl ? tpl.single : o.single;
    const line = tpl ? tpl.line : o.line;
    let opts;
    if (single) opts = { single: true };
    else if (o.roof != null) opts = { roofY: o.roof, playerH };
    else if (line && line.length) opts = { base: lineToArray(line, o.sprite[2]), playerH };
    else opts = { base: autoBase(assets.obj, o.sprite, o.tiles, otw), playerH };
    const dr = buildObjectDrawables(o.sprite, o.tiles || [], o.layer || 0, otw, oth, opts);
    if (o.bias) for (const d of dr) d.sortY += o.bias;   // 编辑器“深度微调”：整体前/后移
    objects.push(...dr);
  }
  // 世界边界 = 格子 ∪ 对象
  for (const c of data.cells) {
    if (c.dx < minX) minX = c.dx; if (c.dy < minY) minY = c.dy;
    if (c.dx + 64 > maxX) maxX = c.dx + 64; if (c.dy + 32 > maxY) maxY = c.dy + 32;
  }
  for (const o of objects) {
    const s = o.sprite;
    if (s[4] < minX) minX = s[4]; if (s[5] < minY) minY = s[5];
    if (s[4] + s[2] > maxX) maxX = s[4] + s[2]; if (s[5] + s[3] > maxY) maxY = s[5] + s[3];
  }
  minX -= 4; minY -= 4; maxX += 4; maxY += 4;
  // 地形离屏画布
  const tc = document.createElement("canvas");
  tc.width = maxX - minX; tc.height = maxY - minY;
  const tctx = tc.getContext("2d");
  tctx.imageSmoothingEnabled = false;
  const cells = data.cells.slice().sort((a, b) => (a.dy - b.dy) || (a.dx - b.dx));
  const cols = assets.atlasJson.cols, tw = assets.atlasJson.tileW, th = assets.atlasJson.tileH;
  for (const c of cells) {
    const ix = (c.sy / th) * cols + (c.sx / tw);
    tctx.drawImage(assets.atlas, (ix % cols) * tw, Math.floor(ix / cols) * th, tw, th,
                   c.dx - minX, c.dy - minY, tw, th);
  }
  return { ...data, flags, cellOf, terrain: tc, minX, minY, maxX, maxY, objects };
}

export function loadMap(ctx, name) {
  if (!name) return;
  name = name.replace(/\.map$/i, "");
  const G = ctx.state, data = ctx.maps[name];
  if (!data) { console.warn("no map", name); return; }
  G.currentMap = name;
  G.map = data;
  playBGM(G, data.music);

  // ---- 场景级状态重置 ----
  // 切图/重进 = 全新场景，上一张图的一切瞬时状态都必须丢弃，
  // 否则会残留：怪物还在追旧仇恨、上一张图的投射物飞进来、特效/飘字停在半空、
  // 对话/脚本还卡着、商店面板关不掉。
  // 需要持久化的内容（背包/属性/任务/剧情标记）不在 G 的这些瞬时字段里，不受影响。
  G.lockTarget = null;             // 锁定圈作废（旧图单位引用已失效）
  G.npcs = [];                     // 旧图的怪全部丢弃（下面按 spawns 重建 → 归位/复活）
  G.ground = [];                   // 地面掉落属瞬时物件，不跨图
  G.projectiles = [];              // 飞行中的投射物
  G.fx = [];                       // 特效实例（含持续 buff 光环、命中特效）
  G.effects = [];                  // 旧版帧动画特效数组（与 G.fx 并存，两者都要清）
  G.moveMarker = null;             // 点击落点光圈
  G.uiFx = null;                   // 指示圈缓存
  G.shop = null;                   // 商店面板
  G.savePanel = false;
  G.waypointPanel = false;         // 传送面板（P4）
  G.stashPanel = false;            // 仓库面板（P4）；G.stash 数据本身不随切图清空
  G._wpCell = null;                // 传送点踩点缓存（新图重新判定）
  G.dialog = null;                 // 对话
  G.script = null;                 // 脚本执行栈（脚本上下文绑定旧图单位）
  G.tip = ""; G.tipT = 0;
  G.lastCell = null;               // 防止落地格与旧图重复
  G.triggerCD = 0;
  G.deathT = 0;
  if (G.player) {
    const p = G.player;
    p.target = null; p.lastAttacker = null; p.aggroAt = null;
    p.path = null; p.chaseTarget = null; p.chaseCell = null;
    p.atkT = 0; p.swingT = 0; p.hitPending = false; p.swingTarget = null;
    p.animSpeed = 1; p.pickup = null; p.running = false;
  }
  // 出生 NPC（可带实例覆盖）。每次进图都重新 spawn → 怪物回到出生点、血量重置。
  for (const s of data.spawns) {
    const npc = spawnNPC(ctx, s.npc, s.row, s.col, s.overrides);
    if (npc) G.npcs.push(npc);
  }
}

export function setPlayer(ctx, row, col, dir) {
  const G = ctx.state;
  if (!G.map) return;
  const p = cellCenter(row, col);
  if (!G.player) {
    G.player = attachAll({ model: "role", x: p.x, y: p.y, path: null, action: "stand", dir: dir || 4,
                 frame: 0, ft: 0, running: false, target: null, moveGoal: null, attackCD: 0, atkT: 0, pickup: null, dead: false,
                 isPlayer: true, faction: "player" }, UNIT_COMPONENTS);
  } else { G.player.x = p.x; G.player.y = p.y; G.player.target = null; G.player.path = null; if (dir != null) G.player.dir = dir; }
  // 玩家落点若与某个 NPC 重叠，把该 NPC 挪到最近的空位（保持入口点不变）
  for (const n of G.npcs) if (!n.dead) placeFree(n);
  const m = G.map;
  G.cam.x = Math.max(m.minX, Math.min(m.maxX - VW, p.x - VW / 2));
  G.cam.y = Math.max(m.minY, Math.min(m.maxY - VH, p.y - VH / 2));
  G.triggerCD = 1.2; G.lastCell = null;
}
