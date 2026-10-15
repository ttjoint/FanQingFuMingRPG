// 内容编辑器：以 ContentDB（内容定义）+ 图层化 MapDoc（地图）为规范模型，
// 保存为“补丁式内容包”（只存与默认版本不同的条目）。编辑器内部仍保留旧版
// 数组/地图视图以复用面板，但读写统一经由 Project 适配层。
import { G, A } from "../core/state.js";
import { setAssetOverrides } from "../core/assets.js";
import { h, clear, deep } from "./dom.js";
import { injectStyle } from "./style.js";
import { renderForm, renderListEditor } from "./fields.js";
import { mountMapEditor } from "./map-editor.js";
import { applyPatch, diffContent } from "../content/contentdb.js";
import { attachLegacyViews } from "../content/mapDoc.js";
import { buildMapData } from "../world/map.js";
import { createRegistry } from "../content/registry.js";
import { validateContent } from "../content/schema.js";
import { getRuntime } from "../runtime/context.js";
import {
  loadPack, savePack, activeId, DEFAULT_VERSION, createPack, setActive,
  exportPack, pickJSON, importPack, readImageFile,
} from "../content/store.js";
import { PACK_FORMAT, PACK_VERSION } from "../content/schema.js";

let root = null, ED = null, dirty = false, curTab = "maps";
let mainEl, sideEl, statusEl, mapEditor = null;

const mark = () => { dirty = true; };

// ---------- Project ----------
// base: 默认版本 ContentDB；pack: 内容包（补丁）。
function createProject(base, pack) {
  const content = applyPatch(base, pack.patch || {});
  const maps = {};
  for (const n of content.mapsManifest) if (content.mapDocs[n]) maps[n] = attachLegacyViews(content.mapDocs[n]);
  const p = { id: pack.id, name: pack.name, base, content, maps, images: deep(pack.images || {}) };
  // 数组视图与 content 记录共享同一批对象引用，字段编辑自动同步；
  // 增删/排序在 syncProject 时重建记录。
  p.npcs = content.npcOrder.map(id => content.npcs[id]);
  p.items = content.itemOrder.map(id => content.items[id]);
  p.skills = content.skillOrder.map(id => content.skills[id]);
  return p;
}

function syncProject(p) {
  const c = p.content;
  const rebuild = (arr, keyFn, tkey, okey) => {
    const t = {}, o = [];
    for (const it of arr) { const k = String(keyFn(it)); if (k == null) continue; t[k] = it; o.push(k); }
    c[tkey] = t; c[okey] = o;
  };
  rebuild(p.npcs, it => it.id, "npcs", "npcOrder");
  rebuild(p.items, it => it.name, "items", "itemOrder");
  rebuild(p.skills, it => it.name, "skills", "skillOrder");
  // 地图已为 MapDoc 且带旧视图（非枚举）：直接作为规范存储，不做转换。
  c.mapDocs = p.maps;
  return c;
}

function currentPatch() { syncProject(ED); return diffContent(ED.base, ED.content); }
function exportObj() { return { format: PACK_FORMAT, version: PACK_VERSION, id: ED.id, name: ED.name, base: "__default__", patch: currentPatch(), images: ED.images }; }

// ---------- 打开 / 关闭 ----------
export async function openEditor() {
  if (root) return;
  const base = A.defaults;   // 默认版本 ContentDB
  let pack = await loadPack(activeId());
  if (!pack || pack.id === DEFAULT_VERSION || (pack.patch && pack.patch.legacyDomains)) {
    const name = prompt("默认版本为只读原版数据。\n请输入新版本名称，编辑内容将保存到该版本：", "我的版本");
    if (!name) return;
    pack = await createPack(name);
    setActive(pack.id);
  }
  ED = createProject(base, pack);
  dirty = false;
  injectStyle();
  G.scene = "editor";
  root = h("div", { id: "editorRoot" });
  document.body.appendChild(root);
  buildShell();
  selectTab("maps");
}

export async function closeEditor(force) {
  if (!root) return;
  if (!force && dirty) {
    if (confirm("有未保存的修改，是否保存到版本「" + ED.name + "」？")) { if (!(await doSave())) return; }
  }
  if (mapEditor) { mapEditor.destroy(); mapEditor = null; }
  root.remove(); root = null; G.scene = "menu";
}

// ---------- 保存 ----------
function applyRuntime() {
  syncProject(ED);
  getRuntime().install(ED.content, ED.base, buildMapData);
  setAssetOverrides(ED.images || {});
}

async function doSave() {
  const pack = { format: PACK_FORMAT, version: PACK_VERSION, id: ED.id, name: ED.name, base: "__default__", patch: currentPatch(), images: ED.images, updatedAt: Date.now() };
  const r = await savePack(pack);
  if (!r.ok) { toast(r.error || "保存失败"); return false; }
  applyRuntime();
  A.activePack = (await loadPack(ED.id)) || pack;
  dirty = false;
  const issues = validateContent(ED.content, createRegistry(ED.content));
  toast(issues.length ? ("已保存（" + issues.length + " 处引用/校验提示）") : "已保存到版本「" + ED.name + "」");
  if (issues.length) console.warn("内容校验提示：\n" + issues.join("\n"));
  return true;
}

function toast(msg) {
  if (!statusEl) return;
  clear(statusEl); statusEl.append(h("span", null, msg)); statusEl.classList.add("show");
  clearTimeout(/** @type {any} */ (toast)._t); /** @type {any} */ (toast)._t = setTimeout(() => statusEl.classList.remove("show"), 2200);
}

// ---------- 外壳 ----------
const TABS = [["maps", "地图"], ["scripts", "脚本"], ["npcs", "NPC"], ["items", "物品"], ["skills", "技能"], ["config", "升级数值"], ["game", "标题结局"], ["assets", "图片素材"]];
let navEl;

function buildShell() {
  clear(root);
  const nameIn = h("input", { type: "text", value: ED.name, style: "width:150px" });
  nameIn.oninput = () => { ED.name = nameIn.value; mark(); };
  const bar = h("div", { class: "ed-bar" },
    h("span", { class: "ed-title" }, "内容编辑器"),
    h("span", { class: "ed-hint" }, "版本："), nameIn,
    h("span", { class: "ed-spacer" }),
    h("button", { class: "ed-btn primary", onclick: () => doSave() }, "保存"),
    h("button", { class: "ed-btn", onclick: () => exportPack(exportObj()) }, "导出"),
    h("button", { class: "ed-btn", onclick: () => pickJSON(async o => { try { const p = await importPack(o); ED = createProject(A.defaults, p); setActive(p.id); dirty = true; buildShell(); selectTab(curTab); toast("已导入为版本「" + p.name + "」"); } catch (e) { alert(String(e.message || e)); } }) }, "导入"),
    h("button", { class: "ed-btn", onclick: () => closeEditor() }, "关闭并返回"));
  navEl = h("div", { class: "ed-nav" });
  mainEl = h("div", { class: "ed-main" });
  sideEl = h("div", { class: "ed-side" });
  statusEl = h("div", { class: "ed-toast" });
  root.append(bar, h("div", { class: "ed-body" }, navEl, mainEl, sideEl), statusEl);
  renderNav();
}

function renderNav() {
  clear(navEl);
  for (const [k, label] of TABS) navEl.append(h("button", { class: curTab === k ? "on" : "", onclick: () => selectTab(k) }, label));
}

function selectTab(k) {
  if (mapEditor) { mapEditor.destroy(); mapEditor = null; }
  curTab = k; renderNav();
  clear(mainEl); clear(sideEl);
  if (k !== "maps") sideEl.style.display = "none"; else sideEl.style.display = "";
  ({ maps: tabMaps, scripts: tabScripts, npcs: tabNpcs, items: tabItems, skills: tabSkills, config: tabConfig, game: tabGame, assets: tabAssets })[k]();
}

// ---------- 地图 ----------
function tabMaps() {
  mapEditor = mountMapEditor(mainEl, sideEl, {
    names: ED.content.mapsManifest,
    current: (G.currentMap && ED.content.mapDocs[G.currentMap]) ? G.currentMap : undefined,
    maps: ED.maps,
    mapsIndex: ED.content.mapsIndex,
    transitions: ED.content.transitions,
    npcs: ED.npcs,
    npcOptions: ED.npcs.map(n => ({ v: n.id, label: n.id + " " + n.name })),
    npcName: id => { const n = ED.npcs.find(x => x.id === id); return n ? n.name : ("#" + id); },
    itemNames: ED.items.map(x => x.name),
    skillNames: ED.skills.map(x => x.name),
    scriptNames: Object.keys(ED.content.scripts || {}),
    models: Object.keys(A.chars || {}),
    images: ED.images,
    onChange: () => mark(),
  });
}

// ---------- 脚本 ----------
function tabScripts() {
  const scripts = ED.content.scripts;
  const names = Object.keys(scripts);
  let cur = names[0];
  const sel = h("select", { onchange: () => { cur = sel.value; ta.value = scripts[cur] || ""; } });
  for (const n of names) sel.append(h("option", { value: n }, n));
  const ta = h("textarea", { style: "width:100%;height:calc(100% - 70px);min-height:360px;white-space:pre;font-family:Consolas,monospace" });
  ta.value = scripts[cur] || "";
  ta.oninput = () => { scripts[cur] = ta.value; mark(); };
  mainEl.append(h("h3", null, "剧情 / 交互脚本（GSP）"), h("div", { class: "ed-row" }, h("label", null, "脚本文件"), sel), ta,
    h("div", { class: "ed-hint" }, "语法与原版一致：Say / Ask / if / else / endif / ChangeMap / AddNPC …"));
}

// ---------- 通用：列表编辑 ----------
function listTab(title, arr, schema, columns, makeNew) {
  mainEl.append(h("h3", null, title));
  const host = h("div");
  mainEl.append(host);
  renderListEditor(host, {
    list: arr, schema, columns, makeNew, onChange: () => mark(),
    onStructural: () => mark(), sel: 0,
  });
}

const NPC_SCHEMA_FIELDS = [
  { k: "id", label: "编号", type: "number" }, { k: "name", label: "名称", type: "text" },
  { k: "model", label: "行走图(pmg)", type: "text" }, { k: "portrait", label: "头像", type: "text" },
  { k: "script", label: "对话脚本(gsp)", type: "text" }, { k: "hp", label: "生命", type: "number" },
  { k: "attack", label: "攻击", type: "number" }, { k: "defence", label: "防御", type: "number" },
  { k: "level", label: "等级", type: "number" }, { k: "exp", label: "经验", type: "number" },
  { k: "speed", label: "移动速度", type: "number", def: 45 }, { k: "runSpeed", label: "追击速度", type: "number", def: 70 },
  { k: "hostile", label: "主动敌对", type: "checkbox" }, { k: "ai", label: "AI", type: "number" },
  { k: "skills", label: "技能", type: "strlist" },
  { k: "drops", label: "掉落物品", type: "drops" },
  { k: "talks", label: "闲话(每行一句)", type: "lines", rows: 4 },
];
function npcSchema() {
  return NPC_SCHEMA_FIELDS.map(f => {
    const o = /** @type {any} */ ({ ...f });
    if (f.k === "model") o.list = Object.keys(A.chars || {});
    if (f.k === "script") o.list = Object.keys(ED.content.scripts || {});
    if (f.k === "drops") o.items = ED.items.map(x => x.name);
    if (f.k === "skills") { o.options = ED.skills.map(x => x.name); o.addLabel = "＋ 添加技能"; }
    return o;
  });
}
const ITEM_SCHEMA = [
  { k: "name", label: "名称", type: "text" },
  { k: "type", label: "类型", type: "select", numeric: true, options: [[0, "消耗品"], [1, "武器"], [2, "防具"], [3, "饰品"], [4, "技能书"], [7, "包裹"], [8, "剧情物品"]] },
  { k: "subtype", label: "子类", type: "number" }, { k: "price", label: "价格", type: "number" },
  { k: "reqLevel", label: "需求等级", type: "number" }, { k: "hp", label: "生命+", type: "number" },
  { k: "mp", label: "精力+", type: "number" }, { k: "attack", label: "攻击+", type: "number" },
  { k: "defence", label: "防御+", type: "number" }, { k: "attrA", label: "命中+", type: "number" },
  { k: "attrB", label: "属性B", type: "number" }, { k: "attrC", label: "属性C", type: "number" },
  { k: "icon", label: "图标", type: "text" }, { k: "desc", label: "说明", type: "textarea", rows: 2 },
];
const SKILL_SCHEMA = [
  { k: "name", label: "名称", type: "text" },
  { k: "type", label: "类型", type: "select", numeric: true, options: [[0, "治疗(自身)"], [1, "攻击"]] },
  { k: "range", label: "射程", type: "number" }, { k: "mp", label: "耗精力", type: "number" },
  { k: "power", label: "威力", type: "number" }, { k: "reqLevel", label: "需求等级", type: "number" },
  { k: "sound", label: "音效", type: "text" }, { k: "icon", label: "图标", type: "text" },
  { k: "frames", label: "特效帧(每行一个)", type: "lines", rows: 5 }, { k: "desc", label: "说明", type: "textarea", rows: 2 },
];

function tabNpcs() {
  listTab("NPC / 怪物（" + ED.npcs.length + "）", ED.npcs, npcSchema(),
    [{ k: "id", label: "编号" }, { k: "name", label: "名称" }, { k: "model", label: "行走图" }, { k: "level", label: "等级" }, { k: "hp", label: "生命" }],
    () => ({ id: 0, name: "新NPC", model: "npc001.pmg", portrait: "", script: "", hp: 100, attack: 10, defence: 0, level: 1, exp: 0, hostile: 0, ai: 0, skills: [], speed: 45, runSpeed: 70, drops: [], talks: [] }));
}
function tabItems() {
  listTab("物品（" + ED.items.length + "）", ED.items, ITEM_SCHEMA,
    [{ k: "name", label: "名称" }, { k: "type", label: "类型" }, { k: "price", label: "价格" }, { k: "attack", label: "攻击" }, { k: "defence", label: "防御" }],
    () => ({ name: "新物品", type: 0, subtype: 0, price: 0, reqLevel: 0, hp: 0, mp: 0, attack: 0, defence: 0, attrA: 0, attrB: 0, attrC: 0, icon: "", desc: "" }));
}
function tabSkills() {
  listTab("技能（" + ED.skills.length + "）", ED.skills, SKILL_SCHEMA,
    [{ k: "name", label: "名称" }, { k: "type", label: "类型" }, { k: "power", label: "威力" }, { k: "mp", label: "耗精力" }, { k: "range", label: "射程" }],
    () => ({ name: "新技能", desc: "", type: 1, range: 40, mp: 0, reqLevel: 1, power: 10, sound: "", icon: "", frames: [] }));
}

// ---------- 数值 ----------
function tabConfig() {
  const c = ED.content.config;
  const sec = (title, key, fields) => {
    mainEl.append(h("h3", null, title));
    const f = h("div", { class: "ed-grid" }); mainEl.append(f);
    renderForm(f, fields, c[key], mark);
  };
  mainEl.append(h("h3", null, "全局数值配置"));
  sec("主角初始数值", "player", [
    { k: "hpMax", label: "最大生命", type: "number" }, { k: "mpMax", label: "最大精力", type: "number" },
    { k: "expNext", label: "升级所需经验", type: "number" }, { k: "level", label: "起始等级", type: "number" },
    { k: "money", label: "起始银两", type: "number" }, { k: "attack", label: "起始攻击", type: "number" },
    { k: "defence", label: "起始防御", type: "number" }, { k: "hit", label: "起始命中", type: "number" },
    { k: "moral", label: "起始道德", type: "number" }, { k: "honor", label: "起始声望", type: "number" },
  ]);
  sec("升级常数", "levelUp", [
    { k: "expMul", label: "所需经验×", type: "number", step: 0.1 }, { k: "expAdd", label: "所需经验+", type: "number" },
    { k: "hpMax", label: "生命成长", type: "number" }, { k: "mpMax", label: "精力成长", type: "number" },
    { k: "attack", label: "攻击成长", type: "number" }, { k: "defence", label: "防御成长", type: "number" },
    { k: "hit", label: "命中成长", type: "number" }, { k: "maxLevel", label: "等级上限", type: "number" },
    { k: "healOnLevel", label: "升级回满", type: "checkbox" },
  ]);
  sec("战斗常数", "combat", [
    { k: "rangeMin", label: "最小攻击距离", type: "number" }, { k: "attackCD", label: "攻击冷却(秒)", type: "number", step: 0.1 },
    { k: "mpDrainRun", label: "奔跑耗精力/秒", type: "number", step: 0.1 }, { k: "npcAggro", label: "敌人视野", type: "number" },
    { k: "npcMelee", label: "敌人近战距离", type: "number" }, { k: "npcAttackCD", label: "敌人攻击冷却", type: "number", step: 0.1 },
    { k: "npcHitBase", label: "敌人命中基数", type: "number" }, { k: "npcHitPerLevel", label: "敌人命中/级", type: "number" },
  ]);
}

// ---------- 标题 / 结局 ----------
function tabGame() {
  const g = ED.content.game;
  if (!g.music) g.music = {};
  if (!g.result) g.result = [];
  if (!g.flash) g.flash = [];
  mainEl.append(h("h3", null, "标题 / 结局配置"));
  const f = h("div", { class: "ed-grid" }); mainEl.append(f);
  renderForm(f, [{ k: "start", label: "标题音乐", type: "text" }, { k: "end", label: "结局音乐", type: "text" }], g.music, mark);
  const f2 = h("div", { class: "ed-grid" }); mainEl.append(f2);
  renderForm(f2, [{ k: "endpic", label: "结局背景图", type: "text" }], g, mark);
  const f3 = h("div", { class: "ed-grid" }); mainEl.append(f3);
  renderForm(f3, [{ k: "flash", label: "片头闪屏(每行一张)", type: "lines", rows: 3 }], g, mark);
  listTab("结局评价称号（按声望区间）", g.result, [
    { k: "lower", label: "声望下限", type: "number" }, { k: "upper", label: "声望上限", type: "number" }, { k: "name", label: "称号", type: "text" },
  ], [{ k: "lower", label: "下限" }, { k: "upper", label: "上限" }, { k: "name", label: "称号" }],
    () => ({ lower: 0, upper: 1000, name: "新称号" }));
}

// ---------- 图片素材 ----------
function assetPaths() {
  const set = new Set();
  for (const it of ED.items) if (it.icon) set.add("assets/items_icons/" + it.icon.replace(/\.bmp$/, ".png"));
  for (const sk of ED.skills) if (sk.icon) set.add("assets/skill_icons/" + sk.icon.replace(/\.bmp$/, ".png"));
  for (const n of ED.npcs) if (n.portrait) set.add("assets/face/" + n.portrait.replace(/\.bmp$/, ".png"));
  for (const u of ["mainmenu", "content", "end", "start", "load", "about", "exit", "team", "kouhao", "userpanel", "dlgpanel", "packpanel"])
    set.add("assets/ui/" + u + ".png");
  for (const p in ED.images) set.add(p);
  return [...set].sort();
}

function tabAssets() {
  mainEl.append(h("h3", null, "图片素材替换"));
  mainEl.append(h("div", { class: "ed-hint" }, "上传的图片会保存进当前版本（data URL），游戏中自动生效。尺寸建议与原图一致。"));
  const pathIn = h("input", { type: "text", placeholder: "assets/items_icons/金创药.png", style: "width:280px" });
  const fileIn = h("input", { type: "file", accept: "image/*" });
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; if (!f) return;
    const p = pathIn.value.trim(); if (!p) { alert("请填写目标资源路径"); return; }
    ED.images[p] = await readImageFile(f); setAssetOverrides(ED.images); mark(); selectTab("assets");
  };
  mainEl.append(h("div", { class: "ed-tools" }, h("span", null, "新路径："), pathIn, h("span", null, "选择图片："), fileIn));

  const grid = h("div", { style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px" });
  for (const p of assetPaths()) {
    const previewSrc = ED.images[p] || p;
    const img = h("img", { src: previewSrc, style: "width:40px;height:40px;object-fit:contain;background:#0a0b0d;border:1px solid #2c3038;image-rendering:pixelated" });
    const file = h("input", { type: "file", accept: "image/*", style: "display:none" });
    file.onchange = async () => { const f = file.files[0]; if (!f) return; ED.images[p] = await readImageFile(f); setAssetOverrides(ED.images); mark(); selectTab("assets"); };
    grid.append(h("div", { class: "ed-row", style: "margin:0" }, img,
      h("span", { style: "flex:1;font-size:11px;word-break:break-all" }, p),
      h("button", { class: "ed-btn", onclick: () => file.click() }, "上传"),
      ED.images[p] ? h("button", { class: "ed-btn danger", onclick: () => { delete ED.images[p]; setAssetOverrides(ED.images); mark(); selectTab("assets"); } }, "还原") : null));
    grid.append(file);
  }
  mainEl.append(grid);
}
