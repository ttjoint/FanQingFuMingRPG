// 数据版本（内容包 v2）存储层。
// - “默认版本” = 原版 assets 数据，只读。
// - 编辑器改动保存为“补丁”（patch：只存与基准不同的条目），见 content/contentdb.js 的 diffContent。
// - **图片存 IndexedDB**（见 idb.js）；localStorage 只放补丁与索引。无 IndexedDB 时降级为内联 dataURL。
// - **本地磁盘版本库**：通过 python serve.py 提供的 /__api__/versions 后端，可把版本直接
//   写入 versions/<id>/ 文件夹（仅本地开发时可用）。磁盘版本与浏览器版本共存于同一份索引，
//   由 id 前缀区分（磁盘版本 id 即文件夹名；浏览器版本 id 形如 p<timestamp>）。
import { createPackObj, normalizePack, newPackId } from "./pack.js";
import { idbAvailable, idbSet, idbGet, idbDel } from "./idb.js";
import { packToZip, zipToPack } from "./projectZip.js";
import {
  diskAvailable, listDiskVersions, loadDiskVersion,
  createDiskVersion, saveDiskVersion, deleteDiskVersion, renameDiskVersion,
} from "./diskVersions.js";

const INDEX_KEY = "gsxy.packs.v2";
const PACK_PREFIX = "gsxy.pack.v2.";
export const DEFAULT_VERSION = "__default__";
// 磁盘原版版本的文件夹 id（versions/default）。
const DISK_DEFAULT_ID = "default";
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
  const d = _diskVersions.find(x => x.id === id);
  if (d) return d.name;
  const p = loadIndex().packs.find(x => x.id === id);
  return p ? p.name : "默认版本";
}

// ---- 磁盘版本库（仅本地开发后端可用时）----
let _diskVersions = [];       // [{id,name,builtin,readonly,updatedAt}]
let _diskReady = false;
// 探测磁盘后端并缓存版本列表。返回是否可用。
export async function refreshDiskVersions() {
  if (!(await diskAvailable())) { _diskReady = false; return false; }
  _diskVersions = await listDiskVersions();
  _diskReady = true;
  return true;
}
export function diskVersionsReady() { return _diskReady; }
export function isDiskVersion(id) { return !!_diskVersions.find(x => x.id === id); }
export function isDiskReadonly(id) { const d = _diskVersions.find(x => x.id === id); return !!(d && (d.readonly || d.builtin)); }

// 合并列出（磁盘优先）：供版本管理界面使用。
// - 磁盘后端可用（本地模式）：**只列磁盘版本**，不再混入浏览器版本（本地一律落盘）。
// - 无后端（静态部署）：只列浏览器版本。
// 磁盘上的原版 default 统一以虚拟的 DEFAULT_VERSION 入口呈现。
export async function listAllVersions() {
  const ok = await refreshDiskVersions();
  const out = [];
  if (ok) {
    for (const d of _diskVersions) {
      if (d.id === DISK_DEFAULT_ID) continue;
      out.push({ id: d.id, name: d.name, builtin: !!d.builtin, readonly: !!d.readonly, source: "disk", updatedAt: d.updatedAt || 0 });
    }
    return out;
  }
  for (const p of loadIndex().packs) {
    out.push({ id: p.id, name: p.name, builtin: false, readonly: false, source: "browser", updatedAt: p.updatedAt || 0 });
  }
  return out;
}

export function defaultPack() {
  return { format: "gsxy.pack", version: 2, id: DEFAULT_VERSION, name: "默认版本", base: null, patch: {}, images: {} };
}
// 磁盘默认版本的等价包（也是空补丁，仅元信息不同）。
export function diskDefaultPack() {
  return { format: "gsxy.pack", version: 2, id: DEFAULT_VERSION, name: "默认版本（原版）", base: null, patch: {}, images: {} };
}

const assetKey = (packId, path) => "pack." + packId + ":" + path;

// 保存：
// - 磁盘版本（本地模式后端可用）：补丁 + 图片覆盖**全部直接落盘** versions/<id>/。
// - 浏览器版本（静态部署）：图片写 IndexedDB（键记录在 pack.assets），补丁写 localStorage。异步。
export async function savePack(pack) {
  const p = normalizePack(pack);
  const onDisk = isDiskVersion(p.id) && await diskAvailable();
  if (onDisk) {
    if (isDiskReadonly(p.id)) return { ok: false, error: "该版本为只读（原版），不能修改" };
    // 与磁盘现有覆盖对比，算出新增/变更与需删除的图片。
    const prev = await loadDiskVersion(p.id);
    const prevAssets = new Set((prev && prev.assets) || []);
    const images = {};
    const removedImages = [];
    for (const path in (p.images || {})) {
      // 值可能是 dataURL，也可能是磁盘 URL（来自 loadPack）。
      // 若已经是本版本磁盘上的同一路径，则无需重写。
      const cur = p.images[path];
      if (prevAssets.has(path) && cur === diskAssetURL(p.id, path)) { prevAssets.delete(path); continue; }
      images[path] = await toDataURL(cur);
      prevAssets.delete(path);
    }
    for (const path of prevAssets) removedImages.push(path);
    try {
      await saveDiskVersion(p.id, p.name, p.patch || {}, images, removedImages);
      await refreshDiskVersions();
    } catch (e) {
      return { ok: false, error: String(e.message || e) };
    }
    return { ok: true, disk: true };
  }
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

// 磁盘版本覆盖图片的 URL（逻辑键 -> versions/<id>/assets/...）。
function diskAssetURL(id, logicalKey) {
  const rel = String(logicalKey).startsWith("assets/") ? String(logicalKey).slice("assets/".length) : String(logicalKey);
  return "versions/" + id + "/assets/" + rel;
}

// 读取：磁盘版本从 versions/<id>/ 读补丁 + 图片覆盖（图片以 URL 表示）；
// 浏览器版本从 localStorage/IndexedDB 读。异步。
export async function loadPack(id) {
  if (!id || id === DEFAULT_VERSION) return defaultPack();
  await refreshDiskVersions();
  if (isDiskVersion(id) && await diskAvailable()) {
    const d = await loadDiskVersion(id);
    if (d) {
      const p = normalizePack({ format: "gsxy.pack", version: 2, id: d.id, name: d.name, base: d.base || "default", patch: d.patch || {}, images: {} });
      applyDiskImages(id, d.assets, p);
      return p;
    }
  }
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(PACK_PREFIX + id) || "null"); } catch (e) { }
  // 回退：若本地无记录但磁盘后端可用，仍尝试按 id 直读磁盘版本。
  if (!stored && await diskAvailable()) {
    const d = await loadDiskVersion(id);
    if (d) {
      const p = normalizePack({ format: "gsxy.pack", version: 2, id: d.id, name: d.name, base: d.base || "default", patch: d.patch || {}, images: {} });
      applyDiskImages(id, d.assets, p);
      return p;
    }
  }
  if (!stored) return null;
  const p = normalizePack(stored);
  await loadImagesFor(id, p);
  return p;
}

// 把磁盘版本的覆盖图片映射为逻辑键 -> URL（供 assetURL 覆盖表使用）。
function applyDiskImages(id, assets, p) {
  const images = { ...(p.images || {}) };
  for (const logical of (assets || [])) images[logical] = diskAssetURL(id, logical);
  p.images = images;
}

// 从 localStorage/IndexedDB 取出某版本（浏览器版本）的图片覆盖，写入 pack.images。
async function loadImagesFor(id, p) {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(PACK_PREFIX + id) || "null"); } catch (e) { }
  const images = { ...(p.images || {}) };
  if (stored) {
    Object.assign(images, stored.images || {});
    for (const path in (stored.assets || {})) {
      const v = await idbGet(stored.assets[path]);
      if (v != null) images[path] = v;
    }
  }
  p.images = images;
}

export async function deletePack(id) {
  await refreshDiskVersions();
  if (isDiskVersion(id)) {
    if (isDiskReadonly(id)) return { ok: false, error: "该版本为只读（原版），不能删除" };
    try { await deleteDiskVersion(id); await refreshDiskVersions(); } catch (e) { return { ok: false, error: String(e.message || e) }; }
    { const idx0 = loadIndex(); if (idx0.active === id) { idx0.active = DEFAULT_VERSION; saveIndex(idx0); } }
    return { ok: true, disk: true };
  }
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

// 生成磁盘版本 id（ASCII、字母数字/短横线，避免重复）。
// 中文等名称会被安全地转为 p-<时间戳> 形式的 id（名称本身仍保存在 version.json 的 name 里）。
export function newDiskId(name) {
  const ascii = String(name || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const slug = ascii || "p";
  return slug + "-" + Date.now().toString(36);
}

// 在磁盘上新建一个版本（从 base 拷贝补丁与图片覆盖）。仅后端可用时有效。
export async function createDiskPack(name, patch, base, images) {
  if (!(await diskAvailable())) throw new Error("未检测到本地版本库后端（请用 python serve.py 启动）");
  const id = newDiskId(name);
  await createDiskVersion(id, name, patch || {}, base || DISK_DEFAULT_ID);
  if (images && Object.keys(images).length) {
    // 复制图片覆盖：源可能是磁盘 URL/相对路径，需 fetch 回 dataURL 再写入新版本目录。
    const dataURLs = {};
    for (const k in images) dataURLs[k] = await toDataURL(images[k]);
    await saveDiskVersion(id, name, patch || {}, dataURLs, []);
  }
  await refreshDiskVersions();
  return { format: "gsxy.pack", version: 2, id, name, base: base || DISK_DEFAULT_ID, patch: patch || {}, images: {} };
}

// 把任意图片引用（dataURL / 相对路径 / URL）转成 dataURL，便于写入磁盘。
async function toDataURL(src) {
  const s = String(src || "");
  if (s.startsWith("data:")) return s;
  const r = await fetch(s);
  const blob = await r.blob();
  return await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

// 重命名版本（磁盘走文件，浏览器走索引）。
export async function renameVersion(id, name) {
  await refreshDiskVersions();
  if (isDiskVersion(id)) {
    if (isDiskReadonly(id)) return { ok: false, error: "该版本为只读（原版），不能重命名" };
    try { await renameDiskVersion(id, name); await refreshDiskVersions(); return { ok: true, disk: true }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  }
  const idx = loadIndex();
  const e = idx.packs.find(x => x.id === id);
  if (e) { e.name = name; e.updatedAt = Date.now(); saveIndex(idx); }
  return { ok: true };
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
// 导出为可移植 JSON（内联图片，去掉 IDB 键）。磁盘版本的图片是相对 URL，先取回为 dataURL。
export async function exportPack(pack) {
  const images = await resolveImages(pack.images);
  downloadJSON((pack.name || "pack") + ".gsxy.json", {
    format: pack.format, version: pack.version, id: pack.id, name: pack.name, base: pack.base,
    patch: pack.patch || {}, images,
  });
}
// 导出为**项目 zip**（project.json + images/）。
export async function exportProjectZip(pack) {
  const p = { ...pack, images: await resolveImages(pack.images) };
  downloadBlob((pack.name || "project") + ".gsxy.zip", new Blob([packToZip(p)], { type: "application/zip" }));
}

// 把图片表中的相对路径/URL 统一转成 dataURL（导出/写盘用）。
async function resolveImages(images) {
  const out = {};
  for (const k in (images || {})) out[k] = await toDataURL(images[k]);
  return out;
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
