// NPC 字段映射表（单一事实来源）。
//
// 历史上 `makeNPC`（创建）/ `diffNpc`（存档差异化）/ `npcFromSave`（还原）各写了一套
// 字段映射与默认值，新增字段容易漏改（例如 inventory 就漏过存档还原）。
// 这里用一张表统一描述「模板字段 -> 运行时实体字段」的派生与默认值，三处共用。
//
// 每个条目：
//   fromTemplate(d) : 由 NPC 模板（内容数据）派生运行时值（也是存档差异比较的基准）
//   default         : 模板缺失时的缺省值（等价于 fromTemplate(空对象)）
//
// 说明：`speed`/`runSpeed` 等“模板可缺省”的字段，一律在 fromTemplate 内补默认，
// 这样模板/存档/运行时三者的派生值天然一致。

const int = d => (d && d.attack) > 0;
const orElse = (v, d) => (v == null ? d : v);

export const NPC_FIELDS = {
  name: { fromTemplate: d => d.name || "", default: "" },
  model: { fromTemplate: d => String((d && d.model) || "").replace(/\.pmg$/, ""), default: "" },
  portrait: { fromTemplate: d => d.portrait || "", default: "" },
  script: { fromTemplate: d => d.script || "", default: "" },
  hp: { fromTemplate: d => orElse(d && d.hp, 0), default: 0 },
  hpMax: { fromTemplate: d => orElse(d && d.hp, 0), default: 0 },
  atk: { fromTemplate: d => orElse(d && d.attack, 0), default: 0 },
  def: { fromTemplate: d => orElse(d && d.defence, 0), default: 0 },
  level: { fromTemplate: d => orElse(d && d.level, 1), default: 1 },
  exp: { fromTemplate: d => orElse(d && d.exp, 0), default: 0 },
  attackable: { fromTemplate: d => int(d), default: false },
  aggressive: { fromTemplate: d => !!(d && d.hostile), default: false },
  ai: { fromTemplate: d => (d && (d.ai == null || d.ai === "")) ? "" : (typeof d.ai === "number" ? d.ai : String(d.ai)), default: "" },
  speed: { fromTemplate: d => orElse(d && d.speed, 45), default: 45 },
  runSpeed: { fromTemplate: d => orElse(d && d.runSpeed, 70), default: 70 },
  drops: { fromTemplate: d => ((d && d.drops) || []).map(x => ({ name: x.name, count: x.count || 1 })), default: [] },
  inventory: { fromTemplate: d => (d && d.inventory) || null, default: null },
  faction: { fromTemplate: d => (d && d.faction) || "", default: "" },
  talks: { fromTemplate: d => (d && d.talks) || [], default: [] },
  talk: { fromTemplate: d => ((d && d.talks && d.talks.length) ? d.talks[0].replace(/\\n/g, "\n") : ""), default: "" },
};

export const NPC_FIELD_KEYS = Object.keys(NPC_FIELDS);

// 常用缺省值的具名导出，避免在逻辑层散落魔法数字（单一事实来源）。
export const NPC_DEFAULT_SPEED = NPC_FIELDS.speed.default;          // 45
export const NPC_DEFAULT_RUN_SPEED = NPC_FIELDS.runSpeed.default;  // 70

// 新建 NPC（编辑器）的初始模板。这里集中定义，避免默认值散落。
export function newNpcTemplate() {
  return {
    id: 0, name: "新NPC", model: "npc001.pmg", portrait: "", script: "",
    hp: 100, attack: 10, defence: 0, level: 1, exp: 0, hostile: 0, ai: 0,
    skills: [], speed: NPC_DEFAULT_SPEED, runSpeed: NPC_DEFAULT_RUN_SPEED,
    drops: [], talks: [], inventory: null, faction: "",
  };
}

// 由模板派生一份 { field: value }（用于创建实体 / 存档差异基准）。
// @returns {Record<string, any>}
export function npcFieldsFromTemplate(d) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of NPC_FIELD_KEYS) out[k] = NPC_FIELDS[k].fromTemplate(d);
  return out;
}

// 供引擎序列化（engine/npcSerialize.js）注入的字段方案（schema）。
// 引擎不认识具体字段，只按这份方案做「模板差异 / 还原」。
export const NPC_SCHEMA = { keys: NPC_FIELD_KEYS, fields: NPC_FIELDS };

// 缺省值对象（模板完全缺失时使用）。
// @returns {Record<string, any>}
export function npcFieldDefaults() {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of NPC_FIELD_KEYS) out[k] = NPC_FIELDS[k].default;
  return out;
}
