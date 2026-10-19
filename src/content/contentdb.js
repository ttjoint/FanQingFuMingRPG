// ContentDB：内容定义的规范模型（Record<id, Def>），由旧 assets 数据构建，
// 也可由打包补丁（patch）覆盖。构建脚本、运行时、编辑器共用这一份结构。
import { CONTENT_VERSION, normalizeNpc, normalizeItem, normalizeSkill, normalizeConfig, normalizeMapDoc, normalizeDecorTemplates, normalizeFactions, normalizeAis, normalizeBuffList, normalizeEffectList, normalizeAffixList } from "./schema.js";
import { normalizeUi } from "./ui.js";
import { normalizeWaypoints } from "../engine/waypoint.js";
import { normalizeUniques, normalizeSets } from "../engine/uniqueItem.js";
import { defaultUi } from "./uiDefault.js";
import { normalizePages } from "./page.js";
import { defaultPageTable } from "./pageDefault.js";

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
    factions: normalizeFactions(assets.factions),   // 阵营关系表（内容内置，只读）
    ais: normalizeAis(assets.ais),                   // AI 配置表（内容内置，单位按 id 引用）
    buffs: normalizeBuffList(assets.buffs),          // Buff/Debuff 配置表（内容内置，技能按 id 引用）
    effects: normalizeEffectList(assets.effects),    // 特效定义表（内容内置，技能/Buff/指示按 id 引用）
    affixes: normalizeAffixList(assets.affixes),     // 词缀表（物品实例随机词缀的来源）
    game: deep(assets.game) || {}, transitions: deep(assets.transitions) || {}, mapsIndex: deep(assets.mapsIndex) || {},
    mapsManifest: (assets.mapsManifest || []).slice(), mapDocs: docs,
    decorTemplates: normalizeDecorTemplates(assets.decorTemplates || {}),   // 跨地图共享的装饰物模板
    // 界面布局：可编辑的 UI 元件表。缺省 = 改造前的硬编码布局（逐像素一致）。
    ui: normalizeUi(assets.ui || defaultUi()),
    // 全屏页面：标题/片头/关于/结算/告别。缺省 = 改造前写死在 scene-ui.js 的那 5 个。
    pages: normalizePages(assets.pages || defaultPageTable().pages),
    // 版本指定的"启动后进入哪个页面"。缺省从片头开始（与改造前一致）。
    initialPage: String(assets.initialPage || defaultPageTable().initial),
    // 传送点表（P4）：踩点解锁 + 图间传送。缺省为空 = 退回纯脚本跳图。
    waypoints: normalizeWaypoints(assets.waypoints),
    uniques: normalizeUniques(assets.uniques),        // 暗金物品（P4）：按物品名绑定的固定词缀
    sets: normalizeSets(assets.sets),                 // 套装（P4）：按件数阶梯加成
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
    factions: content.factions || [],
    ais: content.ais || [],
    buffs: content.buffs || [],
    effects: content.effects || [],
    affixes: content.affixes || [],
    transitions: content.transitions, mapsIndex: content.mapsIndex, mapsManifest: content.mapsManifest,
    decorTemplates: content.decorTemplates || {},
    waypoints: content.waypoints || [],
    uniques: content.uniques || [],
    sets: content.sets || [],
    // 内容域（非"实体表"但系统/渲染层要读）：
    //   ui   —— 界面元件表；pages —— 全屏页面表；initialPage —— 版本指定的启动页。
    // 之前这些只挂在 runtime.content 上，导致 render/scene-ui.js 读 A.pages 永远 undefined
    // （实测：页面对话框点了没反应，因为页面查不到 → 元件命中恒为空）。
    ui: content.ui || null,
    pages: content.pages || [],
    initialPage: content.initialPage || "",
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
  // 阵营关系表（整表替换；随内容版本固定，但允许内容包覆盖）
  if (!eq(base.factions, next.factions)) patch.content.factions = deep(next.factions);
  if (!eq(base.ais, next.ais)) patch.content.ais = deep(next.ais);   // AI 配置表（整表替换）
  if (!eq(base.buffs, next.buffs)) patch.content.buffs = deep(next.buffs);   // Buff 配置表（整表替换）
  if (!eq(base.effects, next.effects)) patch.content.effects = deep(next.effects);   // 特效定义表（整表替换）
  if (!eq(base.affixes, next.affixes)) patch.content.affixes = deep(next.affixes);   // 词缀表（整表替换）
  // 界面布局：元件是**有序数组**（z 序/同层绘制顺序有意义），增删移动都属于整表差异。
  if (!eq(base.ui, next.ui)) patch.content.ui = deep(next.ui);
  // 传送点表（P4）：同样是数组（顺序即面板里的显示顺序），整表替换。
  if (!eq(base.waypoints, next.waypoints)) patch.content.waypoints = deep(next.waypoints);
  if (!eq(base.uniques, next.uniques)) patch.content.uniques = deep(next.uniques);   // 暗金表（整表替换）
  if (!eq(base.sets, next.sets)) patch.content.sets = deep(next.sets);               // 套装表（整表替换）
  // 装饰物模板（按贴图键）：只存非空且变化的条目
  {
    const b = base.decorTemplates || {}, n = next.decorTemplates || {};
    const mod = {}, removed = [];
    for (const k in n) { const v = normalizeDecorTemplates({ x: n[k] }).x; if (!v) continue; if (!eq(b[k], v)) mod[k] = v; }
    for (const k in b) if (!(k in n) || !normalizeDecorTemplates({ x: n[k] }).x) removed.push(k);
    if (Object.keys(mod).length) patch.content.decorTemplates = mod;
    if (removed.length) patch.content.removedDecorTemplates = removed;
  }
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
  if (c.factions !== undefined) out.factions = normalizeFactions(c.factions);
  if (c.ais !== undefined) out.ais = normalizeAis(c.ais);
  if (c.buffs !== undefined) out.buffs = normalizeBuffList(c.buffs);
  if (c.effects !== undefined) out.effects = normalizeEffectList(c.effects);
  if (c.affixes !== undefined) out.affixes = normalizeAffixList(c.affixes);
  if (c.ui !== undefined) out.ui = normalizeUi(c.ui);
  if (c.waypoints !== undefined) out.waypoints = normalizeWaypoints(c.waypoints);
  if (c.uniques !== undefined) out.uniques = normalizeUniques(c.uniques);
  if (c.sets !== undefined) out.sets = normalizeSets(c.sets);
  {
    if (!out.decorTemplates) out.decorTemplates = {};
    const mod = c.decorTemplates || {};
    for (const k in mod) out.decorTemplates[k] = deep(mod[k]);
    for (const k of (c.removedDecorTemplates || [])) delete out.decorTemplates[k];
    out.decorTemplates = normalizeDecorTemplates(out.decorTemplates);
  }
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
