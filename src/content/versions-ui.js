// 数据版本管理：开始游戏前选择/新建/导入导出内容版本。
import { h, clear } from "../editor/dom.js";
import { injectStyle } from "../editor/style.js";
import { G } from "../core/state.js";
import {
  listVersions, activeId, setActive, createPack, deletePack, loadPack,
  savePack, exportPack, exportProjectZip, importPack, pickJSON, pickZip, DEFAULT_VERSION,
} from "./store.js";

let root = null;

function meta() {
  const list = listVersions();
  return [{ id: DEFAULT_VERSION, name: "默认版本（原版）", builtin: true, updatedAt: 0 }, ...list];
}

export function openVersionManager() {
  if (root) return;
  injectStyle();
  root = h("div", { id: "editorRoot" });
  G.scene = "version";
  document.body.appendChild(root);
  render();
}

function close() { if (root) { root.remove(); root = null; G.scene = "menu"; } }

function choose(id) {
  setActive(id);
  location.reload();
}

function render() {
  clear(root);
  const bar = h("div", { class: "ed-bar" },
    h("span", { class: "ed-title" }, "数据版本"),
    h("span", { class: "ed-hint" }, "选择一个版本后开始游戏；编辑器保存的版本会出现在这里"),
    h("span", { class: "ed-spacer" }),
    h("button", { class: "ed-btn", onclick: async () => { const n = prompt("新版本名称：", "我的版本"); if (n) { await createPack(n); render(); } } }, "＋ 新建"),
    h("button", { class: "ed-btn", onclick: () => pickJSON(async o => { try { await importPack(o); render(); } catch (e) { alert(String(e.message || e)); } }) }, "导入版本"),
    h("button", { class: "ed-btn", onclick: () => pickZip(async o => { try { await importPack(o); render(); } catch (e) { alert(String(e.message || e)); } }) }, "导入 zip"),
    h("button", { class: "ed-btn", onclick: close }, "关闭"),
  );
  const body = h("div", { class: "ed-main" });
  const tbl = h("table", { class: "ed-table" });
  tbl.append(h("thead", null, h("tr", null,
    h("th", null, "版本"), h("th", null, "更新时间"), h("th", null, "操作"))));
  const tb = h("tbody");
  const act = activeId();
  for (const v of meta()) {
    const upd = v.updatedAt ? new Date(v.updatedAt).toLocaleString() : "—";
    const ops = h("td");
    ops.append(h("button", { class: "ed-btn primary", onclick: () => choose(v.id) }, v.id === act ? "▶ 当前" : "选择"));
    if (!v.builtin) {
      ops.append(" ", h("button", { class: "ed-btn", onclick: async () => { const n = prompt("重命名：", v.name); if (!n) return; const pk = await loadPack(v.id); if (pk) { pk.name = n; await savePack(pk); render(); } } }, "重命名"));
      ops.append(" ", h("button", { class: "ed-btn", onclick: async () => { const p = await loadPack(v.id); if (p) exportPack(p); } }, "导出"));
      ops.append(" ", h("button", { class: "ed-btn", onclick: async () => { const p = await loadPack(v.id); if (p) exportProjectZip(p); } }, "导出 zip"));
      ops.append(" ", h("button", { class: "ed-btn danger", onclick: async () => { if (confirm("删除版本「" + v.name + "」？")) { await deletePack(v.id); render(); } } }, "删除"));
    }
    tb.append(h("tr", null, h("td", null, v.name), h("td", null, upd), ops));
  }
  tbl.append(tb);
  body.append(tbl);
  body.append(h("div", { class: "ed-hint", style: "margin-top:10px" },
    "· 默认版本为原版数据，只读。编辑器保存的修改会成为独立版本，选择它即用该版本开始游戏。",
    h("br"), "· 导出得到 .gsxy.json 文件，可备份/分享；导入即可加入本列表。"));
  root.append(bar, body);
}
