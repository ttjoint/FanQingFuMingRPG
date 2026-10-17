// 提示词模板：按素材类别给出风格前缀/后缀与默认尺寸、后处理参数。
//
// 重要经验（经像素分析验证）：
//   1. **不要** 用 "pixel art / 16-bit / 32x32 sprite" 这类词。模型会理解成
//      「给照片套像素滤镜」，产出 2~4 万色的细节图，缩到 32px 后结构崩坏。
//   2. 用 "flat design / cartoon / bold colors / simple shape / thick outline"，
//      模型会画简单剪影，缩小后可辨识度显著更高（@32 色数 172 vs 296）。
//   3. 负向词必须显式排除 frame / pedestal / decoration / shadow / character，
//      否则模型爱加展示台与场景元素（实测左下角出现方形装饰块）。
//   4. 尺寸相关的描述（"32x32"）同样会诱发像素滤镜，一律不写。

export const NEGATIVE_BASE = [
  "blurry", "low quality", "jpeg artifacts", "watermark", "text", "signature",
  "photo", "photorealistic", "3d render", "realistic", "gradient", "shading",
  "background scenery", "multiple objects", "frame", "border", "pedestal",
  "decoration", "drop shadow", "character", "person", "hands", "complex detail",
  "western", "modern clothing", "cropped", "out of frame", "nude",
].join(", ");

/** 素材类别 → 生成参数。size 是最终游戏内尺寸，gen 是 AI 出图尺寸。 */
export const KINDS = {
  item: {
    label: "物品图标",
    size: 32,
    gen: 256,
    steps: 26,
    cfg: 7,
    levels: 6,
    ratio: 0.9,
    positive: "game inventory icon, ONE {subject} only, flat design, cartoon, bold saturated colors, thick dark outline, simple readable silhouette, centered, plain pure white background, no shadow, no border, single object",
    negative: "scenery, character, hands, ornate details, texture noise",
  },
  skill: {
    label: "技能图标",
    size: 34,
    gen: 256,
    steps: 26,
    cfg: 7,
    levels: 6,
    ratio: 0.9,
    positive: "game skill icon emblem, ONE symbolic {subject} motif, flat design, cartoon, bold colors, thick outline, strong silhouette, glowing accent, centered, plain pure white background, no border, no text",
    negative: "character portrait, scenery, hands, ornate frame",
  },
  face: {
    label: "角色头像",
    size: [63, 80],
    gen: 384,
    steps: 28,
    cfg: 7,
    levels: 8,
    ratio: 0.95,
    positive: "character portrait bust, {subject}, chinese ancient wuxia style, flat color shading, bold outlines, simple clean shapes, upper body, facing viewer, plain solid background",
    negative: "full body, tiny face, several people, busy background, text",
  },
  unit: {
    label: "角色立绘/格子精灵",
    size: 64,
    gen: 384,
    steps: 28,
    cfg: 7,
    levels: 8,
    ratio: 1,
    positive: "full body character sprite, {subject}, chinese ancient wuxia, flat colors, bold outline, simple shapes, standing idle front view, entire body visible with feet, plain pure white background, no shadow",
    negative: "cropped legs, half body, scenery, text, ground shadow",
  },
  prop: {
    label: "场景物件",
    size: 64,
    gen: 256,
    steps: 26,
    cfg: 7,
    levels: 8,
    ratio: 1,
    positive: "isometric game prop, ONE {subject}, chinese ancient style, flat colors, bold outline, simple shapes, centered, plain pure white background, no shadow",
    negative: "character, text, ground, scenery cluster",
  },
};

/**
 * 组装提示词。
 * @param {string} kind 见 KINDS
 * @param {string} subject 主体描述（建议英文）
 * @param {{extra?:string, negative?:string}} [opts]
 */
export function buildPrompt(kind, subject, opts) {
  const k = KINDS[kind] || KINDS.item;
  const o = opts || {};
  let pos = k.positive.replace("{subject}", subject);
  if (o.extra) pos += ", " + o.extra;
  const neg = [k.negative, NEGATIVE_BASE, o.negative || ""].filter(Boolean).join(", ");
  return { positive: pos, negative: neg, size: k.size, gen: k.gen, ratio: k.ratio, steps: k.steps, cfg: k.cfg, levels: k.levels };
}

/** 把目标尺寸规范化成 [w,h]。 */
export function sizeOf(size) {
  // size 可以是数字（方形）或 [w, h]（非方形，如头像 63×80）。
  // 旧实现把数组又包了一层，导致解构出的是数组而不是数字 → NaN。
  if (Array.isArray(size)) return [size[0], size[1] != null ? size[1] : size[0]];
  return [size, size];
}

/** 背景感知的抠图色键：亮背景用白，暗背景用黑。返回 [r,g,b]。 */
export function keyFor(bg) {
  const lum = bg[0] * 0.3 + bg[1] * 0.59 + bg[2] * 0.11;
  return lum > 127 ? [255, 255, 255] : [0, 0, 0];
}
