// 版本库的“本地磁盘后端”客户端。
//
// 仅当通过 python serve.py（本地开发服务器）运行时，/__api__/versions 才可用；
// 该后端让编辑器把版本**直接写入 versions/<id>/ 文件夹**。
// 静态部署（无后端）时 available() 返回 false，调用方自动退化为纯浏览器存储。
//
// 与 store.js 的浏览器内存/IndexedDB 存储解耦：这里只负责磁盘版本，
// 保存/读取格式与「内容包」（gsxy.pack v2）保持一致，便于互通。

const BASE = "/__api__/versions";
let _available = null;   // 三态：null 未检测 / true / false

// 探测后端是否可用（并缓存）。失败不抛异常。
export async function diskAvailable() {
  if (_available !== null) return _available;
  try {
    const r = await fetch(BASE, { method: "GET" });
    if (!r.ok) { _available = false; return false; }
    const j = await r.json();
    _available = !!(j && j.ok && j.available);
  } catch (e) {
    _available = false;
  }
  return _available;
}

async function req(method, path, body) {
  const opt = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(BASE + path, opt);
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok || !j || j.ok === false) throw new Error((j && j.error) || ("HTTP " + r.status));
  return j;
}

// 列出磁盘版本（默认版本也在内，标记 builtin/readonly）。
export async function listDiskVersions() {
  if (!(await diskAvailable())) return [];
  try { return (await req("GET", "")).versions || []; } catch (e) { return []; }
}

// 读取一个磁盘版本（含 patch）。
export async function loadDiskVersion(id) {
  if (!(await diskAvailable())) return null;
  try { return (await req("GET", "/" + encodeURIComponent(id))).version || null; } catch (e) { return null; }
}

export async function createDiskVersion(id, name, patch, base) {
  return (await req("POST", "", { id, name, patch: patch || {}, base: base || "default" })).version;
}

export async function saveDiskVersion(id, name, patch, images, removedImages) {
  const body = { name, patch };
  if (images && Object.keys(images).length) body.images = images;
  if (removedImages && removedImages.length) body.removedImages = removedImages;
  return (await req("PUT", "/" + encodeURIComponent(id), body)).version;
}

export async function deleteDiskVersion(id) {
  return req("DELETE", "/" + encodeURIComponent(id));
}

export async function renameDiskVersion(id, name) {
  return (await req("POST", "/" + encodeURIComponent(id) + "/rename", { name })).version;
}
