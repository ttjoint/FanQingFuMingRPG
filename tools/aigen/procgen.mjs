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
  const c = canvas(size), s = size / 32;
  const cx = 15 * s;
  // 杆（略斜，从右下到左上）
  line(c, cx + 2 * s, 30 * s, cx - 1 * s, 13 * s, P.wood, Math.max(2, 1.6 * s));
  line(c, cx + 2.8 * s, 30 * s, cx - 0.2 * s, 13 * s, P.woodD, Math.max(1, s));
  // 枪头（叶形，明显比杆宽）
  poly(c, [[cx - 1 * s, 13 * s], [cx + 2 * s, 9 * s], [cx + 1.5 * s, 3 * s], [cx - 1.5 * s, 5 * s]], P.steel);
  line(c, cx + 0.8 * s, 5 * s, cx + 0.2 * s, 12 * s, P.steelL, Math.max(1, s));
  line(c, cx - 1 * s, 8 * s, cx - 0.3 * s, 12 * s, P.steelD, Math.max(1, s));
  // 缨（向左下垂的红穗，与枪头分开）
  line(c, cx - 0.6 * s, 13.5 * s, cx - 4 * s, 17 * s, P.red, Math.max(1, s));
  line(c, cx - 0.6 * s, 14.5 * s, cx - 3.2 * s, 19 * s, P.redD, Math.max(1, s));
  line(c, cx - 0.4 * s, 14 * s, cx - 4.4 * s, 15.5 * s, P.red, Math.max(1, s));
  outline(c);
  return c;
}

/** 古书：线装书，封面斜置 + 书页侧层次 + 书脊。 */
function book(size) {
  const c = canvas(size), s = size / 32;
  // 书页侧面（先在底层，往右错开形成厚度）
  poly(c, [[23 * s, 7 * s], [27.5 * s, 9 * s], [28 * s, 25 * s], [24.5 * s, 26.5 * s]], P.paper);
  for (let i = 0; i < 5; i++)
    line(c, 24 * s, (9 + i * 3.3) * s, 27.5 * s, (10 + i * 3.3) * s, P.paperD, Math.max(1, s * 0.8));
  // 封面
  poly(c, [[6 * s, 8 * s], [24 * s, 6 * s], [24.5 * s, 25 * s], [7 * s, 27 * s]], P.paperD);
  // 封面内框（让它不像一块纯色）
  poly(c, [[8.5 * s, 10.5 * s], [21.5 * s, 9 * s], [22 * s, 22.5 * s], [9 * s, 24 * s]], P.paper);
  // 书名签（红竖条）
  poly(c, [[11 * s, 11 * s], [14.5 * s, 10.6 * s], [14.8 * s, 20 * s], [11.3 * s, 20.4 * s]], P.red);
  for (let i = 0; i < 3; i++)
    line(c, 11.8 * s, (12.5 + i * 2.6) * s, 14 * s, (12.3 + i * 2.6) * s, P.redD, Math.max(1, s * 0.7));
  // 书脊线（左侧粗竖线）
  line(c, 6.5 * s, 8.5 * s, 7.5 * s, 26.5 * s, P.woodD, Math.max(1, 1.4 * s));
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

export const SHAPES = { ironSword, spear, book, jadePendant, potion };

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
  const imgs = names.map((n) => SHAPES[n](size));
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
