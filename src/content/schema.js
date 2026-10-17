// 内容/文档 schema：默认值、规整（normalize）与校验（validate）。
// 这是「构建脚本 / 运行时 / 编辑器」共用的单一契约。数据缺字段时会补齐，
// 未知字段一律保留（向前兼容，避免丢数据）。
import { isRef, refKind, refId } from "./ids.js";
import { normalizeProjectile } from "../engine/projectile.js";
import { normalizeBuffs } from "../engine/buff.js";import { normalizeTargeting } from "../engine/targeting.js";
import { normalizeItemDef, normalizeAffix } from "../engine/item.js";
import { normalizeEffect } from "../engine/effect.js";
import { CFG } from "../core/config.js";

export const CONTENT_VERSION = 2;
export const MAPDOC_VERSION = 2;
export const PACK_FORMAT = "gsxy.pack";
export const PACK_VERSION = 2;

const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : (v == null || v === "" ? d : Number(v) || d));
const str = (v, d = "") => (v == null ? d : String(v));
const arr = v => (Array.isArray(v) ? v : []);

// ---- NPC ----
export function normalizeNpc(n) {
  const o = clone(n) || {};
  o.id = num(o.id, 0);
  o.name = str(o.name, "NPC" + o.id);
  o.model = str(o.model, "");
  o.portrait = str(o.portrait, "");
  o.script = str(o.script, "");
  o.hp = num(o.hp, 100);
  o.attack = num(o.attack, 0);
  o.defence = num(o.defence, 0);
  o.level = num(o.level, 1);
  o.exp = num(o.exp, 0);
  o.hostile = num(o.hostile, 0);
  o.ai = (o.ai == null || o.ai === "") ? "" : (typeof o.ai === "number" ? o.ai : String(o.ai));   // AI 配置 id（字符串引用，兼容旧数字）
  o.speed = num(o.speed, 45);
  o.runSpeed = num(o.runSpeed, 70);
  // 阵营（faction）：空字符串 = 未指定，运行时用 defaultFaction() 兼容层派生（攻击力>0 -> enemy）。
  o.faction = str(o.faction, "");
  // skills 在旧数据里是错位的台词文本：过滤为数组（保留合法字符串）
  o.skills = Array.isArray(o.skills) ? o.skills.map(String) : [];
  if (!Array.isArray(o.drops)) o.drops = [];
  o.drops = o.drops.map(d => normalizeDrop(d)).filter(d => d.name);
  o.talks = arr(o.talks).map(String);
  // 货物箱（商人）：「背包」组件的数据源。stock 为显式货源，auto 为按分类自动补货。
  // 无 inventory / 空货物 = 无背包 = 非商人（shopGoods 返回 null，不开店）。
  o.inventory = normalizeInventory(o.inventory);
  return o;
}

// ---- 阵营（faction）----
// 关系表是内容的一部分（随资源版本固定）；每项 { id, name, hostileTo: [id] }。
// 判定为双向对称（见 engine/faction.js）。
export function normalizeFactions(list) {
  return arr(list).filter(f => f && f.id).map(f => ({
    id: str(f.id, ""),
    name: str(f.name, str(f.id, "")),
    hostileTo: arr(f.hostileTo).map(String),
  }));
}

// AI 配置表（内置内容，单位按 id 引用）。结构保持灵活：只做浅校验，
// 具体条件/动作语义由 engine/ai.js 在编译时处理。
export function normalizeAis(list) {
  return arr(list).filter(a => a && a.id != null).map(a => {
    const o = clone(a) || {};
    o.id = str(o.id, "");
    o.name = str(o.name, o.id);
    if (!o.idle || typeof o.idle !== "object") o.idle = { action: "idle" };
    if (!Array.isArray(o.rules)) o.rules = [];
    return o;
  });
}

// Buff 配置表（内容内置，技能/脚本按 id 引用）。具体语义见 engine/buff.js。
export function normalizeBuffList(list) {
  return normalizeBuffs(list);
}

// 特效定义表（内容内置，技能/Buff/指示按 id 引用）。具体语义见 engine/effect.js。
export function normalizeEffectList(list) {
  return arr(list).filter(f => f && (f.id || f.name)).map(f => normalizeEffect(f));
}

// 词缀表（物品实例随机词缀的来源）。具体语义见 engine/item.js 的 normalizeAffix。
export function normalizeAffixList(list) {
  return arr(list).filter(a => a && (a.id || a.name)).map(a => normalizeAffix(a));
}

// ---- Item / Skill ----
// 物品模板：在旧字段基础上支持 kind/rarity/stackable/mods/equip/use/affixPool/socketCount 等。
// 实体字段（attack/hp/attrA...）与 mods 双向同步，保证旧读取点继续可用。
export function normalizeItem(it) {
  const o = clone(it) || {};
  o.name = str(o.name, "新物品");
  o.type = num(o.type, 0);
  o.subtype = num(o.subtype, 0);
  o.price = num(o.price, 0);
  o.reqLevel = num(o.reqLevel, 0);
  o.hp = num(o.hp, 0); o.mp = num(o.mp, 0);
  o.attack = num(o.attack, 0); o.defence = num(o.defence, 0);
  o.attrA = num(o.attrA, 0); o.attrB = num(o.attrB, 0); o.attrC = num(o.attrC, 0);
  o.icon = str(o.icon, ""); o.desc = str(o.desc, "");
  // 扩展：模板/实例体系所需字段（缺省时按旧字段推断）。
  const d = normalizeItemDef(o);
  d.type = o.type; d.subtype = o.subtype;
  return d;
}

// 掉落定义：兼容 { name, count }，并支持 chance/min/max/rarity/affixes。
export function normalizeDrop(d) {
  const o = clone(d) || {};
  o.name = str(o.name, "");
  if (!o.name) return o;
  o.chance = o.chance == null ? 100 : num(o.chance, 100);
  const c = num(o.count, 1);
  o.count = c;
  o.min = o.min != null ? num(o.min, c) : c;
  o.max = o.max != null ? num(o.max, o.min) : o.min;
  if (o.max < o.min) o.max = o.min;
  o.rarity = o.rarity ? str(o.rarity) : null;
  o.affixes = Array.isArray(o.affixes) ? o.affixes.map(String) : null;
  return o;
}

export function normalizeSkill(sk) {
  const o = clone(sk) || {};
  o.name = str(o.name, "新技能");
  o.type = num(o.type, 1);
  o.range = num(o.range, 40);
  // 攻击方式：近战(melee) / 远程(ranged)；缺省按射程推断（<=60 视为近战）。
  // mode 决定“命中如何发生”，具体弹道参数在阶段的 projectile 字段中描述。
  // 近战/远程分界射程来自配置（数值平衡数据），不再硬编码。
  const meleeMax = (CFG.combat && CFG.combat.meleeMaxRange != null) ? CFG.combat.meleeMaxRange : 60;
  o.mode = (o.mode === "melee" || o.mode === "ranged") ? o.mode : (o.range > meleeMax ? "ranged" : "melee");
  o.mp = num(o.mp, 0);
  o.reqLevel = num(o.reqLevel, 1);
  o.power = num(o.power, 0);
  o.sound = str(o.sound, "");
  o.icon = str(o.icon, "");
  o.frames = arr(o.frames).map(String);
  // 弹道配置：仅远程技能有意义；缺失则为 null（近战/瞬间结算）。
  o.projectile = o.mode === "ranged" ? normalizeProjectile(o.projectile) : null;
  // 阶段 D：目标类型 / AOE / 技能级冷却。
  o.targeting = normalizeTargeting(o.targeting);
  o.cooldown = Math.max(0, num(o.cooldown, 0));
  // 阶段 C/D：命中时施加的 buff（列表，元素为 buff id；支持 {id,stacks,chance} 形式）。
  // 特效：fx 可为字符串（命中特效 id）或对象 { cast, hit, target, ground }（各为特效 id）。
  o.fx = normalizeFxRef(o.fx);
  o.onHit = normalizeOnHit(o.onHit);
  o.desc = str(o.desc, "");
  return o;
}

// 规整技能/物品的特效引用：统一为对象形式 { cast, hit, target, ground }。
function normalizeFxRef(v) {
  if (!v) return null;
  if (typeof v === "string") return { hit: v };
  if (typeof v !== "object") return null;
  const out = {};
  for (const k of ["cast", "hit", "target", "ground"]) if (v[k]) out[k] = str(v[k]);
  return Object.keys(out).length ? out : null;
}

// 规整技能的 onHit 配置：统一为 { buffs, heal, knockback }。
function normalizeOnHit(v) {
  if (!v || typeof v !== "object") return null;
  const out = {};
  const bs = Array.isArray(v.buffs) ? v.buffs : [];
  out.buffs = bs.map(b => {
    if (typeof b === "string") return { id: b, stacks: 1, chance: 100 };
    return { id: str(b && b.id, ""), stacks: Math.max(1, Math.floor(num(b && b.stacks, 1))), chance: num(b && b.chance, 100) };
  }).filter(b => b.id);
  // 命中治疗：给自己（self）或目标（target）。
  if (v.heal && typeof v.heal === "object") {
    out.heal = { amount: Math.max(0, num(v.heal.amount, 0)), to: v.heal.to === "target" ? "target" : "self" };
  }
  // 击退：把目标推开 dist 像素。
  if (v.knockback) out.knockback = { dist: Math.max(0, num(typeof v.knockback === "object" ? v.knockback.dist : v.knockback, 0)) };
  const has = out.buffs.length || out.heal || out.knockback;
  return has ? out : null;
}

// ---- 装饰物模板（跨地图共享，按贴图源矩形为键）----
// 同一张贴图在不同地图里是同一个模板：地基线/单一深度只编辑一次，所有实例共享。
// 键 = "sx,sy,sw,sh"。
export function decorSpriteKey(s) { return s[0] + "," + s[1] + "," + s[2] + "," + s[3]; }
export function normalizeDecorTemplates(t) {
  const out = {};
  for (const k in (t || {})) {
    const v = t[k]; if (!v || typeof v !== "object") continue;
    const o = {};
    if (v.single) o.single = true;
    if (Array.isArray(v.line) && v.line.length) o.line = v.line.map(p => [num(p[0], 0), num(p[1], 0)]);
    if (Object.keys(o).length) out[k] = o;
  }
  return out;
}

// ---- 背包 / 货物箱 ----
// 通用容器：{ stock?: [{name,count}], auto?: "potion"|"weapon"|"armor"|"accessory" }。
// Npc 的 inventory 即“货物背包”：有非空货物即可与玩家交易（见 systems/shop.js）。
export function normalizeInventory(inv) {
  if (!inv || typeof inv !== "object") return null;
  const o = {};
  if (Array.isArray(inv.stock)) {
    o.stock = inv.stock.map(e => ({ name: str(e && e.name, ""), count: num(e && e.count, 1) })).filter(e => e.name);
  }
  if (inv.auto) o.auto = str(inv.auto, "");
  return (o.stock && o.stock.length) || o.auto ? o : null;
}

// ---- Config ----
// 默认值单一事实来源在 core/config.js；此处再导出以保持既有引用兼容。
export { DEFAULT_CONFIG } from "../core/config.js";
import { DEFAULT_CONFIG } from "../core/config.js";
export function normalizeConfig(c) {
  const out = clone(DEFAULT_CONFIG);
  if (c) for (const sec of Object.keys(DEFAULT_CONFIG)) {
    const src = c[sec]; if (!src) continue;
    for (const k of Object.keys(DEFAULT_CONFIG[sec])) if (src[k] != null) out[sec][k] = src[k];
  }
  return out;
}

// ---- MapDoc ----
// cells 数组（row/col 顺序任意）-> 以 idx=row*width+col 索引的图层化文档。
export function normalizeMapDoc(doc) {
  const o = clone(doc) || {};
  o.schemaVersion = MAPDOC_VERSION;
  o.name = str(o.name, "");
  o.width = num(o.width, 0);
  o.music = str(o.music, "");
  o.entry = Array.isArray(o.entry) && o.entry.length >= 2 ? [num(o.entry[0], 0), num(o.entry[1], 0)] : null;
  o.ground = Array.isArray(o.ground) ? o.ground : [];       // [{sx,sy}] 或 [sx,sy] 扁平数组
  o.collision = Array.isArray(o.collision) ? o.collision : [];
  o.events = o.events && typeof o.events === "object" ? o.events : {};
  o.decorations = arr(o.decorations);
  o.units = arr(o.units);
  return o;
}

// ---- 校验 ----
// 返回问题字符串数组（空数组 = 通过）。registry 可选，用于引用完整性检查。
export function validateContent(content, registry) {
  const issues = [];
  if (!content) { issues.push("content 为空"); return issues; }
  if (content.schemaVersion !== CONTENT_VERSION) issues.push("content.schemaVersion 期望 " + CONTENT_VERSION + "，实际 " + content.schemaVersion);
  const npcIds = new Set();
  for (const [id, n] of Object.entries(content.npcs || {})) {
    if (String(n.id) !== String(id)) issues.push("NPC 键 " + id + " 与 def.id " + n.id + " 不一致");
    if (npcIds.has(n.id)) issues.push("NPC 重复 id " + n.id); npcIds.add(n.id);
    for (const d of n.drops || []) if (d.name && isRef(d.name)) issues.push("npc " + id + " 掉落应使用物品 id 而非 ref");
    if (n.model && !/\.pmg$/.test(n.model)) issues.push("npc " + id + " model 建议带 .pmg 扩展名");
  }
  for (const [name, it] of Object.entries(content.items || {})) if (!name) issues.push("物品缺少名称键");
  for (const [name, sk] of Object.entries(content.skills || {})) if (!name) issues.push("技能缺少名称键");
  if (registry) issues.push(...registry.validate());
  return issues;
}

export { isRef, refKind, refId };
