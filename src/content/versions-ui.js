// 数据版本管理：开始游戏前选择/新建/复制/导入导出内容版本。
// - 原版（默认版本）只读，不可修改/删除。
// - 本地开发服务器（python serve.py）提供磁盘版本库后端时，可把版本直接写入 versions/<id>/；
//   否则退化为纯浏览器（localStorage/IndexedDB）存储。
import { h, clear } from "../editor/dom.js";
import { injectStyle } from "../editor/style.js";
import { G } from "../core/state.js";
import {
  listAllVersions, activeId, setActive, createPack, createDiskPack, deletePack, loadPack,
  savePack, exportPack, exportProjectZip, importPack, pickJSON, pickZip, DEFAULT_VERSION,
  diskVersionsReady, isDiskVersion, isDiskReadonly, renameVersion, refreshDiskVersions,
} from "./store.js";

let root = null;

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

async function render() {
  clear(root);
  await refreshDiskVersions();
  const disk = diskVersionsReady();
  const bar = h("div", { class: "ed-bar" },
    h("span", { class: "ed-title" }, "数据版本"),
    h("span", { class: "ed-hint" }, disk
      ? "本地模式：版本可直接写入 versions/ 文件夹"
      : "浏览器模式：版本保存在本地浏览器（静态部署不含写文件后端）"),
    h("span", { class: "ed-spacer" }),
    h("button", { class: "ed-btn primary", onclick: () => onNew(disk) }, "＋ 新建版本"),
    h("button", { class: "ed-btn", onclick: () => pickJSON(async o => { try { await importPack(o); render(); } catch (e) { alert(String(e.message || e)); } }) }, "导入版本"),
    h("button", { class: "ed-btn", onclick: () => pickZip(async o => { try { await importPack(o); render(); } catch (e) { alert(String(e.message || e)); } }) }, "导入 zip"),
    h("button", { class: "ed-btn", onclick: close }, "关闭"),
  );
  const body = h("div", { class: "ed-main" });
  const tbl = h("table", { class: "ed-table" });
  tbl.append(h("thead", null, h("tr", null,
    h("th", null, "版本"), h("th", null, "来源"), h("th", null, "更新时间"), h("th", null, "操作"))));
  const tb = h("tbody");
  const act = activeId();
  const all = [{ id: DEFAULT_VERSION, name: "默认版本（原版）", builtin: true, readonly: true, source: disk ? "disk" : "builtin", updatedAt: 0 }, ...(await listAllVersions())];
  for (const v of all) {
    const upd = v.updatedAt ? new Date(v.updatedAt).toLocaleString() : "—";
    const src = v.source === "disk" ? "磁盘" : (v.source === "browser" ? "浏览器" : "内置");
    const ops = h("td");
    ops.append(h("button", { class: "ed-btn primary", onclick: () => choose(v.id) }, v.id === act ? "▶ 当前" : "选择"));
    // 复制为可写版本（对任何版本都可用，包括只读原版）。
    ops.append(" ", h("button", { class: "ed-btn", onclick: () => onCopy(v) }, "复制"));
    if (!v.builtin && !v.readonly) {
      ops.append(" ", h("button", { class: "ed-btn", onclick: async () => { const n = prompt("重命名：", v.name); if (!n) return; const r = await renameVersion(v.id, n); if (r && r.ok === false) alert(r.error); render(); } }, "重命名"));
      ops.append(" ", h("button", { class: "ed-btn", onclick: async () => { const p = await loadPack(v.id); if (p) await exportPack(p); } }, "导出"));
      ops.append(" ", h("button", { class: "ed-btn", onclick: async () => { const p = await loadPack(v.id); if (p) await exportProjectZip(p); } }, "导出 zip"));
      ops.append(" ", h("button", { class: "ed-btn danger", onclick: async () => { if (confirm("删除版本「" + v.name + "」？")) { const r = await deletePack(v.id); if (r && r.ok === false) alert(r.error); render(); } } }, "删除"));
    } else if (v.readonly || v.builtin) {
      ops.append(" ", h("span", { class: "ed-hint", style: "margin-left:6px" }, "只读"));
    }
    tb.append(h("tr", null, h("td", null, v.name), h("td", null, src), h("td", null, upd), ops));
  }
  tbl.append(tb);
  body.append(tbl);
  body.append(h("div", { class: "ed-hint", style: "margin-top:10px" },
    "· 默认版本为原版数据，只读；如需修改请「复制」出一个新版本再编辑。",
    h("br"),
    disk
      ? "· 本地模式下：新建/复制/编辑的版本会直接写入项目 versions/ 文件夹（每个版本一个文件夹，便于版本管理）。"
      : "· 浏览器模式下：版本保存在本地浏览器；导出 .gsxy.json / zip 可备份或迁移。"));
  root.append(bar, body);
}

// 新建：优先磁盘（本地后端可用），否则浏览器。
async function onNew(disk) {
  const n = prompt("新版本名称：", "我的版本");
  if (!n) return;
  try {
    if (disk) await createDiskPack(n, {}, "default");
    else await createPack(n);
  } catch (e) { alert(String(e.message || e)); }
  render();
}

// 复制某版本为新版本（含其数据补丁），原版只读因此复制后可编辑。
async function onCopy(v) {
  const n = prompt("复制为（新版本名称）：", (v.name || "版本") + " 副本");
  if (!n) return;
  try {
    const src = await loadPack(v.id);
    const patch = (src && src.patch) || {};
    if (diskVersionsReady()) await createDiskPack(n, patch, "default", (src && src.images) || {});
    else await createPack(n, patch, (src && src.images) || {});
  } catch (e) { alert(String(e.message || e)); }
  render();
}
