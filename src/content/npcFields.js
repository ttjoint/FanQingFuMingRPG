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

// 原版数据里的 `-1` 被当作无符号数读出，变成 4294967295（0xFFFFFFFF）。
// 现有 21 个 NPC 的 level/defence/exp 都是这个值（都是不参战的对话 NPC）。
// 目前无实际影响，但只要在编辑器里给它们配上攻击，4294967295 级的经验值
// 就会直接进伤害/奖励公式。这类“看上去是数字、实际是哨兵值”的脏数据
// 必须在入口归一，不能指望每份数据都干净。
const U32_SEQ = 4294967295;
const sane = (v, d) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n === U32_SEQ) return d;
  return n;
};

export const NPC_FIELDS = {
  name: { fromTemplate: d => d.name || "", default: "" },
  model: { fromTemplate: d => String((d && d.model) || "").replace(/\.pmg$/, ""), default: "" },
  portrait: { fromTemplate: d => d.portrait || "", default: "" },
  script: { fromTemplate: d => d.script || "", default: "" },
  hp: { fromTemplate: d => orElse(d && d.hp, 0), default: 0 },
  hpMax: { fromTemplate: d => orElse(d && d.hp, 0), default: 0 },
  atk: { fromTemplate: d => orElse(d && d.attack, 0), default: 0 },
  def: { fromTemplate: d => sane(d && d.defence, 0), default: 0 },
  level: { fromTemplate: d => sane(d && d.level, 1), default: 1 },
  exp: { fromTemplate: d => sane(d && d.exp, 0), default: 0 },
  attackable: { fromTemplate: d => int(d), default: false },
  aggressive: { fromTemplate: d => !!(d && d.hostile), default: false },
  ai: { fromTemplate: d => (d && (d.ai == null || d.ai === "")) ? "" : (typeof d.ai === "number" ? d.ai : String(d.ai)), default: "" },
  // 可用技能名列表（AI 施放用）。
  //   来源优先级：模板 skillList（数组）> 模板 skills 为数组。
  //   注意：原版模板的 `skills` **是对话占位符字符串**（如 "*/*"），不是技能名，
  //   不能直接当列表用；那种情况一律视为「无技能」。
  skills: {
    fromTemplate: d => {
      const v = d && d.skillList ? d.skillList : (d && Array.isArray(d.skills) ? d.skills : null);
      return Array.isArray(v) ? v.map(String).filter(Boolean) : [];
    },
    default: [],
  },
  speed: { fromTemplate: d => orElse(d && d.speed, 45), default: 45 },
  runSpeed: { fromTemplate: d => orElse(d && d.runSpeed, 70), default: 70 },
  drops: { fromTemplate: d => ((d && d.drops) || []).map(x => ({ name: x.name, count: x.count || 1 })), default: [] },
  inventory: { fromTemplate: d => (d && d.inventory) || null, default: null },
  // NPC 背包（脚本指令拾取/丢弃的目标容器）：条目数组，与玩家背包同一模型。
  // 空背包归一为 undefined（与未初始化的运行时实体一致），避免空数组与缺省值不等而误写入存档。
  bag: { fromTemplate: d => ((d && d.bag && d.bag.length) ? JSON.parse(JSON.stringify(d.bag)) : undefined), default: undefined },
  // 抗性（P0）：模板上是 [{type,value}]（schema.normalizeResist 规整过），
  // 单位上必须是**同一形状** —— engine/damage.js 的 resistOf 只看 target.resist。
  //
  // 这里曾经漏过很久：schema 能定义、编辑器能改、引擎能算，但 makeNPC 不搬，
  // 于是目标身上永远没有 resist，所有抗性**静默失效**（伤害恒按 0 抗结算）。
  // 缺省用 undefined 而不是 []：空数组与缺省值的差异会让存档 diff 误判（同 bag）。
  resist: {
    fromTemplate: d => {
      const r = d && d.resist;
      if (r == null) return undefined;
      if (Array.isArray(r)) return r.length ? r.map(x => ({ type: x.type, value: x.value })) : undefined;
      return r;   // 兼容单值 / 映射形式，resistOf 两种都认
    },
    default: undefined,
  },
  // 自身攻击的伤害类型（P0）：空串 = 物理（DEFAULT_DAMAGE_TYPE）。
  damageType: { fromTemplate: d => (d && d.damageType) || "", default: "" },
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
    drops: [], talks: [], inventory: null, bag: undefined, faction: "",
    // 抗性与伤害类型留空：物理无抗是旧行为的默认，不需要在每个模板里重复写。
    resist: undefined, damageType: "",
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
