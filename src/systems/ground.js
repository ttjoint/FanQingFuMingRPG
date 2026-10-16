// 地面掉落物系统：投掷、查询、拾取、归属与存在时长。运行时状态 g 由调用方注入。
//
// 掉落物是「轻量数据记录」（不进 UNIT_COMPONENTS，不带 AI/寻路/阵营），
// 但支持实例条目 { name, count, inst? }，从而保留词缀/强化等个体数据。
//
// 记录结构：
//   { name, count, inst?, x, y, t, dropTime, owner, ttl, from?, highlight }
//     - owner     ：掉落者（可选），用于「拾取保护」（防止掉落者立刻捡回）。
//     - dropTime  ：掉落时刻（G.time 秒）。
//     - ttl       ：存在时长（秒），<=0 表示永久（来自 config.items.dropTtl）。
import { itemByName } from "../core/registry.js";
import { addItem, canAddItem, normalizeEntry } from "./inventory.js";
import { playSound } from "./audio.js";
import { CFG } from "../core/config.js";

// 掉落物配置（数值来自 config.items，缺失时用引擎内置默认值）。
export function dropCfg() {
  const c = (CFG && CFG.items) || {};
  return {
    ttl: c.dropTtl != null ? c.dropTtl : 0,
    scatter: c.dropScatter != null ? c.dropScatter : 22,
    pickupRadius: c.pickupRadius != null ? c.pickupRadius : 20,
    pickupDelay: c.pickupDelay != null ? c.pickupDelay : 0,
    stackRadius: c.stackRadius != null ? c.stackRadius : 18,
  };
}

// 投掷一个掉落条目。entryOrName 兼容旧调用（字符串 / {name,count}）。
// opts: { owner, ttl, from, scatter }
export function dropGround(g, entryOrName, x, y, countOrOpts, maybeOpts) {
  const entry = normalizeEntry(typeof entryOrName === "string" ? { name: entryOrName, count: (typeof countOrOpts === "number" ? countOrOpts : 1) } : entryOrName);
  if (!entry) return null;
  if (!itemByName(entry.name)) return null;
  const opts = (countOrOpts && typeof countOrOpts === "object") ? countOrOpts : (maybeOpts || {});
  const cfg = dropCfg();
  const sc = opts.scatter != null ? opts.scatter : cfg.scatter;
  const jx = (Math.random() - 0.5) * sc, jy = (Math.random() - 0.5) * (sc / 2);
  const rec = {
    name: entry.name,
    count: entry.count || 1,
    x: x + jx, y: y + jy, t: 0,
    dropTime: g.time || 0,
    owner: opts.owner != null ? opts.owner : null,
    from: opts.from || null,
    ttl: opts.ttl != null ? opts.ttl : cfg.ttl,
    highlight: false,
  };
  if (entry.inst) rec.inst = entry.inst;
  // 与附近同种、可堆叠、无实例的掉落物合并，避免地面铺满。
  if (!rec.inst) {
    for (const gr of g.ground || []) {
      if (gr.inst || gr.name !== rec.name) continue;
      if (Math.hypot(gr.x - rec.x, gr.y - rec.y) > cfg.stackRadius) continue;
      gr.count += rec.count;
      return gr;
    }
  }
  if (!g.ground) g.ground = [];
  g.ground.push(rec);
  return rec;
}

export function groundAt(g, wx, wy, radius) {
  const r = radius != null ? radius : dropCfg().pickupRadius;
  for (let i = g.ground.length - 1; i >= 0; i--) {
    const gr = g.ground[i];
    if (Math.hypot(wx - gr.x, wy - gr.y) < r) return gr;
  }
  return null;
}

// 是否允许该单位拾取（拾取保护：掉落者需等 pickupDelay 秒；owner=null 表示无保护）。
export function canPickup(g, gr, unit) {
  if (!gr) return false;
  const cfg = dropCfg();
  if (gr.owner && unit && unit === gr.owner && cfg.pickupDelay > 0) {
    if ((g.time || 0) - (gr.dropTime || 0) < cfg.pickupDelay) return false;
  }
  return true;
}

// unit 为 null 时表示玩家（兼容旧调用）。
export function pickupGround(g, gr, unit) {
  if (!gr) return false;
  if (g.ground.indexOf(gr) < 0) return false;
  if (!canPickup(g, gr, unit)) return false;
  if (!canAddItem(g, gr.name, gr.count || 1)) { g.tip = "物品栏已满，无法拾取"; g.tipT = 2; return false; }
  addItem(g, gr.inst ? { name: gr.name, count: 1, inst: gr.inst } : { name: gr.name, count: gr.count || 1 });
  const i = g.ground.indexOf(gr); if (i >= 0) g.ground.splice(i, 1);
  playSound(g, "pick_item.wav");
  g.tip = "拾取 " + gr.name; g.tipT = 1.5;
  return true;
}

// 每帧更新：存在时长到期移除。
export function updateGround(g, dt) {
  if (!g.ground || !g.ground.length) return;
  const cfg = dropCfg();
  if (cfg.ttl <= 0) return;   // 全局永久
  for (let i = g.ground.length - 1; i >= 0; i--) {
    const gr = g.ground[i];
    const ttl = gr.ttl != null ? gr.ttl : cfg.ttl;
    if (ttl <= 0) continue;
    if ((g.time || 0) - (gr.dropTime || 0) >= ttl) g.ground.splice(i, 1);
  }
}

// ---- NPC 背包（供脚本指令「拾取 / 丢弃」使用）----
// NPC 的背包与玩家共用同一套条目模型，挂在 npc.bag（数组，容量 bagSize）。
export function npcBag(n, size) {
  if (!n.bag) n.bag = new Array(size || 9).fill(null);
  return n.bag;
}

export function npcPickup(ctx, n, gr) {
  const G = ctx.state;
  if (!gr || G.ground.indexOf(gr) < 0) return false;
  if (!canPickup(G, gr, n)) return false;
  const bag = npcBag(n, (CFG.npc && CFG.npc.bagSize) || 9);
  const entry = gr.inst ? { name: gr.name, count: 1, inst: gr.inst } : { name: gr.name, count: gr.count || 1 };
  const it = itemByName(gr.name) || {};
  if (!entry.inst && it.stackable !== false) {
    for (const s of bag) if (s && !s.inst && s.name === entry.name) { s.count += entry.count; G.ground.splice(G.ground.indexOf(gr), 1); return true; }
  }
  const idx = bag.indexOf(null);
  if (idx < 0) return false;
  bag[idx] = entry;
  G.ground.splice(G.ground.indexOf(gr), 1);
  return true;
}

export function npcDrop(ctx, n, bagIndex) {
  const G = ctx.state;
  const bag = npcBag(n, (CFG.npc && CFG.npc.bagSize) || 9);
  const entry = bag[bagIndex];
  if (!entry) return false;
  bag[bagIndex] = null;
  dropGround(G, entry, n.x, n.y, { owner: n, from: "npc" });
  return true;
}
