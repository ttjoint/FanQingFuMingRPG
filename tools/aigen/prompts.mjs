// 提示词模板：按素材类型给出风格前缀/后缀与默认尺寸、后处理参数。
// 风格词针对《国殇》题材（中国古风 + 像素）。

export const NEGATIVE_BASE = [
  "blurry", "low quality", "jpeg artifacts", "watermark", "text", "signature",
  "photo", "photorealistic", "3d render", "western", "modern clothing",
  "multiple characters", "cropped", "out of frame", "nude",
].join(", ");

/** 素材类别 → 生成参数。size 是最终游戏内尺寸，gen 是 AI 出图尺寸。 */
export const KINDS = {
  item: {
    label: "物品图标",
    size: 32,
    gen: 512,
    ratio: 0.9,
    positive: "pixel art game item icon, single object centered, {subject}, chinese ancient style, wuxia, clean outline, high contrast, vivid colors, isolated on pure white background, 32x32 sprite",
    negative: "background scenery, character, hands, frame, border, drop shadow",
  },
  skill: {
    label: "技能图标",
    size: 34,
    gen: 512,
    ratio: 0.9,
    positive: "pixel art skill icon, single emblem centered, {subject}, chinese ancient wuxia, glowing energy, bold outline, strong color contrast, isolated on pure white background, 32x32 sprite",
    negative: "character portrait, scenery, text, hands",
  },
  face: {
    label: "角色头像",
    size: [63, 80],
    gen: 512,
    ratio: 0.95,
    positive: "pixel art character portrait bust, {subject}, chinese ancient style, wuxia, upper body, front facing, detailed face, dramatic lighting, dark background",
    negative: "full body, tiny face, several people, text",
  },
  unit: {
    label: "角色立绘/格子精灵",
    size: 64,
    gen: 512,
    ratio: 1,
    positive: "pixel art full body character sprite, {subject}, chinese ancient wuxia, standing idle pose, front view, entire body visible, feet at bottom, transparent looking plain white background",
    negative: "cropped legs, half body, scenery, text",
  },
  prop: {
    label: "场景物件",
    size: 64,
    gen: 512,
    ratio: 1,
    positive: "pixel art isometric prop, {subject}, chinese ancient style, wuxia, single object, plain white background",
    negative: "character, text, ground shadow",
  },
};

/**
 * 组装提示词。
 * @param {string} kind 见 KINDS
 * @param {string} subject 主体描述（中文/英文均可，建议英文）
 * @param {{extra?:string, negative?:string}} [opts]
 */
export function buildPrompt(kind, subject, opts) {
  const k = KINDS[kind] || KINDS.item;
  const o = opts || {};
  let pos = k.positive.replace("{subject}", subject);
  if (o.extra) pos += ", " + o.extra;
  const neg = [k.negative, NEGATIVE_BASE, o.negative || ""].filter(Boolean).join(", ");
  return { positive: pos, negative: neg, size: k.size, gen: k.gen, ratio: k.ratio };
}

/** 把目标尺寸规范化成 [w,h]。 */
export function sizeOf(size) {
  return Array.isArray(size) ? size : [size, size];
}
