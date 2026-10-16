// 特效系统：统一推进「世界特效」实例（技能命中烟花、Buff 附着、指示圈等）。
// 运行时状态 g 由调用方注入。
//
// 两类特效：
//   1) 一次性/循环的「已生成实例」—— 存于 g.fx 数组，由本系统每帧推进并回收。
//   2) 「瞬时指示」—— 由 systems/indicators.js 每帧重新计算（红/蓝圈、落点光圈、物品高亮），
//      不进入 g.fx，避免每帧堆积。渲染层直接从 g.fx / g.uiFx 读取。
import { makeEffect, stepEffect } from "../engine/effect.js";

// 生成一个特效实例（供技能/buff/脚本调用）。effectsTable 由运行时注入（ctx.assets.effectTable）。
export function spawnFx(ctx, effectIdOrDef, opts) {
  const g = ctx.state;
  const tbl = ctx.assets && ctx.assets.effectTable;
  let def = effectIdOrDef;
  if (typeof effectIdOrDef === "string") def = (tbl && tbl.get(effectIdOrDef)) || { id: effectIdOrDef };
  const inst = makeEffect(def, opts);
  if (!g.fx) g.fx = [];
  g.fx.push(inst);
  return inst;
}

// 每帧推进并回收已结束的实例。
export function fxSystem(ctx, dt) {
  const g = ctx.state;
  const list = g.fx;
  if (!list || !list.length) return;
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const inst = list[i];
    const done = stepEffect(inst, dt);
    if (!done || inst.loop) list[w++] = inst;
  }
  list.length = w;
}

// 清空全部特效（切图/读档时调用）。
export function clearFx(g) { if (g.fx) g.fx.length = 0; if (g.uiFx) g.uiFx.length = 0; }
