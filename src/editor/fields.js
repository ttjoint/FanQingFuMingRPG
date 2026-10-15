// 表单向导：由 schema 生成可编辑控件，供 NPC / 物品 / 技能 / 数值 / 结局等复用。
import { h, clear } from "./dom.js";

let dlSeq = 0;

function valOf(f, obj) {
  const v = obj[f.k];
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

export function renderForm(host, schema, obj, onChange) {
  clear(host);
  const flag = f => { if (onChange) onChange(f); };
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
    if (f.type === "strlist") {
      const box = h("div", { class: "ed-drops" });
      renderStrList(box, obj, f, onChange);
      host.append(h("div", { class: "ed-field" }, lab, box));
      continue;
    }
    if (f.type === "textarea" || f.type === "lines") {
      ctl = h("textarea", { rows: f.rows || (f.type === "lines" ? 4 : 3) });
      ctl.value = v;
      ctl.oninput = () => {
        obj[f.k] = f.type === "lines" ? ctl.value.split("\n").map(s => s.trimEnd()).filter(s => s.length) : ctl.value;
        flag(f);
      };
    } else if (f.type === "select") {
      ctl = h("select");
      for (const o of f.options) {
        const value = Array.isArray(o) ? o[0] : o.v, label = Array.isArray(o) ? o[1] : o.label;
        ctl.append(h("option", { value }, label));
      }
      ctl.value = String(obj[f.k]);
      ctl.style.flex = "1";
      ctl.onchange = () => { obj[f.k] = f.numeric ? Number(ctl.value) : ctl.value; flag(f); };
    } else if (f.type === "checkbox") {
      ctl = h("input", { type: "checkbox" });
      ctl.checked = !!obj[f.k];
      ctl.onchange = () => { obj[f.k] = ctl.checked; flag(f); };
    } else if (f.type === "number") {
      ctl = h("input", { type: "number", step: f.step || 1 });
      if (f.min != null) ctl.min = f.min;
      if (f.max != null) ctl.max = f.max;
      if (f.def != null && (obj[f.k] == null || obj[f.k] === "")) obj[f.k] = f.def;
      ctl.value = valOf(f, obj);
      ctl.oninput = () => { obj[f.k] = ctl.value === "" ? 0 : Number(ctl.value); flag(f); };
    } else {
      ctl = h("input", { type: "text" });
      ctl.value = v;
      ctl.oninput = () => { obj[f.k] = ctl.value; flag(f); };
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
  }
}

// 列表 + 选中项表单 + 增删。list 为数组（会被就地修改）。
export function renderListEditor(host, opts) {
  const { list, schema, columns, makeNew } = opts;
  let sel = opts.sel != null ? opts.sel : 0;
  const redraw = () => {
    clear(host);
    host.append(h("div", { class: "ed-tools" },
      h("button", { class: "ed-btn", onclick: () => { list.push(makeNew()); opts.sel = list.length - 1; opts.onStructural && opts.onStructural(); } }, "＋ 新建"),
      h("button", { class: "ed-btn", onclick: () => { if (sel == null || !list[sel]) return; list.splice(sel + 1, 0, JSON.parse(JSON.stringify(list[sel]))); opts.sel = sel + 1; opts.onStructural && opts.onStructural(); } }, "复制"),
      h("button", { class: "ed-btn danger", onclick: () => { if (sel == null || !list[sel]) return; list.splice(sel, 1); opts.sel = Math.max(0, sel - 1); opts.onStructural && opts.onStructural(); } }, "删除"),
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
