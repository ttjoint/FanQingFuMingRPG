// ContentDB：内容定义的规范模型（Record<id, Def>），由旧 assets 数据构建，
// 也可由打包补丁（patch）覆盖。构建脚本、运行时、编辑器共用这一份结构。
import { CONTENT_VERSION, normalizeNpc, normalizeItem, normalizeSkill, normalizeConfig, normalizeMapDoc } from "./schema.js";

const deep = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
export const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function buildContentDB(assets, mapDocs) {
  const npcs = {}, npcOrder = [];
  for (const n of assets.npcs || []) { const d = normalizeNpc(n); npcs[String(d.id)] = d; npcOrder.push(String(d.id)); }
  const items = {}, itemOrder = [];
  for (const it of assets.items || []) { const d = normalizeItem(it); items[d.name] = d; itemOrder.push(d.name); }
  const skills = {}, skillOrder = [];
  for (const sk of assets.skills || []) { const d = normalizeSkill(sk); skills[d.name] = d; skillOrder.push(d.name); }
  const scripts = {}; for (const k in (assets.scripts || {})) scripts[k] = assets.scripts[k];
  const docs = {}; for (const k in (mapDocs || {})) docs[k] = normalizeMapDoc(mapDocs[k]);
  return {
    schemaVersion: CONTENT_VERSION,
    config: normalizeConfig(assets.config),
    npcs, npcOrder, items, itemOrder, skills, skillOrder, scripts,
    game: deep(assets.game) || {}, transitions: deep(assets.transitions) || {}, mapsIndex: deep(assets.mapsIndex) || {},
    mapsManifest: (assets.mapsManifest || []).slice(), mapDocs: docs,
  };
}

// 规范模型 -> 旧运行时视图（A.npcsData / A.items / ...），保证既有 systems 不用改。
export function contentToLegacy(content) {
  return {
    npcs: content.npcOrder.map(id => content.npcs[id]),
    items: content.itemOrder.map(id => content.items[id]),
    skills: content.skillOrder.map(id => content.skills[id]),
    scripts: content.scripts,
    config: content.config, game: content.game,
    transitions: content.transitions, mapsIndex: content.mapsIndex, mapsManifest: content.mapsManifest,
  };
}

// ---- 补丁 ----
// 只存与基准不同的条目，避免“改一条重写整域”。
export function diffContent(base, next) {
  const patch = { content: {}, maps: {}, removedMaps: [] };
  const tableDiff = (key, removedKey, b, n, order) => {
    const mod = {};
    const ids = new Set([...(order || []), ...Object.keys(n)]);
    for (const id of ids) if (!eq(b[id], n[id])) mod[id] = deep(n[id]);
    const removed = Object.keys(b).filter(id => !(id in n));
    if (Object.keys(mod).length) patch.content[key] = mod;
    if (removed.length) patch.content[removedKey] = removed;
  };
  tableDiff("npcs", "removedNpcs", base.npcs, next.npcs, next.npcOrder);
  tableDiff("items", "removedItems", base.items, next.items, next.itemOrder);
  tableDiff("skills", "removedSkills", base.skills, next.skills, next.skillOrder);
  tableDiff("scripts", "removedScripts", base.scripts, next.scripts, Object.keys(next.scripts));
  for (const k of ["config", "game", "mapsIndex", "transitions"]) if (!eq(base[k], next[k])) patch.content[k] = deep(next[k]);
  for (const id in next.mapDocs) if (!eq(base.mapDocs[id], next.mapDocs[id])) patch.maps[id] = deep(next.mapDocs[id]);
  patch.removedMaps = Object.keys(base.mapDocs).filter(id => !(id in next.mapDocs));
  if (!Object.keys(patch.content).length) delete patch.content;
  if (!Object.keys(patch.maps).length) delete patch.maps;
  if (!patch.removedMaps.length) delete patch.removedMaps;
  return patch;
}

export function applyPatch(base, patch) {
  if (!patch) return base;
  const out = deep(base);
  const c = patch.content || {};
  const applyTable = (key, removedKey, order) => {
    const mod = c[key] || {};
    for (const id in mod) { if (!(id in out[key])) order && order.push(id); out[key][id] = deep(mod[id]); }
    for (const id of (c[removedKey] || [])) { delete out[key][id]; if (order) { const i = order.indexOf(id); if (i >= 0) order.splice(i, 1); } }
  };
  applyTable("npcs", "removedNpcs", out.npcOrder);
  applyTable("items", "removedItems", out.itemOrder);
  applyTable("skills", "removedSkills", out.skillOrder);
  applyTable("scripts", "removedScripts", null);
  for (const k of ["config", "game", "mapsIndex", "transitions"]) if (c[k] !== undefined) out[k] = deep(c[k]);
  out.config = normalizeConfig(out.config);
  for (const id in (patch.maps || {})) out.mapDocs[id] = normalizeMapDoc(patch.maps[id]);
  for (const id of (patch.removedMaps || [])) delete out.mapDocs[id];
  return out;
}

// 定义 + 实例覆盖 -> 生效定义（浅合并；overrides 里的字段整取代模板字段）。
// 用于地图上的单位实例（UnitPlacement.overrides）。
export function resolveNpc(def, overrides) {
  if (!def) return def;
  if (!overrides || !Object.keys(overrides).length) return def;
  return { ...def, ...overrides };
}
