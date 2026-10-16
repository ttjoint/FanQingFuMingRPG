// 引擎核心：通用「模板 → 实例差异」序列化（纯函数，可在 Node 中测试）。
//
// 设计：本模块**不认识任何具体游戏字段**。它只接受一个「字段方案（schema）」：
//   schema = { keys: string[], fields: { [k]: { fromTemplate(t): any, default: any } }, always?: string[] }
// 由内容适配层通过 configureSerializer(schema) 注入一次（见 systems/save.js 的装配），
// 例如 content/npcFields.js 的 NPC_FIELDS 与之派生出的 schema。
// 这样新增/修改游戏字段完全不需要改动引擎，引擎只保留通用的差异计算与还原能力。
//
// 用途：存档只保存「与模板不同的字段」，还原时用「模板 + 差异 + 默认值」重建。

// 运行时实体的位置/生死等永远显式保存的字段（不参与模板派生）。
export const POSITION_KEYS = ["id", "x", "y", "dir", "dead"];

let SCHEMA = { keys: [], fields: {}, always: POSITION_KEYS };

// 注入字段方案（由内容层装配；引擎自身保持通用）。
export function configureSerializer(schema) {
  SCHEMA = {
    keys: (schema && schema.keys) || [],
    fields: (schema && schema.fields) || {},
    always: (schema && schema.always) || POSITION_KEYS,
  };
}

// 从一份 { k: {fromTemplate,default} } 字段表构造 schema（便捷）。
export function makeSchema(fields, always = POSITION_KEYS) {
  return { keys: Object.keys(fields), fields, always };
}

// 计算某个实例相对其模板的差异；template 为对应内容数据（可为空）。
export function diffAgainst(unit, template, schema = SCHEMA) {
  const { keys, fields, always } = schema;
  const out = {};
  for (const k of always) out[k] = unit[k];
  for (const k of keys) {
    const dv = template ? fields[k].fromTemplate(template) : undefined;
    if (JSON.stringify(unit[k]) !== JSON.stringify(dv)) out[k] = unit[k];
  }
  return out;
}

// 由「模板 + 存档差异」还原字段对象（不含组件与运行时属性）。
export function fieldsFromSave(template, saved, schema = SCHEMA) {
  const { keys, fields } = schema;
  const out = {};
  for (const k of keys) {
    out[k] = (saved && saved[k] !== undefined) ? saved[k]
      : (template !== undefined && template !== null ? fields[k].fromTemplate(template) : fields[k].default);
  }
  return out;
}

// 向后兼容别名（旧调用点 / 旧测试）。
export const diffNpcAgainst = (unit, template, schema) => diffAgainst(unit, template, schema);
export const npcFieldsFromSave = (template, saved, schema) => fieldsFromSave(template, saved, schema);
