// 数据版本（内容包 v2）存储层。
// - “默认版本” = 原版 assets 数据，只读。
// - 编辑器改动保存为“补丁”（patch：只存与基准不同的条目），见 content/contentdb.js 的 diffContent。
// - **图片存 IndexedDB**（见 idb.js）；localStorage 只放补丁与索引。无 IndexedDB 时降级为内联 dataURL。
import { createPackObj, normalizePack, newPackId } from "./pack.js";
import { idbAvailable, idbSet, idbGet, idbDel } from "./idb.js";
import { packToZip, zipToPack } from "./projectZip.js";

const INDEX_KEY = "gsxy.packs.v2";
const PACK_PREFIX = "gsxy.pack.v2.";
export const DEFAULT_VERSION = "__default__";
export { newPackId };

export function isLocalMode() {
  try {
    const p = location.protocol, hn = location.hostname;
    if (p === "file:") return true;
    return hn === "localhost" || hn === "127.0.0.1" || hn === "::1" || hn === "[::1]" || hn.endsWith(".local");
  } catch (e) { return true; }
}
export function isEditorAvailable() {
  try { return isLocalMode() || new URLSearchParams(location.search).has("editor"); }
  catch (e) { return isLocalMode(); }
}

export function loadIndex() {
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || "null") || { active: DEFAULT_VERSION, packs: [] }; }
  catch (e) { return { active: DEFAULT_VERSION, packs: [] }; }
}
function saveIndex(idx) { try { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); } catch (e) { } }

export function listVersions() { return loadIndex().packs; }
export function activeId() { return loadIndex().active || DEFAULT_VERSION; }
export function setActive(id) { const idx = loadIndex(); idx.active = id || DEFAULT_VERSION; saveIndex(idx); }
export function versionName(id) {
  if (!id || id === DEFAULT_VERSION) return "默认版本";
  const p = loadIndex().packs.find(x => x.id === id);
  return p ? p.name : "默认版本";
}

export function defaultPack() {
  return { format: "gsxy.pack", version: 2, id: DEFAULT_VERSION, name: "默认版本", base: null, patch: {}, images: {} };
}

const assetKey = (packId, path) => "pack." + packId + ":" + path;

// 保存：图片写 IndexedDB（键记录在 pack.assets），补丁写 localStorage。异步。
export async function savePack(pack) {
  const p = normalizePack(pack);
  const images = { ...(p.images || {}) };
  const prev = (() => { try { return JSON.parse(localStorage.getItem(PACK_PREFIX + p.id) || "null"); } catch (e) { return null; } })();
  const prevAssets = (prev && prev.assets) || {};
  const assets = {};
  let inline = null;
  if (Object.keys(images).length && await idbAvailable()) {
    for (const path in images) {
      const key = assetKey(p.id, path);
      if (await idbSet(key, images[path])) assets[path] = key; else (inline || (inline = {}))[path] = images[path];
    }
    // 清理已移除图片的旧键
    for (const path in prevAssets) if (!assets[path]) idbDel(prevAssets[path]);
  } else {
    inline = images;   // 无 IndexedDB：内联保存
  }
  const stored = { format: p.format, version: p.version, id: p.id, name: p.name, base: p.base, patch: p.patch, updatedAt: p.updatedAt || Date.now(), assets };
  if (inline && Object.keys(inline).length) stored.images = inline;
  try {
    localStorage.setItem(PACK_PREFIX + p.id, JSON.stringify(stored));
    const idx = loadIndex();
    const meta = { id: p.id, name: p.name, updatedAt: stored.updatedAt };
    const e = idx.packs.find(x => x.id === p.id);
    if (e) Object.assign(e, meta); else idx.packs.push(meta);
    saveIndex(idx);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.name === "QuotaExceededError" ? "本地存储空间不足，请导出后删除部分版本" : e) };
  }
}

// 读取：补丁 + 从 IndexedDB 取回图片（或内联）。异步。
export async function loadPack(id) {
  if (!id || id === DEFAULT_VERSION) return defaultPack();
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(PACK_PREFIX + id) || "null"); } catch (e) { }
  if (!stored) return null;
  const p = normalizePack(stored);
  const images = { ...(p.images || {}) };
  for (const path in (stored.assets || {})) {
    const v = await idbGet(stored.assets[path]);
    if (v != null) images[path] = v;
  }
  p.images = images;
  return p;
}

export async function deletePack(id) {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(PACK_PREFIX + id) || "null"); } catch (e) { }
  if (stored && stored.assets) for (const path in stored.assets) await idbDel(stored.assets[path]);
  try { localStorage.removeItem(PACK_PREFIX + id); } catch (e) { }
  const idx = loadIndex();
  idx.packs = idx.packs.filter(p => p.id !== id);
  if (idx.active === id) idx.active = DEFAULT_VERSION;
  saveIndex(idx);
}

export async function createPack(name, patch, images) {
  const pack = createPackObj(name, patch, images);
  await savePack(pack);
  return pack;
}

// ---- 导入 / 导出 ----
export function downloadBlob(name, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function downloadJSON(name, obj) {
  downloadBlob(name, new Blob([JSON.stringify(obj, null, 1)], { type: "application/json" }));
}
// 导出为可移植 JSON（内联图片，去掉 IDB 键）。
export function exportPack(pack) {
  downloadJSON((pack.name || "pack") + ".gsxy.json", {
    format: pack.format, version: pack.version, id: pack.id, name: pack.name, base: pack.base,
    patch: pack.patch || {}, images: pack.images || {},
  });
}
// 导出为**项目 zip**（project.json + images/）。
export function exportProjectZip(pack) {
  downloadBlob((pack.name || "project") + ".gsxy.zip", new Blob([packToZip(pack)], { type: "application/zip" }));
}

export async function importPack(obj) {
  const p = normalizePack(obj);
  p.id = newPackId();               // 避免与本地已有版本冲突
  const r = await savePack(p);
  if (!r.ok) throw new Error(r.error || "保存失败");
  return p;
}

export function pickJSON(cb) {
  const input = document.createElement("input");
  input.type = "file"; input.accept = ".json,application/json";
  input.onchange = () => {
    const f = input.files && input.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { cb(JSON.parse(/** @type {string} */ (r.result))); } catch (e) { alert("JSON 解析失败：" + e); } };
    r.readAsText(f);
  };
  input.click();
}

// 选 zip 项目文件 -> 内容包对象
export function pickZip(cb) {
  const input = document.createElement("input");
  input.type = "file"; input.accept = ".zip,application/zip";
  input.onchange = async () => {
    const f = input.files && input.files[0]; if (!f) return;
    try { cb(zipToPack(new Uint8Array(await f.arrayBuffer()))); }
    catch (e) { alert("zip 解析失败：" + e); }
  };
  input.click();
}

export function readImageFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}
