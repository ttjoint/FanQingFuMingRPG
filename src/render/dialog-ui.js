// 对话框（头像 + dlgpanel + 富文本正文）。
import { G } from "../core/state.js";
import { stateOf } from "./frame.js";
import { ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { parseRich, drawRichText } from "./text.js";


// P5：视图层的状态入口。
// 允许调用方显式传入运行时（rt）或游戏状态（g），不传则回退到当前全局实例。

export function drawDialog(rt) {
  const G = stateOf(rt);
  if (!G.dialog) return;
  // 头像（有则显示；旁白的 portrait 为 NULL/空）
  const has = G.dialog.portrait && G.dialog.portrait !== "NULL";
  const im = has ? getImg("assets/face/" + G.dialog.portrait.replace(/\.bmp$/, ".png")) : null;
  if (im) {
    const pw = 90, ph = Math.round(90 * im.height / im.width);
    ctx.fillStyle = "#1a140e"; ctx.fillRect(95, 30, pw + 8, ph + 8);
    ctx.strokeStyle = "#b8a468"; ctx.strokeRect(95.5, 30.5, pw + 7, ph + 7);
    ctx.drawImage(im, 99, 34, pw, ph);
  }
  // 原版对话框 dlgpanel.bmp（dlg.ini: x=200,y=15）
  const P = getImg("assets/ui/dlgpanel.png");
  const px = 200, py = 15;
  if (P) ctx.drawImage(P, px, py);
  else { ctx.fillStyle = "rgba(26,20,14,0.95)"; ctx.fillRect(px, py, 260, 350); ctx.strokeStyle = "#b8a468"; ctx.strokeRect(px + .5, py + .5, 259, 349); }
  ctx.fillStyle = "#ffd75e"; ctx.font = "bold 14px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText(G.dialog.speaker && G.dialog.speaker.trim() ? G.dialog.speaker : "", px + 130, py + 45);
  ctx.save();
  ctx.font = "14px 'Microsoft YaHei',SimHei,sans-serif";
  const runs = parseRich(G.dialog.text);
  drawRichText(runs, px + 22, py + 71, 218, 20, 14, "rgba(0,0,0,0.75)");
  drawRichText(runs, px + 21, py + 70, 218, 20, 14, null);
  ctx.restore();
  ctx.fillStyle = "#9fd0ff"; ctx.font = "11px sans-serif";
  if (G.dialog.kind === "ask") ctx.fillText("[Y] 是    [N] 否", px + 60, py + 322);
  else ctx.fillText("▼ Enter / 点对话框继续（点外部中断）", px + 60, py + 312);
}
