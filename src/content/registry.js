// IdRegistry：按 (kind, id) 解析定义，替代到处 find(x => x.name === n) 的用法。
// 同时提供引用完整性校验，供编辑器面板显示断链。
import { parseRef } from "./ids.js";

export function createRegistry(content) {
  const c = content || {};
  const mapDocs = c.mapDocs || {};
  const table = kind => ({
    npc: c.npcs, item: c.items, skill: c.skills, script: c.scripts, map: mapDocs,
  })[kind] || {};

  const reg = {
    get(kind, id) { const t = table(kind); return t[String(id)]; },
    has(kind, id) { return reg.get(kind, id) != null; },
    list(kind) { return Object.keys(table(kind)); },
    byName(kind, name) { const t = table(kind); for (const k in t) if (t[k] && t[k].name === name) return t[k]; },
    idByName(kind, name) { const t = table(kind); for (const k in t) if (t[k] && t[k].name === name) return k; },
    getByRef(ref) { const { kind, id } = parseRef(ref); return reg.get(kind, id); },
    hasRef(ref) { const { kind, id } = parseRef(ref); return reg.has(kind, id); },
    validate() {
      const issues = [];
      for (const [id, n] of Object.entries(c.npcs || {})) {
        if (n.script && !reg.has("script", n.script)) issues.push(`NPC ${id} 引用不存在的脚本「${n.script}」`);
        for (const d of n.drops || []) if (d.name && !reg.has("item", d.name)) issues.push(`NPC ${id} 掉落引用不存在的物品「${d.name}」`);
        for (const s of n.skills || []) if (s && !reg.has("skill", s)) issues.push(`NPC ${id} 引用不存在的技能「${s}」`);
      }
      for (const [mid, doc] of Object.entries(mapDocs)) {
        for (const u of doc.units || []) if (!reg.has("npc", u.npc)) issues.push(`地图 ${mid} 单位引用不存在的 NPC「${u.npc}」`);
      }
      return issues;
    },
  };
  return reg;
}
