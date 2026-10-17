// 内容编辑器：以 ContentDB（内容定义）+ 图层化 MapDoc（地图）为规范模型，
// 保存为“补丁式内容包”（只存与默认版本不同的条目）。编辑器内部仍保留旧版
// 数组/地图视图以复用面板，但读写统一经由 Project 适配层。
import { G, A } from "../core/state.js";
import { setAssetOverrides, assetURL } from "../core/assets.js";
import { h, clear, deep } from "./dom.js";
import { injectStyle } from "./style.js";
import { renderForm, renderListEditor } from "./fields.js";
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

let root = null, ED = null, dirty = false, curTab = "maps";
let mainEl, sideEl, statusEl, mapEditor = null;

const mark = () => { dirty = true; };

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
  // 属性栏只在地图/装饰物页有意义；桌面端隐藏时同步隐藏拖拽手柄。
  const needSide = k === "maps" || k === "decor";
  sideEl.style.display = needSide ? "" : "none";
  const sideRsz = root.querySelectorAll(".ed-resizer")[1];
  if (sideRsz) sideRsz.style.display = (needSide && !isNarrow()) ? "" : "none";
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
  const tbl = h("table", { class: "ed-table" });
  const head = h("tr"); for (const l of ["贴图", "出现", "地图", "模式"]) head.append(h("th", null, l));
  tbl.append(h("thead", null, head));
  const body = h("tbody"); tbl.append(body); mainEl.append(tbl);
  if (!all.length) mainEl.append(rhint("（未找到装饰物：请确认地图数据已加载）"));

  const modeLabel = t => { const st = decorState(t); return st === "single" ? "单一" : (st === "line" ? "手画" : "自动"); };
  const renderRows = () => {
    for (const x of all) {
      const tr = [...body.children].find(t => t.dataset.k === x.key);
      if (tr) tr.children[3].textContent = modeLabel(tplOf(x.key, false));
    }
  };
  const renderSide = () => {
    clear(sideEl);
    const cur = all.find(x => x.key === decorSelKey);
    if (!cur) { sideEl.append(rhint("选择左侧一个模板")); return; }
    const s = cur.sprite, tiles = cur.tiles, tpl = tplOf(cur.key, true);
    sideEl.append(h("h3", null, "模板 " + s[2] + "×" + s[3]));
    sideEl.append(rhint("出现 " + cur.count + " 处：" + [...cur.maps].join("、")));
    sideEl.append(rfield("深度模式", modeControl(s, tiles, tpl, 64, () => { mark(); renderSide(); renderRows(); })));
    if (decorState(tpl) === "line") sideEl.append(h("div", { class: "ed-row" }, h("button", { class: "ed-btn", onclick: () => { delete tpl.line; mark(); renderSide(); renderRows(); } }, "恢复自动地基线")));
    sideEl.append(h("h3", null, "地基线 / 头顶线"));
    sideEl.append(makeLineEditor(s, tiles, tpl, 64, sideEl.clientWidth - 30, () => { mark(); renderRows(); }));
    sideEl.append(rhint("黄=地基线（可越出贴图）；青=头顶最高线（其上→覆盖层，永远遮挡玩家）"));
  };
  for (const x of all) {
    const tr = h("tr", { class: decorSelKey === x.key ? "on" : "", onclick: () => { decorSelKey = x.key; for (const t of body.children) t.classList.toggle("on", t.dataset.k === x.key); renderSide(); } });
    tr.dataset.k = x.key;
    tr.append(h("td", null, x.sprite[2] + "×" + x.sprite[3]), h("td", null, String(x.count)), h("td", null, [...x.maps].join("、")), h("td", null, modeLabel(tplOf(x.key, false))));
    body.append(tr);
  }
  if (!decorSelKey || !all.some(x => x.key === decorSelKey)) decorSelKey = all.length ? all[0].key : null;
  renderSide();
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
  mainEl.append(h("div", { class: "ed-hint" }, "单位通过 NPC 的「AI 配置」字段按 id 引用；这里定义可复用的行为档案。"));
  mainEl.append(h("div", { class: "ed-hint" }, AI_COND_HINT));
  mainEl.append(h("div", { class: "ed-hint" }, AI_ACT_HINT));

  const host = h("div");
  mainEl.append(host);
  let sel = 0;
  const redraw = () => {
    clear(host);
    const tools = h("div", { class: "ed-tools" },
      h("button", { class: "ed-btn", onclick: () => { const id = prompt("AI 配置 id", "ai_" + (list.length + 1)); if (!id) return; list.push({ id, name: id, idle: { action: "idle" }, rules: [] }); sel = list.length - 1; mark(); redraw(); } }, "＋ 新建"),
      h("button", { class: "ed-btn", onclick: () => { if (!list[sel]) return; list.splice(sel + 1, 0, deep(list[sel])); sel = sel + 1; mark(); redraw(); } }, "复制"),
      h("button", { class: "ed-btn danger", onclick: () => { if (!list[sel]) return; list.splice(sel, 1); sel = Math.max(0, sel - 1); mark(); redraw(); } }, "删除"),
      h("button", { class: "ed-btn", onclick: () => { if (!list[sel]) return; const t = prompt("模板：" + Object.keys(AI_TEMPLATES).join(" / ")); if (!t || !AI_TEMPLATES[t]) return; Object.assign(list[sel], deep(AI_TEMPLATES[t])); mark(); redraw(); } }, "套用模板"),
    );
    host.append(tools);
    const tbl = h("table", { class: "ed-table" });
    tbl.append(h("thead", null, h("tr", null, h("th", null, "id"), h("th", null, "名称"), h("th", null, "规则数"))));
    const body = h("tbody");
    list.forEach((a, i) => body.append(h("tr", { class: i === sel ? "on" : "", onclick: () => { sel = i; redraw(); } },
      h("td", null, a.id || ""), h("td", null, a.name || ""), h("td", null, String((a.rules || []).length)))));
    tbl.append(body);
    host.append(tbl);

    const a = list[sel];
    if (!a) return;
    const idIn = h("input", { type: "text", value: a.id || "" });
    idIn.oninput = () => { a.id = idIn.value; mark(); };
    const nameIn = h("input", { type: "text", value: a.name || "" });
    nameIn.oninput = () => { a.name = nameIn.value; mark(); };
    host.append(h("div", { class: "ed-row" }, h("label", null, "id"), idIn, h("label", null, "名称"), nameIn));
    const ta = h("textarea", { style: "width:100%;height:360px;white-space:pre;font-family:Consolas,monospace" });
    const body2 = /** @type {any} */ ({ ...a }); delete body2.id; delete body2.name;
    ta.value = JSON.stringify(body2, null, 2);
    const err = h("div", { class: "ed-hint" });
    ta.oninput = () => {
      try {
        const o = JSON.parse(ta.value);
        err.textContent = "";
        delete a.idle; delete a.targeting; delete a.rules;
        Object.assign(a, o);
        mark();
      } catch (e) { err.textContent = "JSON 语法错误：" + e.message; err.style.color = "#e66"; }
    };
    host.append(h("h3", null, "行为档案（idle / targeting / rules）"), ta, err);
  };
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
  { k: "hostile", label: "主动敌对", type: "checkbox" },
  { k: "ai", label: "AI 配置", type: "select" },
  { k: "skills", label: "技能", type: "strlist" },
  { k: "drops", label: "掉落物品", type: "drops" },
  { k: "inventory", label: "货物背包(商人)", type: "inventory" },
  { k: "talks", label: "闲话(每行一句)", type: "lines", rows: 4 },
];
function npcSchema() {
  return NPC_SCHEMA_FIELDS.map(f => {
    const o = /** @type {any} */ ({ ...f });
    if (f.k === "model") { o.list = Object.keys(A.chars || {}); o.img = n => roleSrc(n.model); }
    if (f.k === "portrait") o.img = n => n.portrait ? assetSrc("assets/face/" + n.portrait.replace(/\.bmp$/, ".png")) : null;
    if (f.k === "script") o.list = Object.keys(ED.content.scripts || {});
    if (f.k === "ai") o.options = [["", "（默认）"]].concat((ED.content.ais || []).map(a => [a.id, a.id + (a.name && a.name !== a.id ? " " + a.name : "")]));
    if (f.k === "drops") o.items = ED.items.map(x => x.name);
    if (f.k === "inventory") o.items = ED.items.map(x => x.name);
    if (f.k === "skills") { o.options = ED.skills.map(x => x.name); o.addLabel = "＋ 添加技能"; }
    return o;
  });
}
const ITEM_SCHEMA = [
  { k: "name", label: "名称", type: "text" },
  { k: "type", label: "类型", type: "select", numeric: true, options: [[0, "消耗品"], [1, "武器"], [2, "防具"], [3, "饰品"], [4, "技能书"], [7, "包裹"], [8, "剧情物品"], [9, "宝石"], [10, "材料"]] },
  { k: "subtype", label: "子类", type: "number" }, { k: "price", label: "价格", type: "number" },
  { k: "reqLevel", label: "需求等级", type: "number" }, { k: "hp", label: "生命+", type: "number" },
  { k: "mp", label: "精力+", type: "number" }, { k: "attack", label: "攻击+", type: "number" },
  { k: "defence", label: "防御+", type: "number" }, { k: "attrA", label: "攻速+", type: "number" },
  { k: "attrB", label: "属性B", type: "number" }, { k: "attrC", label: "属性C", type: "number" },
  { k: "icon", label: "图标", type: "text", img: it => it.icon ? assetSrc("assets/items_icons/" + it.icon.replace(/\.bmp$/, ".png")) : null }, { k: "desc", label: "说明", type: "textarea", rows: 2 },
  { k: "rarity", label: "稀有度", type: "select", options: [["common", "普通"], ["magic", "精良"], ["rare", "稀有"], ["unique", "传说"], ["quest", "任务"]] },
  { k: "stackable", label: "可堆叠", type: "checkbox" },
  { k: "maxStack", label: "最大堆叠", type: "number", def: 0 },
  { k: "socketCount", label: "镶嵌孔数", type: "number", def: 0 },
  { k: "maxDurability", label: "最大耐久", type: "number", def: 0 },
  { k: "gem.mods.atk", label: "宝石·攻击+", type: "number" },
  { k: "gem.mods.def", label: "宝石·防御+", type: "number" },
  { k: "gem.mods.hp", label: "宝石·生命+", type: "number" },
  { k: "gem.mods.hit", label: "宝石·攻速+", type: "number" },
  { k: "fx.aura", label: "特效·装备光环", type: "select" },
  { k: "fx.use", label: "特效·使用时", type: "select" },
];
const SKILL_SCHEMA = [
  { k: "name", label: "名称", type: "text" },
  { k: "type", label: "类型", type: "select", numeric: true, options: [[0, "治疗(自身)"], [1, "攻击"]] },
  { k: "mode", label: "攻击方式", type: "select", options: [["melee", "近战（瞬间命中）"], ["ranged", "远程（预留弹道）"]] },
  { k: "range", label: "射程", type: "number" }, { k: "mp", label: "耗精力", type: "number" },
  { k: "power", label: "威力", type: "number" }, { k: "reqLevel", label: "需求等级", type: "number" },
  { k: "sound", label: "音效", type: "text" }, { k: "icon", label: "图标", type: "text", img: sk => sk.icon ? assetSrc("assets/skill_icons/" + sk.icon.replace(/\.bmp$/, ".png")) : null },
  { k: "frames", label: "特效帧(每行一个)", type: "lines", rows: 5, img: sk => (sk.frames && sk.frames[0]) ? assetSrc("assets/skill/" + sk.frames[0].replace(/\.bmp$/, ".png")) : null },
  { k: "projectile.homing", label: "弹道·追踪目标", type: "checkbox" },
  { k: "projectile.speed", label: "弹道·速度(像素/秒)", type: "number", def: 320 },
  { k: "projectile.radius", label: "弹道·命中半径", type: "number", def: 18 },
  { k: "projectile.pierce", label: "弹道·穿透次数", type: "number", def: 0 },
  { k: "projectile.frames", label: "弹道·飞行帧(每行一个)", type: "lines", rows: 3, img: sk => (sk.projectile && sk.projectile.frames && sk.projectile.frames[0]) ? assetSrc("assets/projectile/" + sk.projectile.frames[0].replace(/\.bmp$/, ".png")) : null },
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
  { k: "id", label: "id", type: "text" },
  { k: "name", label: "名称", type: "text" },
  { k: "icon", label: "图标", type: "text", img: b => b.icon ? assetSrc("assets/buff_icons/" + String(b.icon).replace(/\.bmp$/, ".png")) : null },
  { k: "duration", label: "持续(秒)", type: "number", def: 10 },
  { k: "maxStacks", label: "最大层数", type: "number", min: 1, def: 1 },
  { k: "stackMode", label: "叠层方式", type: "select", options: [["refresh", "刷新时长"], ["stack", "叠加层数"]] },
  { k: "mods.atk", label: "每层·攻击", type: "number", def: 0 },
  { k: "mods.def", label: "每层·防御", type: "number", def: 0 },
  { k: "mods.hpMax", label: "每层·生命上限", type: "number", def: 0 },
  { k: "mods.mpMax", label: "每层·精力上限", type: "number", def: 0 },
  { k: "mods.speed", label: "每层·速度", type: "number", def: 0 },
  { k: "mods.hit", label: "每层·攻速", type: "number", def: 0 },
  { k: "dot.dps", label: "每层·每秒伤害", type: "number", def: 0 },
  { k: "hot.hps", label: "每层·每秒治疗", type: "number", def: 0 },
  { k: "tags", label: "标签(每行一个)", type: "lines", rows: 2 },
  { k: "fx.aura", label: "特效·光环(循环)", type: "select" },
  { k: "fx.onApply", label: "特效·施加时", type: "select" },
  { k: "fx.onExpire", label: "特效·到期时", type: "select" },
  { k: "desc", label: "说明", type: "textarea", rows: 2 },
];

const EFFECT_SCHEMA = [
  { k: "id", label: "id", type: "text" },
  { k: "name", label: "名称", type: "text" },
  { k: "layer", label: "层级(叠放次序)", type: "select", options: [["under", "地面（恒低于单位）"], ["over", "角色层（按 y 排序）"], ["top", "顶层（头顶，恒在上）"]] },
  { k: "anchor", label: "锚点", type: "select", options: [["world", "世界坐标"], ["unit", "单位"], ["item", "物品"]] },
  { k: "frames", label: "帧图(每行一个)", type: "lines", rows: 4, img: e => (e.frames && e.frames[0]) ? assetSrc("assets/fx/" + e.frames[0].replace(/\.bmp$/, ".png")) : null },
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
    () => ({ id: "fx_" + (list.length + 1), name: "新特效", layer: "over", anchor: "world", frames: [], fps: 12, loop: false, holdFirst: 0, holdLast: 0, life: 0, ox: 0, oy: 0, scale: 1, color: "", radius: 18 }));
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
  mainEl.append(h("h3", null, "Buff / Debuff 配置（共 " + list.length + "）"));
  mainEl.append(h("div", { class: "ed-hint" }, "技能通过「命中效果」按 id 引用；叠层/刷新/持续/DOT/HOT 均在引擎 engine/buff.js 中处理。"));
  const host = h("div");
  mainEl.append(host);
  let sel = 0;
  const redraw = () => {
    clear(host);
    host.append(h("div", { class: "ed-tools" },
      h("button", { class: "ed-btn", onclick: () => { const id = prompt("Buff id", "buff_" + (list.length + 1)); if (!id) return; list.push({ id, name: id, duration: 10, maxStacks: 1, stackMode: "refresh", mods: {}, tags: [] }); sel = list.length - 1; mark(); redraw(); } }, "＋ 新建"),
      h("button", { class: "ed-btn", onclick: () => { if (!list[sel]) return; list.splice(sel + 1, 0, deep(list[sel])); sel++; mark(); redraw(); } }, "复制"),
      h("button", { class: "ed-btn danger", onclick: () => { if (!list[sel]) return; list.splice(sel, 1); sel = Math.max(0, sel - 1); mark(); redraw(); } }, "删除"),
    ));
    const tbl = h("table", { class: "ed-table" });
    tbl.append(h("thead", null, h("tr", null, h("th", null, "id"), h("th", null, "名称"), h("th", null, "持续"), h("th", null, "层数"))));
    const body = h("tbody");
    list.forEach((b, i) => {
      const tr = h("tr", { class: i === sel ? "on" : "", onclick: () => { sel = i; redraw(); } });
      tr.append(h("td", null, String(b.id || "")), h("td", null, String(b.name || "")), h("td", null, String(b.duration == null ? "" : b.duration)), h("td", null, String(b.maxStacks == null ? "" : b.maxStacks)));
      body.append(tr);
    });
    tbl.append(body); host.append(tbl);
    if (list[sel]) {
      host.append(h("h3", null, "编辑：" + (list[sel].name || list[sel].id || ("#" + sel))));
      const form = h("div", { class: "ed-grid" });
      host.append(form);
      renderForm(form, withFx(BUFF_SCHEMA), list[sel], () => mark());
    }
  };
  redraw();
}

function tabNpcs() {
  listTab("NPC / 怪物（" + ED.npcs.length + "）", ED.npcs, npcSchema(),
    [{ k: "id", label: "编号" }, { k: "name", label: "名称" }, { k: "model", label: "行走图" }, { k: "level", label: "等级" }, { k: "hp", label: "生命" }],
    () => newNpcTemplate());
}
function tabItems() {
  listTab("物品（" + ED.items.length + "）", ED.items, withFx(ITEM_SCHEMA),
    [{ k: "name", label: "名称" }, { k: "type", label: "类型" }, { k: "price", label: "价格" }, { k: "attack", label: "攻击" }, { k: "defence", label: "防御" }],
    () => ({ name: "新物品", type: 0, subtype: 0, price: 0, reqLevel: 0, hp: 0, mp: 0, attack: 0, defence: 0, attrA: 0, attrB: 0, attrC: 0, icon: "", desc: "" }));
}
function tabSkills() {
  listTab("技能（" + ED.skills.length + "）", ED.skills, withFx(skillSchema()),
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
  for (const sk of ED.skills) {
    if (sk.icon) set.add("assets/skill_icons/" + sk.icon.replace(/\.bmp$/, ".png"));
    for (const f of (sk.frames || [])) set.add("assets/skill/" + String(f).replace(/\.bmp$/, ".png"));
    for (const f of ((sk.projectile && sk.projectile.frames) || [])) set.add("assets/projectile/" + String(f).replace(/\.bmp$/, ".png"));
  }
  for (const b of (ED.buffs || [])) if (b.icon) set.add("assets/buff_icons/" + String(b.icon).replace(/\.bmp$/, ".png"));
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
