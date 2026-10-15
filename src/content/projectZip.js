// 内容包 ⇄ zip（项目文件）。**零依赖**的最小 ZIP 实现（仅 store 模式，不压缩），
// 便于纯静态浏览器直接加载（避免裸模块名），也可在 Node 中单测。
// 结构：project.json（补丁+元数据）+ images/<路径>（二进制）。
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64ToU8 = b64 => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const u8ToB64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); };

let CRC_TABLE = null;
function crc32(u8) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const b = {
  u16: n => [n & 0xff, (n >> 8) & 0xff],
  u32: n => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff],
};

function zipStore(files) {
  const chunks = []; let offset = 0;
  const central = [];
  for (const name of Object.keys(files)) {
    const data = files[name], nameB = enc.encode(name), crc = crc32(data);
    const lh = Uint8Array.from([].concat([0x50, 0x4b, 0x03, 0x04], b.u16(20), b.u16(0), b.u16(0), b.u16(0), b.u16(0), b.u32(crc), b.u32(data.length), b.u32(data.length), b.u16(nameB.length), b.u16(0)));
    chunks.push(lh, nameB, data);
    central.push({ nameB, crc, size: data.length, off: offset });
    offset += lh.length + nameB.length + data.length;
  }
  const cdStart = offset; let cdSize = 0;
  for (const c of central) {
    const h = Uint8Array.from([].concat([0x50, 0x4b, 0x01, 0x02], b.u16(20), b.u16(20), b.u16(0), b.u16(0), b.u16(0), b.u16(0), b.u32(c.crc), b.u32(c.size), b.u32(c.size), b.u16(c.nameB.length), b.u16(0), b.u16(0), b.u16(0), b.u16(0), b.u32(0), b.u32(c.off)));
    chunks.push(h, c.nameB); cdSize += h.length + c.nameB.length;
  }
  const end = Uint8Array.from([].concat([0x50, 0x4b, 0x05, 0x06], b.u16(0), b.u16(0), b.u16(central.length), b.u16(central.length), b.u32(cdSize), b.u32(cdStart), b.u16(0)));
  chunks.push(end);
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function unzipStore(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65536; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("不是有效的 zip");
  const count = dv.getUint16(eocd + 10, true), cdOff = dv.getUint32(eocd + 16, true);
  const files = {}; let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("zip 中央目录损坏");
    const method = dv.getUint16(p + 10, true), compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), cmtLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error("仅支持 store 模式的 zip");
    const lNameLen = dv.getUint16(localOff + 26, true), lExtra = dv.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtra;
    files[name] = u8.slice(dataStart, dataStart + compSize);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

export function packToZip(pack) {
  const files = {}, imageTypes = {};
  for (const path in (pack.images || {})) {
    const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(pack.images[path] || "");
    if (!m) continue;
    imageTypes[path] = m[1];
    files["images/" + path] = b64ToU8(m[2]);
  }
  files["project.json"] = enc.encode(JSON.stringify({
    format: pack.format, version: pack.version, name: pack.name, base: pack.base,
    patch: pack.patch || {}, imageTypes,
  }, null, 1));
  return zipStore(files);
}

export function zipToPack(bytes) {
  const files = unzipStore(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const proj = JSON.parse(dec.decode(files["project.json"]));
  const images = {};
  for (const k in files) if (k.startsWith("images/")) {
    const path = k.slice(7);
    const mime = (proj.imageTypes && proj.imageTypes[path]) || "image/png";
    images[path] = "data:" + mime + ";base64," + u8ToB64(files[k]);
  }
  return { format: proj.format, version: proj.version, id: proj.id, name: proj.name, base: proj.base, patch: proj.patch || {}, images };
}
