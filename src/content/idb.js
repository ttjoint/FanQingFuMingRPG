// 极简 IndexedDB 封装（用于内容包图片，避免 localStorage 配额）。无 IDB 环境下安全降级。
const DB = "gsxy-assets", STORE = "assets";
let _db = null;

function open() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (_db) return Promise.resolve(_db);
  return new Promise(res => {
    let r;
    try { r = indexedDB.open(DB, 1); } catch (e) { return res(null); }
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
    r.onsuccess = () => { _db = r.result; res(_db); };
    r.onerror = () => res(null);
    r.onblocked = () => res(null);
  });
}

export async function idbAvailable() { return !!(await open()); }

export async function idbSet(key, val) {
  const db = await open(); if (!db) return false;
  return new Promise(res => {
    try { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(val, key); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }
    catch (e) { res(false); }
  });
}

export async function idbGet(key) {
  const db = await open(); if (!db) return null;
  return new Promise(res => {
    try { const tx = db.transaction(STORE, "readonly"); const q = tx.objectStore(STORE).get(key); q.onsuccess = () => res(q.result == null ? null : q.result); q.onerror = () => res(null); }
    catch (e) { res(null); }
  });
}

export async function idbDel(key) {
  const db = await open(); if (!db) return false;
  return new Promise(res => {
    try { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(key); tx.oncomplete = () => res(true); tx.onerror = () => res(false); }
    catch (e) { res(false); }
  });
}
