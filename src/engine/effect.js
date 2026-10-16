// 特效（effect）纯逻辑：定义归一化、实例生成、推进（帧动画 / 首尾停留 / 循环）。
// 不依赖 DOM、content、core。
//
// 层级（layer）—— 决定叠放次序：
//   "under" : 永远在所有单位之下（脚底光环、地面标记）。
//   "over"  : 与单位一同按「帧图底边 y」参与深度排序（普通打击/爆点/命中）。
//   "top"   : 永远显示在最上层（头顶 buff、称号、UI 指示）。
//
// 锚点（anchor）—— 决定位置来源：
//   "world" : 固定世界坐标 (x, y)。
//   "unit"  : 跟随某个单位（follow 指向单位对象），每帧读取其 x/y。
//   "item"  : 跟随某个掉落物记录。
//
// 实例结构：
//   { def, id, layer, anchor, follow, x, y, ox, oy, t, frame, done, life, loop, scale, flip, color, alpha }

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : (d == null ? 0 : d); }
function str(v, d) { return v == null ? (d == null ? "" : d) : String(v); }

export const LAYER_UNDER = "under";
export const LAYER_OVER = "over";
export const LAYER_TOP = "top";
export const ANCHOR_WORLD = "world";
export const ANCHOR_UNIT = "unit";
export const ANCHOR_ITEM = "item";

// 层级排序权重：under 恒最底，top 恒最顶，over 参与 y 排序（同单位规则）。
export function layerWeight(layer) {
  if (layer === LAYER_UNDER) return -1;
  if (layer === LAYER_TOP) return 2;
  return 1;
}

// 归一化特效定义。缺省字段给出引擎内置默认（可由内容覆盖）。
export function normalizeEffect(fx) {
  const o = Object.assign({}, fx || {});
  o.id = str(o.id, o.name || "");
  o.frames = Array.isArray(o.frames) ? o.frames.slice().map(String) : [];
  o.fps = num(o.fps, o.cps) || 12;                     // 播放速率（帧/秒）
  o.loop = !!o.loop;                                   // 是否循环
  o.holdFirst = num(o.holdFirst);                      // 首帧静止时长（秒）
  o.holdLast = num(o.holdLast);                        // 末帧静止时长（秒）
  o.life = num(o.life);                                // 总寿命（秒），0 = 由帧/停留推算
  o.layer = (o.layer === LAYER_UNDER || o.layer === LAYER_TOP) ? o.layer : LAYER_OVER;
  o.anchor = (o.anchor === ANCHOR_UNIT || o.anchor === ANCHOR_ITEM) ? o.anchor : ANCHOR_WORLD;
  o.blend = (o.blend === "add" || o.blend === "lighter") ? "lighter" : "source-over";
  o.scale = num(o.scale, 1) || 1;
  o.ox = num(o.ox); o.oy = num(o.oy);                  // 锚点偏移
  o.color = o.color ? str(o.color) : null;             // 染色（无贴图时的程序化颜色）
  o.shape = str(o.shape, "sprite");                    // sprite | ring | glow | marker
  o.texture = o.texture ? str(o.texture) : null;       // 未来可切贴图动画帧
  o.shadow = o.shadow !== false;
  // 由帧数与停留推算寿命（若未显式给出）。
  if (!o.life && o.frames.length) {
    o.life = o.holdFirst + o.frames.length / o.fps + o.holdLast;
  }
  return o;
}

export function buildEffectTable(list) {
  const byId = new Map();
  for (const fx of list || []) { const d = normalizeEffect(fx); if (d.id) byId.set(d.id, d); }
  return {
    byId,
    get(id) { return byId.get(id) || null; },
    list() { return [...byId.values()]; },
  };
}

// 生成一个特效实例。def 可为定义对象或 id（需传入 table）。
export function makeEffect(defOrId, opts) {
  const o = opts || {};
  const def = (defOrId && typeof defOrId === "object") ? normalizeEffect(defOrId) : normalizeEffect(o.def || { id: defOrId });
  const inst = {
    def,
    id: def.id,
    layer: o.layer || def.layer,
    anchor: o.anchor || def.anchor,
    follow: o.follow || null,
    x: num(o.x), y: num(o.y),
    ox: num(o.ox, def.ox), oy: num(o.oy, def.oy),
    t: 0, frame: 0, done: false,
    loop: o.loop != null ? !!o.loop : def.loop,
    life: o.life != null ? num(o.life) : def.life,
    scale: o.scale != null ? num(o.scale, def.scale) : def.scale,
    flip: !!o.flip,
    color: o.color || def.color,
    alpha: o.alpha != null ? num(o.alpha, 1) : 1,
  };
  if (!inst.life && inst.def.frames.length) inst.life = inst.def.holdFirst + inst.def.frames.length / inst.def.fps + inst.def.holdLast;
  inst.life = inst.life || 0.6;
  return inst;
}

// 依据当前 t 计算应显示的帧号（含首帧停留）。
export function frameAt(inst) {
  const d = inst.def;
  if (!d.frames.length) return 0;
  if (inst.loop) {
    const t = Math.max(0, inst.t - d.holdFirst);
    return Math.floor(t * d.fps) % d.frames.length;
  }
  const t = inst.t - d.holdFirst;
  if (t <= 0) return 0;
  const f = Math.floor(t * d.fps);
  return Math.min(d.frames.length - 1, f);
}

// 推进一个实例；返回是否已结束。
export function stepEffect(inst, dt) {
  inst.t += dt;
  inst.frame = frameAt(inst);
  if (inst.loop) { inst.done = false; return false; }
  const n = inst.def.frames.length;
  // 帧播完 + 末帧停留 + 首帧停留 = 寿命
  const animEnd = inst.def.holdFirst + (n ? n / inst.def.fps : 0) + inst.def.holdLast;
  if (inst.t >= animEnd || (inst.life > 0 && inst.t >= inst.life)) { inst.done = true; return true; }
  inst.done = false; return false;
}

// 实例当前世界坐标（跟随单位/物品时实时解析）。
export function effectPos(inst, fallback) {
  let bx = inst.x, by = inst.y;
  const f = inst.follow;
  if (f) {
    if (inst.anchor === ANCHOR_ITEM && f.x != null) { bx = f.x; by = f.y; }
    else if (f.x != null) { bx = f.x; by = f.y; }
  } else if (fallback && fallback.x != null) { bx = fallback.x; by = fallback.y; }
  return { x: bx + (inst.ox || 0), y: by + (inst.oy || 0) };
}

// 深度排序键：under/top 用层级权重，over 用底边 y。
export function effectSortKey(inst, fallback) {
  const w = layerWeight(inst.layer);
  if (w === 1) { const p = effectPos(inst, fallback); return p.y; }
  return null;   // under / top 不参与 y 排序，由渲染层单独处理
}
