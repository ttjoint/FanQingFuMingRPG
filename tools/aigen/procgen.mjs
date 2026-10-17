// 程序化像素图标生成器（形状 100% 可控）。
//
// 存在理由：AI（单 checkpoint 无 ControlNet）无法按指定轮廓出图，实测 8 seed 0 命中铁剑。
// 而 32×32 图标本身信息量很小，用线段/多边形绘制 + 有限调色板 + 描边，效果稳定且可复现。
//
// 用法：node tools/aigen/procgen.mjs  → 输出 _aigen/proc/*.png + 放大对照图
import { encodePNG } from "./png.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 建一张 ≤size×size 的透明画布。 */
function canvas(size) {
  const data = Buffer.alloc(size * size * 4, 0);
  const put = (x, y, [r, g, b], a = 255) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  };
  const get = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return [0, 0, 0, 0];
    const i = (y * size + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };
  const img = { width: size, height: size, data, put, get };
  return img;
}

/** 粗线段（Bresenham + 方笔）。
 * 注意：必须先取整。传入浮点坐标时 x===x1 永远不成立，会进入无限循环。
 * w<=0 时直接返回（不做任何绘制）。
 */
function line(c, x0, y0, x1, y1, color, w = 1) {
  if (w <= 0) return;
  x0 = Math.round(x0); y0 = Math.round(y0);
  x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  const half = Math.floor((w - 1) / 2);
  for (;;) {
    for (let oy = -half; oy <= w - 1 - half; oy++)
      for (let ox = -half; ox <= w - 1 - half; ox++)
        c.put(x + ox, y + oy, color);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}

/** 实心多边形（扫描线）。 */
function poly(c, pts, color) {
  let minY = Infinity, maxY = -Infinity;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2)
      for (let x = Math.ceil(xs[i]); x <= Math.floor(xs[i + 1]); x++) c.put(x, y, color);
  }
}

/** 圆盘。 */
function disc(c, cx, cy, r, color) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) c.put(x, y, color);
}

/** 给所有不透明像素描一圈深色边（像素图标的关键，也保证抠底不渗）。 */
function outline(c, color = [20, 16, 24]) {
  const add = [];
  for (let y = 0; y < c.width; y++) {
    for (let x = 0; x < c.width; x++) {
      if (c.get(x, y)[3] > 0) continue;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => c.get(x + dx, y + dy)[3] > 0);
      if (nb) add.push([x, y]);
    }
  }
  for (const [x, y] of add) c.put(x, y, color);
}

// ── 调色板（中式冷兵器，参考项目现有美术） ──
const P = {
  steel: [176, 188, 202], steelD: [116, 130, 148], steelL: [226, 234, 240],
  iron: [92, 96, 108], ironD: [58, 60, 72],
  wood: [124, 82, 48], woodD: [86, 54, 30], woodL: [164, 116, 70],
  gold: [214, 172, 74], goldD: [156, 118, 42],
  jade: [108, 190, 148], jadeD: [62, 138, 104], jadeL: [170, 226, 194],
  red: [196, 58, 58], redD: [132, 32, 36],
  paper: [226, 214, 184], paperD: [176, 160, 128],
  dark: [20, 16, 24],
};

/** 铁剑：竖直剑身 + 横护手 + 柄。 */
function ironSword(size) {
  const c = canvas(size), s = size / 32;
  const cx = 16 * s;
  // 剑身（上尖下宽）
  poly(c, [[cx - 1.6 * s, 6 * s], [cx + 1.6 * s, 6 * s], [cx + 2.2 * s, 20 * s], [cx - 2.2 * s, 20 * s]], P.steel);
  poly(c, [[cx, 5 * s], [cx + 1.6 * s, 7 * s], [cx - 1.6 * s, 7 * s]], P.steel);
  // 血槽（高光）
  line(c, cx - 0.4 * s, 8 * s, cx - 0.4 * s, 19 * s, P.steelL, Math.max(1, s));
  line(c, cx + 1.4 * s, 9 * s, cx + 1.4 * s, 19 * s, P.steelD, Math.max(1, s));
  // 护手
  line(c, cx - 6 * s, 21 * s, cx + 6 * s, 21 * s, P.gold, Math.max(1, 2 * s));
  line(c, cx - 6 * s, 22.5 * s, cx + 6 * s, 22.5 * s, P.goldD, Math.max(1, s));
  // 柄
  poly(c, [[cx - 1.6 * s, 23 * s], [cx + 1.6 * s, 23 * s], [cx + 1.6 * s, 27 * s], [cx - 1.6 * s, 27 * s]], P.wood);
  for (let i = 0; i < 3; i++) line(c, cx - 1.6 * s, (24 + i * 1.2) * s, cx + 1.6 * s, (24 + i * 1.2) * s, P.woodD, Math.max(1, s));
  // 剑首
  disc(c, cx, 28 * s, 1.8 * s, P.gold);
  outline(c);
  return c;
}

/** 长枪：长木杆 + 叶形枪头 + 红缨。 */
function spear(size) {
  // 关键洞察（经视觉模型 A/B 对比得出）：
  // 32×32 内竖直物品受高度限制，斜置能拿到对角线长度（≈1.41 倍），
  // 「长杆」的比例才成立。手绘乌木剑正是斜置，因此被模型判为「最像枪」。
  // 之前竖直版本反复被判为「匕首」，加长枪头也没用——方向错了。
  const c = canvas(size), s = size / 32;
  // 杆：从左下 (4,30) 斜向右上 (20,7)，贯穿对角线
  const x0 = 4 * s, y0 = 30 * s, x1 = 20 * s, y1 = 7 * s;
  line(c, x0, y0, x1, y1, P.wood, Math.max(2, 1.4 * s));
  // 木纹暗侧（沿杆偏右下偏移）
  line(c, x0 + 0.7 * s, y0, x1 + 0.7 * s, y1, P.woodD, Math.max(1, s * 0.7));
  // 枪头：沿同一方向延伸的窄长刃，宽约为杆的 3 倍
  const dx = (x1 - x0), dy = (y1 - y0);
  const len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;                         // 垂直方向单位向量
  const w = 3.4 * s;                                // 刃半宽（偏宽才能在 32px 下辨认出金属头）
  const tipX = x1 + ux * 10 * s, tipY = y1 + uy * 10 * s;
  poly(c, [
    [x1 + px * w, y1 + py * w],
    [x1 + px * w * 0.55 + ux * 6.5 * s, y1 + py * w * 0.55 + uy * 6.5 * s],
    [tipX, tipY],
    [x1 - px * w * 0.55 + ux * 6.5 * s, y1 - py * w * 0.55 + uy * 6.5 * s],
    [x1 - px * w, y1 - py * w],
  ], P.steel);
  // 中脊高光
  // 中脊高光 + 两侧亮面：让金属头在缩小后仍明显区别于木杆
  line(c, x1 + ux * 0.5 * s, y1 + uy * 0.5 * s, tipX - ux * 0.8 * s, tipY - uy * 0.8 * s, P.steelL, Math.max(1, s * 0.9));
  line(c, x1 + px * 1.8 * s + ux * s, y1 + py * 1.8 * s + uy * s, tipX - ux * 2 * s, tipY - uy * 2 * s, P.steelL, Math.max(1, s * 0.6));
  // 接环（垂直于杆的金色横箍）
  line(c, x1 + px * 2.4 * s, y1 + py * 2.4 * s, x1 - px * 2.4 * s, y1 - py * 2.4 * s, P.gold, Math.max(1, s));
  // 红缨：从接环向下（屏幕下方）垂
  line(c, x1 - px * 1.2 * s, y1 - py * 1.2 * s + 1 * s, x1 - px * 2.2 * s, y1 - py * 2.2 * s + 4 * s, P.red, Math.max(1, s));
  line(c, x1 - px * 0.4 * s, y1 - py * 0.4 * s + 1 * s, x1 - px * 1.4 * s, y1 - py * 1.4 * s + 4.5 * s, P.redD, Math.max(1, s * 0.9));
  outline(c);
  return c;
}

/** 古书：线装书，封面斜置 + 书页侧层次 + 书脊。 */
function book(size) {
  const c = canvas(size), s = size / 32;
  // 透视：书是斜放的扁平体，不是立方块。
  // 先画「书页堆」——右侧的厚度，露出多条平行线是“书”最强特征
  poly(c, [
    [20 * s, 8 * s], [27 * s, 12 * s], [27 * s, 22 * s], [20 * s, 26 * s],
  ], P.paper);
  for (let i = 0; i < 6; i++) {
    const t = 9.5 + i * 2.4;
    line(c, 20 * s, t * s, 27 * s, (t + 3.6) * s, P.paperD, Math.max(1, s * 0.7));
  }
  // 封面（左半，稍窄于书页堆，形成错位）
  poly(c, [
    [5 * s, 10 * s], [20 * s, 8 * s], [20 * s, 26 * s], [5 * s, 24 * s],
  ], P.paperD);
  // 封面上的纹饰框
  poly(c, [
    [7 * s, 12 * s], [18 * s, 10.5 * s], [18 * s, 23.5 * s], [7 * s, 22 * s],
  ], P.wood);
  // 书名签（红竖条，偏左）
  poly(c, [[8.5 * s, 13 * s], [11.5 * s, 12.7 * s], [11.5 * s, 20.5 * s], [8.5 * s, 20.8 * s]], P.red);
  line(c, 10 * s, 13.2 * s, 10 * s, 20.3 * s, P.gold, Math.max(1, s * 0.7));
  // 书脊（最左粗深色竖带）
  poly(c, [[5 * s, 10 * s], [6.6 * s, 9.8 * s], [6.6 * s, 24.2 * s], [5 * s, 24 * s]], P.woodD);
  outline(c);
  return c;
}

/** 玉佩：环形玉璧 + 系绳 + 孔。 */
function jadePendant(size) {
  const c = canvas(size), s = size / 32;
  const cx = 16 * s, cy = 19 * s, R = 10 * s, r = 3.6 * s;
  // 外环
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 <= R * R && d2 >= r * r) c.put(x, y, P.jade);
    }
  }
  // 高光/暗面（左上亮、右下暗）
  for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) {
    for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      const d2 = (x - cx) ** 2 + (y - cy) ** 2;
      if (d2 > R * R || d2 < r * r) continue;
      const rel = (x - cx) / R + (y - cy) / R;
      if (rel < -0.7) c.put(x, y, P.jadeL);
      else if (rel > 0.75) c.put(x, y, P.jadeD);
    }
  }
  // 系绳
  line(c, cx, 2 * s, cx - 1.5 * s, 9 * s, P.red, Math.max(1, s));
  line(c, cx + 0.8 * s, 2 * s, cx - 0.8 * s, 9 * s, P.redD, Math.max(1, s));
  outline(c);
  return c;
}

/** 药瓶：细颈瓷瓶 + 木塞。 */
function potion(size) {
  const c = canvas(size), s = size / 32;
  const cx = 16 * s;
  // 瓶身
  disc(c, cx, 21 * s, 7 * s, P.jadeL);
  poly(c, [[cx - 7 * s, 21 * s], [cx + 7 * s, 21 * s], [cx + 5.5 * s, 27 * s], [cx - 5.5 * s, 27 * s]], P.jadeL);
  // 液体（下半）
  poly(c, [[cx - 6.2 * s, 19 * s], [cx + 6.2 * s, 19 * s], [cx + 5.5 * s, 27 * s], [cx - 5.5 * s, 27 * s]], P.red);
  // 颈
  poly(c, [[cx - 2 * s, 10 * s], [cx + 2 * s, 10 * s], [cx + 2.4 * s, 17 * s], [cx - 2.4 * s, 17 * s]], P.jadeL);
  // 木塞
  poly(c, [[cx - 2.4 * s, 6 * s], [cx + 2.4 * s, 6 * s], [cx + 2.2 * s, 10 * s], [cx - 2.2 * s, 10 * s]], P.wood);
  line(c, cx - 2.4 * s, 7.5 * s, cx + 2.4 * s, 7.5 * s, P.woodD, Math.max(1, s * 0.7));
  // 高光
  line(c, cx - 4 * s, 18 * s, cx - 4.6 * s, 24 * s, P.steelL, Math.max(1, s * 0.7));
  outline(c);
  return c;
}

/** 宝石：多面切割轮廓 + 高光。`hue` 决定颜色，4 种宝石共用同一形状。 */
function gem(size, hue) {
  const c = canvas(size), s = size / 32;
  const cx = 16 * s, cy = 18 * s;
  const cols = {
    red: { base: [206, 56, 64], d: [140, 28, 40], l: [246, 132, 132] },
    blue: { base: [72, 118, 210], d: [40, 68, 148], l: [140, 186, 246] },
    yellow: { base: [226, 178, 62], d: [162, 116, 28], l: [250, 224, 138] },
    purple: { base: [148, 86, 196], d: [98, 50, 140], l: [202, 158, 236] },
  }[hue];
  // 主体：上平、下尖的多面体
  poly(c, [
    [cx - 7 * s, cy - 5 * s], [cx + 7 * s, cy - 5 * s],
    [cx + 9 * s, cy - 1 * s], [cx, cy + 9 * s], [cx - 9 * s, cy - 1 * s],
  ], cols.base);
  // 台面（顶部亮带）
  poly(c, [[cx - 7 * s, cy - 5 * s], [cx + 7 * s, cy - 5 * s], [cx + 9 * s, cy - 1 * s], [cx - 9 * s, cy - 1 * s]], cols.l);
  // 右侧暗面
  poly(c, [[cx + 9 * s, cy - 1 * s], [cx, cy + 9 * s], [cx, cy - 1 * s]], cols.d);
  // 刻面棱线
  line(c, cx - 7 * s, cy - 5 * s, cx - 4 * s, cy - 1 * s, cols.l, Math.max(1, s * 0.7));
  line(c, cx + 7 * s, cy - 5 * s, cx + 4 * s, cy - 1 * s, cols.d, Math.max(1, s * 0.7));
  line(c, cx - 4 * s, cy - 1 * s, cx, cy + 9 * s, cols.d, Math.max(1, s * 0.6));
  // 高光点
  disc(c, cx - 3.5 * s, cy - 3 * s, 1.2 * s, [255, 255, 255]);
  outline(c);
  return c;
}

export const SHAPES = {
  ironSword, spear, book, jadePendant, potion,
  gemRed: (z) => gem(z, "red"),
  gemBlue: (z) => gem(z, "blue"),
  gemYellow: (z) => gem(z, "yellow"),
  gemPurple: (z) => gem(z, "purple"),
};

/**
 * 规范化为游戏内图标规格：内容缩放到不超过 maxContent 并居中，四周至少留 margin。
 * 现有手绘素材就是 32×32 + 内容 bbox ≤30×30 + 与边留 1px，这里保持一致。
 */
export function normalizeIcon(img, size = 32, margin = 1) {
  const maxContent = size - margin * 2;
  // 内容包围盒
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 16) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  }
  if (x1 < 0) return img;                       // 空图
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  // 按 30px 适配，允许放大：程序化图形是矢量描述的，放大后仍在像素网格上
  const scale = Math.min(maxContent / cw, maxContent / ch);
  const tw = Math.max(1, Math.round(cw * scale));
  const th = Math.max(1, Math.round(ch * scale));

  const out = Buffer.alloc(size * size * 4, 0);
  const ox = Math.floor((size - tw) / 2);
  const oy = Math.floor((size - th) / 2);
  // 最近邻采样：程序化图形本身就在像素网格上，不应模糊
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const sx = x0 + Math.min(cw - 1, Math.floor(x / scale));
      const sy = y0 + Math.min(ch - 1, Math.floor(y / scale));
      const si = (sy * img.width + sx) * 4;
      const di = ((oy + y) * size + ox + x) * 4;
      out[di] = img.data[si]; out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2]; out[di + 3] = img.data[si + 3];
    }
  }
  return { width: size, height: size, data: out };
}

// ── CLI ──
// 用 pathToFileURL 比较（直接拼 file:// 在中文路径下会被百分号编码，判等永远失败）
const isMain = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  const size = 32, scale = 8;
  const outDir = path.join("_aigen", "proc");
  fs.mkdirSync(outDir, { recursive: true });
  const names = Object.keys(SHAPES);
  const imgs = names.map((n) => normalizeIcon(SHAPES[n](size), size));
  names.forEach((n, i) => fs.writeFileSync(path.join(outDir, n + ".png"), encodePNG(imgs[i])));

  // 横向对照表（8x 放大）
  const cell = size * scale + 10;
  const W = cell * names.length, H = cell;
  const data = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 30; data[i * 4 + 1] = 30; data[i * 4 + 2] = 36; data[i * 4 + 3] = 255; }
  const sheet = { width: W, height: H, data };
  imgs.forEach((im, idx) => {
    const ox = idx * cell + 5, oy = 5;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      const a = im.data[si + 3] / 255;
      if (a <= 0) continue;
      for (let by = 0; by < scale; by++) for (let bx = 0; bx < scale; bx++) {
        const di = ((oy + y * scale + by) * W + ox + x * scale + bx) * 4;
        for (let k = 0; k < 3; k++) data[di + k] = Math.round(im.data[si + k] * a + data[di + k] * (1 - a));
        data[di + 3] = 255;
      }
    }
  });
  fs.writeFileSync(path.join("_aigen", "程序化图标.png"), encodePNG(sheet));

  // 剪影自检：打印每个形状的轮廓，肉眼可核
  const ramp = "#";
  for (const n of names) {
    const im = SHAPES[n](size);
    let out = "=== " + n + " ===\n";
    for (let y = 0; y < size; y++) {
      let row = "";
      for (let x = 0; x < size; x++) row += im.get(x, y)[3] > 0 ? ramp : " ";
      out += row + "\n";
    }
    console.log(out);
  }
  console.log("已写入 " + outDir + "  与 _aigen/程序化图标.png");
}
