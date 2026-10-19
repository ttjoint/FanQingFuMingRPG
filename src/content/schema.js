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

// 抗性规整。接受三种写法（见 engine/damage.js resistOf）：
//   { fire: 50 } / [{type,value}] / 50（单值，对所有类型生效）
// 统一输出为「有序数组」[{type,value}]，便于编辑器用表格编辑；
// 空对象/无值返回 null（= 无抗性，避免在每个 NPC 上存一堆 0）。
function normalizeResist(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isFinite(v) && v !== 0 ? [{ type: "all", value: v }] : null;
  const out = [];
  if (Array.isArray(v)) {
    for (const e of v) {
      if (!e || typeof e !== "object") continue;
      const t = str(e.type);
      const n = num(e.value, 0);
      if (t && n !== 0) out.push({ type: t, value: n });
    }
  } else if (typeof v === "object") {
    for (const k of Object.keys(v)) {
      const n = num(v[k], 0);
      if (n !== 0) out.push({ type: k, value: n });
    }
  }
  return out.length ? out : null;
}

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
  // 抗性：按伤害类型减免百分比（可负=弱点，>=100=免疫）。
  // 也支持单一数值（对所有类型生效，兼容旧数据）。解析见 engine/damage.js resistOf()。
  o.resist = normalizeResist(o.resist);
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
  // 伤害类型：物理/火焰/冰霜/闪电/毒素……由配置里的类型表给出合法值，
  // 引擎层只当作不透明 key 使用（见 engine/damage.js）。缺省为物理。
  o.damageType = str(o.damageType, "physical");
  o.sound = str(o.sound, "");
  o.icon = str(o.icon, "");
  o.frames = arr(o.frames).map(String);
  // 弹道配置：仅远程技能有意义；缺失则为 null（近战/瞬间结算）。
  o.projectile = o.mode === "ranged" ? normalizeProjectile(o.projectile) : null;
  // 阶段 D：目标类型 / AOE / 技能级冷却。
  o.targeting = normalizeTargeting(o.targeting);
  o.cooldown = Math.max(0, num(o.cooldown, 0));
  // 资源与充能（P3）：
  // - resource    ：消耗哪种资源（"mp" | "hp" | "none"）。缺省 mp，兼容旧数据。
  // - charges/maxCharges：充能型技能（如冲刺/闪避）。charges=0 表示不是充能技能。
  //   recharge 为每恢复 1 点充能所需秒数（缺省等于 cooldown）。
  // - passive     ：被动技能，不主动施放、不进技能栏，只提供加成（见 synergy）。
  o.resource = ["mp", "hp", "none"].includes(str(o.resource, "")) ? str(o.resource, "mp") : "mp";
  o.maxCharges = Math.max(0, Math.floor(num(o.maxCharges, 0)));
  o.recharge = Math.max(0, num(o.recharge, o.cooldown));
  o.passive = !!o.passive;
  // 协同（synergy）：本技能受哪些技能加成。
  // 形如 [{ skill: "内功", per: 0.08, max: 0.4 }]：对方每 1 级 +per 加成，上限 max。
  // 计算在 engine/skill.js 的 synergyBonus()，这里只做结构规整。
  o.synergy = arr(o.synergy).map(x => {
    const q = x && typeof x === "object" ? x : {};
    return {
      skill: str(q.skill, ""),
      per: num(q.per, 0),
      max: num(q.max, 0),
      stat: str(q.stat, "power"),   // 加成作用于哪个数值：power / range / duration
    };
  }).filter(x => x.skill && x.per);
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
//
// width/height 是两个独立维度。历史上 MapDoc 只存 width，并在**所有**网格运算里
// 假设 height === width（flags 一律 new Uint8Array(w*w)、边界判定一律 row < width）。
// 现有 9 张原版地图恰好都是正方形，所以这个假设从未暴露；但它是一个**隐式不变量**，
// 一旦编辑器新建非方形地图，碰撞/寻路会在无提示的情况下错乱：
//   - 行数多于列数时，下半张图被判为越界（走不进去）；
//   - 列数多于行数时，越界读取 flags 得到 undefined（读到「可走」）。
// 现在把 height 显式建模：缺省时按方形（= width）补齐，保证旧数据与旧存档行为完全不变。
export function normalizeMapDoc(doc) {
  const o = clone(doc) || {};
  o.schemaVersion = MAPDOC_VERSION;
  o.name = str(o.name, "");
  o.width = num(o.width, 0);
  // height 缺省 = width（兼容：历史 MapDoc 只有 width，且隐含正方形）。
  o.height = num(o.height, o.width);
  o.music = str(o.music, "");
  o.entry = Array.isArray(o.entry) && o.entry.length >= 2 ? [num(o.entry[0], 0), num(o.entry[1], 0)] : null;
  o.ground = Array.isArray(o.ground) ? o.ground : [];       // [{sx,sy}] 或 [sx,sy] 扁平数组
  o.collision = Array.isArray(o.collision) ? o.collision : [];
  o.events = o.events && typeof o.events === "object" ? o.events : {};
  o.decorations = arr(o.decorations);
  o.units = arr(o.units);
  return o;
}

// ---- 内容 lint ----
//
// validateContent 只保证「结构合法」（id 一致、字段类型对），因此一类真正的数据错误
// 能安静地活下去：名字里多一个空格、掉落表全空、脚本引用的 NPC 不存在、数值处在哨兵值。
// 这些都不会报错，只会在运行时表现为「脚本静默 no-op」或「怪打不死」。
//
// lintContent 补充这类语义检查。它是纯函数（不读运行时状态、不读文件），
// 因此能在编辑器保存时、CI 里、以及单测里直接跑。
//
// 返回的每条都是可读的中文描述，指到具体 id / 名字。
const SENTINEL32 = 4294967295;   // 0xFFFFFFFF：原数据用这个当地“无值”哨兵

// 名称里出现连续空白或首尾空白：几乎总是手滑，且会让脚本按名查找失效。
export function lintNames(list, kind) {
  const issues = [], seen = new Map();
  for (const d of list || []) {
    const name = d && d.name;
    if (typeof name !== "string" || !name) continue;
    if (/^\s|\s$/.test(name)) issues.push(kind + "「" + JSON.stringify(name) + "」首/尾有多余空白，按名查找会失效");
    else if (/\s{2,}/.test(name)) issues.push(kind + "「" + JSON.stringify(name) + "」含连续空白，按名查找会失效（应写作「" + name.replace(/\s+/g, "") + "」）");
    seen.set(name, (seen.get(name) || []).concat([d.id != null ? d.id : name]));
  }
  for (const [name, ids] of seen) if (ids.length > 1) issues.push(kind + "「" + name + "」重复出现（id: " + ids.join("/") + "），按名查找只能命中第一个");
  return issues;
}

// 数值合理性：哨兵值 / 非数值 / 负数。
export function lintNumbers(list, kind) {
  const issues = [];
  const check = ["level", "hp", "hpMax", "attack", "defence", "exp"];
  for (const d of list || []) {
    const label = kind + "「" + (d && d.name != null ? d.name : "?") + "」";
    for (const k of check) {
      const v = d && d[k];
      if (v == null) continue;
      if (typeof v !== "number" || !Number.isFinite(v)) { issues.push(label + " 的 " + k + " 不是有效数字（" + JSON.stringify(v) + "）"); continue; }
      if (v === SENTINEL32) issues.push(label + " 的 " + k + " 为 0xFFFFFFFF 哨兵值（未初始化）");
      else if (v < 0) issues.push(label + " 的 " + k + " 为负数（" + v + "）");
    }
  }
  return issues;
}

// 引用的 AI 必须存在。AI 表里 id 是标识、name 是显示名，单位按 id 引用。
export function lintAiRefs(npcs, ais) {
  const ids = new Set((ais || []).map(a => a && a.id).filter(Boolean));
  const issues = [];
  for (const n of npcs || []) {
    if (!n || !n.ai) continue;
    if (!ids.has(n.ai)) issues.push("NPC「" + n.name + "」引用了不存在的 AI「" + n.ai + "」");
  }
  return issues;
}

// 掉落物品名必须能在物品表里找到。
export function lintDropRefs(npcs, items) {
  const names = new Set((items || []).map(i => i && i.name).filter(Boolean));
  const issues = [];
  for (const n of npcs || []) for (const d of (n && n.drops) || []) {
    if (!d || !d.name) { issues.push("NPC「" + n.name + "」有一条掉落没写物品名"); continue; }
    if (!names.has(d.name)) issues.push("NPC「" + n.name + "」掉落引用了不存在的物品「" + d.name + "」");
  }
  return issues;
}

// 可战斗 NPC 却没有掉落，几乎总是漏配（不是错误，所以单独标注为“提示”）。
export function lintEmptyDrops(npcs) {
  const issues = [];
  for (const n of npcs || []) {
    if (!n) continue;
    // 只关心真的会打的单位：有攻击力或无 ai 的战斗模板；纯摆位的村民不算
    if (!(n.attack > 0)) continue;
    if (!n.drops || !n.drops.length) issues.push("NPC「" + n.name + "」（attack=" + n.attack + "）没有掉落表，击杀后无任何产出");
  }
  return issues;
}

// 脚本里按名字引用的单位，必须真能在内容里找到（否则运行时静默 no-op）。
// 只检查**按名引用单位**的指令；其他指令（跳图/对话/变量）不在此列。
const NAME_REF_FUNCS = new Set(["DelNPC", "AddNPC", "ShowNPCTalk", "SetNPCEvent", "SetNPCAttack", "NPCPickItem", "NPCDropAt", "SetFaction", "SetBuff"]);
export function lintScriptRefs(scripts, npcs) {
  const names = new Set((npcs || []).map(n => n && n.name).filter(Boolean));
  const issues = [];
  const seen = new Set();
  const scan = (src, where) => {
    if (typeof src !== "string") return;
    // 指令调用形如 Name("参数"...)：只取第一个字符串参数当“单位名”
    const re = /([A-Za-z_]\w*)\s*\(\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(src))) {
      const fn = m[1], arg = m[2];
      if (!NAME_REF_FUNCS.has(fn)) continue;
      if (!npcs || !npcs.length) continue;          // 没提供 NPC 表就不做引用检查
      if (names.has(arg)) continue;
      // 名字带空白时单独提一句：这就是典型的“看起来一样其实不同”
      const squeezed = arg.replace(/\s+/g, "");
      const near = [...names].filter(x => x.replace(/\s+/g, "") === squeezed);
      const hint = near.length ? "（内容里有名字相近的「" + near.join("/") + "」，空白不一致）" : "";
      const key = fn + ":" + arg;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(where + " 的 " + fn + "(\"" + arg + "\") 找不到同名单位，运行时会静默忽略" + hint);
    }
  };
  for (const [name, src] of Object.entries(scripts || {})) scan(src, "脚本「" + name + "」");
  return issues;
}

// 内容总 linter：把上面几项串起来。可以直接给编辑器/CI 用。
// content 为 ContentDB 形状（Record 或旧数组都接受）。
//
// 每条问题分两级：
//   error    —— 确定是 bug，运行时会有可见后果（名字不一致导致脚本失效、引用不存在）
//   warning  —— 可疑但不是错误（哨兵值、空掉落表），可能是故意留的
// 返回对象 { level, msg }，方便编辑器分流显示、CI 只卡 error。
// lintContentList() 是只取文本的简化版（兼容旧调用）。
export function lintContentDetailed(content) {
  if (!content) return [{ level: "error", msg: "content 为空" }];
  const npcList = Array.isArray(content.npcs) ? content.npcs
    : Object.values(content.npcs || {});
  const itemList = Array.isArray(content.items) ? content.items
    : Object.values(content.items || {});
  const aiList = Array.isArray(content.ais) ? content.ais
    : Object.values(content.ais || {});
  const out = [];
  const push = (level, list) => { for (const msg of list) out.push({ level, msg }); };
  // 名字空白/重名：error（直接导致按名查找失效）
  push("error", lintNames(npcList, "NPC"));
  push("error", lintNames(itemList, "物品"));
  // 引用失效：error
  push("error", lintAiRefs(npcList, aiList));
  push("error", lintDropRefs(npcList, itemList));
  push("error", lintScriptRefs(content.scripts, npcList));
  // 数值哨兵 / 空掉落：warning（不影响当前玩法，但埋了雷）
  push("warning", lintNumbers(npcList, "NPC"));
  push("warning", lintEmptyDrops(npcList));
  return out;
}

export function lintContent(content) {
  return lintContentDetailed(content).map(x => (x.level === "error" ? "[错误] " : "[警告] ") + x.msg);
}

// ---- 校验 ----
// 返回问题字符串数组（空数组 = 通过）。registry 可选，用于引用完整性检查。
export function validateContent(content, registry, opts) {
  const issues = [];
  // 地图尺寸自洽：缺 height 会退回「方形」假设，但图层长度必须真的等于 w*h。
  for (const [name, d] of Object.entries((content && content.mapDocs) || {})) {
    if (!d) continue;
    const w = d.width | 0, h = (d.height == null ? w : d.height) | 0;
    if (w <= 0 || h <= 0) { issues.push("地图 " + name + " 尺寸非法（" + w + "×" + h + "）"); continue; }
    const n = w * h;
    for (const layer of ["ground", "collision", "cellLayer"]) {
      const a = d[layer];
      if (a && a.length !== n) issues.push("地图 " + name + " 的 " + layer + " 长度 " + a.length + " ≠ " + w + "×" + h + "（长宽不一致或数据残留）");
    }
  }
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
  // 语义 lint 默认开启：结构合法但内容明显错了的情况（名字带空白、引用失效、
  // 空掉落、哨兵数值）必须能在这里暴露。传 { lint: false } 可关掉。
  // strict: 为 true 时把 warning 也当成问题（CI 用）。
  if (!opts || opts.lint !== false) {
    for (const x of lintContentDetailed(content)) {
      if (x.level === "error" || (opts && opts.strict)) issues.push(x.msg);
    }
  }
  return issues;
}

export { isRef, refKind, refId };
