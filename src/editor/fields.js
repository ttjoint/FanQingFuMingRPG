// 表单向导：由 schema 生成可编辑控件，供 NPC / 物品 / 技能 / 数值 / 结局等复用。
import { h, clear } from "./dom.js";

let dlSeq = 0;

// 支持点分路径键（如 "projectile.frames"），自动在缺省时创建中间对象。
function pathGet(obj, k) {
  if (k.indexOf(".") < 0) return obj[k];
  let o = obj;
  for (const part of k.split(".")) { if (o == null || typeof o !== "object") return undefined; o = o[part]; }
  return o;
}
function pathSet(obj, k, v) {
  if (k.indexOf(".") < 0) { obj[k] = v; return; }
  const parts = k.split(".");
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null || typeof o[parts[i]] !== "object") o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = v;
}

function valOf(f, obj) {
  const v = pathGet(obj, f.k);
  if (f.type === "lines") return Array.isArray(v) ? v.join("\n") : (v == null ? "" : String(v));
  return v == null ? "" : v;
}

// 掉落物品编辑器：数组 [{name,count}]，物品名下拉取自 f.items。
export function renderDrops(host, obj, f, onChange) {
  const arr = Array.isArray(obj[f.k]) ? obj[f.k] : (obj[f.k] = []);
  const redraw = () => {
    clear(host);
    arr.forEach((d, i) => {
      const sel = h("select", { onchange: () => { d.name = sel.value; onChange && onChange(f); } });
      const names = f.items || [];
      for (const nm of names) sel.append(h("option", { value: nm }, nm));
      if (d.name && !names.includes(d.name)) sel.append(h("option", { value: d.name }, d.name + "（无此物品）"));
      sel.value = d.name || names[0] || "";
      const cnt = h("input", { type: "number", value: d.count || 1, style: "width:56px", min: 1 });
      cnt.oninput = () => { d.count = Math.max(1, Number(cnt.value) || 1); onChange && onChange(f); };
      host.append(h("div", { class: "ed-row" }, sel, cnt,
        h("button", { class: "ed-btn danger", onclick: () => { arr.splice(i, 1); onChange && onChange(f); redraw(); } }, "删")));
    });
    host.append(h("button", { class: "ed-btn", onclick: () => { arr.push({ name: (f.items && f.items[0]) || "", count: 1 }); onChange && onChange(f); redraw(); } }, "＋ 添加掉落"));
  };
  redraw();
}

// 货物背包（容器）编辑器：obj[f.k] = { stock?: [{name,count}], auto?: string } 或 null。
// 无货物 = 非商人（不展开交易）。与 NPC 名称/模型无关，纯数据驱动。
const INV_AUTO_OPTS = [["", "（不自动）"], ["potion", "药/水类自动"], ["weapon", "武器类自动"], ["armor", "防具类自动"], ["accessory", "饰品类自动"]];

export function renderInventory(host, obj, f, onChange) {
  const items = f.items || [];
  const redraw = () => {
    clear(host);
    if (!obj[f.k] || typeof obj[f.k] !== "object") obj[f.k] = { stock: [], auto: "" };
    const inv = obj[f.k];
    if (!Array.isArray(inv.stock)) inv.stock = [];
    // 自动分类
    const auto = h("select");
    for (const [v, label] of INV_AUTO_OPTS) auto.append(h("option", { value: v }, label));
    auto.value = inv.auto || "";
    auto.onchange = () => { inv.auto = auto.value; onChange && onChange(f); redraw(); };
    host.append(h("div", { class: "ed-row" }, h("span", null, "自动分类"), auto));
    // 显式货物（优先于自动分类）
    host.append(h("div", { class: "ed-field" }, h("label", null, "显式货物（优先于自动分类）")));
    inv.stock.forEach((e, i) => {
      const sel = h("select", { onchange: () => { e.name = sel.value; onChange && onChange(f); } });
      for (const nm of items) sel.append(h("option", { value: nm }, nm));
      if (e.name && !items.includes(e.name)) sel.append(h("option", { value: e.name }, e.name + "（无此物品）"));
      sel.value = e.name || items[0] || "";
      const cnt = h("input", { type: "number", min: "1", style: "width:5em" });
      cnt.value = String(e.count || 1);
      cnt.oninput = () => { e.count = Math.max(1, Number(cnt.value) || 1); onChange && onChange(f); };
      host.append(h("div", { class: "ed-row" }, sel, cnt,
        h("button", { class: "ed-btn danger", onclick: () => { inv.stock.splice(i, 1); onChange && onChange(f); redraw(); } }, "删")));
    });
    host.append(h("button", { class: "ed-btn", onclick: () => { inv.stock.push({ name: (items && items[0]) || "", count: 1 }); onChange && onChange(f); redraw(); } }, "＋ 添加货物"));
  };
  redraw();
}

// 字符串列表编辑器：obj[f.k] 为字符串数组；f.options 为候选（技能名等）。
export function renderStrList(host, obj, f, onChange) {
  let arr = obj[f.k];
  if (!Array.isArray(arr)) {
    const opts = f.options || [];
    arr = obj[f.k] = String(arr == null ? "" : arr).split(/[,\s/、]+/).filter(s => opts.includes(s));
  }
  const redraw = () => {
    clear(host);
    arr.forEach((v, i) => {
      const sel = h("select", { onchange: () => { arr[i] = sel.value; onChange && onChange(f); } });
      const opts = f.options || [];
      for (const o of opts) sel.append(h("option", { value: o }, o));
      if (v && !opts.includes(v)) sel.append(h("option", { value: v }, v + "（未知）"));
      sel.value = v;
      host.append(h("div", { class: "ed-row" }, sel,
        h("button", { class: "ed-btn danger", onclick: () => { arr.splice(i, 1); onChange && onChange(f); redraw(); } }, "删")));
    });
    host.append(h("button", { class: "ed-btn", onclick: () => { arr.push((f.options && f.options[0]) || ""); onChange && onChange(f); redraw(); } }, f.addLabel || "＋ 添加"));
  };
  redraw();
}

// 命中效果 buff 编辑器：obj[f.k] 为 { buffs: [{id,stacks,chance}] }。
// f.options 为可选 buff id 列表。
export function renderBuffEffects(host, obj, f, onChange) {
  const opts = f.options || [];
  const ensure = () => {
    if (!obj[f.k] || typeof obj[f.k] !== "object") obj[f.k] = { buffs: [] };
    if (!Array.isArray(obj[f.k].buffs)) obj[f.k].buffs = [];
    return obj[f.k].buffs;
  };
  const redraw = () => {
    clear(host);
    const arr = ensure();
    host.append(h("div", { class: "ed-field" }, h("label", null, "命中时施加 Buff（命中概率 %）")));
    arr.forEach((b, i) => {
      const sel = h("select", { onchange: () => { b.id = sel.value; onChange && onChange(f); } });
      for (const o of opts) sel.append(h("option", { value: o }, o));
      if (b.id && !opts.includes(b.id)) sel.append(h("option", { value: b.id }, b.id + "（未知）"));
      sel.value = b.id || opts[0] || "";
      const st = h("input", { type: "number", min: "1", style: "width:4em" }); st.value = String(b.stacks || 1);
      st.oninput = () => { b.stacks = Math.max(1, Number(st.value) || 1); onChange && onChange(f); };
      const ch = h("input", { type: "number", min: "0", max: "100", style: "width:4em" }); ch.value = String(b.chance == null ? 100 : b.chance);
      ch.oninput = () => { b.chance = Math.max(0, Math.min(100, Number(ch.value) || 0)); onChange && onChange(f); };
      host.append(h("div", { class: "ed-row" }, sel, h("span", null, "层"), st, h("span", null, "%"), ch,
        h("button", { class: "ed-btn danger", onclick: () => { arr.splice(i, 1); onChange && onChange(f); redraw(); } }, "删")));
    });
    host.append(h("button", { class: "ed-btn", onclick: () => { arr.push({ id: opts[0] || "", stacks: 1, chance: 100 }); onChange && onChange(f); redraw(); } }, "＋ 添加 Buff"));
  };
  redraw();
}

export function renderForm(host, schema, obj, onChange) {
  clear(host);
  const refreshers = [];
  const flag = f => { if (onChange) onChange(f); for (const r of refreshers) r(); };
  for (const f of schema) {
    const lab = h("label", null, f.label || f.k);
    let ctl;
    const v = valOf(f, obj);
    if (f.type === "drops") {
      const box = h("div", { class: "ed-drops" });
      renderDrops(box, obj, f, onChange);
      host.append(h("div", { class: "ed-field" }, lab, box));
      continue;
    }
    if (f.type === "inventory") {
      const box = h("div", { class: "ed-drops" });
      renderInventory(box, obj, f, onChange);
      host.append(h("div", { class: "ed-field" }, lab, box));
      continue;
    }
    if (f.type === "strlist") {
      const box = h("div", { class: "ed-drops" });
      renderStrList(box, obj, f, onChange);
      host.append(h("div", { class: "ed-field" }, lab, box));
      continue;
    }
    if (f.type === "buffeffects") {
      const box = h("div", { class: "ed-drops" });
      renderBuffEffects(box, obj, f, onChange);
      host.append(box);
      continue;
    }
    if (f.type === "textarea" || f.type === "lines") {
      ctl = h("textarea", { rows: f.rows || (f.type === "lines" ? 4 : 3) });
      ctl.value = v;
      ctl.oninput = () => {
        pathSet(obj, f.k, f.type === "lines" ? ctl.value.split("\n").map(s => s.trimEnd()).filter(s => s.length) : ctl.value);
        flag(f);
      };
    } else if (f.type === "select") {
      ctl = h("select");
      for (const o of f.options) {
        const value = Array.isArray(o) ? o[0] : o.v, label = Array.isArray(o) ? o[1] : o.label;
        ctl.append(h("option", { value }, label));
      }
      ctl.value = String(pathGet(obj, f.k));
      ctl.style.flex = "1";
      ctl.onchange = () => { pathSet(obj, f.k, f.numeric ? Number(ctl.value) : ctl.value); flag(f); };
    } else if (f.type === "checkbox") {
      ctl = h("input", { type: "checkbox" });
      ctl.checked = !!pathGet(obj, f.k);
      ctl.onchange = () => { pathSet(obj, f.k, ctl.checked); flag(f); };
    } else if (f.type === "number") {
      ctl = h("input", { type: "number", step: f.step || 1 });
      if (f.min != null) ctl.min = f.min;
      if (f.max != null) ctl.max = f.max;
      if (f.def != null && (pathGet(obj, f.k) == null || pathGet(obj, f.k) === "")) pathSet(obj, f.k, f.def);
      ctl.value = valOf(f, obj);
      ctl.oninput = () => { pathSet(obj, f.k, ctl.value === "" ? 0 : Number(ctl.value)); flag(f); };
    } else {
      ctl = h("input", { type: "text" });
      ctl.value = v;
      ctl.oninput = () => { pathSet(obj, f.k, ctl.value); flag(f); };
    }
    // 可选下拉候选：f.list 为字符串数组时，生成 datalist 绑定到输入框。
    if (Array.isArray(f.list)) {
      const id = "ed_dl_" + (++dlSeq);
      const dl = h("datalist", { id });
      for (const o of f.list) dl.append(h("option", { value: o }));
      ctl.setAttribute("list", id);
      host.append(dl);
    }
    host.append(h("div", { class: "ed-row" }, lab, ctl));
    // 图片字段：若有 f.img(obj)，在控件下方显示预览（随输入/选择实时刷新）
    if (typeof f.img === "function") {
      const im = h("img", { class: "ed-fieldimg" });
      const ph = h("span", { class: "ed-imghint" }, "（无图片）");
      const wrap = h("div", { class: "ed-imgwrap" }, im, ph);
      const refresh = () => {
        const s = f.img(obj);
        if (s) { im.src = s; im.style.display = ""; ph.style.display = "none"; }
        else { im.removeAttribute("src"); im.style.display = "none"; ph.style.display = ""; }
      };
      im.onerror = () => { im.style.opacity = "0.15"; };
      im.onload = () => { im.style.opacity = "1"; };
      refreshers.push(refresh); refresh();
      host.append(wrap);
    }
  }
}

// 列表 + 选中项表单 + 增删。list 为数组（会被就地修改）。
export function renderListEditor(host, opts) {
  const { list, schema, columns, makeNew } = opts;
  let sel = opts.sel != null ? opts.sel : 0;
  const redraw = () => {
    sel = opts.sel != null ? opts.sel : 0;   // 每次重绘都从 opts 同步选中项（行点击/新建/删除后才会切换）
    clear(host);
    host.append(h("div", { class: "ed-tools" },
      h("button", { class: "ed-btn", onclick: () => { list.push(makeNew()); opts.sel = list.length - 1; opts.onStructural && opts.onStructural(); redraw(); } }, "＋ 新建"),
      h("button", { class: "ed-btn", onclick: () => { if (sel == null || !list[sel]) return; list.splice(sel + 1, 0, JSON.parse(JSON.stringify(list[sel]))); opts.sel = sel + 1; opts.onStructural && opts.onStructural(); redraw(); } }, "复制"),
      h("button", { class: "ed-btn danger", onclick: () => { if (sel == null || !list[sel]) return; list.splice(sel, 1); opts.sel = Math.max(0, sel - 1); opts.onStructural && opts.onStructural(); redraw(); } }, "删除"),
    ));
    const tbl = h("table", { class: "ed-table" });
    const head = h("tr");
    for (const c of columns) head.append(h("th", null, c.label));
    tbl.append(h("thead", null, head));
    const body = h("tbody");
    list.forEach((it, i) => {
      const tr = h("tr", { class: i === sel ? "on" : "", onclick: () => { opts.sel = i; redraw(); } });
      for (const c of columns) tr.append(h("td", null, c.get ? c.get(it) : (it[c.k] == null ? "" : String(it[c.k]))));
      body.append(tr);
    });
    tbl.append(body);
    host.append(tbl);
    if (list[sel]) {
      host.append(h("h3", null, "编辑：" + (list[sel].name || list[sel].id || ("#" + sel))));
      const form = h("div", { class: "ed-grid" });
      host.append(form);
      const syncNames = () => {
        const trs = body.children;
        for (let i = 0; i < trs.length; i++) {
          const tds = trs[i].children;
          for (let j = 0; j < columns.length; j++) tds[j].textContent = columns[j].get ? columns[j].get(list[i]) : (list[i][columns[j].k] == null ? "" : String(list[i][columns[j].k]));
        }
      };
      renderForm(form, schema, list[sel], () => { opts.onChange && opts.onChange(); syncNames(); });
    }
  };
  redraw();
  return { redraw, getSel: () => opts.sel };
}
