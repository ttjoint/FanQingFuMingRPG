// 单位（NPC）属性面板：绑定到被选中的那个 NPC，含行走图动作×方向预览、头像、
// 数值、掉落、技能、AI 行为等。供地图编辑器的「单位」层右侧栏复用。
import { h, clear } from "./dom.js";
import { A } from "../core/state.js";
import { renderForm, renderDrops, renderStrList } from "./fields.js";

const ACTIONS = [["stand", "站立"], ["walk", "行走"], ["run", "奔跑"], ["fight", "攻击"], ["die", "倒地"]];

// 原版 npc.npc 的 AI 编号 -> 可读说明（网页版按「攻击>0 + 主动敌对」判定敌人）。
const AI_OPTIONS = [
  [0, "0 · 默认（有行走帧则游荡）"], [1, "1 · 待机"], [2, "2 · 巡逻"],
  [3, "3 · 固定站位（多有脚本）"], [4, "4 · 随机游荡"],
  [5, "5 · 特殊"], [6, "6 · 特殊"], [7, "7 · 特殊"],
];

export function renderNpcPanel(host, npc, ctx) {
  clear(host);
  const images = ctx.images || {};
  const path = p => images[p] || p;
  const frameSrc = name => path("assets/role/" + name.replace(/\.bmp$/, ".png"));
  const faceSrc = name => path("assets/face/" + name.replace(/\.bmp$/, ".png"));

  // 规整字段（原版记录里没有这些字段，skills 还可能是错位的台词文本）。
  const skillNames = ctx.skillNames || [];
  if (!Array.isArray(npc.skills)) {
    npc.skills = String(npc.skills == null ? "" : npc.skills).split(/[,\s/、]+/).filter(s => skillNames.includes(s));
  }
  if (npc.speed == null) npc.speed = 45;
  if (npc.runSpeed == null) npc.runSpeed = 70;
  if (!Array.isArray(npc.drops)) npc.drops = [];

  const on = f => {
    ctx.onChange && ctx.onChange(f);
    if (f && (f.k === "model" || f.k === "portrait") && ctx.rerender) ctx.rerender();
  };

  const model = (npc.model || "").replace(/\.pmg$/, "");

  // ---- 行走图预览：动作 × 8 方向（各取首帧） ----
  host.append(h("h3", null, "行走图预览（动作 × 方向，首帧）"));
  const grid = h("div", { class: "ed-sprgrid" });
  if (!A.chars || !A.chars[model]) {
    grid.append(h("div", { class: "ed-hint", style: "margin:0" }, "未找到模型：" + (npc.model || "（空）")));
  } else {
    for (const [act, label] of ACTIONS) {
      const row = h("div", { class: "ed-sprrow" }, h("span", { class: "ed-sprlab" }, label));
      const blocks = A.chars[model][act];
      for (let d = 0; d < 8; d++) {
        let img = null;
        if (blocks) {
          const block = blocks[d % blocks.length] || blocks[0];
          if (block && block.length) img = h("img", {
            src: frameSrc(block[0]), class: "ed-sprimg", title: "方向 " + d + " · " + block.length + " 帧",
            onerror: ev => { ev.target.style.visibility = "hidden"; },
          });
        }
        row.append(h("div", { class: "ed-sprcell" }, img, h("span", { class: "dim" }, String(d))));
      }
      grid.append(row);
    }
  }
  host.append(grid);

  // ---- 头像 ----
  host.append(h("h3", null, "头像"));
  host.append(npc.portrait ? h("img", { src: faceSrc(npc.portrait), class: "ed-faceimg", onerror: ev => { ev.target.style.opacity = "0.2"; } }) : h("div", { class: "ed-hint", style: "margin:0" }, "（无头像）"));

  // ---- 基本属性 ----
  host.append(h("h3", null, "基本属性"));
  const form = h("div", { class: "ed-grid" });
  host.append(form);
  const modelOptions = [["", "（无）"]].concat((ctx.models || []).map(m => [m + ".pmg", m]));
  if (npc.model && !modelOptions.some(o => o[0] === npc.model)) modelOptions.push([npc.model, npc.model]);
  const portraitOptions = [["", "（无）"]].concat((ctx.portraits || []).map(p => [p, p]));
  if (npc.portrait && !portraitOptions.some(o => o[0] === npc.portrait)) portraitOptions.push([npc.portrait, npc.portrait]);
  const scriptOptions = [["", "（无）"]].concat((ctx.scripts || []).map(s => [s, s]));
  if (npc.script && !scriptOptions.some(o => o[0] === npc.script)) scriptOptions.push([npc.script, npc.script]);
  renderForm(form, [
    { k: "id", label: "编号", type: "number" },
    { k: "name", label: "名称", type: "text" },
    { k: "model", label: "行走图(pmg)", type: "select", options: modelOptions },
    { k: "portrait", label: "头像", type: "select", options: portraitOptions },
    { k: "script", label: "对话脚本(gsp)", type: "select", options: scriptOptions },
    { k: "hp", label: "生命", type: "number" },
    { k: "attack", label: "攻击", type: "number" },
    { k: "defence", label: "防御", type: "number" },
    { k: "level", label: "等级", type: "number" },
    { k: "exp", label: "经验", type: "number" },
    { k: "hostile", label: "主动敌对", type: "checkbox" },
    { k: "ai", label: "AI 行为", type: "select", numeric: true, options: AI_OPTIONS },
    { k: "speed", label: "移动速度", type: "number" },
    { k: "runSpeed", label: "追击速度", type: "number" },
  ], npc, on);

  // ---- 掉落物品 ----
  host.append(h("h3", null, "掉落物品"));
  const drops = h("div", { class: "ed-drops" });
  host.append(drops);
  renderDrops(drops, npc, { k: "drops", items: ctx.itemNames || [] }, f => ctx.onChange && ctx.onChange(f));

  // ---- 技能 ----
  host.append(h("h3", null, "技能"));
  const skl = h("div", { class: "ed-drops" });
  host.append(skl);
  renderStrList(skl, npc, { k: "skills", options: skillNames, addLabel: "＋ 添加技能" }, f => ctx.onChange && ctx.onChange(f));

  // ---- 空闲对白 ----
  host.append(h("h3", null, "空闲对白（每行一句）"));
  const talk = h("div", { class: "ed-grid" });
  host.append(talk);
  renderForm(talk, [{ k: "talks", label: "台词", type: "lines", rows: 5 }], npc, f => ctx.onChange && ctx.onChange(f));

  host.append(h("div", { class: "ed-hint" }, "AI 为原版行为编号；本网页版按「攻击>0 且 主动敌对」判定敌人，其余按模型有无行走帧决定原地或游荡。"));
  host.append(h("div", { class: "ed-hint" }, "「技能」为本编辑器新增字段：原版记录里的 skills 是错位的台词文本，已被过滤为合法技能名。"));
}
