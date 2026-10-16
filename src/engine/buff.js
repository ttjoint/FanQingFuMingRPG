// 引擎核心：Buff / Debuff 纯逻辑。无 DOM、无阵营、无渲染依赖，可在 Node 中测试。
//
// 设计（阶段 C）：
//  - Buff 是「挂在单位身上的定时效果叠加层」，支持 **层数（stacks）/ 叠加（stack）/ 刷新（refresh）**。
//  - 单位上的 Buff 列表是**运行时可变数据**（不写进内容包）；每个元素是“实例”：
//      { id, name, icon, stacks, dur, maxDur, mods, dot, hot, tags }
//  - 本模块只负责“时间推进 / 叠加语义 / 属性汇总”，具体结算（扣血/回血）交由运行时调用方。
//
// 数据（assets/buffs.json 中每项，经 normalizeBuff 规整）：
//   {
//     id, name, icon, desc,
//     duration: 秒,                        // 基础持续时间
//     maxStacks: 最大层数（默认 1 = 不可叠加）
//     stackMode: "refresh"(默认) | "stack" // 再获得时：刷新时长 / 叠层并刷新时长
//     mods: { atk, def, hpMax, mpMax, speed, hit }   // 每「层」的属性加成（可正可负）
//     dot: { dps }                          // 每层每秒伤害
//     hot: { hps }                          // 每层每秒治疗
//     tags: [string]                        // 分类（如 "burn","slow","buff"）
//   }

export const STACK_REFRESH = "refresh";
export const STACK_STACK = "stack";

const n = (v, d) => (typeof v === "number" && isFinite(v) ? v : (v == null || v === "" ? d : (Number(v) || d)));
const s = (v, d = "") => (v == null ? d : String(v));

// 规整一条 buff 定义（内容数据）。
export function normalizeBuff(b) {
  if (!b || typeof b !== "object") return null;
  const o = {};
  o.id = s(b.id, "");
  if (!o.id) return null;
  o.name = s(b.name, o.id);
  o.icon = s(b.icon, "");
  o.desc = s(b.desc, "");
  o.duration = n(b.duration, 10);
  o.maxStacks = Math.max(1, Math.floor(n(b.maxStacks, 1)));
  o.stackMode = b.stackMode === STACK_STACK ? STACK_STACK : STACK_REFRESH;
  const m = b.mods && typeof b.mods === "object" ? b.mods : {};
  o.mods = {
    atk: n(m.atk, 0), def: n(m.def, 0), hpMax: n(m.hpMax, 0),
    mpMax: n(m.mpMax, 0), speed: n(m.speed, 0), hit: n(m.hit, 0),
  };
  o.dot = b.dot && typeof b.dot === "object" ? { dps: n(b.dot.dps, 0) } : null;
  o.hot = b.hot && typeof b.hot === "object" ? { hps: n(b.hot.hps, 0) } : null;
  o.tags = Array.isArray(b.tags) ? b.tags.map(String) : [];
  return o;
}

export function normalizeBuffs(list) {
  return (Array.isArray(list) ? list : []).map(normalizeBuff).filter(Boolean);
}

// 由内容构建查表（id -> def）。
export function buildBuffTable(listOrDefs) {
  const byId = new Map();
  const arr = Array.isArray(listOrDefs) ? listOrDefs : [];
  for (const raw of arr) {
    const def = normalizeBuff(raw);
    if (def) byId.set(def.id, def);
  }
  return { byId, list: Array.from(byId.values()) };
}

// 从一个 buff 实例生成“新建实例”。
export function makeBuffInstance(def, opts) {
  const o = opts || {};
  return {
    id: def.id, name: def.name, icon: def.icon,
    stacks: Math.max(1, Math.floor(n(o.stacks, 1))),
    dur: n(o.dur, def.duration), maxDur: def.duration,
    maxStacks: def.maxStacks, stackMode: def.stackMode,
    mods: { ...def.mods }, dot: def.dot ? { ...def.dot } : null,
    hot: def.hot ? { ...def.hot } : null, tags: (def.tags || []).slice(),
  };
}

// 查找单位身上的 buff 实例（按 id）。
export function findBuff(unit, id) {
  if (!unit || !Array.isArray(unit.buffs)) return null;
  return unit.buffs.find(b => b.id === id) || null;
}
export const hasBuff = (unit, id) => !!findBuff(unit, id);
export const getStacks = (unit, id) => { const b = findBuff(unit, id); return b ? b.stacks : 0; };

// 施加一个 buff（叠加 / 刷新语义）。
//   def: 已规整的 buff 定义（或 raw，会被规整）
//   返回被创建/更新的实例。
//   - maxStacks<=1：仅刷新时长。
//   - stackMode="stack"：层数 +1（上限 maxStacks），并刷新时长。
//   - stackMode="refresh"（默认）：刷新时长，层数保持。
export function applyBuff(unit, defOrRaw, opts) {
  const def = defOrRaw && defOrRaw.maxStacks !== undefined && defOrRaw.mods ? defOrRaw : normalizeBuff(defOrRaw);
  if (!def || !unit) return null;
  if (!Array.isArray(unit.buffs)) unit.buffs = [];
  const o = opts || {};
  let inst = findBuff(unit, def.id);
  if (!inst) {
    inst = makeBuffInstance(def, { stacks: o.stacks });
    unit.buffs.push(inst);
    return inst;
  }
  // 已存在：叠加 / 刷新
  if (inst.maxStacks > 1 && inst.stackMode === STACK_STACK) {
    inst.stacks = Math.min(inst.maxStacks, inst.stacks + Math.max(1, Math.floor(n(o.stacks, 1))));
  } else if (inst.maxStacks > 1 && o.stacks) {
    inst.stacks = Math.min(inst.maxStacks, inst.stacks + Math.floor(n(o.stacks, 1)));
  }
  inst.dur = n(o.dur, def.duration);            // 刷新时长（回到满）
  inst.maxDur = def.duration;
  return inst;
}

// 移除一个 buff。
export function removeBuff(unit, id) {
  if (!unit || !Array.isArray(unit.buffs)) return false;
  const i = unit.buffs.findIndex(b => b.id === id);
  if (i < 0) return false;
  unit.buffs.splice(i, 1);
  return true;
}

// 汇总单位所有 buff 的属性加成（按层数累加）。
export function statMods(unit) {
  const out = { atk: 0, def: 0, hpMax: 0, mpMax: 0, speed: 0, hit: 0 };
  if (!unit || !Array.isArray(unit.buffs)) return out;
  for (const b of unit.buffs) {
    const k = b.stacks || 1;
    for (const key in out) out[key] += ((b.mods && b.mods[key]) || 0) * k;
  }
  return out;
}

// 每层每秒的总 DoT / HoT（供运行时按 dt 结算）。
export function dotPerSecond(unit) {
  let v = 0;
  if (unit && Array.isArray(unit.buffs)) for (const b of unit.buffs) if (b.dot) v += (b.dot.dps || 0) * (b.stacks || 1);
  return v;
}
export function hotPerSecond(unit) {
  let v = 0;
  if (unit && Array.isArray(unit.buffs)) for (const b of unit.buffs) if (b.hot) v += (b.hot.hps || 0) * (b.stacks || 1);
  return v;
}

// 推进时间：返回本帧「到期的 buff id 列表」。
// 不负责结算 DoT/HoT（由运行时按 dotPerSecond/hotPerSecond 处理，便于统一走 applyDamage/heal）。
export function tickBuffs(unit, dt) {
  const expired = [];
  if (!unit || !Array.isArray(unit.buffs)) return expired;
  const keep = [];
  for (const b of unit.buffs) {
    b.dur -= dt;
    if (b.dur <= 0) expired.push(b.id);
    else keep.push(b);
  }
  unit.buffs = keep;
  return expired;
}

// 清空（死亡/复活等场景）。
export function clearBuffs(unit) { if (unit) unit.buffs = []; }
