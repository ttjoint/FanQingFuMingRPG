// 内容编辑器：以 ContentDB（内容定义）+ 图层化 MapDoc（地图）为规范模型，
// 保存为“补丁式内容包”（只存与默认版本不同的条目）。编辑器内部仍保留旧版
// 数组/地图视图以复用面板，但读写统一经由 Project 适配层。
import { G, A } from "../core/state.js";
import { setAssetOverrides, assetURL } from "../core/assets.js";
import { h, clear, deep } from "./dom.js";
import { injectStyle } from "./style.js";
import { renderForm, renderListEditor, mkSplitResizer, editorShell } from "./fields.js";
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
import { buildAssetIndexAsync, searchAssets, groupOf, fileName, assetIndex } from "./assets-index.js";
import { decorThumb, decorPreview } from "./atlas-preview.js";
import { setImagesWriter } from "./asset-picker.js";

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

// 资源覆盆（上传替换）解析：assets 路径 → dataURL（若有覆盆），否则原路径。供表单图片预览用。
const assetSrc = p => (ED && ED.images && ED.images[p]) || assetURL(p);
const roleSrc = model => {
  const m = String(model || "").replace(/\.pmg$/, "");
  const ch = A.chars && A.chars[m]; if (!ch) return null;
  const blocks = ch.stand || ch.walk; const b = blocks && blocks[0] && blocks[0];
  return (b && b.length) ? assetSrc("assets/role/" + b[0].replace(/\.bmp$/, ".png")) : null;
};

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
const TABS = [["maps", "地图"], ["decor", "装饰物"], ["scripts", "脚本"], ["npcs", "NPC"], ["ais", "AI"], ["buffs", "Buff"], ["items", "物品"], ["skills", "技能"], ["effects", "特效"], ["affixes", "词缀"], ["config", "升级数值"], ["game", "标题结局"], ["assets", "图片素材"]];
let navEl;

// 标签页图标（纯文本，无需图标字体）。
const TAB_ICONS = {
  maps: "🗺", decor: "🌳", scripts: "📜", npcs: "👤", ais: "🧠", buffs: "✨",
  items: "⚔", skills: "⚡", effects: "💥", affixes: "🔧", config: "📈",
  game: "🎬", assets: "🖼",
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
  ({ maps: tabMaps, decor: tabDecor, scripts: tabScripts, npcs: tabNpcs, ais: tabAis, buffs: tabBuffs, items: tabItems, skills: tabSkills, effects: tabEffects, affixes: tabAffixes, config: tabConfig, game: tabGame, assets: tabAssets })[k]();
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
}

// ---------- 装饰物模板（跨地图共享，按贴图源矩形）----------
const rfield = (label, ctl) => h("div", { class: "ed-row" }, h("label", null, label), ctl);
const rnum = (val, on) => { const i = h("input", { type: "number", value: val }); i.oninput = () => on(Number(i.value) || 0); return i; };
const rhint = t => h("div", { class: "ed-hint" }, t);
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
  const right = h("div", { class: "ed-split-form" });
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
const AI_COND_HINT = "条件(when)可用：always, hpBelow, hpAbove, mpBelow, mpAbove, hasTarget, noTarget, targetDead, targetInRange(melee/aggro/数字), targetDistBelow, aggroOver, lostOver, allyBeingAttacked, nearbyEnemyCount, nearbyAllyCount, random, cooldownReady, leashExceeded（可组合 all/any/not）";
const AI_ACT_HINT = "动作(do.action)可用：idle, wander(radius,interval,speed), chase(stopRange,maxTime,speed), attack(cooldown,rage), flee(range,speed), assist(radius), guard(leash)";
const AI_TEMPLATES = {
  "站桩": { idle: { action: "idle" }, rules: [] },
  "原地游荡": { idle: { action: "wander", radius: 160, interval: [2, 6] }, rules: [] },
  "守卫(警戒+回防)": { idle: { action: "idle" }, targeting: { aggroRange: 260, retaliate: true, giveUpT: 8, leash: 480 }, rules: [
    { when: { targetInRange: "melee" }, do: { action: "attack" } },
    { when: { hasTarget: true }, do: { action: "guard", leash: 260 } },
  ] },
  "主动野兽(游荡+扑咬+低血逃)": { idle: { action: "wander", radius: 200, interval: [2, 5] }, targeting: { aggroRange: 200, retaliate: true, giveUpT: 6, leash: 420 }, rules: [
    { when: { hpBelow: 0.25 }, do: { action: "flee", range: 420, speed: 1.5 } },
    { when: { targetInRange: "melee" }, do: { action: "attack", cooldown: 1.1 } },
    { when: { hasTarget: true }, do: { action: "chase", stopRange: "melee" } },
  ] },
  "强盗(呼朋引伴+低血逃)": { idle: { action: "wander", radius: 180, interval: [2, 6] }, targeting: { aggroRange: 260, retaliate: true, giveUpT: 8, leash: 520 }, rules: [
    { when: { hpBelow: 0.2 }, do: { action: "flee", range: 480, speed: 1.5 } },
    { when: { targetInRange: "melee" }, do: { action: "attack", cooldown: 1.1 } },
    { when: { allyBeingAttacked: true }, do: { action: "assist", radius: 300 } },
    { when: { hasTarget: true }, do: { action: "chase", stopRange: "melee" } },
  ] },
  "首领(分阶段)": { idle: { action: "idle" }, targeting: { aggroRange: 320, retaliate: true, giveUpT: 12, leash: 640 }, rules: [
    { when: { hpBelow: 0.3 }, do: { action: "attack", cooldown: 0.7, rage: 1.5 } },
    { when: { hpBelow: 0.6 }, do: { action: "attack", cooldown: 1.0 } },
    { when: { targetInRange: "melee" }, do: { action: "attack", cooldown: 1.2 } },
    { when: { hasTarget: true }, do: { action: "chase", stopRange: "melee" } },
  ] },
};

function tabAis() {
  const list = ED.content.ais || (ED.content.ais = []);
  mainEl.append(h("h3", null, "AI 配置（共 " + list.length + "）"));
  mainEl.append(rhint("单位通过 NPC 的「AI 配置」字段按 id 引用；这里定义可复用的行为档案。"));
  mainEl.append(rhint(AI_COND_HINT));
  mainEl.append(rhint(AI_ACT_HINT));

  const split = h("div", { class: "ed-split" });
  const left = h("div", { class: "ed-split-list" });
  const right = h("div", { class: "ed-split-form" });
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
    list: arr, schema, columns, makeNew, onChange: () => mark(),
    onStructural: () => mark(), sel: 0,
    thumb, splitKey: o.key || "list",
  });
}

// 缩略图 URL：值可能是纯文件名（老数据）也可能是完整 assets/ 路径。
function assetSrc2(ref, dir) {
  if (!ref) return null;
  const s = String(ref);
  if (/^(data:|blob:|https?:)/i.test(s)) return s;
  if (s.startsWith("assets/")) return assetSrc(s);
  return assetSrc("assets/" + String(dir).replace(/\/$/, "") + "/" + s.replace(/\.bmp$/i, ".png"));
}

// NPC 字段按语义分组呈现：身份 → 数值 → 行为 → 内容 → 掉落/交易 → 台词。
// 带 group 的项是分隔项（无 k）；大段文本（lines/textarea）会自动独占整行。
const NPC_SCHEMA_FIELDS = [
  { group: "身份" },
  { k: "id", label: "编号", type: "number" }, { k: "name", label: "名称", type: "text" },
  { k: "model", label: "行走图", type: "model" }, { k: "portrait", label: "头像", type: "image", dir: "face" },

  { group: "数值" },
  { k: "level", label: "等级", type: "number" }, { k: "exp", label: "经验", type: "number" },
  { k: "hp", label: "生命", type: "number" }, { k: "attack", label: "攻击", type: "number" },
  { k: "defence", label: "防御", type: "number" },
  { k: "speed", label: "移动速度", type: "number", def: 45 }, { k: "runSpeed", label: "追击速度", type: "number", def: 70 },

  { group: "行为" },
  { k: "hostile", label: "主动敌对", type: "checkbox" },
  { k: "ai", label: "AI 配置", type: "select" },
  { k: "script", label: "对话脚本", type: "select" },
  { k: "skills", label: "技能", type: "strlist" },

  { group: "掉落与交易" },
  { k: "drops", label: "掉落物品", type: "drops" },
  { k: "inventory", label: "货物背包(商人)", type: "inventory" },

  { group: "台词" },
  { k: "talks", label: "闲话", hint: "每行一句，随机抽取", type: "lines", rows: 5 },
];
function npcSchema() {
  return NPC_SCHEMA_FIELDS.map(f => {
    const o = /** @type {any} */ ({ ...f });
    if (f.k === "model") { o.models = Object.keys(A.chars || {}); o.modelSrc = m => roleSrc(m); }
    if (f.k === "script") { o.options = [["", "（无）"]].concat(Object.keys(ED.content.scripts || {}).map(x => [x, x])); }
    if (f.k === "ai") o.options = [["", "（默认）"]].concat((ED.content.ais || []).map(a => [a.id, a.id + (a.name && a.name !== a.id ? " " + a.name : "")]));
    if (f.k === "drops") o.items = ED.items.map(x => x.name);
    if (f.k === "inventory") o.items = ED.items.map(x => x.name);
    if (f.k === "skills") { o.options = ED.skills.map(x => x.name); o.addLabel = "＋ 添加技能"; }
    return o;
  });
}
const ITEM_SCHEMA = [
  { group: "基本" },
  { k: "name", label: "名称", type: "text" },
  { k: "type", label: "类型", type: "select", numeric: true, options: [[0, "消耗品"], [1, "武器"], [2, "防具"], [3, "饰品"], [4, "技能书"], [7, "包裹"], [8, "剧情物品"], [9, "宝石"], [10, "材料"]] },
  { k: "subtype", label: "子类", type: "number" },
  { k: "rarity", label: "稀有度", type: "select", options: [["common", "普通"], ["magic", "精良"], ["rare", "稀有"], ["unique", "传说"], ["quest", "任务"]] },
  { k: "price", label: "价格", type: "number" }, { k: "reqLevel", label: "需求等级", type: "number" },
  { k: "icon", label: "图标", type: "image", dir: "items_icons" },

  { group: "属性加成" },
  { k: "hp", label: "生命+", type: "number" }, { k: "mp", label: "精力+", type: "number" },
  { k: "attack", label: "攻击+", type: "number" }, { k: "defence", label: "防御+", type: "number" },
  { k: "attrA", label: "攻速+", type: "number" },
  { k: "attrB", label: "属性B", type: "number" }, { k: "attrC", label: "属性C", type: "number" },

  { group: "堆叠与耐久" },
  { k: "stackable", label: "可堆叠", type: "checkbox" },
  { k: "maxStack", label: "最大堆叠", type: "number", def: 0 },
  { k: "socketCount", label: "镶嵌孔数", type: "number", def: 0 },
  { k: "maxDurability", label: "最大耐久", type: "number", def: 0 },

  { group: "宝石词条", hint: "仅 type=宝石 时生效" },
  { k: "gem.mods.atk", label: "攻击+", type: "number" },
  { k: "gem.mods.def", label: "防御+", type: "number" },
  { k: "gem.mods.hp", label: "生命+", type: "number" },
  { k: "gem.mods.hit", label: "攻速+", type: "number" },

  { group: "特效" },
  { k: "fx.aura", label: "装备光环", type: "select" },
  { k: "fx.use", label: "使用时", type: "select" },

  { group: "说明" },
  { k: "desc", label: "物品说明", type: "textarea", rows: 4 },
];
const SKILL_SCHEMA = [
  { k: "name", label: "名称", type: "text" },
  { k: "type", label: "类型", type: "select", numeric: true, options: [[0, "治疗(自身)"], [1, "攻击"]] },
  { k: "mode", label: "攻击方式", type: "select", options: [["melee", "近战（瞬间命中）"], ["ranged", "远程（预留弹道）"]] },
  { k: "range", label: "射程", type: "number" }, { k: "mp", label: "耗精力", type: "number" },
  { k: "power", label: "威力", type: "number" }, { k: "reqLevel", label: "需求等级", type: "number" },
  { k: "sound", label: "音效", type: "text" }, { k: "icon", label: "图标", type: "image", dir: "skill_icons" },
  { k: "frames", label: "特效帧", type: "frames", dir: "skill" },
  { k: "projectile.homing", label: "弹道·追踪目标", type: "checkbox" },
  { k: "projectile.speed", label: "弹道·速度(像素/秒)", type: "number", def: 320 },
  { k: "projectile.radius", label: "弹道·命中半径", type: "number", def: 18 },
  { k: "projectile.pierce", label: "弹道·穿透次数", type: "number", def: 0 },
  { k: "projectile.frames", label: "弹道·飞行帧", type: "frames", dir: "projectile" },
  { k: "desc", label: "说明", type: "textarea", rows: 2 },
];

// 技能表单按需构建（buff 候选随 ED.buffs 变化，避免模块加载时崩溃）。
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
const BUFF_SCHEMA = [
  { group: "基本" },
  { k: "id", label: "id", type: "text" },
  { k: "name", label: "名称", type: "text" },
  { k: "icon", label: "图标", type: "image", dir: "buff_icons" },

  { group: "时长与叠层" },
  { k: "duration", label: "持续(秒)", type: "number", def: 10 },
  { k: "maxStacks", label: "最大层数", type: "number", min: 1, def: 1 },
  { k: "stackMode", label: "叠层方式", type: "select", options: [["refresh", "刷新时长"], ["stack", "叠加层数"]] },

  { group: "每层属性修正" },
  { k: "mods.atk", label: "攻击", type: "number", def: 0 },
  { k: "mods.def", label: "防御", type: "number", def: 0 },
  { k: "mods.hpMax", label: "生命上限", type: "number", def: 0 },
  { k: "mods.mpMax", label: "精力上限", type: "number", def: 0 },
  { k: "mods.speed", label: "速度", type: "number", def: 0 },
  { k: "mods.hit", label: "攻速", type: "number", def: 0 },

  { group: "持续效果" },
  { k: "dot.dps", label: "每秒伤害", type: "number", def: 0 },
  { k: "hot.hps", label: "每秒治疗", type: "number", def: 0 },

  { group: "表现" },
  { k: "fx.aura", label: "光环(循环)", type: "select" },
  { k: "fx.onApply", label: "施加时", type: "select" },
  { k: "fx.onExpire", label: "到期时", type: "select" },

  { group: "说明与标签" },
  { k: "tags", label: "标签", hint: "每行一个", type: "lines", rows: 3 },
  { k: "desc", label: "说明", type: "textarea", rows: 4 },
];

const EFFECT_SCHEMA = [
  { k: "id", label: "id", type: "text" },
  { k: "name", label: "名称", type: "text" },
  { k: "layer", label: "层级(叠放次序)", type: "select", options: [["under", "地面（恒低于单位）"], ["over", "角色层（按 y 排序）"], ["top", "顶层（头顶，恒在上）"]] },
  { k: "anchor", label: "锚点", type: "select", options: [["world", "世界坐标"], ["unit", "单位"], ["item", "物品"]] },
  { k: "frames", label: "帧图", type: "frames", dir: "fx" },
  { k: "fps", label: "帧率(帧/秒)", type: "number", def: 12 },
  { k: "loop", label: "循环播放", type: "checkbox" },
  { k: "holdFirst", label: "首帧停留(秒)", type: "number", def: 0 },
  { k: "holdLast", label: "尾帧停留(秒)", type: "number", def: 0 },
  { k: "life", label: "存在时长(秒,0=不限)", type: "number", def: 0 },
  { k: "ox", label: "横向偏移", type: "number", def: 0 },
  { k: "oy", label: "纵向偏移", type: "number", def: 0 },
  { k: "scale", label: "缩放", type: "number", step: 0.1, def: 1 },
  { k: "texture", label: "贴图(预留,留空=程序化)", type: "text" },
  { k: "color", label: "颜色(程序化)", type: "text" },
  { k: "radius", label: "半径(程序化)", type: "number", def: 18 },
];
function tabEffects() {
  const list = ED.content.effects || (ED.content.effects = []);
  listTab("特效（" + list.length + "）", list, EFFECT_SCHEMA,
    [{ k: "id", label: "id" }, { k: "layer", label: "层级" }, { k: "anchor", label: "锚点" }, { k: "loop", label: "循环" }],
    () => ({ id: "fx_" + (list.length + 1), name: "新特效", layer: "over", anchor: "world", frames: [], fps: 12, loop: false, holdFirst: 0, holdLast: 0, life: 0, ox: 0, oy: 0, scale: 1, color: "", radius: 18 }),
    { key: "effects", thumb: e => (e.frames && e.frames[0]) ? assetSrc2(e.frames[0], "fx") : null });
}

const AFFIX_SCHEMA = [
  { k: "id", label: "id", type: "text" },
  { k: "name", label: "名称", type: "text" },
  { k: "prefix", label: "名称前缀", type: "text" },
  { k: "rarity", label: "稀有度", type: "select", options: [["magic", "精良"], ["rare", "稀有"], ["unique", "传说"]] },
  { k: "weight", label: "抽取权重", type: "number", def: 10 },
  { k: "slots", label: "适用槽(每行一个)", type: "lines", rows: 3 },
  { k: "mods.atk", label: "攻击+", type: "number" },
  { k: "mods.def", label: "防御+", type: "number" },
  { k: "mods.hp", label: "生命+", type: "number" },
  { k: "mods.mp", label: "精力+", type: "number" },
  { k: "mods.hit", label: "攻速+", type: "number" },
  { k: "mods.spd", label: "速度+", type: "number" },
];
function tabAffixes() {
  const list = ED.content.affixes || (ED.content.affixes = []);
  listTab("词缀（" + list.length + "）", list, AFFIX_SCHEMA,
    [{ k: "name", label: "名称" }, { k: "rarity", label: "稀有度" }, { k: "weight", label: "权重" }, { k: "mods.atk", label: "攻击" }, { k: "mods.def", label: "防御" }],
    () => ({ id: "af_" + (list.length + 1), name: "新词缀", prefix: "新的", rarity: "magic", weight: 10, slots: [], mods: { atk: 1 } }));
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
    { k: "defence", label: "起始防御", type: "number" }, { k: "attackSpeed", label: "起始攻速", type: "number" },
    { k: "moral", label: "起始道德", type: "number" }, { k: "honor", label: "起始声望", type: "number" },
    { k: "startSkills", label: "初始技能（逗号分隔）", type: "strlist" },
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
    { k: "meleeMaxRange", label: "近战/远程分界", type: "number", step: 1 },
    { k: "hitBuffer", label: "命中缓冲(像素)", type: "number", step: 1 }, { k: "damageVariance", label: "伤害浮动(0~1)", type: "number", step: 0.05 },
  ]);
  sec("移动速度", "move", [
    { k: "walkSpeed", label: "走路速度(像素/秒)", type: "number" }, { k: "runSpeed", label: "奔跑速度(像素/秒)", type: "number" },
  ]);
  sec("经济", "economy", [
    { k: "sellRate", label: "卖出回收比例", type: "number", step: 0.05 },
  ]);
  sec("背包", "inventory", [
    { k: "packItem", label: "背包道具名", type: "text" }, { k: "packSize", label: "背包格数", type: "number" },
  ]);
}

// ---------- 标题 / 结局 ----------
function tabGame() {
  const g = ED.content.game;
  if (!g.music) g.music = {};
  if (!g.result) g.result = [];
  if (!Array.isArray(g.flash)) g.flash = [];
  mainEl.append(h("h3", null, "标题 / 结局配置"));

  // 音乐候选：版本里有登记过的音频文件；没有就退化成可输入的文本框。
  const audioFiles = (A.assetsAudio || []).slice();
  const musicField = k => (audioFiles.length
    ? { k, label: k === "start" ? "标题音乐" : "结局音乐", type: "select",
        options: [["", "（无）"]].concat(audioFiles.map(x => [x, x])) }
    : { k, label: k === "start" ? "标题音乐" : "结局音乐", type: "text" });

  mainEl.append(h("h3", null, "音乐与背景"));
  const f = h("div", { class: "ed-grid" }); mainEl.append(f);
  renderForm(f, [musicField("start"), musicField("end")], g.music, mark);
  const f2 = h("div", { class: "ed-grid" }); mainEl.append(f2);
  renderForm(f2, [{ k: "endpic", label: "结局背景图", type: "image", dir: "ui" }], g, mark);

  mainEl.append(h("h3", null, "片头闪屏"));
  mainEl.append(rhint("按顺序播放的闪图，可为每张设时长。"));
  const f3 = h("div", { class: "ed-grid" }); mainEl.append(f3);
  renderForm(f3, [{ k: "flash", label: "闪屏图（可多选成序列）", type: "frames", dir: "ui" }], g, mark);

  listTab("结局评价称号（按声望区间）", g.result, [
    { k: "lower", label: "声望下限", type: "number" }, { k: "upper", label: "声望上限", type: "number" }, { k: "name", label: "称号", type: "text" },
  ], [{ k: "lower", label: "下限" }, { k: "upper", label: "上限" }, { k: "name", label: "称号" }],
    () => ({ lower: 0, upper: 1000, name: "新称号" }), { key: "gameresult" });
}

// ---------- 图片素材 ----------

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

  const drawList = () => {
    clear(listWrap);
    const all = searchAssets(query);
    cntEl.textContent = "共 " + idx.length + (query ? " / 显示 " + all.length : "") + " 项";
    const tbl = h("table", { class: "ed-table" });
    tbl.append(h("thead", null, h("tr", null, h("th", { class: "ed-thumb" }), h("th", null, "资源"), h("th", null, "状态"))));
    const tb = h("tbody");
    let lastGroup = null;
    for (const p of all) {
      const g = groupOf(p);
      if (g !== lastGroup) {
        tb.append(h("tr", null, h("td", { colspan: 3, style: "background:#121418;color:#7f8792;font-size:10px;letter-spacing:.06em;padding:4px 8px" }, g)));
        lastGroup = g;
      }
      const tr = h("tr", { class: p === selPath ? "on" : "", onclick: () => { selPath = p; drawList(); drawDetail(); } });
      const im = h("img", { src: ED.images[p] || assetSrc(p), loading: "lazy" });
      im.onerror = () => { im.style.opacity = "0.12"; };
      tr.append(h("td", { class: "ed-thumb" }, im),
        h("td", { style: "font-size:11px;word-break:break-all" }, fileName(p)),
        h("td", { style: "font-size:10px;color:" + (ED.images[p] ? "#f0d060" : "#6b737e") }, ED.images[p] ? "本版覆盖" : "原版"));
      tb.append(tr);
    }
    if (!all.length) tb.append(h("tr", null, h("td", { colspan: 3 }, h("div", { class: "ed-empty" }, "没有匹配的资源"))));
    tbl.append(tb);
    listWrap.append(tbl);
  };
  searchIn.oninput = () => { query = searchIn.value; drawList(); };

  // ---- 右：大图预览 + 上传/还原 ----
  const drawDetail = () => {
    clear(right);
    if (!selPath) { right.append(h("div", { class: "ed-empty" }, "左侧选择一个资源")); return; }
    const overridden = !!ED.images[selPath];
    right.append(h("h3", { style: "margin-top:0" }, fileName(selPath)));
    right.append(rhint(selPath));
    const big = h("img", { class: "ed-decor-big", src: ED.images[selPath] || assetSrc(selPath), style: "max-width:100%;max-height:320px" });
    big.onerror = () => { big.style.opacity = "0.12"; };
    right.append(h("div", { style: "display:flex;justify-content:center;background:#0a0b0d;border:1px solid #22262d;border-radius:4px;padding:12px;margin:8px 0" }, big));
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
