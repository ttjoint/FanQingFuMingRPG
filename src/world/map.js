// 地图数据构建 / 切换 / 玩家落点。ctx 由调用方注入；buildMapData(assets, data) 只依赖资源。
import { VW, VH } from "../core/constants.js";
import { cellCenter } from "../core/utils.js";
import { spawnNPC, placeFree } from "./npc.js";
import { playBGM } from "../systems/audio.js";
import { attachAll } from "../engine/ecs.js";
import { UNIT_COMPONENTS } from "../runtime/components.js";

// 把 assets/maps/*.json 转成运行时结构：可行走网格、地形离屏画布、带地基矩形的对象表。
export function buildMapData(assets, data) {
  const w = data.width;
  const flags = new Uint8Array(w * w);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  const cellOf = new Array(w * w);
  for (const c of data.cells) {
    flags[c.row * w + c.col] = c.flag;
    cellOf[c.row * w + c.col] = c;
  }
  // 对象：整幅精灵，按“底边 y”与角色一起排序（避免房顶/房屋与树木交错）
  // foot：建筑/树木的“地基”矩形（由对象图块列表求得），用于修正站在门口时被墙体遮挡的问题。
  const objects = data.objects.map(o => {
    const sp = o.sprite;   // [sx0, sy0, sw, sh, dxa, dya]
    let fx0 = 1e9, fy0 = 1e9, fx1 = -1e9, fy1 = -1e9;
    for (const t of (o.tiles || [])) {
      const dx = t[2], dy = t[3];
      if (dx < fx0) fx0 = dx; if (dy < fy0) fy0 = dy;
      if (dx + 64 > fx1) fx1 = dx + 64; if (dy + 32 > fy1) fy1 = dy + 32;
    }
    const foot = fx1 > fx0 ? { x0: fx0, y0: fy0, x1: fx1, y1: fy1 } : null;
    // layer：装饰的“深度层”。同一层内仍按底边 y 排序；层号越大越靠上画（如树冠/屋顶遮罩）。
    return { sprite: sp, sortY: sp[5] + sp[3] + (o.layer || 0) * 100000, layer: o.layer || 0, foot };
  });
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
  G.npcs = [];
  G.ground = [];
  // 出生 NPC（可带实例覆盖）
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
                 frame: 0, ft: 0, running: false, target: null, moveGoal: null, attackCD: 0, atkT: 0, pickup: null, dead: false }, UNIT_COMPONENTS);
  } else { G.player.x = p.x; G.player.y = p.y; G.player.target = null; G.player.path = null; if (dir != null) G.player.dir = dir; }
  // 玩家落点若与某个 NPC 重叠，把该 NPC 挪到最近的空位（保持入口点不变）
  for (const n of G.npcs) if (!n.dead) placeFree(n);
  const m = G.map;
  G.cam.x = Math.max(m.minX, Math.min(m.maxX - VW, p.x - VW / 2));
  G.cam.y = Math.max(m.minY, Math.min(m.maxY - VH, p.y - VH / 2));
  G.triggerCD = 1.2; G.lastCell = null;
}
