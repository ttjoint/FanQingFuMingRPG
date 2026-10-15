// 文本排版：内联颜色标记解析、富文本绘制、普通折行。
import { TAG_COLORS, TEXT_COLOR, ctx } from "../core/constants.js";

// 把对白解析成若干“带颜色的文本段”，支持 <N文字/> 内联颜色标记。
export function parseRich(text) {
  const runs = [];
  let color = TEXT_COLOR, buf = "";
  const flush = () => { if (buf) { runs.push({ s: buf, color }); buf = ""; } };
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === "<") {
      const m = /^<(\d)([^>]*)>/.exec(text.slice(i));
      if (m) {
        flush();
        const inner = m[2].replace(/\/$/, "");
        if (inner) runs.push({ s: inner, color: TAG_COLORS[m[1]] || TEXT_COLOR });
        i += m[0].length;
        continue;   // <N文字/> 为自闭合标记：只给标记内文字上色，之后恢复默认色
      }
    }
    if (ch === "\n") { flush(); runs.push({ nl: true }); i++; continue; }
    buf += ch; i++;
  }
  flush();
  return runs;
}

// 逐字排版并绘制彩色富文本；shadow 不为空时只画阴影（用于描边）。
export function drawRichText(runs, x, y, maxw, lh, maxLines, shadow) {
  let cx = x, cy = y, line = 1;
  for (const r of runs) {
    if (r.nl) { cx = x; cy += lh; line++; if (line > maxLines) return; continue; }
    for (const ch of r.s) {
      const w = ctx.measureText(ch).width;
      if (cx > x && cx + w > x + maxw) { cx = x; cy += lh; line++; if (line > maxLines) return; }
      ctx.fillStyle = shadow || r.color;
      ctx.fillText(ch, cx, cy);
      cx += w;
    }
  }
}

export function wrapText(text, x, y, maxw, lh, maxh) {
  const lines = [];
  let line = "";
  for (const ch of text) {
    if (ch === "\n") { lines.push(line); line = ""; continue; }
    const t = line + ch;
    if (ctx.measureText(t).width > maxw) { lines.push(line); line = ch; } else line = t;
  }
  if (line) lines.push(line);
  lines.forEach((l, k) => ctx.fillText(l, x, y + k * lh));
  return lines.length;
}
