// 行走图（pmg / chars.json）预览与编辑。
//
// chara 数据结构（见 core/assets.js 的 preloadChar）：
//   chars[模型名][动作][方向 0..7][帧] = "npc143_st_4.bmp"
//   方向顺序 0..7 对应 0°/20°/40°…（见 GEO 的等距朝向约定），
//   动作一般是 stand / walk / run / fight / die。
//
// 编辑器的痛点：原实现只在模型下拉里显示一张「站立首帧」的缩略图，看不出
// 整套行走图长什么样。本模块把**所有方向 × 所有帧**铺成网格整体呈现，
// 并允许逐格替换 / 追加 / 删除帧。

import { h, clear } from "./dom.js";
import { assetSrc } from "./assets-index.js";

const DIR_LABELS = ["0°", "45°", "90°", "135°", "180°", "225°", "270°", "315°"];

/** 帧文件名 → 可显示的 URL。chars.json 里存的是 assets/role/ 下的纯文件名。 */
export function pmgSrc(name) {
  if (!name) return null;
  const s = String(name);
  if (/^(data:|blob:|https?:)/i.test(s)) return s;
  if (s.startsWith("assets/")) return assetSrc(s);
  return assetSrc("assets/role/" + s.replace(/\.(bmp|jpg|jpeg|webp)$/i, ".png"));
}

/**
 * 渲染一个模型的完整行走图网格。
 * @param {Record<string,string[][]>} model  chars[模型名]
 * @param {{maxW?:number, onPick?:(action:string,dir:number,frame:number)=>void, sel?:{a:string,d:number,f:number}}} [opts]
 */
export function pmgGrid(model, opts) {
  const o = opts || {};
  const box = h("div", { class: "ed-pmg" });
  if (!model) { box.append(h("div", { class: "ed-empty" }, "（无模型数据）")); return box; }
  const actions = Object.keys(model);
  if (!actions.length) { box.append(h("div", { class: "ed-empty" }, "（该模型没有任何动作帧）")); return box; }
  const acts = h("div", { class: "ed-pmg-tabs" });
  let cur = actions[0];

  const body = h("div", { class: "ed-pmg-body" });
  box.append(acts, body);

  const drawBody = () => {
    clear(body);
    const dirs = model[cur] || [];
    if (!dirs.length) { body.append(h("div", { class: "ed-empty" }, "（该动作没有帧）")); return; }
    for (let d = 0; d < dirs.length; d++) {
      const frames = dirs[d] || [];
      const row = h("div", { class: "ed-pmg-dir" });
      row.append(h("div", { class: "ed-pmg-dirlab" }, DIR_LABELS[d] || ("方向" + d)));
      const strip = h("div", { class: "ed-pmg-strip" });
      for (let f = 0; f < frames.length; f++) {
        const cell = h("div", { class: "ed-pmg-cell", title: cur + " / 方向" + d + " / 帧" + (f + 1) + "\n" + frames[f] });
        const im = h("img", { loading: "lazy", decoding: "async", src: pmgSrc(frames[f]) });
        im.onerror = () => { im.style.opacity = "0.12"; };
        cell.append(im, h("span", { class: "ed-pmg-idx" }, String(f + 1)));
        cell.onclick = () => {
          const s = o.sel;
          if (s && s.a === cur && s.d === d && s.f === f) return;
          o.sel = { a: cur, d, f };
          if (o.onPick) o.onPick(cur, d, f);
          body.querySelectorAll(".ed-pmg-cell.on").forEach(x => x.classList.remove("on"));
          cell.classList.add("on");
        };
        if (o.sel && o.sel.a === cur && o.sel.d === d && o.sel.f === f) cell.classList.add("on");
        strip.append(cell);
      }
      row.append(strip);
      body.append(row);
    }
  };

  for (const a of actions) {
    const b = h("button", { class: "ed-btn ghost" + (a === cur ? " on" : ""), title: a }, a);
    b.onclick = () => { cur = a; acts.querySelectorAll("button").forEach(x => x.classList.toggle("on", x === b)); drawBody(); };
    acts.append(b);
  }
  drawBody();
  /** @type {any} */ (box).drawBody = drawBody;
  /** @type {any} */ (box).curAction = () => cur;
  return box;
}
