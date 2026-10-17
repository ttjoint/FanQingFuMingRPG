// 零依赖 PNG 编解码 + 像素后处理（用于把 AI 大图处理成游戏内小图标）。
// 支持：8bit RGB / RGBA / 灰度（非隔行），足够覆盖 ComfyUI 的输出。
// 操作：裁边（去四周纯色边）、最近邻缩放、按色键抠透明、色调量化、输出 PNG。
import { deflateSync, inflateSync, crc32 } from "node:zlib";

// ---------- 解码 ----------
export function decodePNG(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let off = 8, w = 0, h = 0, bitDepth = 8, colorType = 6, interlace = 0;
  const idat = [];
  let palette = null, trns = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") trns = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error("仅支持 8bit PNG（当前 " + bitDepth + "）");
  if (interlace) throw new Error("不支持隔行 PNG");
  const raw = inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 4 ? 2 : 0;
  if (colorType === 3) throw new Error("暂不支持调色板 PNG");
  if (!channels) throw new Error("不支持的 colorType " + colorType);
  const stride = w * channels;
  const out = Buffer.alloc(stride * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      cur[x] = v;
    }
  }
  // 统一成 RGBA
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += channels) {
    const R = out[j], G = channels > 1 ? out[j + 1] : out[j], B = channels > 1 ? out[j + 2] : out[j];
    const A = channels === 4 || channels === 2 ? out[j + channels - 1] : 255;
    rgba[i * 4] = R; rgba[i * 4 + 1] = G; rgba[i * 4 + 2] = B; rgba[i * 4 + 3] = A;
  }
  return { width: w, height: h, data: rgba };
}

// ---------- 编码 ----------
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

export function encodePNG(img) {
  const { width: w, height: h, data } = img;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                                  // filter: none
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- 像素操作 ----------
/** 取像素 [r,g,b,a]。 */
export function px(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

/** 中心区域裁剪。 */
export function crop(img, x0, y0, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= img.height) continue;
    const sx0 = Math.max(0, x0);
    const copyW = Math.min(w, img.width - sx0);
    if (copyW <= 0) continue;
    img.data.copy(out, (y * w + (sx0 - x0)) * 4, (sy * img.width + sx0) * 4, (sy * img.width + sx0 + copyW) * 4);
  }
  return { width: w, height: h, data: out };
}

/** 裁成正方形（取中心，边长 = min(w,h) * ratio）。 */
export function centerSquare(img, ratio) {
  const s = Math.round(Math.min(img.width, img.height) * (ratio || 1));
  const x0 = Math.floor((img.width - s) / 2), y0 = Math.floor((img.height - s) / 2);
  return crop(img, x0, y0, s, s);
}

/** 最近邻缩放（保持像素风锐利）。 */
export function resize(img, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y + 0.5) * img.height / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x + 0.5) * img.width / w));
      const si = (sy * img.width + sx) * 4, di = (y * w + x) * 4;
      out[di] = img.data[si]; out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2]; out[di + 3] = img.data[si + 3];
    }
  }
  return { width: w, height: h, data: out };
}

/** 按色键抠透明：与参考色距离 ≤ tol 的像素变全透明。threshold 支持"边缘半透明"柔化。 */
export function chromaKey(img, key, tol, soften) {
  const k = key || [255, 255, 255];
  const t = tol == null ? 26 : tol;
  const st = soften == null ? 12 : soften;
  const out = Buffer.from(img.data);
  for (let i = 0; i < out.length; i += 4) {
    const dr = out[i] - k[0], dg = out[i + 1] - k[1], db = out[i + 2] - k[2];
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    if (d <= t) out[i + 3] = 0;
    else if (d <= t + st) out[i + 3] = Math.round(out[i + 3] * (d - t) / st);
  }
  return { width: img.width, height: img.height, data: out };
}

/** 自动找出「背景色」：取四角像素的众数。 */
export function detectBackground(img) {
  const cs = [px(img, 0, 0), px(img, img.width - 1, 0), px(img, 0, img.height - 1), px(img, img.width - 1, img.height - 1)];
  // 分组取出现最多的
  let best = cs[0], bestN = 0;
  for (const c of cs) {
    let n = 0;
    for (const d of cs) if (Math.abs(c[0] - d[0]) + Math.abs(c[1] - d[1]) + Math.abs(c[2] - d[2]) < 30) n++;
    if (n > bestN) { bestN = n; best = c; }
  }
  return [best[0], best[1], best[2]];
}

/** 裁掉四周透明（或与背景近色）的边，返回紧致包围盒，可选 padding。 */
export function trimBox(img, bg, tol, padding) {
  const t = tol == null ? 26 : tol, pad = padding || 0;
  let minX = img.width, minY = img.height, maxX = -1, maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b, a] = px(img, x, y);
      if (a < 8) continue;
      if (bg) {
        const d = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
        if (d <= t) continue;
      }
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: img.width, h: img.height };
  return {
    x: Math.max(0, minX - pad), y: Math.max(0, minY - pad),
    w: Math.min(img.width, maxX + 1 + pad) - Math.max(0, minX - pad),
    h: Math.min(img.height, maxY + 1 + pad) - Math.max(0, minY - pad),
  };
}

/** 把任意尺寸图放进 size×size 画布（等比缩放 + 居中，最近邻）。 */
export function fitCentered(img, size, bg) {
  const s = Math.min(size / img.width, size / img.height);
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const scaled = resize(img, w, h);
  const out = Buffer.alloc(size * size * 4);
  if (bg) for (let i = 0; i < size * size; i++) { out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = 255; }
  const ox = Math.floor((size - w) / 2), oy = Math.floor((size - h) / 2);
  for (let y = 0; y < h; y++) {
    const dy = oy + y; if (dy < 0 || dy >= size) continue;
    scaled.data.copy(out, (dy * size + ox) * 4, y * w * 4, (y + 1) * w * 4);
  }
  return { width: size, height: size, data: out };
}

/**
 * 一步处理成游戏图标：
 *   裁中心方 → 去背景 → 紧致裁剪 → 等比放进 size×size（居中）
 * @param {{img:any, size:number, key?:number[]|null, tol?:number, ratio?:number, padding?:number, keepBg?:boolean}} o
 */
export function toIcon(o) {
  let img = centerSquare(o.img, o.ratio);
  let bg = o.key || detectBackground(img);
  if (!o.keepBg) img = chromaKey(img, bg, o.tol);
  const box = trimBox(img, o.keepBg ? null : bg, o.tol, o.padding == null ? 1 : o.padding);
  const cut = crop(img, box.x, box.y, box.w, box.h);
  return fitCentered(cut, o.size, o.keepBg ? bg : null);
}
