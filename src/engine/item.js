// 物品「模板 / 实例」纯逻辑（不依赖 DOM、content、core）。
//
// 设计约定：
//   - 模板（definition）：静态数据，主键 = name（兼容既有 itemByName）；id 为可选稳定别名。
//   - 实例（instance） ：运行时的具体那一件，带独立随机 id 与可变数据（词缀 / 镶孔 / 强化 / 耐久）。
//   - 背包 / 地上 / 商店里的「条目」形如 { name, count, inst? }：
//       * inst 为 null/undefined 时，行为与旧版 { name, count } 完全一致（可堆叠，无个体差异）。
//       * inst 存在时，该条目是「不可堆叠的单件实例」（count 恒为 1）。
// 这样既保留了 name 作为模板主键的简洁，又为词条随机化 / 镶嵌 / 强化留出空间。

// ---- 基础工具 ----
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : (d == null ? 0 : d); }

let _seq = 0;
// 生成实例 id：时间戳 + 递增序号 + 随机，保证同一会话内不重复，且跨会话极低冲突。
export function newInstanceId(rand) {
  const r = typeof rand === "function" ? rand() : Math.random();
  _seq = (_seq + 1) % 0xffff;
  const t = Date.now().toString(36);
  const s = _seq.toString(36);
  const k = Math.floor(r * 0x7fffffff).toString(36);
  return "it_" + t + s + k;
}

// ---- 模板 ----
// 归一化物品模板：把散落的旧字段（hp/mp/attack/defence/attrA...）收敛到 mods，
// 同时保留原字段（兼容既有读取点）。
export function normalizeItemDef(def, opts) {
  const o = Object.assign({}, def || {});
  o.name = String(o.name == null ? "" : o.name);
  o.id = o.id || o.name;
  o.kind = o.kind || kindFromType(o.type);
  o.rarity = o.rarity || "common";
  o.price = num(o.price);
  o.reqLevel = num(o.reqLevel);
  o.icon = o.icon || "";
  o.desc = o.desc || "";
  const m = o.mods || {};
  o.mods = {
    hp: num(m.hp != null ? m.hp : o.hp),
    mp: num(m.mp != null ? m.mp : o.mp),
    atk: num(m.atk != null ? m.atk : o.attack),
    def: num(m.def != null ? m.def : o.defence),
    hit: num(m.hit != null ? m.hit : o.attrA),
    spd: num(m.spd),
  };
  // 同步回旧字段，避免破坏既有读取点
  o.hp = o.mods.hp; o.mp = o.mods.mp;
  o.attack = o.mods.atk; o.defence = o.mods.def; o.attrA = o.mods.hit;
  const stackable = o.stackable != null ? !!o.stackable : defaultStackable(o);
  o.stackable = stackable;
  o.maxStack = Math.max(1, num(o.maxStack, stackable ? 99 : 1));
  if (!stackable) o.maxStack = 1;
  o.affixPool = Array.isArray(o.affixPool) ? o.affixPool.slice() : [];
  // 模板侧用 socketCount 表示「可镶孔数」；实例侧 inst.sockets 是实际的孔数组。
  o.socketCount = Math.max(0, num(o.socketCount != null ? o.socketCount : (typeof o.sockets === "number" ? o.sockets : 0)));
  delete o.sockets;
  o.maxDurability = Math.max(0, num(o.maxDurability != null ? o.maxDurability : o.durability));
  o.equipSlot = (o.equip && o.equip.slot) || o.equipSlot || null;
  if (!o.equipSlot) o.equipSlot = equipSlotOf(o);   // 按 kind 推断（weapon/armor/trinket）
  o.use = o.use || null;
  o.gem = o.gem || null;   // 宝石类物品：{ mods:{...} }，镶嵌后计入属性
  o.tags = Array.isArray(o.tags) ? o.tags.slice() : [];
  if (opts && opts.keepLegacyType === false) delete o.type;
  return o;
}

// 旧 type（魔数）→ 语义化 kind 的兼容映射。
export function kindFromType(type) {
  switch (num(type)) {
    case 0: return "consumable";
    case 1: return "weapon";
    case 2: return "armor";
    case 3: return "trinket";
    case 4: return "scroll";
    case 7: return "pack";
    case 8: return "quest";
    case 9: return "gem";
    case 10: return "material";
    default: return "misc";
  }
}

// kind → 旧 type（保留写回能力，供老代码 / 老存档使用）。
export function typeFromKind(kind) {
  switch (kind) {
    case "consumable": return 0;
    case "weapon": return 1;
    case "armor": return 2;
    case "trinket": return 3;
    case "scroll": return 4;
    case "pack": return 7;
    case "quest": return 8;
    case "gem": return 9;
    case "material": return 10;
    default: return 0;
  }
}

// 是否默认可堆叠：消耗品 / 任务道具 / 技能书 / 材料 可叠，装备类不可。
export function defaultStackable(def) {
  const k = def.kind || kindFromType(def.type);
  return k === "consumable" || k === "quest" || k === "scroll" || k === "material" || k === "gem" || k === "misc";
}

// 装备槽位：优先 equip.slot / equipSlot，其次按 kind 推断（兼容旧 type 判断）。
export function equipSlotOf(def) {
  if (!def) return null;
  if (def.equipSlot) return def.equipSlot;
  if (def.equip && def.equip.slot) return def.equip.slot;
  const k = def.kind || kindFromType(def.type);
  if (k === "weapon") return "weapon";
  if (k === "armor") return "armor";
  if (k === "trinket") return "trinket";
  return null;
}

export function isEquippable(def) { return equipSlotOf(def) != null; }

// ---- 实例 ----
export function newInstance(def, opts) {
  const o = opts || {};
  const inst = {
    id: o.id || newInstanceId(o.rand),
    affixes: o.affixes ? o.affixes.slice() : [],
    sockets: [],
    enhance: num(o.enhance),
    durability: o.durability != null ? num(o.durability) : (def && def.maxDurability ? def.maxDurability : 0),
  };
  const maxSockets = (def && def.socketCount) || 0;
  for (let i = 0; i < maxSockets; i++) inst.sockets.push(null);
  return inst;
}

// 归一化实例（读档 / 外部注入时使用）。
export function normalizeInstance(inst) {
  if (!inst || typeof inst !== "object") return null;
  const o = Object.assign({}, inst);
  o.id = o.id || newInstanceId();
  o.affixes = Array.isArray(o.affixes) ? o.affixes.slice() : [];
  o.sockets = Array.isArray(o.sockets) ? o.sockets.slice() : [];
  o.enhance = num(o.enhance);
  o.durability = num(o.durability);
  return o;
}

// 条目是否携带实例（即不可堆叠的单件）。
export function hasInstance(entry) { return !!(entry && entry.inst); }

// 两个条目能否合并堆叠：必须都无实例、同名、且未超上限。
export function canStack(a, b, def) {
  if (!a || !b) return false;
  if (a.inst || b.inst) return false;
  if (a.name !== b.name) return false;
  const max = (def && def.maxStack) || 99;
  return (a.count || 0) + (b.count || 0) <= max;
}

// ---- 属性汇总 ----
// 词缀形如 { id, mods:{atk,def,...} }；强化每级按 enhancePerLevel 加成。
//
// 元素键（P0）：`dmg<Type>` = 对某系伤害的百分比加成（如 dmgFire:30），
// `res<Type>` = 对该系抗性（如 resFire:20）。引擎侧的结算函数早就有
// （engine/damage.js 的 applyDamageBonus / resistOf），但这里不汇总的话，
// 词缀写了也永远不会影响伤害——所以必须与基础属性一起累加。
// 类型名首字母大写（fire → dmgFire），与 uniqueItem 的 MOD_KEYS 保持同一约定。
const DMG_TYPES = ["physical", "fire", "cold", "lightning", "poison", "magic"];
const elemKey = (kind, t) => kind + t.charAt(0).toUpperCase() + t.slice(1);
export const ELEMENT_MOD_KEYS = DMG_TYPES.flatMap(t => [elemKey("dmg", t), elemKey("res", t)]);
export const BASE_MOD_KEYS = ["hp", "mp", "atk", "def", "hit", "spd"];

// 把一份 mods 累加进 out（缺的键按 0）。
function addMods(out, m) {
  if (!m) return;
  for (const k of BASE_MOD_KEYS) out[k] = num(out[k]) + num(m[k]);
  for (const k of ELEMENT_MOD_KEYS) {
    // 只在真的用到时才建键，避免每个物品都带一整套 0，存档/日志都会变大。
    if (m[k] == null) continue;
    out[k] = num(out[k]) + num(m[k]);
  }
}

export function instanceStats(entry, def, opts) {
  const o = opts || {};
  const base = (def && def.mods) || {};
  const out = { hp: 0, mp: 0, atk: 0, def: 0, hit: 0, spd: 0 };
  addMods(out, base);
  const inst = entry && entry.inst;
  if (!inst) return out;
  for (const af of inst.affixes || []) addMods(out, af && af.mods);
  // 镶嵌宝石同样提供属性（宝石条目形如 { name, gem:{mods} } 或直接 { mods }）。
  for (const g of inst.sockets || []) {
    if (!g) continue;
    addMods(out, (g.gem && g.gem.mods) || g.mods);
  }
  const per = o.enhancePerLevel || 0;
  if (per && inst.enhance) {
    const e = inst.enhance * per;
    out.atk += num(e); out.def += num(e);
  }
  return out;
}

// 展示名：词缀前缀 + 模板名 + 强化后缀，如「锋利的铁剑 +2」。
export function displayName(entry, def, opts) {
  const o = opts || {};
  const name = (def && def.name) || (entry && entry.name) || "";
  const inst = entry && entry.inst;
  if (!inst) return name;
  let prefix = "";
  if (o.showAffixPrefix !== false) {
    for (const af of inst.affixes || []) if (af && af.prefix) { prefix = af.prefix; break; }
  }
  const suffix = inst.enhance ? (" +" + inst.enhance) : "";
  return prefix + name + suffix;
}

// 稀有度 → 颜色（供 UI 着色；纯字符串，不依赖渲染层）。
export function rarityColor(rarity, palette) {
  const p = palette || { common: "#d8d0b8", magic: "#6fb3ff", rare: "#ffd75e", unique: "#ff8a3d", quest: "#9de07a" };
  return p[rarity] || p.common;
}

// ---- 镶嵌 ----
// 装备实例的 inst.sockets 是长度 = 模板 socketCount 的数组，空位为 null。
// 宝石条目：{ name, gem? }。返回 { ok, reason, slot }；不修改装备，只判断能否镶。
export function canSocket(entry, gemEntry) {
  const inst = entry && entry.inst;
  if (!inst) return { ok: false, reason: "该物品没有实例，不可镶嵌" };
  if (!gemEntry) return { ok: false, reason: "没有宝石" };
  const sockets = inst.sockets || [];
  if (!sockets.length) return { ok: false, reason: "该装备没有镶嵌孔" };
  const slot = sockets.indexOf(null);
  if (slot < 0) return { ok: false, reason: "镶嵌孔已满" };
  return { ok: true, slot };
}

// 镶嵌：把 gemEntry 放进第一个空孔。返回是否成功（不修改 gemEntry 自身）。
export function socketGem(entry, gemEntry) {
  const r = canSocket(entry, gemEntry);
  if (!r.ok) return r;
  entry.inst.sockets[r.slot] = { name: gemEntry.name, gem: gemEntry.gem || { mods: gemEntry.mods || {} } };
  return { ok: true, slot: r.slot };
}

// 取出指定孔的宝石，返回宝石条目（无则 null）。
export function unsocketGem(entry, slot) {
  const inst = entry && entry.inst;
  if (!inst || !Array.isArray(inst.sockets)) return null;
  const i = num(slot, -1);
  if (i < 0 || i >= inst.sockets.length) return null;
  const gem = inst.sockets[i];
  if (!gem) return null;
  inst.sockets[i] = null;
  return { name: gem.name, count: 1, gem: gem.gem || undefined };
}

// ---- 强化 ----
// 强化价格：基础价 * 倍率^当前等级（纯函数，便于 UI 预览）。
export function enhanceCost(def, curLevel, cfg) {
  const c = cfg || {};
  const base = num(c.enhancePriceBase, 50), mul = num(c.enhancePriceMul, 1.6);
  const lv = Math.max(0, num(curLevel, 0));
  return Math.max(1, Math.round(base * Math.pow(mul, lv)));
}

// 能否强化（等级上限 / 有实例）。
export function canEnhance(entry, cfg) {
  const c = cfg || {};
  const inst = entry && entry.inst;
  if (!inst) return { ok: false, reason: "该物品没有实例，不可强化" };
  const max = num(c.maxEnhance, 10);
  if (num(inst.enhance, 0) >= max) return { ok: false, reason: "已达强化上限 +" + max };
  return { ok: true };
}

// 强化 +1，返回是否成功。
export function enhance(entry, cfg) {
  const r = canEnhance(entry, cfg);
  if (!r.ok) return r;
  entry.inst.enhance = num(entry.inst.enhance, 0) + 1;
  return { ok: true, level: entry.inst.enhance };
}

// ---- 耐久 ----
// 扣耐久，返回扣后耐久（不低于 0）。durability 为 0/缺省表示无耐久概念。
export function wearDurability(entry, amount) {
  const inst = entry && entry.inst;
  if (!inst || !inst.durability) return inst ? num(inst.durability, 0) : 0;
  inst.durability = Math.max(0, num(inst.durability, 0) - Math.max(0, num(amount, 0)));
  return inst.durability;
}

// 是否已损坏（有耐久属性但降到 0）。def 可传入模板以读取 maxDurability。
export function isBroken(entry, def) {
  const inst = entry && entry.inst;
  if (!inst) return false;
  const max = num((def && def.maxDurability) || inst.maxDurability, 0);
  return max > 0 && num(inst.durability, 0) <= 0;
}

// ---- 词缀 roll ----
// 归一化一条词缀定义：{ id, name, prefix, rarity, mods, weight, slots }。
export function normalizeAffix(a) {
  const o = Object.assign({}, a || {});
  o.id = String(o.id || o.name || "");
  o.name = String(o.name || o.id || "");
  o.prefix = o.prefix != null ? String(o.prefix) : "";
  o.rarity = o.rarity || "magic";
  const m = o.mods || {};
  const mods = { hp: num(m.hp), mp: num(m.mp), atk: num(m.atk), def: num(m.def), hit: num(m.hit), spd: num(m.spd) };
  // 元素键（dmgFire / resPoison ...）必须原样保留：
  // 以前这里只重建固定 6 个键，元素词缀会在规整时被**静默丢光**——
  // 数据里写了、编辑器里能看到，但落到实例上就没了。
  for (const k of ELEMENT_MOD_KEYS) if (m[k] != null && num(m[k])) mods[k] = num(m[k]);
  o.mods = mods;
  o.weight = Math.max(0, num(o.weight, 10));
  o.slots = Array.isArray(o.slots) ? o.slots.slice() : null;
  return o;
}

// 按权重从候选词缀里抽一个（rng 返回 [0,1)）。无候选返回 null。
export function rollAffix(pool, rng, opts) {
  const r = typeof rng === "function" ? rng : Math.random;
  const o = opts || {};
  const slot = o.slot || null;
  const list = (pool || []).map(normalizeAffix).filter(a => !slot || !a.slots || a.slots.indexOf(slot) >= 0);
  const total = list.reduce((s, a) => s + a.weight, 0);
  if (!list.length || total <= 0) return null;
  let t = r() * total;
  for (const a of list) { t -= a.weight; if (t <= 0) return a; }
  return list[list.length - 1];
}

// 按 rarity 决定词缀条数，并返回去重后的词缀数组。
const AFFIX_COUNT = { common: 0, magic: 1, rare: 2, unique: 3, quest: 0 };
export function rollAffixes(pool, rarity, rng, opts) {
  const r = typeof rng === "function" ? rng : Math.random;
  const n = AFFIX_COUNT[rarity] || 0;
  const out = [], used = {};
  for (let i = 0; i < n * 4 && out.length < n; i++) {
    const a = rollAffix(pool, r, opts);
    if (!a || used[a.id]) continue;
    used[a.id] = true; out.push(a);
  }
  return out;
}
