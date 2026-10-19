// 浮动伤害数字的绘制（像素风格，与游戏 UI 一致）。
//
// 分层：数据与生命周期在 engine/floatText.js（纯逻辑、有单测），
// 这里只负责把 {text,x,y,alpha,color} 画到画布上，不做任何决策。
import { ctx, VW, VH } from "../core/constants.js";
import { floatVisual } from "../engine/floatText.js";
import { stateOfStrict } from "./frame.js";

// 每个数字画两遍：先画黑色描边（偏移 8 个方向各 1px），再画本体。
// 这是像素游戏里让文字在任意背景上都可读的最省事办法 —— 不用测量文本边界，
// 也不用给每个数字铺半透明底板（那样在大群怪时会糊成一片）。
function drawOutlined(label, x, y, color, font) {
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      ctx.fillText(label, x + dx, y + dy);
    }
  }
  ctx.fillStyle = color;
  ctx.fillText(label, x, y);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/**
 * 绘制所有单位的浮动伤害数字。
 *
 * @param {any} rt 运行时（提供 state）
 * @param {number} camX
 * @param {number} camY
 */
export function drawFloats(rt, camX, camY) {
  // 这里用 stateOfStrict：浮动数字是「必须由调用方注入」的绘制，
  // 旧写法 `(rt && rt.state) || null` 在漏传 rt 时静默啥都不画，
  // 与其他 8 处 stateOf 副本「回退全局」的行为不一致，排查时极易误判。
  // 语义无关改变（依旧不回退全局），但规则现在只有一份（见 render/frame.js）。
  const G = stateOfStrict(rt);
  if (!G) return;
  // 单位和玩家都可能带 floats；统一收集后一次画完，
  // 避免「玩家数字被后画的敌人数字盖住」这种层序问题。
  const units = [];
  if (G.player) units.push(G.player);
  if (Array.isArray(G.npcs)) for (const n of G.npcs) units.push(n);
  for (const u of units) {
    const list = u && u.floats;
    if (!Array.isArray(list) || !list.length) continue;
    for (const f of list) {
      const v = floatVisual(f);
      if (v.alpha <= 0.02 || !v.text) continue;
      const sx = Math.round(v.x - camX);
      const sy = Math.round(v.y - camY);
      if (sx < -40 || sx > VW + 40 || sy < -40 || sy > VH + 40) continue;
      ctx.save();
      ctx.globalAlpha = v.alpha;
      // 免疫用更小字号：它是"状态提示"而不是"伤害数值"，不该抢眼。
      const font = f.immune ? "bold 11px sans-serif" : (v.crit ? "bold 16px sans-serif" : "bold 13px sans-serif");
      drawOutlined(v.text, sx, sy, v.color, font);
      ctx.restore();
    }
  }
}
