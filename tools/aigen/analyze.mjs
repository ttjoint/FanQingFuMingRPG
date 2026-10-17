// 像素画质量分析：客观判断「AI 出图是否是真正的像素画」，以及抠底/裁剪是否合理。
// 真像素画的两个硬指标：
//   1) 调色板很小（整图通常 ≤ 64 色，大图也 ≤ 数百色）
//   2) 存在明确像素网格（相邻像素大量相同 → 有「块」），而非逐像素噪点
import { decodePNG, resize, px, trimBox, detectBackground } from "./png.mjs";

/** 统计整图与缩放后的唯一色数。 */
export function paletteStats(img, size) {
  const uniq = (im) => {
    const s = new Set();
    for (let i = 0; i < im.data.length; i += 4) s.add((im.data[i] << 16) | (im.data[i + 1] << 8) | im.data[i + 2]);
    return s.size;
  };
  const out = { full: uniq(img) };
  if (size) out["at" + size] = uniq(resize(img, size, size));
  return out;
}

/**
 * 像素网格强度：把图按 block×block 切块，统计「块内颜色一致」的比例。
 * 真像素画在正确的 block 大小下应接近 1.0；AI 伪像素风通常 < 0.5。
 */
export function gridScore(img, block) {
  const b = block || 4;
  let same = 0, total = 0;
  for (let y = 0; y + b <= img.height; y += b) {
    for (let x = 0; x + b <= img.width; x += b) {
      const [r, g, bl] = px(img, x, y);
      let ok = true;
      for (let dy = 0; dy < b && ok; dy++) {
        for (let dx = 0; dx < b; dx++) {
          const [r2, g2, b2] = px(img, x + dx, y + dy);
          if (Math.abs(r2 - r) + Math.abs(g2 - g) + Math.abs(b2 - bl) > 12) { ok = false; break; }
        }
      }
      total++; if (ok) same++;
    }
  }
  return total ? same / total : 0;
}

/** 推断最可能的像素块大小（取 gridScore 最高的 block）。 */
export function inferBlock(img, maxBlock) {
  const mb = maxBlock || 16;
  let best = { block: 1, score: 0 };
  for (let b = 2; b <= mb; b += 2) {
    const s = gridScore(img, b);
    if (s > best.score) best = { block: b, score: s };
  }
  return best;
}

/** 边缘清晰度：统计相邻像素差值的分布，值越大越「噪」。 */
export function noiseLevel(img) {
  let sum = 0, n = 0;
  for (let y = 0; y < img.height; y += 2) {
    for (let x = 0; x + 1 < img.width; x += 2) {
      const a = (y * img.width + x) * 4, b = a + 4;
      sum += Math.abs(img.data[a] - img.data[b]) + Math.abs(img.data[a + 1] - img.data[b + 1]) + Math.abs(img.data[a + 2] - img.data[b + 2]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

/**
 * 抠底安全性检查：用色键抠透明后，前景里还有多少「与背景色接近」的像素被误删。
 * 做法：统计抠图前后不透明像素数的落差，以及原图中「与背景近色但不连通边缘」的像素
 * （这些就是会被误删的白发/白袍）。
 */
export function keyingRisk(img, key, tol) {
  const k = key || detectBackground(img);
  const t = tol == null ? 26 : tol;
  let near = 0, opaque = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 8) continue;
    opaque++;
    const d = Math.abs(img.data[i] - k[0]) + Math.abs(img.data[i + 1] - k[1]) + Math.abs(img.data[i + 2] - k[2]);
    if (d <= t * 3) near++;
  }
  return { bg: k, nearColorRatio: opaque ? near / opaque : 0 };
}

/** 检测「画面里是不是有多个主体」（连通域数量，粗略）。 */
export function blobCount(img, key, tol) {
  const k = key || detectBackground(img);
  const t = tol == null ? 26 : tol;
  const w = img.width, h = img.height;
  const seen = new Uint8Array(w * h);
  const isFg = (x, y) => {
    const i = (y * w + x) * 4;
    if (img.data[i + 3] < 32) return false;
    return Math.abs(img.data[i] - k[0]) + Math.abs(img.data[i + 1] - k[1]) + Math.abs(img.data[i + 2] - k[2]) > t;
  };
  const sizes = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !isFg(x, y)) continue;
      let n = 0;
      const stack = [[x, y]];
      seen[y * w + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop(); n++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (seen[ny * w + nx] || !isFg(nx, ny)) continue;
          seen[ny * w + nx] = 1; stack.push([nx, ny]);
        }
      }
      if (n > w * h * 0.002) sizes.push(n);
    }
  }
  sizes.sort((a, b) => b - a);
  return { blobs: sizes.length, largestRatio: sizes.length ? sizes[0] / (w * h) : 0, sizes: sizes.slice(0, 5) };
}

/** 综合评估。 */
export function analyze(img, opts) {
  const o = opts || {};
  const bg = detectBackground(img);
  const box = trimBox(img, bg, o.tol == null ? 26 : o.tol, 1);
  const pal = paletteStats(img, 32);
  const block = inferBlock(img, 16);
  // bbox 内部的前景填充率：前景像素数 / bbox 面积。低值 = 稀疏碎点。
  const tol = o.tol == null ? 26 : o.tol;
  let fgPx = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const i = (y * img.width + x) * 4;
      if (img.data[i + 3] < 32) continue;
      if (Math.abs(img.data[i] - bg[0]) + Math.abs(img.data[i + 1] - bg[1]) + Math.abs(img.data[i + 2] - bg[2]) > tol) fgPx++;
    }
  }
  const bboxFill = +(fgPx / Math.max(1, box.w * box.h)).toFixed(3);
  return {
    size: [img.width, img.height],
    palette: pal,
    grid: { block: block.block, score: +block.score.toFixed(3) },
    noise: +noiseLevel(img).toFixed(1),
    bbox: box,
    fill: +(box.w * box.h / (img.width * img.height)).toFixed(3),
    bboxFill,
    aspect: +(box.w / box.h).toFixed(2),
    ...keyingRisk(img, bg, o.tol),
    ...blobCount(img, bg, o.tol),
    verdict: verdictOf({ pal, block }),
  };
}

function verdictOf(d) {
  const c32 = d.pal["at32"] || 0;
  if (c32 <= 80 && d.block.score > 0.5) return "真像素画（可直接缩放）";
  if (c32 <= 200) return "伪像素/风格化（需量化后再缩小）";
  return "非像素画（细节过多，缩小会糊）";
}

export { decodePNG };
