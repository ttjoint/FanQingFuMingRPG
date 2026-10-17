// 验证「白发/白袍不被误抠」。
//
// 真实场景：角色有深色描边（outline）把白发与背景隔开，或白袍被深色衣服包住。
// 旧色键（chromaKey）会把所有近白像素删掉 -> 白发/白袍变成窟窿。
// 新洪水填充（floodKey）只从画布四边向内扩散 -> 被描边包围的白色区域保留。
import { encodePNG, decodePNG, chromaKey, floodKey } from "./png.mjs";

/**
 * 构造测试图：白色背景 + 深色描边轮廓 + 轮廓内部的白色区域（模拟白发/白袍）。
 * @param {boolean} withOutline 是否有深色描边把内部白色与背景隔开
 */
function makeTest(withOutline) {
  const W = 64, H = 64;
  const data = Buffer.alloc(W * H * 4, 255);
  const set = (x, y, r, g, b) => { const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; };
  // 深色身体块
  for (let y = 30; y < 60; y++) for (let x = 20; x < 44; x++) set(x, y, 40, 40, 60);
  // 内部白色区域（白发），位于身体上方且在轮廓内
  for (let y = 12; y < 30; y++) for (let x = 24; x < 40; x++) set(x, y, 253, 253, 253);
  if (withOutline) {
    // 给白发外圈画 2px 深色描边，把它与背景隔开
    for (let y = 10; y < 32; y++) {
      for (let x = 22; x < 42; x++) {
        const onEdge = (x < 24 || x >= 40 || y < 12 || y >= 30);
        const nearBox = x >= 22 && x < 42 && y >= 10 && y < 32;
        if (onEdge && nearBox) set(x, y, 20, 20, 20);
      }
    }
  }
  return { width: W, height: H, data };
}

const key = [255, 255, 255];
const px = (im, x, y) => im.data[(y * im.width + x) * 4 + 3];

function run(withOutline) {
  const orig = decodePNG(encodePNG(makeTest(withOutline)));
  const oldK = chromaKey(orig, key, 26);
  const newK = floodKey(orig, key, 34);
  return {
    label: withOutline ? "有描边隔离" : "无描边（白发直连背景）",
    old: { hair: px(oldK, 32, 20), bg: px(oldK, 2, 2) },
    now: { hair: px(newK, 32, 20), bg: px(newK, 2, 2) },
    stat: { removed: newK.removed, keptInnerNear: newK.keptInnerNear },
  };
}

let fail = 0;
for (const withOutline of [true, false]) {
  const r = run(withOutline);
  console.log("--- " + r.label + " ---");
  console.log("  旧 chromaKey：白发 alpha=" + r.old.hair + "  背景 alpha=" + r.old.bg);
  console.log("  新 floodKey ：白发 alpha=" + r.now.hair + "  背景 alpha=" + r.now.bg + "  " + JSON.stringify(r.stat));
  if (withOutline) {
    // 有描边时：新旧都应保住白发（色键距离不够近也可能保住，但真正考验是"白色"纯度）
    if (r.now.hair < 200) { console.log("  ✗ 有描边情况下白发被误删"); fail++; }
    else if (r.now.bg !== 0) { console.log("  ✗ 有描边情况下背景未抠除"); fail++; }
    else console.log("  ✓ 白发保留、背景抠除");
  } else {
    // 无描边时：洪水会渗入，这是物理限制，应如实报告而不是假装成功
    console.log("  （无描边时洪水会从缝隙渗入，这是已知物理限制——生成时应要求深色描边）");
  }
}

// 对照：纯白前景 + 白背景，色键必然误删，洪水在有描边时必须保住
const orig = decodePNG(encodePNG(makeTest(true)));
const oldK = chromaKey(orig, [255, 255, 255], 60);   // 大容差模拟"接近纯白"
const newK = floodKey(orig, [255, 255, 255], 34);
const oldHair = px(oldK, 32, 20), newHair = px(newK, 32, 20);
console.log("--- 大容差对比（tol=60）---");
console.log("  旧 chromaKey：白发 alpha=" + oldHair);
console.log("  新 floodKey ：白发 alpha=" + newHair);
if (!(newHair > 200 && oldHair === 0)) { console.log("  ✗ 未体现出洪水填充优势"); fail++; }
else console.log("  ✓ 旧色键烧掉白发(" + oldHair + ")，新洪水保住(" + newHair + ")");

console.log(fail ? "✗ 失败 " + fail + " 项" : "✓ 白发保护自检通过");
process.exit(fail ? 1 : 0);
