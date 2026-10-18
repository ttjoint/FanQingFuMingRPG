// 套装 / 暗金物品：纯逻辑，无 DOM。
//
// 现状：稀有度（P0-P2）只体现在"词缀条数"上（common 0 / magic 1 / rare 2 / unique 3），
// 所以"暗金"和"三条稀有词缀的金装"在玩家眼里没有区别 ——
// 缺少的是**独特命名层级**：有名字、固定属性、可收集的套装。
//
// 设计：
//   - `uniques`：按物品名（或模板 id）绑定的固定词缀组。掉落时若命中，
//     用它**替换**随机词缀，而不是叠加 —— 暗金的价值在于"确定的强"，
//     随机叠上去会让强度不可预期，也没法做"这件就是那件"的辨识度。
//   - `sets`：一组同套物品 + 套装加成。按穿着的件数给阶梯加成。
//     partial 加成逐档累加（2 件给 2 件档，3 件给 2+3 件档），
//     这是玩家对"套装"的既有预期。
//   - 加成统一用与词缀相同的 mods 形状（hp/mp/atk/def/hit/spd），
//     这样结算路径不需要第二套逻辑。

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : (d == null ? 0 : d); };
const MOD_KEYS = ["hp", "mp", "atk", "def", "hit", "spd"];

// 归一化一组 mods：只保留认识的键，数值化。
export function normalizeMods(m) {
  const o = {};
  const src = m || {};
  for (const k of MOD_KEYS) {
    const v = num(src[k]);
    if (v) o[k] = v;
  }
  return o;
}

// 归一化一件暗金定义。
//   { id, name（物品模板名）, uname（暗金显示名）, mods, rarity, desc }
export function normalizeUnique(u) {
  const o = u || {};
  return {
    id: String(o.id || o.uname || o.name || "").trim(),
    name: String(o.name || "").trim(),            // 绑定的物品模板名
    uname: String(o.uname || o.id || o.name || "暗金"),
    mods: normalizeMods(o.mods),
    rarity: o.rarity || "unique",
    desc: o.desc != null ? String(o.desc) : "",
  };
}

// 归一化暗金表。丢掉没有绑定物品名的项（否则永远匹配不到，是死数据）。
export function normalizeUniques(list) {
  const src = Array.isArray(list) ? list : [];
  const seen = new Set();
  const out = [];
  for (const u of src) {
    const n = normalizeUnique(u);
    if (!n.name || !n.id) continue;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

// 按物品名找暗金定义。
export function uniqueFor(list, itemName) {
  const arr = normalizeUniques(list);
  return arr.find(u => u.name === itemName) || null;
}

// 归一化一个套装：{ id, name, pieces:[物品名], bonuses:[{pieces, mods, desc}] }
export function normalizeSet(s) {
  const o = s || {};
  const pieces = (Array.isArray(o.pieces) ? o.pieces : []).map(x => String(x || "").trim()).filter(Boolean);
  const bonuses = (Array.isArray(o.bonuses) ? o.bonuses : []).map(b => ({
    pieces: Math.max(1, Math.floor(num(b && b.pieces, 1))),
    mods: normalizeMods(b && b.mods),
    desc: (b && b.desc) != null ? String(b.desc) : "",
  })).sort((a, b) => a.pieces - b.pieces);      // 必须按件数升序：累加时依赖顺序
  return {
    id: String(o.id || o.name || "").trim(),
    name: String(o.name || o.id || "套装"),
    pieces,
    bonuses,
    desc: o.desc != null ? String(o.desc) : "",
  };
}

export function normalizeSets(list) {
  const src = Array.isArray(list) ? list : [];
  const seen = new Set();
  const out = [];
  for (const s of src) {
    const n = normalizeSet(s);
    if (!n.id || !n.pieces.length) continue;      // 没有部件的套装永远激活不了
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out;
}

// 当前穿着里属于各套装的件数。wornNames = 已穿装备的物品名数组。
export function setCounts(sets, wornNames) {
  const worn = new Set((wornNames || []).filter(Boolean));
  const out = {};
  for (const s of normalizeSets(sets)) {
    let n = 0;
    for (const p of s.pieces) if (worn.has(p)) n++;
    if (n > 0) out[s.id] = n;
  }
  return out;
}

// 某套装在 count 件时生效的加成（逐档累加已达成的那几档）。
// 例：count=3，档位 [2,3,4] → 拿 2 件档 + 3 件档。
export function activeBonuses(set, count) {
  const s = normalizeSet(set);
  const c = Math.max(0, Math.floor(num(count, 0)));
  const out = { mods: {}, tiers: [] };
  for (const b of s.bonuses) {
    if (b.pieces > c) continue;
    out.tiers.push(b.pieces);
    for (const k in b.mods) out.mods[k] = num(out.mods[k]) + b.mods[k];
  }
  return out;
}

// 所有已激活套装的合计加成。
// 返回 { mods, detail: [{ set, count, bonuses }] }。
export function setBonusTotal(sets, wornNames) {
  const counts = setCounts(sets, wornNames);
  const mods = {};
  const detail = [];
  for (const s of normalizeSets(sets)) {
    const c = counts[s.id] || 0;
    if (!c) continue;
    const act = activeBonuses(s, c);
    const keys = Object.keys(act.mods);
    if (!keys.length) { detail.push({ set: s, count: c, bonuses: act }); continue; }
    for (const k of keys) mods[k] = num(mods[k]) + act.mods[k];
    detail.push({ set: s, count: c, bonuses: act });
  }
  return { mods, detail };
}

// 把暗金/套装信息塞进实例：inst.unique = { id, uname }、inst.setId = "xxx"。
// 掉落实例构造时调用（见 systems/combat.js 的 makeDropInstance 调用点）。
export function tagInstance(inst, uniques, sets, itemName) {
  if (!inst) return inst;
  const u = uniqueFor(uniques, itemName);
  if (u) {
    inst.unique = { id: u.id, uname: u.uname };
    // 暗金用固定词缀替换随机词缀：价值在于"确定的强"，
    // 随机叠加上去会让强度不可预期，也失去辨识度。
    inst.affixes = Object.keys(u.mods).length
      ? [{ id: "u_" + u.id, name: u.uname, prefix: u.uname, mods: { ...u.mods } }]
      : [];
    if (!inst.rarity) inst.rarity = u.rarity;
  }
  for (const s of normalizeSets(sets)) {
    if (s.pieces.includes(itemName)) { inst.setId = s.id; break; }
  }
  return inst;
}

// 实例是否属于某套装（供 UI 高亮）。
export function setOfInstance(sets, inst) {
  if (!inst || !inst.setId) return null;
  return normalizeSets(sets).find(s => s.id === inst.setId) || null;
}
