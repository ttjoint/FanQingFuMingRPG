// 内容/文档 schema：默认值、规整（normalize）与校验（validate）。
// 这是「构建脚本 / 运行时 / 编辑器」共用的单一契约。数据缺字段时会补齐，
// 未知字段一律保留（向前兼容，避免丢数据）。
import { isRef, refKind, refId } from "./ids.js";

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
  o.ai = num(o.ai, 0);
  o.speed = num(o.speed, 45);
  o.runSpeed = num(o.runSpeed, 70);
  // skills 在旧数据里是错位的台词文本：过滤为数组（保留合法字符串）
  o.skills = Array.isArray(o.skills) ? o.skills.map(String) : [];
  if (!Array.isArray(o.drops)) o.drops = [];
  o.drops = o.drops.map(d => ({ name: str(d && d.name, ""), count: num(d && d.count, 1) })).filter(d => d.name);
  o.talks = arr(o.talks).map(String);
  return o;
}

// ---- Item / Skill ----
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
  return o;
}
export function normalizeSkill(sk) {
  const o = clone(sk) || {};
  o.name = str(o.name, "新技能");
  o.type = num(o.type, 1);
  o.range = num(o.range, 40);
  o.mp = num(o.mp, 0);
  o.reqLevel = num(o.reqLevel, 1);
  o.power = num(o.power, 0);
  o.sound = str(o.sound, "");
  o.icon = str(o.icon, "");
  o.frames = arr(o.frames).map(String);
  o.desc = str(o.desc, "");
  return o;
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

// ---- Config ----
export const DEFAULT_CONFIG = {
  player: { hpMax: 200, mpMax: 100, expNext: 500, level: 1, money: 500, moral: 0, honor: 0, attack: 20, defence: 5, hit: 30 },
  levelUp: { expMul: 1.5, expAdd: 200, hpMax: 40, mpMax: 20, attack: 5, defence: 3, hit: 3, maxLevel: 99, healOnLevel: true },
  combat: { rangeMin: 40, attackCD: 0.9, mpDrainRun: 1.6, npcAttackCD: 1.1, npcAggro: 260, npcMelee: 46, npcHitBase: 20, npcHitPerLevel: 60 },
};
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
