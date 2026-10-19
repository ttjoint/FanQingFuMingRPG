// 内容编辑器：以 ContentDB（内容定义）+ 图层化 MapDoc（地图）为规范模型，
// 保存为“补丁式内容包”（只存与默认版本不同的条目）。编辑器内部仍保留旧版
// 数组/地图视图以复用面板，但读写统一经由 Project 适配层。
import { G, A } from "../core/state.js";
import { setAssetOverrides, assetURL } from "../core/assets.js";
import { h, clear, deep } from "./dom.js";
import { injectStyle } from "./style.js";
import { renderForm, renderListEditor, mkSplitResizer, editorShell, imgPlaceholder } from "./fields.js";
import { mountMapEditor } from "./map-editor.js";
import { modeControl, makeLineEditor, decorState } from "./decor-line.js";
import { applyPatch, diffContent } from "../content/contentdb.js";
import { attachLegacyViews } from "../content/mapDoc.js";
import { buildMapData } from "../world/map.js";
import { createRegistry } from "../content/registry.js";
import { validateContent, decorSpriteKey } from "../content/schema.js";
import { getRuntime } from "../runtime/context.js";
import {
  loadPack, savePack, activeId, DEFAULT_VERSION, createPack, createDiskPack, setActive,
  exportPack, pickJSON, importPack, readImageFile, refreshDiskVersions, isDiskVersion,
} from "../content/store.js";
import { PACK_FORMAT, PACK_VERSION } from "../content/schema.js";
import { newNpcTemplate } from "../content/npcFields.js";
import { buildAssetIndexAsync, searchAssets, groupOf, fileName, assetIndex, musicFiles } from "./assets-index.js";
import { decorThumb, decorPreview } from "./atlas-preview.js";
import { setImagesWriter } from "./asset-picker.js";
import { pmgGrid } from "./pmg-view.js";
import { mountUiTab } from "./ui-tab.js";
import { normalizeUi } from "../content/ui.js";
import { tabAudio } from "./audio-tab.js";
import { initEditorCtx, edCtx, edProject, edMain, edMark, assetSrc, roleSrc, assetSrc2, rfield, rnum, rhint } from "./ed-ctx.js";

import {
  DMG_TYPE_OPTIONS, AI_COND_HINT, AI_ACT_HINT, AI_TEMPLATES,
  NPC_SCHEMA_FIELDS, ITEM_SCHEMA, SKILL_SCHEMA, BUFF_SCHEMA,
  EFFECT_SCHEMA, AFFIX_SCHEMA, WAYPOINT_SCHEMA, UNIQUE_SCHEMA,
} from "./schemas.js";

let root = null, ED = null, dirty = false, curTab = "maps";
let mainEl, sideEl, statusEl, mapEditor = null, sideRszEl = null;

const mark = () => { dirty = true; };

// 资源选择弹窗里"上传本地图"时，把图写进当前的 images 覆盖表。
// （用注入而非直接 import ED，避免弹窗模块反向依赖编辑器状态）
setImagesWriter((key, dataUrl) => {
  if (!ED) return;
  ED.images[key] = dataUrl;
  setAssetOverrides(ED.images);
  mark();
});


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
  p.buffs = content.buffs || [];   // Buff 配置表（整表，随内容版本固定但可覆盖）
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
  c.buffs = p.buffs || [];   // Buff 配置表：整表引用（非 record）
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
  const diskReady = await refreshDiskVersions();
  let pack = await loadPack(activeId());
  // 本地模式（磁盘后端可用）：不识别浏览器版本——若当前指向的不是磁盘版本，则当作默认版本处理。
  const isUsablePack = pack && pack.id !== DEFAULT_VERSION && !(pack.patch && pack.patch.legacyDomains)
    && (!diskReady || isDiskVersion(pack.id));
  if (!isUsablePack) {
    const name = prompt("默认版本为只读原版数据。\n请输入新版本名称，编辑内容将保存到该版本：", "我的版本");
    if (!name) return;
    // 本地开发后端可用时直接建磁盘版本（写入 versions/<id>/），否则浏览器版本。
    pack = diskReady ? await createDiskPack(name, {}, "default") : await createPack(name);
    setActive(pack.id);
  }
  ED = createProject(base, pack);
  dirty = false;
  // 把会话状态交给共享上下文：拆分出去的页面模块通过 edCtx() 读它。
  // getter 保持与本地变量同步（ED/root/... 在编辑器运行期间会被重新赋值）。
  initEditorCtx({
    get ED() { return ED; },
    get root() { return root; },
    get dirty() { return dirty; },
    get curTab() { return curTab; },
    get mainEl() { return mainEl; },
    get sideEl() { return sideEl; },
    get statusEl() { return statusEl; },
    get mapEditor() { return mapEditor; },
    mark: () => { dirty = true; },
  });
  injectStyle();
  G.scene = "editor";
  root = h("div", { id: "editorRoot" });
  document.body.appendChild(root);
  buildShell();
  selectTab("maps");
  // 预热资源索引：音频字段（技能音效、地图/标题音乐）在渲染表单时要同步拿到
  // assets/music、assets/sound 清单，而索引本身是异步建立的（要拉 versions/index.json）。
  // 这里在打开编辑器时先起一次，避免第一次进技能页时下拉是空的。
  buildAssetIndexAsync({
    versions: null, currentId: ED.id, images: ED.images,
    items: ED.items, skills: ED.skills, npcs: ED.npcs, buffs: ED.buffs || [],
    charsMap: A.chars || {}, maps: Object.values(ED.maps || {}),
  }).catch(() => {});
}

export async function closeEditor(force) {
  if (!root) return;
  if (!force && dirty) {
    if (confirm("有未保存的修改，是否保存到版本「" + ED.name + "」？")) { if (!(await doSave())) return; }
  }
  if (mapEditor) { mapEditor.destroy(); mapEditor = null; }
  root.remove(); root = null; G.scene = "title";
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
  // 分级提示：error 是确定会出 bug 的，warning 是可疑但可能故意的。
  // 原先两者混在一起，一条「已保存（72 处提示）」看不到重点。
  const errs = issues.length;
  toast(errs ? ("已保存（" + errs + " 处错误/提示，详见控制台）") : "已保存到版本「" + ED.name + "」");
  if (issues.length) console.warn("内容校验提示（" + issues.length + " 条）：\n" + issues.join("\n"));
  return true;
}

function toast(msg) {
  if (!statusEl) return;
  clear(statusEl); statusEl.append(h("span", null, msg)); statusEl.classList.add("show");
  clearTimeout(/** @type {any} */ (toast)._t); /** @type {any} */ (toast)._t = setTimeout(() => statusEl.classList.remove("show"), 2200);
}

// ---------- 外壳 ----------
const TABS = [["maps", "地图"], ["decor", "装饰物"], ["scripts", "脚本"], ["npcs", "NPC"], ["ais", "AI"], ["buffs", "Buff"], ["items", "物品"], ["skills", "技能"], ["effects", "特效"], ["affixes", "词缀"], ["config", "升级数值"], ["game", "标题结局"], ["pmg", "行走图"], ["assets", "图片素材"], ["audio", "音频"], ["ui", "界面"], ["waypoints", "传送点"], ["uniques", "暗金"], ["sets", "套装"]];
let navEl;

// 标签页图标（纯文本，无需图标字体）。
const TAB_ICONS = {
  maps: "🗺", decor: "🌳", scripts: "📜", npcs: "👤", ais: "🧠", buffs: "✨",
  items: "⚔", skills: "⚡", effects: "💥", affixes: "🔧", config: "📈",
  game: "🎬", pmg: "🚶", assets: "🖼", audio: "🎵", ui: "🖥", waypoints: "🧭", uniques: "🏆", sets: "🎽",
};

// 窄屏(<900px)判定：导航/属性栏变抽屉。用 matchMedia 便于监听变化。
const MOBILE_MQ = "(max-width: 900px)";
const isNarrow = () => window.matchMedia(MOBILE_MQ).matches;

function buildShell() {
  clear(root);
  const nameIn = h("input", { type: "text", value: ED.name, style: "width:150px", title: "版本名称" });
  nameIn.oninput = () => { ED.name = nameIn.value; mark(); };

  // 窄屏抽屉开关
  const navToggle = h("button", {
    class: "ed-btn ghost ed-btnicon ed-drawerbtn", title: "切换导航",
    onclick: () => toggleDrawer(navEl),
  }, "☰");
  const sideToggle = h("button", {
    class: "ed-btn ghost ed-btnicon ed-drawerbtn", title: "切换属性栏",
    onclick: () => toggleDrawer(sideEl),
  }, "⧉");

  const bar = h("div", { class: "ed-bar" },
    navToggle,
    h("span", { class: "ed-title" }, "内容编辑器"),
    h("span", { class: "ed-verlab" }, "版本"), nameIn,
    h("span", { class: "ed-sep" }),
    h("div", { class: "ed-grp" },
      h("button", { class: "ed-btn primary", title: "保存 (Ctrl+S)", onclick: () => doSave() }, "保存"),
      h("button", { class: "ed-btn", title: "导出内容包", onclick: () => exportPack(exportObj()) }, "导出"),
      h("button", { class: "ed-btn", title: "导入内容包", onclick: () => pickJSON(async o => { try { const p = await importPack(o); ED = createProject(A.defaults, p); setActive(p.id); dirty = true; buildShell(); selectTab(curTab); toast("已导入为版本「" + p.name + "」"); } catch (e) { alert(String(e.message || e)); } }) }, "导入")),
    h("span", { class: "ed-spacer" }),
    h("button", { class: "ed-btn", title: "关闭编辑器，返回游戏菜单 (Esc)", onclick: () => closeEditor() }, "关闭并返回"),
    sideToggle);

  navEl = h("div", { class: "ed-nav" });
  mainEl = h("div", { class: "ed-main" });
  sideEl = h("div", { class: "ed-side" });
  statusEl = h("div", { class: "ed-toast" });
  const scrim = h("div", { class: "ed-scrim", onclick: () => closeDrawers() });

  // 可拖拽分栏（桌面端）：左导航 / 右属性栏都能调宽，宽度记在 localStorage。
  const rszNav = mkResizer("nav", navEl, "--ed-nav-w", 120, 320);
  const rszSide = mkResizer("side", sideEl, "--ed-side-w", 240, 640);
  sideRszEl = rszSide;

  root.append(bar,
    h("div", { class: "ed-body" }, navEl, rszNav, mainEl, rszSide, sideEl, scrim),
    statusEl);
  restoreWidths();
  renderNav();
  bindHotkeys();
}

// ---- 分栏拖拽 ----
function restoreWidths() {
  for (const [k, prop] of [["nav", "--ed-nav-w"], ["side", "--ed-side-w"]]) {
    const v = localStorage.getItem("ed.width." + k);
    if (v) root.style.setProperty(prop, v + "px");
  }
}

function mkResizer(key, target, prop, min, max) {
  const el = h("div", { class: "ed-resizer", title: "拖动调整宽度 / 双击恢复默认" });
  let startX = 0, startW = 0;
  const onMove = e => {
    const dx = e.clientX - startX;
    // 左侧导航向右拖 = 变宽；右侧属性栏向右拖 = 变窄。
    const w = key === "nav" ? startW + dx : startW - dx;
    target.style.width = Math.max(min, Math.min(max, w)) + "px";
  };
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    el.classList.remove("dragging");
    document.body.classList.remove("ed-resizing");
    localStorage.setItem("ed.width." + key, String(parseInt(target.style.width, 10) || ""));
  };
  el.addEventListener("mousedown", e => {
    if (isNarrow()) return;
    e.preventDefault();
    startX = e.clientX; startW = target.getBoundingClientRect().width;
    el.classList.add("dragging");
    document.body.classList.add("ed-resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
  el.addEventListener("dblclick", () => {
    // 双击恢复 CSS 默认宽度
    target.style.width = "";
    root.style.removeProperty(prop);
    localStorage.removeItem("ed.width." + key);
  });
  return el;
}

// ---- 窄屏抽屉 ----
function toggleDrawer(el) {
  const on = !el.classList.contains("open");
  closeDrawers();
  if (on) { el.classList.add("open"); const sc = root.querySelector(".ed-scrim"); if (sc) sc.classList.add("on"); }
}
function closeDrawers() {
  for (const el of [navEl, sideEl]) if (el) el.classList.remove("open");
  const sc = root && root.querySelector(".ed-scrim"); if (sc) sc.classList.remove("on");
}

// ---- 键盘快捷键（桌面习惯） ----
let hotkeysBound = false;
function bindHotkeys() {
  if (hotkeysBound) return;
  hotkeysBound = true;
  document.addEventListener("keydown", e => {
    if (G.scene !== "editor" || !root) return;
    const el = /** @type {any} */ (e.target);
    const tag = (el && el.tagName) || "";
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || !!(el && el.isContentEditable);
    // Ctrl+S / Cmd+S：保存（输入框内也生效）
    if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault(); doSave(); return;
    }
    // Esc：优先关抽屉，其次关编辑器
    if (e.key === "Escape") {
      if (navEl && (navEl.classList.contains("open") || sideEl.classList.contains("open"))) {
        closeDrawers(); e.preventDefault(); return;
      }
      if (!typing) { e.preventDefault(); closeEditor(); }
      return;
    }
    if (typing) return;
    // Ctrl+1..9 / Ctrl+0：切换标签页
    if ((e.ctrlKey || e.metaKey) && /^[0-9]$/.test(e.key)) {
      const idx = e.key === "0" ? 9 : (parseInt(e.key, 10) - 1);
      const t = TABS[idx];
      if (t) { e.preventDefault(); selectTab(t[0]); }
    }
  });
}

function renderNav() {
  clear(navEl);
  TABS.forEach(([k, label], i) => {
    const b = h("button", {
      class: curTab === k ? "on" : "",
      title: label + (i < 9 ? "  (Ctrl+" + (i + 1) + ")" : "  (Ctrl+0)"),
      onclick: () => { selectTab(k); if (isNarrow()) closeDrawers(); },
    }, h("span", { class: "navico" }, TAB_ICONS[k] || "•"), h("span", { class: "navlab" }, label));
    navEl.append(b);
  });
}

function selectTab(k) {
  if (mapEditor) { mapEditor.destroy(); mapEditor = null; }
  if (uiTabCleanup) { uiTabCleanup(); uiTabCleanup = null; }
  curTab = k; renderNav();
  clear(mainEl); clear(sideEl);
  mainEl.className = "ed-main";
  // 属性栏只在地图页有意义（装饰物页已改为页内 split 布局，不再用全局属性栏，
  // 否则右侧会同时出现"全局属性栏拖拽条"和"页内 split 拖拽条"两条，视觉重复）。
  const needSide = k === "maps";
  sideEl.style.display = needSide ? "" : "none";
  // 用显式引用而非 querySelectorAll 下标（页内 split 也会产生 .ed-resizer，
  // 按下标取会错位）。
  if (sideRszEl) sideRszEl.style.display = (needSide && !isNarrow()) ? "" : "none";
  ({ maps: tabMaps, decor: tabDecor, scripts: tabScripts, npcs: tabNpcs, ais: tabAis, buffs: tabBuffs, items: tabItems, skills: tabSkills, effects: tabEffects, affixes: tabAffixes, config: tabConfig, game: tabGame, pmg: tabPmg, assets: tabAssets, audio: tabAudio, ui: tabUi, waypoints: tabWaypoints })[k]();
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
    factionOptions: [(ED.content.factions || []).find(f => f.id === "") || { id: "", name: "（默认/继承）" }]
      .concat((ED.content.factions || []).map(f => ({ v: f.id, label: f.id + (f.name && f.name !== f.id ? " " + f.name : "") }))),
    skillNames: ED.skills.map(x => x.name),
    aiOptions: [["", "（默认：有攻击力则追击，否则原地游荡）"]]
      .concat((ED.content.ais || []).map(a => ({ v: a.id, label: a.id + (a.name && a.name !== a.id ? " " + a.name : "") }))),
    scriptNames: Object.keys(ED.content.scripts || {}),
    models: Object.keys(A.chars || {}),
    images: ED.images,
    decorTemplates: ED.content.decorTemplates,
    onChange: () => mark(),
  });
  // 调试/E2E 钩子：暴露地图编辑器的测试面（仅用于自动化验证撤销栈，
  // 生产路径不读它）。挂到编辑器根节点上，不污染全局变量。
  if (root) root.__mapEditor = mapEditor;
}

// ---------- 装饰物模板（跨地图共享，按贴图源矩形）----------

let decorSelKey = null;

// 同一贴图源矩形 = 同一模板（跨地图共用）。遍历 ED.maps 本体，不依赖 mapsManifest（更健壮）。
function collectTemplates() {
  const map = new Map();
  for (const name of Object.keys(ED.maps || {})) {
    const m = ED.maps[name]; if (!m || !m.objects) continue;
    for (const o of m.objects) {
      if (!o || !Array.isArray(o.sprite)) continue;
      const k = decorSpriteKey(o.sprite);
      let e = map.get(k);
      if (!e) { e = { key: k, sprite: o.sprite, tiles: o.tiles, count: 0, maps: new Set() }; map.set(k, e); }
      e.count++; e.maps.add(name);
      if ((!e.tiles || !e.tiles.length) && o.tiles && o.tiles.length) e.tiles = o.tiles;
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || (a.sprite[2] * a.sprite[3]) - (b.sprite[2] * b.sprite[3]));
}
function tplOf(key, create) { const t = ED.content.decorTemplates || (ED.content.decorTemplates = {}); let v = t[key]; if (!v && create) v = t[key] = {}; return v || {}; }

function tabDecor() {
  const all = collectTemplates();
  mainEl.append(h("h3", null, "装饰物模板（共 " + all.length + "，跨地图同一贴图共用）"));
  mainEl.append(rhint("同一张贴图在不同地图里是同一个模板：地基线 / 深度模式只编辑一次，所有实例共享。手画：拖黄线控制点、空白处单击加点、右键删点；黄线可越出贴图（拖到下方即让青线覆盖整幅 → 完全遮蔽）。"));
  if (!all.length) { mainEl.append(rhint("（未找到装饰物：请确认地图数据已加载）")); return; }

  if (!decorSelKey || !all.some(x => x.key === decorSelKey)) decorSelKey = all[0].key;
  const modeLabel = t => { const st = decorState(t); return st === "single" ? "单一" : (st === "line" ? "手画" : "自动"); };

  // 与其它分页一致：左列表（可搜索/可拖宽/行首缩略图）+ 右详情。
  const split = h("div", { class: "ed-split" });
  const left = h("div", { class: "ed-split-list" });
  const right = h("div", { class: "ed-split-form" });
  split.append(left, mkSplitResizer("decor", left), right);
  mainEl.append(split);

  const searchIn = h("input", { type: "text", placeholder: "搜索贴图 / 地图…", style: "min-width:160px" });
  const cntEl = h("span", { class: "ed-count" });
  left.append(h("div", { class: "ed-tools", style: "padding:6px" }, h("div", { class: "ed-search" }, searchIn), cntEl));

  const tbl = h("table", { class: "ed-table" });
  const head = h("tr");
  head.append(h("th", { class: "ed-thumb" }));
  for (const l of ["出现", "地图", "模式"]) head.append(h("th", null, l));
  tbl.append(h("thead", null, head));
  const body = h("tbody");
  tbl.append(body);
  left.append(h("div", { class: "ed-tablescroll" }, tbl));

  let query = "";
  const match = x => {
    if (!query) return true;
    const q = query.toLowerCase();
    return x.key.toLowerCase().includes(q) || [...x.maps].join(" ").toLowerCase().includes(q);
  };
  searchIn.oninput = () => { query = searchIn.value; drawTable(); };

  const fillRow = (tr, x) => {
    clear(tr);
    tr.dataset.k = x.key;
    const td = h("td", { class: "ed-thumb" });
    // 装饰物不是独立图片文件，而是共用图集 assets/obj.png 的一块，
    // sprite = [sx, sy, sw, sh, dxa, dya]。这里从图集实时切出缩略图。
    td.append(decorThumb(x, { max: 34 }));
    tr.append(td,
      h("td", null, String(x.count)),
      h("td", null, [...x.maps].join("、")),
      h("td", null, modeLabel(tplOf(x.key, false))));
  };

  const drawTable = () => {
    clear(body);
    let n = 0;
    for (const x of all) {
      if (!match(x)) continue;
      n++;
      const tr = h("tr", { class: decorSelKey === x.key ? "on" : "", onclick: () => { decorSelKey = x.key; select(); } });
      fillRow(tr, x);
      body.append(tr);
    }
    if (!n) body.append(h("tr", null, h("td", { colspan: 4 }, h("div", { class: "ed-empty" }, "没有匹配的项"))));
    cntEl.textContent = "共 " + all.length + (query ? " / 显示 " + n : "") + " 项";
  };

  const renderSide = () => {
    clear(right);
    const cur = all.find(x => x.key === decorSelKey);
    if (!cur) { right.append(h("div", { class: "ed-empty" }, "左侧选择一个模板")); return; }
    const s = cur.sprite, tiles = cur.tiles, tpl = tplOf(cur.key, true);
    // 贴图大图预览
    const big = decorPreview(cur, 280, 200);
    big.title = cur.key;
    right.append(h("div", { class: "ed-row", style: "align-items:flex-start;gap:12px" },
      big,
      h("div", null,
        h("h3", { style: "margin:0 0 4px" }, "模板 " + s[2] + "×" + s[3]),
        rhint("出现 " + cur.count + " 处：" + [...cur.maps].join("、")),
        rhint(cur.key))));
    right.append(rfield("深度模式", modeControl(s, tiles, tpl, 64, () => { mark(); renderSide(); drawTable(); })));
    if (decorState(tpl) === "line") right.append(h("div", { class: "ed-row" }, h("button", { class: "ed-btn", onclick: () => { delete tpl.line; mark(); renderSide(); drawTable(); } }, "恢复自动地基线")));
    right.append(h("h3", null, "地基线 / 头顶线"));
    right.append(makeLineEditor(s, tiles, tpl, 64, Math.max(240, right.clientWidth - 40), () => { mark(); drawTable(); }));
    right.append(rhint("黄=地基线（可越出贴图）；青=头顶最高线（其上→覆盖层，永远遮挡玩家）"));
  };

  const select = () => {
    for (const tr of body.children) tr.classList.toggle("on", tr.dataset.k === decorSelKey);
    renderSide();
  };

  drawTable();
  renderSide();
}

// ---------- 脚本 ----------
function tabScripts() {
  const scripts = ED.content.scripts;
  const names = Object.keys(scripts);
  mainEl.append(h("h3", null, "剧情 / 交互脚本（GSP）"));
  mainEl.append(rhint("语法与原版一致：Say / Ask / if / else / endif / ChangeMap / AddNPC …"));

  const split = h("div", { class: "ed-split" });
  const left = h("div", { class: "ed-split-list" });
  const right = h("div", { class: "ed-split-form fill" });
  split.append(left, mkSplitResizer("scripts", left), right);
  mainEl.append(split);

  const searchIn = h("input", { type: "text", placeholder: "搜索脚本名…" });
  const cntEl = h("span", { class: "ed-count" });
  left.append(h("div", { class: "ed-tools", style: "padding:6px" }, h("div", { class: "ed-search" }, searchIn), cntEl));

  const tbl = h("table", { class: "ed-table" });
  tbl.append(h("thead", null, h("tr", null, h("th", null, "脚本"), h("th", null, "行数"))));
  const body = h("tbody");
  tbl.append(body);
  left.append(h("div", { class: "ed-tablescroll" }, tbl));

  // 右侧：整块文本编辑器（文本类内容不需要表单）
  const ta = h("textarea", { style: "width:100%;height:calc(100% - 34px);min-height:300px;white-space:pre;font-family:Consolas,monospace;font-size:12px" });
  const info = h("div", { class: "ed-hint", style: "margin:4px 0 0" });

  let cur = names[0] || null;
  let query = "";

  const lineCount = txt => String(txt || "").split("\n").length;

  const drawTable = () => {
    clear(body);
    const q = query.toLowerCase();
    let n = 0;
    for (const nm of names) {
      if (q && !nm.toLowerCase().includes(q)) continue;
      n++;
      const tr = h("tr", { class: nm === cur ? "on" : "", onclick: () => { cur = nm; drawTable(); drawEditor(); } });
      tr.append(h("td", null, nm), h("td", { style: "color:#7f8792" }, String(lineCount(scripts[nm]))));
      body.append(tr);
    }
    if (!n) body.append(h("tr", null, h("td", { colspan: 2 }, h("div", { class: "ed-empty" }, "没有匹配的脚本"))));
    cntEl.textContent = "共 " + names.length + (query ? " / 显示 " + n : "") + " 个";
  };
  searchIn.oninput = () => { query = searchIn.value; drawTable(); };

  const drawEditor = () => {
    clear(right);
    if (!cur) { right.append(h("div", { class: "ed-empty" }, "左侧选择一个脚本")); return; }
    right.append(h("div", { class: "ed-row", style: "margin:0 0 6px" }, h("strong", null, cur),
      h("span", { class: "ed-count" }, String(lineCount(scripts[cur])) + " 行")));
    ta.value = scripts[cur] || "";
    right.append(editorShell(ta, { key: "ed.fs.scripts" }));
    right.append(info);
  };
  ta.oninput = () => { if (!cur) return; scripts[cur] = ta.value; mark(); drawTable(); };
  info.textContent = "编辑后左侧行数即时更新；Ctrl+S 保存整个版本。";

  drawTable();
  drawEditor();
}

// AI 配置：一条配置 = 一个行为档案（idle + targeting + 顺序匹配的 rules）。
// 结构复杂且需可扩展，因此用 JSON 文本编辑器直接编辑，并提供常用模板一键插入。
function tabAis() {
  const list = ED.content.ais || (ED.content.ais = []);
  mainEl.append(h("h3", null, "AI 配置（共 " + list.length + "）"));
  mainEl.append(rhint("单位通过 NPC 的「AI 配置」字段按 id 引用；这里定义可复用的行为档案。"));
  mainEl.append(rhint(AI_COND_HINT));
  mainEl.append(rhint(AI_ACT_HINT));

  const split = h("div", { class: "ed-split" });
  const left = h("div", { class: "ed-split-list" });
  const right = h("div", { class: "ed-split-form fill" });
  split.append(left, mkSplitResizer("ais", left), right);
  mainEl.append(split);

  let sel = 0;
  let query = "";

  const searchIn = h("input", { type: "text", placeholder: "搜索 id / 名称…" });
  const cntEl = h("span", { class: "ed-count" });
  left.append(h("div", { class: "ed-tools", style: "padding:6px" },
    h("button", { class: "ed-btn", onclick: () => { const id = prompt("AI 配置 id", "ai_" + (list.length + 1)); if (!id) return; list.push({ id, name: id, idle: { action: "idle" }, rules: [] }); sel = list.length - 1; mark(); redraw(); } }, "+ 新建"),
    h("div", { class: "ed-search" }, searchIn), cntEl));

  const tbl = h("table", { class: "ed-table" });
  tbl.append(h("thead", null, h("tr", null, h("th", null, "id"), h("th", null, "名称"), h("th", null, "规则"))));
  const bodyEl = h("tbody");
  tbl.append(bodyEl);
  left.append(h("div", { class: "ed-tablescroll" }, tbl));

  const match = x => {
    if (!query) return true;
    const q = query.toLowerCase();
    return String(x.id || "").toLowerCase().includes(q) || String(x.name || "").toLowerCase().includes(q);
  };

  const drawTable = () => {
    clear(bodyEl);
    let n = 0;
    list.forEach((x, i) => {
      if (!match(x)) return;
      n++;
      const tr = h("tr", { class: i === sel ? "on" : "", onclick: () => { sel = i; drawTable(); drawDetail(); } });
      tr.append(h("td", null, String(x.id || "")), h("td", null, String(x.name || "")), h("td", { style: "color:#7f8792" }, String((x.rules || []).length)));
      bodyEl.append(tr);
    });
    if (!n) bodyEl.append(h("tr", null, h("td", { colspan: 3 }, h("div", { class: "ed-empty" }, "没有匹配的项"))));
    cntEl.textContent = "共 " + list.length + (query ? " / 显示 " + n : "") + " 项";
  };
  searchIn.oninput = () => { query = searchIn.value; drawTable(); };

  const drawDetail = () => {
    clear(right);
    const a0 = list[sel];
    if (!a0) { right.append(h("div", { class: "ed-empty" }, "左侧选择一个 AI 配置")); return; }
    right.append(h("div", { class: "ed-tools" },
      h("button", { class: "ed-btn", onclick: () => { list.splice(sel + 1, 0, deep(a0)); sel++; mark(); drawTable(); drawDetail(); } }, "复制"),
      h("button", { class: "ed-btn danger", onclick: () => { list.splice(sel, 1); sel = Math.max(0, sel - 1); mark(); drawTable(); drawDetail(); } }, "删除"),
      h("button", { class: "ed-btn", onclick: () => { const t = prompt("模板：" + Object.keys(AI_TEMPLATES).join(" / ")); if (!t || !AI_TEMPLATES[t]) return; Object.assign(a0, deep(AI_TEMPLATES[t])); mark(); drawTable(); drawDetail(); } }, "套用模板")));

    const idIn = h("input", { type: "text", value: a0.id || "" });
    idIn.oninput = () => { a0.id = idIn.value; mark(); drawTable(); };
    const nameIn = h("input", { type: "text", value: a0.name || "" });
    nameIn.oninput = () => { a0.name = nameIn.value; mark(); drawTable(); };
    right.append(h("div", { class: "ed-row" }, h("label", null, "id"), idIn, h("label", null, "名称"), nameIn));

    right.append(h("h3", null, "行为档案（idle / targeting / rules）"));
    const ta = h("textarea", { style: "width:100%;height:calc(100% - 190px);min-height:260px;white-space:pre;font-family:Consolas,monospace;font-size:12px" });
    const clone = /** @type {any} */ ({ ...a0 }); delete clone.id; delete clone.name;
    ta.value = JSON.stringify(clone, null, 2);
    const err = h("div", { class: "ed-hint" });
    ta.oninput = () => {
      try {
        const o = JSON.parse(ta.value);
        err.textContent = "";
        delete a0.idle; delete a0.targeting; delete a0.rules;
        Object.assign(a0, o);
        mark(); drawTable();
      } catch (e) { err.textContent = "JSON 语法错误：" + e.message; err.style.color = "#e66"; }
    };
    right.append(editorShell(ta, { key: "ed.fs.ais" }), err);
  };

  const redraw = () => { drawTable(); drawDetail(); };
  redraw();
}

// ---------- 通用：列表编辑 ----------
// 特效字段的候选：内容特效表（effects.json）的 id，首项为“（无）”。
function fxOptions() {
  return [["", "（无）"]].concat((ED.content.effects || []).map(e => [e.id, e.id + (e.name && e.name !== e.id ? " " + e.name : "")]));
}
// 把 schema 中 fx:true 的字段换成真实 options（需在编辑时延迟构建）。
function withFx(schema) {
  // fx.* 字段：候选项来自内容特效表（effects.json）。用键名前缀识别，避免额外标记字段。
  return schema.map(f => (f.k && f.k.indexOf("fx.") === 0 ? { ...f, options: fxOptions() } : f));
}

// 列表页统一入口：左侧列表（可搜索、每行可带缩略图、可拖拽改宽）+ 右侧详情。
// opts: { key 宽度记忆用的键名, thumb(it)=>url 行首缩略图, icon 从 it.icon 自动推缩略图的目录 }
function listTab(title, arr, schema, columns, makeNew, opts) {
  const o = opts || {};
  mainEl.append(h("h3", null, title));
  const host = h("div");
  mainEl.append(host);
  // 缩略图：优先用调用方给的 thumb()；否则若指定了 icon 目录，就按 it.icon 推导。
  const thumb = o.thumb || (o.icon
    ? (it => (it && it.icon ? assetSrc2(it.icon, o.icon) : null))
    : null);
  renderListEditor(host, {
    // o.sync：表单改的是"展示视图"，需要在每次改动后同步回真实数据
    // （暗金把 mods 摊平成字段、套装把加成拆成 2 件/3 件两档）。
    list: arr, schema, columns, makeNew, onChange: () => { o.sync && o.sync(); mark(); },
    onStructural: () => { o.sync && o.sync(); mark(); }, sel: 0,
    thumb, splitKey: o.key || "list",
  });
}


// NPC 字段按语义分组呈现：身份 → 数值 → 行为 → 内容 → 掉落/交易 → 台词。
// 带 group 的项是分隔项（无 k）；大段文本（lines/textarea）会自动独占整行。
function npcSchema() {
  return NPC_SCHEMA_FIELDS.map(f => {
    const o = /** @type {any} */ ({ ...f });
    if (f.k === "model") { o.models = Object.keys(A.chars || {}); o.modelSrc = m => roleSrc(m); }
    if (f.k === "script") { o.options = [["", "（无）"]].concat(Object.keys(ED.content.scripts || {}).map(x => [x, x])); }
    if (f.k === "ai") o.options = [["", "（默认）"]].concat((ED.content.ais || []).map(a => [a.id, a.id + (a.name && a.name !== a.id ? " " + a.name : "")]));
    if (f.k === "drops") o.items = ED.items.map(x => x.name);
    if (f.k === "inventory") o.items = ED.items.map(x => x.name);
    if (f.k === "skills") { o.options = ED.skills.map(x => x.name); o.addLabel = "＋ 添加技能"; }
    if (f.k === "synergy") o.skills = ED.skills.map(x => x.name);
    return o;
  });
}
function skillSchema() {
  const buffIds = (ED.buffs || []).map(b => b.id).filter(Boolean);
  return SKILL_SCHEMA.concat([
    { k: "cooldown", label: "技能冷却(秒)", type: "number", def: 0 },
    { k: "targeting.kind", label: "目标类型", type: "select", options: [["enemy", "敌对单位"], ["ally", "同阵营"], ["self", "自己"], ["point", "落点范围"]] },
    { k: "targeting.aoe", label: "范围伤害(AOE)", type: "checkbox" },
    { k: "targeting.radius", label: "AOE 半径(像素)", type: "number", def: 0 },
    { k: "targeting.maxTargets", label: "最多命中数(0=不限)", type: "number", def: 0 },
    { k: "targeting.includeSelf", label: "AOE 含自己", type: "checkbox" },
    { k: "onHit.heal.amount", label: "命中·治疗量", type: "number", def: 0 },
    { k: "onHit.heal.to", label: "命中·治疗对象", type: "select", options: [["self", "自己"], ["target", "目标"]] },
    { k: "onHit.knockback.dist", label: "命中·击退距离", type: "number", def: 0 },
    { k: "onHit.buffs", label: "命中效果", type: "buffeffects", options: buffIds },
    { k: "fx.hit", label: "特效·命中", type: "select" },
    { k: "fx.cast", label: "特效·施法", type: "select" },
  ]);
}

// Buff 配置表字段。
function tabEffects() {
  const list = ED.content.effects || (ED.content.effects = []);
  listTab("特效（" + list.length + "）", list, EFFECT_SCHEMA,
    [{ k: "id", label: "id" }, { k: "layer", label: "层级" }, { k: "anchor", label: "锚点" }, { k: "loop", label: "循环" }],
    () => ({ id: "fx_" + (list.length + 1), name: "新特效", layer: "over", anchor: "world", frames: [], fps: 12, loop: false, holdFirst: 0, holdLast: 0, life: 0, ox: 0, oy: 0, scale: 1, color: "", radius: 18 }),
    { key: "effects", thumb: e => (e.frames && e.frames[0]) ? assetSrc2(e.frames[0], "fx") : null });
}

let uiTabCleanup = null;
function tabUi() {
  mainEl.append(h("div", { class: "ed-hint" },
    "这里的元件就是运行时的状态栏、快捷栏、背包、商店等界面。改动只写入内容包，"
    + "多人游戏与默认版本不受影响。坐标是相对锚点的偏移，所以右下角元件用负值向左上。"));
  // 直接在 ED.content.ui 上改（与其它域一样走 diffContent 生成补丁）
  if (!ED.content.ui) ED.content.ui = normalizeUi(null);
  const host = h("div", { style: "flex:1 1 auto;min-height:0;display:flex" });
  mainEl.append(host);
  uiTabCleanup = mountUiTab(host, ED.content.ui, { onChange: () => mark() });
}

function tabAffixes() {
  const list = ED.content.affixes || (ED.content.affixes = []);
  listTab("词缀（" + list.length + "）", list, AFFIX_SCHEMA,
    [{ k: "name", label: "名称" }, { k: "rarity", label: "稀有度" }, { k: "weight", label: "权重" }, { k: "mods.atk", label: "攻击" }, { k: "mods.def", label: "防御" }],
    () => ({ id: "af_" + (list.length + 1), name: "新词缀", prefix: "新的", rarity: "magic", weight: 10, slots: [], mods: { atk: 1 } }));
}

// 传送点（P4）：踩到该格即解锁，解锁后可在地点之间往返传送。
// map 必须与「地图」页的地图名完全一致，否则运行时会找不到图。
function tabWaypoints() {
  const list = ED.content.waypoints || (ED.content.waypoints = []);
  mainEl.append(h("div", { class: "ed-hint" },
    "玩家走到「所在地图 + 行列」这一格就会解锁该传送点；解锁后可在地点之间往返（游戏内 M 键）。" +
    "删除传送点后，玩家存档里对应的解锁标记会失效但无害。"));
  listTab("传送点（" + list.length + "）", list, WAYPOINT_SCHEMA,
    [{ k: "id", label: "id" }, { k: "name", label: "显示名" }, { k: "map", label: "地图" },
     { k: "act", label: "章节" }, { k: "row", label: "行" }, { k: "col", label: "列" }],
    () => ({ id: "wp_" + (list.length + 1), name: "新传送点", map: (ED.content.mapsIndex && Object.values(ED.content.mapsIndex)[0]) || "", row: 1, col: 1, act: 1, desc: "" }));
}

// 暗金物品：绑定到一个物品模板名，掉落时用**固定词缀替换**随机词缀。
function flattenMods(o) {
  const mods = {};
  for (const k of ["atk", "def", "hp", "mp", "spd", "hit"]) if (o[k]) mods[k] = Number(o[k]);
  return mods;
}

function tabUniques() {
  const list = ED.content.uniques || (ED.content.uniques = []);
  mainEl.append(h("div", { class: "ed-hint" },
    "暗金物品 = 有名字、属性固定的独特装备。掉落时用它替换随机词缀，所以强度可预期。" +
    "「物品模板名」要对得上物品页里的名字，否则这件暗金永远不会掉。"));
  // 把 mods 摊平到表单字段上编辑，保存时再收回去。
  const view = list.map(u => ({ ...u, ...(u.mods || {}) }));
  const syncBack = () => { list.forEach((u, i) => { u.mods = flattenMods(view[i]); }); };
  listTab("暗金（" + list.length + "）", view, UNIQUE_SCHEMA,
    [{ k: "id", label: "id" }, { k: "uname", label: "暗金名" }, { k: "name", label: "物品模板" }],
    () => ({ id: "u_" + (list.length + 1), name: "", uname: "新暗金", mods: {} }), { sync: syncBack });
}

function tabSets() {
  const list = ED.content.sets || (ED.content.sets = []);
  mainEl.append(h("div", { class: "ed-hint" },
    "套装按「穿了几件」给阶梯加成，多档累加（3 件 = 2 件档 + 3 件档）。" +
    "部件填物品模板名，逗号分隔；加成按件数升序生效。"));
  const schema = [
    { group: "基本" },
    { k: "id", label: "id" }, { k: "name", label: "套装名" },
    { k: "piecesText", label: "部件", type: "textarea", rows: 3, hint: "物品模板名，逗号/换行分隔" },
    { group: "说明" },
    { k: "desc", label: "描述", type: "textarea", rows: 2 },
    { group: "加成（按件数）" },
    { k: "b2", label: "2 件 攻击", type: "number" },
    { k: "b2d", label: "2 件 防御", type: "number" },
    { k: "b2h", label: "2 件 气血", type: "number" },
    { k: "b3", label: "3 件 攻击", type: "number" },
    { k: "b3d", label: "3 件 防御", type: "number" },
    { k: "b3h", label: "3 件 气血", type: "number" },
  ];
  const tier = (b) => ({ pieces: b.pieces, mods: b.mods });
  const view = list.map(s => {
    const t2 = (s.bonuses || []).find(b => b.pieces === 2) || { mods: {} };
    const t3 = (s.bonuses || []).find(b => b.pieces === 3) || { mods: {} };
    return {
      id: s.id, name: s.name, desc: s.desc || "",
      piecesText: (s.pieces || []).join("，"),
      b2: t2.mods.atk || 0, b2d: t2.mods.def || 0, b2h: t2.mods.hp || 0,
      b3: t3.mods.atk || 0, b3d: t3.mods.def || 0, b3h: t3.mods.hp || 0,
    };
  });
  const syncBack = () => {
    list.forEach((s, i) => {
      const v = view[i];
      s.id = v.id; s.name = v.name; s.desc = v.desc || "";
      s.pieces = String(v.piecesText || "").split(/[，,\s]+/).map(x => x.trim()).filter(Boolean);
      const mk = (n, a, d, hp) => {
        const mods = {};
        if (+a) mods.atk = +a; if (+d) mods.def = +d; if (+hp) mods.hp = +hp;
        return Object.keys(mods).length ? { pieces: n, mods } : null;
      };
      s.bonuses = [mk(2, v.b2, v.b2d, v.b2h), mk(3, v.b3, v.b3d, v.b3h)].filter(Boolean);
    });
  };
  listTab("套装（" + list.length + "）", view, schema,
    [{ k: "id", label: "id" }, { k: "name", label: "套装名" }, { k: "piecesText", label: "部件" }],
    () => ({ id: "set_" + (list.length + 1), name: "新套装", piecesText: "", desc: "", b2: 0, b2d: 0, b2h: 0, b3: 0, b3d: 0, b3h: 0 }), { sync: syncBack });
}

function tabBuffs() {
  const list = ED.buffs || (ED.buffs = ED.content.buffs || (ED.content.buffs = []));
  mainEl.append(h("div", { class: "ed-hint" }, "技能通过「命中效果」按 id 引用；叠层/刷新/持续/DOT/HOT 均在引擎 engine/buff.js 中处理。"));
  listTab("Buff / Debuff（" + list.length + "）", list, withFx(BUFF_SCHEMA),
    [{ k: "id", label: "id" }, { k: "name", label: "名称" }, { k: "duration", label: "持续" }, { k: "maxStacks", label: "层数" }],
    () => ({ id: "buff_" + (list.length + 1), name: "新 Buff", duration: 10, maxStacks: 1, stackMode: "refresh", mods: {}, tags: [] }),
    { key: "buffs", icon: "buff_icons" });
}

function tabNpcs() {
  listTab("NPC / 怪物（" + ED.npcs.length + "）", ED.npcs, npcSchema(),
    [{ k: "id", label: "编号" }, { k: "name", label: "名称" }, { k: "model", label: "行走图" }, { k: "level", label: "等级" }, { k: "hp", label: "生命" }],
    () => newNpcTemplate(),
    { key: "npcs", thumb: n => roleSrc(n.model) || (n.portrait ? assetSrc2(n.portrait, "face") : null) });
}
function tabItems() {
  listTab("物品（" + ED.items.length + "）", ED.items, withFx(ITEM_SCHEMA),
    [{ k: "name", label: "名称" }, { k: "type", label: "类型" }, { k: "price", label: "价格" }, { k: "attack", label: "攻击" }, { k: "defence", label: "防御" }],
    () => ({ name: "新物品", type: 0, subtype: 0, price: 0, reqLevel: 0, hp: 0, mp: 0, attack: 0, defence: 0, attrA: 0, attrB: 0, attrC: 0, icon: "", desc: "" }),
    { key: "items", icon: "items_icons" });
}
function tabSkills() {
  listTab("技能（" + ED.skills.length + "）", ED.skills, withFx(skillSchema()),
    [{ k: "name", label: "名称" }, { k: "type", label: "类型" }, { k: "power", label: "威力" }, { k: "mp", label: "耗精力" }, { k: "range", label: "射程" }],
    () => ({ name: "新技能", desc: "", type: 1, range: 40, mp: 0, reqLevel: 1, power: 10, sound: "", icon: "", frames: [] }),
    { key: "skills", icon: "skill_icons" });
}

// ---------- 数值 ----------
function tabConfig() {
  const c = ED.content.config;
  // 与其它分页统一：每个语义段是一个 ed-group（金色小标题 + 细边框），
  // 不再用大段 <h3> 平铺，视觉上与 NPC / 物品 / Buff 详情面板一致。
  // 分组卡片放进一个外层网格容器：卡片横向并排（宽了自动换行、窄屏单列），
  // 卡片内部字段纵向排 —— 与 NPC/物品/Buff 列表页同一套布局。
  const wrap = h("div", { class: "ed-grid" });
  const sec = (title, key, fields, hint) => {
    const g = h("div", { class: "ed-group" });
    g.append(h("div", { class: "ed-grouptitle" }, title));
    if (hint) g.append(h("div", { class: "ed-ghint" }, hint));
    const f = h("div");
    g.append(f);
    wrap.append(g);
    if (!c[key]) c[key] = {};
    renderForm(f, fields, c[key], mark);
  };
  mainEl.append(h("h3", null, "全局数值配置"));
  mainEl.append(rhint("这些数值是新开局的基准；版本自身可用同名 JSON 覆盖。"));

  sec("主角初始数值", "player", [
    { k: "hpMax", label: "最大生命", type: "number" }, { k: "mpMax", label: "最大精力", type: "number" },
    { k: "level", label: "起始等级", type: "number" }, { k: "expNext", label: "升级所需经验", type: "number" },
    { k: "attack", label: "起始攻击", type: "number" }, { k: "defence", label: "起始防御", type: "number" },
    { k: "attackSpeed", label: "起始攻速", type: "number" },
    { k: "money", label: "起始银两", type: "number" },
    { k: "moral", label: "起始道德", type: "number" }, { k: "honor", label: "起始声望", type: "number" },
    { k: "startSkills", label: "初始技能", hint: "可多个", type: "strlist" },
  ]);

  sec("升级常数", "levelUp", [
    { k: "expMul", label: "所需经验×", type: "number", step: 0.1 }, { k: "expAdd", label: "所需经验+", type: "number" },
    { k: "maxLevel", label: "等级上限", type: "number" },
    { k: "hpMax", label: "生命成长", type: "number" }, { k: "mpMax", label: "精力成长", type: "number" },
    { k: "attack", label: "攻击成长", type: "number" }, { k: "defence", label: "防御成长", type: "number" },
    { k: "attackSpeed", label: "攻速成长", type: "number" },
    { k: "healOnLevel", label: "升级回满", type: "checkbox" },
  ]);

  sec("战斗常数", "combat", [
    { k: "rangeMin", label: "最小攻击距离", type: "number" }, { k: "meleeMaxRange", label: "近战/远程分界", type: "number", step: 1 },
    { k: "attackCD", label: "玩家攻击冷却(秒)", type: "number", step: 0.1 },
    { k: "hitBuffer", label: "命中缓冲(像素)", type: "number", step: 1 },
    { k: "damageVariance", label: "伤害浮动(0~1)", type: "number", step: 0.05 },
    { k: "npcAttackCD", label: "敌人攻击冷却", type: "number", step: 0.1 },
    { k: "npcAggro", label: "敌人视野", type: "number" }, { k: "npcMelee", label: "敌人近战距离", type: "number" },
    { k: "mpDrainRun", label: "奔跑耗精力/秒", type: "number", step: 0.1 },
  ]);

  sec("移动速度", "move", [
    { k: "walkSpeed", label: "走路速度(像素/秒)", type: "number" }, { k: "runSpeed", label: "奔跑速度(像素/秒)", type: "number" },
  ]);

  sec("经济与掉落", "economy", [
    { k: "sellRate", label: "卖出回收比例", type: "number", step: 0.05 },
    { k: "dropRate", label: "全局掉落率倍率", type: "number", step: 0.1,
      hint: "1 = 原样；0 = 完全不掉；2 = 翻倍。作用于所有 NPC 掉落几率。" },
    { k: "players", label: "人数加成", type: "number", step: 1,
      hint: "掉落几率 × √人数：4 人 = 2 倍。组队有收益但不会线性通胀。" },
    { k: "rarityLevelStep", label: "品质提升每 N 级", type: "number", step: 1,
      hint: "怪物等级每高这么多级，稀有度权重往上挪一档（越高越容易掉好货）。" },
    { k: "rarityStrength", label: "品质提升力度(0~1)", type: "number", step: 0.05,
      hint: "每档挪动「当前权重 × 该比例」。0 = 等级不影响品质。" },
  ]);

  sec("背包", "inventory", [
    { k: "packItem", label: "背包道具名", type: "text" }, { k: "packSize", label: "背包格数", type: "number" },
  ]);

  sec("共享仓库", "stash", [
    { k: "size", label: "仓库格数", type: "number",
      hint: "账号级存储，不随存档；改小只会让超出的格子看不见（数据仍保留）。" },
  ]);

  // ---- 音频：默认音量（玩家在游戏内设置面板改的值会覆盖这里）----
  sec("音频默认音量", "audio", [
    { k: "bgm", label: "背景音乐", type: "number", step: 0.05, min: 0, max: 1, def: 0.6 },
    { k: "sfx", label: "音效", type: "number", step: 0.05, min: 0, max: 1, def: 0.8 },
  ], "0~1。玩家在游戏内「设置」里调过音量后，以玩家自己存的值为准（存在浏览器本地）。"
    + "这里只决定「第一次进游戏」时的默认音量。");

  // ---- 掉落 / 拾取 / 强化 ----
  sec("掉落与拾取", "items", [
    { k: "dropTtl", label: "掉落存在时长(秒,0=永久)", type: "number", def: 0 },
    { k: "dropScatter", label: "掉落散布半径", type: "number", def: 22 },
    { k: "pickupRadius", label: "自动拾取半径", type: "number", def: 20 },
    { k: "pickupDelay", label: "拾取保护(秒)", type: "number", step: 0.1, def: 0 },
    { k: "stackRadius", label: "地面堆叠半径", type: "number", def: 18 },
  ]);

  sec("强化与耐久", "items", [
    { k: "maxEnhance", label: "强化上限", type: "number", def: 10 },
    { k: "enhancePriceBase", label: "强化基础价", type: "number", def: 50 },
    { k: "enhancePriceMul", label: "强化价格倍率", type: "number", step: 0.1, def: 1.6 },
    { k: "durabilityLossOnHit", label: "受击耐久损耗", type: "number", step: 0.1, def: 0.5 },
    { k: "repairRate", label: "修理费率", type: "number", step: 0.1, def: 0.6,
      hint: "修理费 = 物品价 × 缺失耐久占比 × 本值；调 0 等于免费修理。" },
    { k: "identifyBase", label: "鉴定底价", type: "number", def: 20,
      hint: "实际价格按稀有度再乘倍率（魔法 1.5 / 稀有 2.5 / 暗金 4）。" },
  ]);

  sec("强化加成", "itemEnhance", [
    { k: "enhancePerLevel", label: "每级攻击/防御加成", type: "number", def: 2 },
  ]);

  // ---- 指示器开关与颜色 ----
  sec("界面指示器", "fx", [
    { k: "uiRings", label: "显示锁定/选圈", type: "checkbox" },
    { k: "moveMarker", label: "显示移动标记", type: "checkbox" },
    { k: "itemHighlight", label: "高亮地上的物品", type: "checkbox" },
    { k: "ring.target", label: "目标圈颜色", type: "text" },
    { k: "ring.interact", label: "交互圈颜色", type: "text" },
    { k: "ring.move", label: "移动圈颜色", type: "text" },
  ], "颜色写 #rrggbb。");

  // ---- 等距几何（改之前务必确认与地图/素材匹配）----
  sec("等距坐标", "iso", [
    { k: "originX", label: "原点 X", type: "number" },
    { k: "halfW", label: "菱形半宽", type: "number" },
    { k: "halfH", label: "菱形半高", type: "number" },
  ], "菱形格子的投影参数。改动会影响所有地图的坐标换算，一般不用动。");

  mainEl.append(wrap);

  // ================= 数据集默认参数（版本级的「全局设置」）=================
  mainEl.append(h("h3", null, "数据集信息"));
  mainEl.append(rhint("这些是当前版本数据集的全局参数，不随单个 NPC/物品变化。"));
  const metaWrap = h("div", { class: "ed-grid" });
  mainEl.append(metaWrap);

  const metaSec = (title, hint) => {
    const g = h("div", { class: "ed-group" });
    g.append(h("div", { class: "ed-grouptitle" }, title));
    if (hint) g.append(h("div", { class: "ed-ghint" }, hint));
    metaWrap.append(g);
    return g;
  };

  // ---- 版本信息（只读展示 + 可改的名称）----
  const gv = metaSec("版本");
  const vInfo = h("dl", { class: "ed-kv" });
  const maps = Object.keys(ED.maps || {});
  const mapCount = maps.length;
  // 地图里的 NPC 存在 spawns（不是 npcs）；数量为 0 时视为空地图
  const spawnCount = m => (m && ((m.spawns && m.spawns.length) || (m.npcs && m.npcs.length) || 0)) || 0;
  const withEnemies = Object.values(ED.maps || {}).filter(m => spawnCount(m) > 0).length;
  const totalSpawns = Object.values(ED.maps || {}).reduce((a, m) => a + spawnCount(m), 0);
  const kvi = (k, v, cls) => vInfo.append(h("dt", null, k), h("dd", { class: cls || "" }, String(v)));
  kvi("版本 id", ED.id || "(未保存)");
  kvi("显示名称", ED.name || "(未命名)");
  kvi("基准版本", ED.base ? (ED.base.name || ED.base.id || "默认") : "—");
  kvi("地图数", mapCount + "（" + withEnemies + " 张有 NPC，合计 " + totalSpawns + " 个）");
  kvi("NPC 数", (ED.npcs || []).length);
  kvi("物品数", (ED.items || []).length);
  kvi("技能数", (ED.skills || []).length);
  kvi("行走图模型", Object.keys(A.chars || {}).length);
  gv.append(vInfo);

  // ---- 新开局的初始地图 ----
  const gm = ED.content.game || (ED.content.game = {});
  const gs = metaSec("新开局", "决定玩家开新档时从哪张地图、以什么状态开始。");
  const startMap = h("select", { style: "flex:1;min-width:0" });
  const idx = (ED.content.mapsIndex) || {};
  startMap.append(h("option", { value: "" }, "（用脚本流程，不强制指定）"));
  for (const [id, name] of Object.entries(idx)) startMap.append(h("option", { value: String(id) }, String(id) + " · " + name));
  startMap.value = gm.startMap == null ? "" : String(gm.startMap);
  startMap.onchange = () => {
    if (startMap.value === "") delete gm.startMap;
    else gm.startMap = Number(startMap.value);
    mark();
  };
  gs.append(h("div", { class: "ed-row" }, h("label", null, "初始地图"), startMap));
  const startCell = h("input", { type: "text", placeholder: "行,列（留空=按地图 entry）", style: "flex:1;min-width:0" });
  startCell.value = Array.isArray(gm.startCell) ? gm.startCell.join(",") : "";
  startCell.oninput = () => {
    const t = startCell.value.trim();
    if (!t) { delete gm.startCell; mark(); return; }
    const parts = t.split(/[,，\s]+/).map(Number).filter(n => isFinite(n));
    if (parts.length === 2) { gm.startCell = parts; mark(); }
  };
  gs.append(h("div", { class: "ed-row" }, h("label", null, "起始格"), startCell));
  gs.append(h("div", { class: "ed-ghint" }, "格式「行,列」，例如 3,3。留空则用地图自身配置的入场点。"));

  // ---- 字体 / 界面缩放（数据集级）----
  const gu = metaSec("界面", "影响游戏内 UI 的默认表现（不是编辑器自己的字号）。");
  const uiCfg = (ED.content.ui = ED.content.ui || {});
  const scaleIn = h("input", { type: "number", step: 0.05, min: 0.5, max: 3, style: "flex:1;min-width:0" });
  scaleIn.value = uiCfg.scale == null ? 1 : uiCfg.scale;
  scaleIn.oninput = () => { const v = parseFloat(scaleIn.value); if (isFinite(v) && v > 0) { uiCfg.scale = v; mark(); } };
  gu.append(h("div", { class: "ed-row" }, h("label", null, "界面缩放"), scaleIn));
  const fontIn = h("input", { type: "text", placeholder: "例：'Microsoft YaHei', sans-serif", style: "flex:1;min-width:0" });
  fontIn.value = uiCfg.font || "";
  fontIn.oninput = () => { uiCfg.font = fontIn.value.trim(); mark(); };
  gu.append(h("div", { class: "ed-row" }, h("label", null, "界面字体"), fontIn));
  gu.append(h("div", { class: "ed-ghint" }, "留空用游戏内置默认字体。这些字段写进版本内容，随版本保存。"));
}

// ---------- 标题 / 结局 ----------
function tabGame() {
  const g = ED.content.game;
  if (!g.music) g.music = {};
  if (!g.result) g.result = [];
  if (!Array.isArray(g.flash)) g.flash = [];
  // 片头闪屏：兼容旧的纯字符串数组，在这里统一成 { file, duration } 以便逐张设时长。
  g.flash = g.flash.map(x => (typeof x === "string"
    ? { file: x, duration: 2 }
    : { file: String((x && x.file) || ""), duration: Number(x && x.duration) > 0 ? Number(x.duration) : 2 }));

  mainEl.append(h("h3", null, "标题 / 结局配置"));
  mainEl.append(rhint("标题与结局的音乐、背景图、片头闪屏与声望称号。"));

  // 音乐候选：来自版本里的 assets/music/（音频索引在 buildAssetIndex 时一并建立）。
  // 音乐字段用 audio 类型：下拉选择 + 试听，不再手打文件名。
  const musicField = k => ({
    k, label: k === "start" ? "标题音乐" : "结局音乐",
    type: "audio", filesFn: musicFiles,
  });

  // 外层网格：卡片横向并排，卡片内字段纵向（与升级数值/列表页一致）。
  const gwrap = h("div", { class: "ed-grid" });
  mainEl.append(gwrap);

  const g1 = h("div", { class: "ed-group" });
  g1.append(h("div", { class: "ed-grouptitle" }, "音乐"));
  const f1 = h("div");
  g1.append(f1);
  gwrap.append(g1);
  renderForm(f1, [musicField("start"), musicField("end")], g.music, mark);

  const g2 = h("div", { class: "ed-group" });
  g2.append(h("div", { class: "ed-grouptitle" }, "结局画面"));
  const f2 = h("div");
  g2.append(f2);
  gwrap.append(g2);
  renderForm(f2, [{ k: "endpic", label: "结局背景图", type: "image", dir: "ui" }], g, mark);

  // 片头闪屏：左列表（缩略图 + 序号 + 时长）+ 右详情，与其它分页一致。
  mainEl.append(h("h3", null, "片头闪屏"));
  mainEl.append(rhint("按顺序播放；每张可单独设停留时长。首行是点击跳过提示前的第一屏。"));

  const flashSchema = [
    { group: "画面" },
    { k: "file", label: "图片", type: "image", dir: "ui" },
    { group: "播放" },
    { k: "duration", label: "停留时长(秒)", type: "number", step: 0.5, min: 0.2, def: 2 },
  ];
  const flashThumb = it => (it && it.file ? assetSrc2(it.file, "ui") : null);
  listTab("闪屏序列（" + g.flash.length + " 张）", g.flash, flashSchema,
    [{ k: "file", label: "图片" }, { k: "duration", label: "时长" }],
    () => ({ file: "", duration: 2 }),
    { key: "gameflash", thumb: flashThumb });

  listTab("结局评价称号（按声望区间）", g.result, [
    { group: "声望区间" },
    { k: "lower", label: "声望下限", type: "number" }, { k: "upper", label: "声望上限", type: "number" },
    { group: "称号" },
    { k: "name", label: "称号", type: "text" },
  ], [{ k: "lower", label: "下限" }, { k: "upper", label: "上限" }, { k: "name", label: "称号" }],
    () => ({ lower: 0, upper: 1000, name: "新称号" }), { key: "gameresult" });
}

// ---------- 图片素材 ----------

// ---------- 行走图（pmg）----------
// chars.json 的结构是 chars[模型][动作][方向 0..7][帧]。
// 编辑时最需要的是「一眼看全这套行走图」：左列表选模型，右侧按方向分行、
// 按帧分列铺开，而不是只显示一张站立首帧。
function tabPmg() {
  const chars = A.chars || {};
  const models = Object.keys(chars).sort();
  mainEl.append(h("h3", null, "行走图（pmg / chars.json）"));
  mainEl.append(rhint("每个模型含 stand / walk / run / fight / die 等动作，每个动作 8 个方向、每方向若干帧。"
    + "帧文件位于 assets/role/，可在「图片素材」页整体替换。"));

  const split = h("div", { class: "ed-split" });
  const left = h("div", { class: "ed-split-list" });
  const right = h("div", { class: "ed-split-form" });
  split.append(left, mkSplitResizer("pmg", left), right);
  mainEl.append(split);

  let query = "";
  let selModel = models[0] || null;

  const searchIn = h("input", { type: "text", placeholder: "搜索模型名…" });
  const cntEl = h("span", { class: "ed-count" });
  left.append(h("div", { class: "ed-tools", style: "padding:6px" }, h("div", { class: "ed-search" }, searchIn), cntEl));
  const listWrap = h("div", { class: "ed-tablescroll" });
  left.append(listWrap);

  const rows = new Map();
  const highlight = () => { for (const [m, tr] of rows) tr.classList.toggle("on", m === selModel); };

  const drawList = () => {
    rows.clear();
    clear(listWrap);
    const q = query.trim().toLowerCase();
    const show = q ? models.filter(m => m.toLowerCase().includes(q)) : models;
    cntEl.textContent = "共 " + models.length + " 个模型" + (q ? " / 显示 " + show.length : "");
    const tbl = h("table", { class: "ed-table" });
    tbl.append(h("thead", null, h("tr", null, h("th", { class: "ed-thumb" }), h("th", null, "模型"), h("th", null, "动作"))));
    const tb = h("tbody");
    for (const m of show) {
      const acts = Object.keys(chars[m] || {});
      const tr = h("tr", { class: m === selModel ? "on" : "" });
      const im = h("img", { loading: "lazy", decoding: "async", src: roleSrc(m) || "" });
      im.onerror = () => { im.style.opacity = "0.12"; };
      tr.append(h("td", { class: "ed-thumb" }, im),
        h("td", { style: "font-size:11px;word-break:break-all" }, m),
        h("td", { style: "font-size:10px;color:#6b737e" }, acts.join(" ")));
      tr.onclick = () => { selModel = m; highlight(); drawRight(); };
      rows.set(m, tr);
      tb.append(tr);
    }
    if (!show.length) tb.append(h("tr", null, h("td", { colspan: 3 }, h("div", { class: "ed-empty" }, "没有匹配的模型"))));
    tbl.append(tb);
    listWrap.append(tbl);
  };
  let searchT = 0;
  searchIn.oninput = () => { query = searchIn.value; clearTimeout(searchT); searchT = setTimeout(drawList, 150); };

  const drawRight = () => {
    clear(right);
    if (!selModel) { right.append(h("div", { class: "ed-empty" }, "左侧选择一个模型")); return; }
    right.append(h("h3", { style: "margin-top:0" }, selModel));
    const ch = chars[selModel] || {};
    const acts = Object.keys(ch);
    // 统计总帧数，给个直观信息
    let total = 0;
    for (const a of acts) for (const d of (ch[a] || [])) total += (d || []).length;
    right.append(rhint(acts.length + " 个动作 / 共 " + total + " 帧 / 帧图位于 assets/role/"));
    right.append(pmgGrid(ch, {}));
  };

  // 与其它分页一致：左列表行首缩略图
  drawList();
  drawRight();
}

function tabAssets() {
  mainEl.append(h("h3", null, "图片素材"));
  mainEl.append(h("div", { class: "ed-hint" },
    "左侧列出「默认版本 + 当前版本」的全部图片资源（版本 assets/ 是覆盖式的，所以默认版本的图也会出现在这里）。"
    + "上传的图片以 data URL 存进当前版本，游戏中自动生效；尺寸建议与原图一致。「还原」会删掉本版本的覆盖，回落到原版图。"));

  // 重建索引（每次进入本页都刷新，保证刚上传的图能立刻搜到）
  const idx0 = buildAssetIndexAsync({
    versions: null,
    currentId: ED.id,
    images: ED.images,
    items: ED.items, skills: ED.skills, npcs: ED.npcs, buffs: ED.buffs || [],
    charsMap: A.chars || {},
    maps: Object.values(ED.maps || {}),
  });
  // 索引构建是异步的（要拉 versions/index.json）；先画骨架，回来后再铺列表。
  let idx = [];

  const split = h("div", { class: "ed-split" });
  const left = h("div", { class: "ed-split-list" });
  const right = h("div", { class: "ed-split-form" });
  split.append(left, mkSplitResizer("assets", left), right);
  mainEl.append(split);

  // ---- 左：搜索 + 列表 ----
  const searchIn = h("input", { type: "text", placeholder: "搜索资源路径…" });
  const cntEl = h("span", { class: "ed-count" });
  left.append(h("div", { class: "ed-tools", style: "padding:6px" }, h("div", { class: "ed-search" }, searchIn), cntEl));
  const listWrap = h("div", { class: "ed-tablescroll" });
  left.append(listWrap);

  let selPath = null;
  let query = "";

  // 列表渲染策略（性能关键）：
  //   资源有 2900+ 条，早期版本每次「点选某一行」都重建整张表并重新创建 2900 个
  //   <img>，浏览器要重新解码上千张图，点一下就卡住几秒。
  //   现在：①只有数据集变化（搜索/上传/还原）才重建 DOM；②点选只切换 class；
  //        ③图片用 IntersectionObserver 懒加载 + 二进制约 1500 行后分批渲染。
  const TABLE_MAX = 4000;          // 一屏不画超过这个行数（再多滚动也不会更快）
  const rowsByPath = new Map();    // path -> <tr>，供点选时直接改 class
  let io = null;
  const ioNow = () => {
    if (io) return io;
    io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = /** @type {HTMLImageElement} */ (e.target);
        const src = img.dataset.lazy;
        if (src) { img.src = src; delete img.dataset.lazy; }
        io.unobserve(img);
      }
    }, { root: listWrap, rootMargin: "300px" });
    return io;
  };

  const highlight = () => {
    for (const [p, tr] of rowsByPath) tr.classList.toggle("on", p === selPath);
  };

  const drawList = () => {
    if (io) { io.disconnect(); io = null; }
    rowsByPath.clear();
    clear(listWrap);
    const all = searchAssets(query);
    cntEl.textContent = "共 " + idx.length + (query ? " / 显示 " + all.length : "") + " 项";
    const tbl = h("table", { class: "ed-table" });
    tbl.append(h("thead", null, h("tr", null, h("th", { class: "ed-thumb" }), h("th", null, "资源"), h("th", null, "状态"))));
    const tb = h("tbody");
    const obs = ioNow();
    let lastGroup = null;
    let shown = 0;
    for (const p of all) {
      if (shown >= TABLE_MAX) break;
      shown++;
      const g = groupOf(p);
      if (g !== lastGroup) {
        tb.append(h("tr", { class: "ed-grouprow" }, h("td", { colspan: 3 }, g)));
        lastGroup = g;
      }
      const on = p === selPath;
      const tr = h("tr", { class: on ? "on" : "" });
      tr.dataset.path = p;
      const src = ED.images[p] || assetSrc(p);
      // 懒加载：先占位不设 src，滚到附近才真正请求/解码
      const im = h("img", { loading: "lazy", decoding: "async" });
      im.dataset.lazy = src;
      im.onerror = () => { im.style.opacity = "0.12"; };
      im.onload = () => { im.style.opacity = "1"; };
      tr.append(h("td", { class: "ed-thumb" }, im),
        h("td", { style: "font-size:11px;word-break:break-all" }, fileName(p)),
        h("td", { style: "font-size:10px;color:" + (ED.images[p] ? "#f0d060" : "#6b737e") }, ED.images[p] ? "本版覆盖" : "原版"));
      tr.onclick = () => { selPath = p; highlight(); drawDetail(); };
      rowsByPath.set(p, tr);
      tb.append(tr);
      obs.observe(im);
    }
    if (!all.length) tb.append(h("tr", null, h("td", { colspan: 3 }, h("div", { class: "ed-empty" }, "没有匹配的资源"))));
    else if (all.length > shown) tb.append(h("tr", null, h("td", { colspan: 3 },
      h("div", { class: "ed-empty" }, "还有 " + (all.length - shown) + " 项未列出，请用搜索缩小范围"))));
    tbl.append(tb);
    listWrap.append(tbl);
  };
  // 搜索防抖：输入时不每键重建 2900 行
  let searchT = 0;
  searchIn.oninput = () => {
    query = searchIn.value;
    clearTimeout(searchT);
    searchT = setTimeout(drawList, 160);
  };

  // ---- 右：大图预览 + 上传/还原 ----
  const drawDetail = () => {
    clear(right);
    if (!selPath) { right.append(h("div", { class: "ed-empty" }, "左侧选择一个资源")); return; }
    const overridden = !!ED.images[selPath];
    right.append(h("h3", { style: "margin-top:0" }, fileName(selPath)));
    right.append(rhint(selPath));
    const big = h("img", { class: "ed-decor-big", src: ED.images[selPath] || assetSrc(selPath), style: "max-width:100%;max-height:320px" });
    // 加载失败 → 换成留空的占位图案（不要浏览器默认的破图）
    const bigPh = imgPlaceholder("图片加载失败：" + fileName(selPath));
    bigPh.style.minHeight = "160px";
    bigPh.style.minWidth = "220px";
    bigPh.style.display = "none";
    big.onerror = () => { big.style.display = "none"; bigPh.style.display = ""; };
    big.onload = () => { big.style.display = ""; bigPh.style.display = "none"; };
    right.append(h("div", { style: "display:flex;justify-content:center;align-items:center;background:#0a0b0d;border:1px solid #22262d;border-radius:4px;padding:12px;margin:8px 0" }, big, bigPh));
    right.append(h("div", { class: "ed-row" }, h("span", null, "来源：" + (overridden ? "本版本上传的覆盖图" : "默认版本原图"))));

    const file = h("input", { type: "file", accept: "image/*", style: "display:none" });
    file.onchange = async () => {
      const f = file.files[0]; if (!f) return;
      ED.images[selPath] = await readImageFile(f);
      setAssetOverrides(ED.images); mark(); drawList(); drawDetail();
    };
    right.append(h("div", { class: "ed-row" },
      h("button", { class: "ed-btn", onclick: () => file.click() }, "上传替换…"), file,
      overridden ? h("button", { class: "ed-btn danger", onclick: () => { delete ED.images[selPath]; setAssetOverrides(ED.images); mark(); drawList(); drawDetail(); } }, "还原为原版") : null));

    // 新路径上传（用于给还没有图的数据加素材）
    const pathIn = h("input", { type: "text", placeholder: "assets/items_icons/新图.png", style: "flex:1" });
    const file2 = h("input", { type: "file", accept: "image/*", style: "display:none" });
    file2.onchange = async () => {
      const f = file2.files[0]; if (!f) return;
      const np = pathIn.value.trim(); if (!np) { alert("请填写目标资源路径"); return; }
      ED.images[np] = await readImageFile(f); setAssetOverrides(ED.images); mark();
      if (!idx.includes(np)) idx.push(np), idx.sort();
      selPath = np; drawList(); drawDetail();
    };
    right.append(h("h3", null, "新增资源"));
    right.append(rhint("给还没有图片的数据补一张（路径需与数据里引用的名字一致）。"));
    right.append(h("div", { class: "ed-row" }, pathIn, h("button", { class: "ed-btn", onclick: () => file2.click() }, "选择图片…"), file2));
  };

  // 先显示"加载中"，索引到位后填充。
  clear(listWrap);
  listWrap.append(h("div", { class: "ed-empty" }, "正在建立资源索引…"));
  idx0.then(list => {
    idx = list;
    if (!selPath || !idx.includes(selPath)) selPath = idx[0] || null;
    drawList();
    drawDetail();
  });
}
