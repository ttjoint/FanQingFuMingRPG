// 引擎入口页（Engine Launcher）—— 引擎自带的启动页，**不属于任何游戏版本**。
//
// 为什么要有这一层：
//   改造前，"选哪个数据版本"和"打开编辑器"这两个入口按钮塞在游戏标题菜单里
//   （core/layout.js 的 MENU_BUTTONS 中的 version / editor）。这有两个问题：
//     1) 它们是**引擎的能力**，不是游戏世界的一部分——塞进游戏菜单后，
//        任何新做的版本只要换掉菜单页就会把它们弄丢。
//     2) 顺序颠倒：玩家得先进某个游戏的标题页，才能选择要进哪个游戏。
//
//   现在的启动链是：
//     index.html → launcher（本文件，引擎资产） → 选定版本 → reload
//                → 该版本的初始页面（pages.json 的 initial，缺省 flash/title）
//
// 约束（重要）：
//   本文件**绝不读任何版本的文件**，只读版本索引（content/store.js）。
//   否则会形成"版本数据决定引擎入口长什么样"的循环依赖。它只做两件事：
//   列出可选版本、把选择结果写回索引，然后整页 reload。
import { h, clear } from "../editor/dom.js";
import { injectStyle } from "../editor/style.js";
import {
  listAllVersions, activeId, setActive, deletePack, loadPack,
  exportPack, exportProjectZip, importPack, pickJSON, pickZip,
  DEFAULT_VERSION, diskVersionsReady, refreshDiskVersions, renameVersion,
  createPack, createDiskPack, versionName,
} from "../content/store.js";

let root = null;

/** 入口页是否已挂载（index.html 启动时据此决定要不要拦截 boot）。 */
export function launcherOpen() { return !!root; }

/**
 * 打开引擎入口页。
 * @param {{onEnter:(id:string)=>void, onEdit:(id:string)=>void}} opts
 *   onEnter 选定版本后进入游戏；onEdit 打开该版本的编辑器。
 *   两个回调都由调用方注入，入口页自己不知道"进入游戏"意味着什么
 *   （这样同一个入口页也能被编辑器模式复用）。
 */
export function openLauncher(opts) {
  if (root) return;
  injectStyle();
  root = h("div", { id: "editorRoot", class: "launcher" });
  document.body.appendChild(root);
  render(opts || {});
}

function close() { if (root) { root.remove(); root = null; } }

async function render(opts) {
  clear(root);
  // 先立即渲染骨架（含内置版本行），再异步拉磁盘版本列表填表。
  //
  // 旧实现先 await refreshDiskVersions() 再建 DOM —— 静态部署下
  // __api__/versions 的 404 往返可能好几秒，这段时间页面只有黑底
  // 「加载引擎…」，用户看起来就像“退出游戏后黑屏卡死”。
  // 入口页自身不依赖磁盘探测结果，骨架先行即可；内置版本在探测完成
  // 前就能进，探测完成后重填列表补上磁盘/浏览器版本。
  const disk = diskVersionsReady();
  const bar = h("div", { class: "ed-bar" },
    h("span", { class: "ed-title" }, "引擎入口"),
    h("span", { class: "ed-hint", "data-role": "mode-hint" },
      disk ? "本地模式：版本可直接写入 versions/ 文件夹" : ""),
    h("span", { class: "ed-spacer" }),
    h("button", { class: "ed-btn primary", onclick: () => choose(activeId(), opts) }, "▶ 进入当前版本"),
    h("button", { class: "ed-btn", onclick: () => close() }, "关闭"),
  );

  const body = h("div", { class: "ed-main" });
  body.append(h("h3", null, "选择数据版本"));
  body.append(h("div", { class: "ed-hint", style: "margin-bottom:10px" },
    "版本决定用哪套游戏数据（物品、地图、脚本、界面、菜单页）。",
    "默认版本为原版复刻内容，只读；要改请「复制」出一个新版本。"));
  const tblWrap = h("div");
  body.append(tblWrap);
  body.append(h("div", { class: "ed-hint", style: "margin-top:14px", "data-role": "foot-hint" },
    "·「进入」会切到该版本并重新载入页面。",
    h("br"),
    "·「编辑」会以该版本为基准打开内容编辑器（只读版本也能编辑，保存时自动复制为可写版本）。"));
  root.append(bar, body);
  fillTable(tblWrap, disk, opts);

  // 异步探测磁盘/浏览器版本，完成后重填（快时无感，慢时用户已能看到内置版本）。
  refreshDiskVersions().then(() => {
    const d = diskVersionsReady();
    const modeHint = root.querySelector("[data-role=mode-hint]");
    if (modeHint && d && !disk) modeHint.textContent = "本地模式：版本可直接写入 versions/ 文件夹";
    const footHint = root.querySelector("[data-role=foot-hint]");
    if (footHint && d) {
      footHint.append(h("br"), "· 本地模式下：新建/复制的版本直接写入项目 versions/ 文件夹。");
    }
    fillTable(tblWrap, d, opts);
  }).catch(() => { });
}

/** 渲染版本列表（含内置版本，探测中也不至于空白）。 */
async function fillTable(wrap, disk, opts) {
  clear(wrap);
  const tbl = h("table", { class: "ed-table" });
  tbl.append(h("thead", null, h("tr", null,
    h("th", null, "版本"), h("th", null, "来源"), h("th", null, "更新时间"), h("th", null, "操作"))));
  const tb = h("tbody");
  const act = activeId();
  const all = [
    { id: DEFAULT_VERSION, name: "默认版本（原版）", builtin: true, readonly: true, source: disk ? "disk" : "builtin", updatedAt: 0 },
    ...(await listAllVersions()),
  ];
  for (const v of all) {
    const upd = v.updatedAt ? new Date(v.updatedAt).toLocaleString() : "—";
    const src = v.source === "disk" ? "磁盘" : (v.source === "browser" ? "浏览器" : "内置");
    const ops = h("td");
    ops.append(h("button", { class: "ed-btn primary", onclick: () => choose(v.id, opts) },
      v.id === act ? "▶ 进入（当前）" : "▶ 进入"));
    ops.append(" ", h("button", { class: "ed-btn", onclick: () => edit(v.id, opts) }, "编辑"));
    ops.append(" ", h("button", { class: "ed-btn", onclick: () => onCopy(v, opts) }, "复制"));
    if (!v.builtin && !v.readonly) {
      ops.append(" ", h("button", {
        class: "ed-btn",
        onclick: async () => { const n = prompt("重命名：", v.name); if (!n) return; const r = await renameVersion(v.id, n); if (r && r.ok === false) alert(r.error); render(opts); },
      }, "重命名"));
      ops.append(" ", h("button", { class: "ed-btn", onclick: async () => { const p = await loadPack(v.id); if (p) await exportPack(p); } }, "导出"));
      ops.append(" ", h("button", { class: "ed-btn", onclick: async () => { const p = await loadPack(v.id); if (p) await exportProjectZip(p); } }, "导出 zip"));
      ops.append(" ", h("button", {
        class: "ed-btn danger",
        onclick: async () => { if (confirm("删除版本「" + v.name + "」？")) { const r = await deletePack(v.id); if (r && r.ok === false) alert(r.error); render(opts); } },
      }, "删除"));
    } else {
      ops.append(" ", h("span", { class: "ed-hint", style: "margin-left:6px" }, "只读"));
    }
    tb.append(h("tr", null, h("td", null, v.name), h("td", null, src), h("td", null, upd), ops));
  }
  tbl.append(tb);
  wrap.append(tbl);
}

/** 进入某个版本的游戏（写索引 + 回调/reload）。 */
function choose(id, opts) {
  setActive(id);
  if (opts && typeof opts.onEnter === "function") { close(); opts.onEnter(id); return; }
  location.reload();
}

/** 以某个版本为基准打开编辑器。 */
function edit(id, opts) {
  setActive(id);
  if (opts && typeof opts.onEdit === "function") { close(); opts.onEdit(id); return; }
  // 未注入回调时退化为"写索引 + reload 后由主流程决定"，与 choose 一致。
  location.reload();
}

// 复制某版本为新版本（含其数据补丁），原版只读因此复制后可编辑。
async function onCopy(v, opts) {
  const n = prompt("复制为（新版本名称）：", (v.name || "版本") + " 副本");
  if (!n) return;
  try {
    const src = await loadPack(v.id);
    const patch = (src && src.patch) || {};
    if (diskVersionsReady()) await createDiskPack(n, patch, "default", (src && src.images) || {});
    else await createPack(n, patch, (src && src.images) || {});
  } catch (e) { alert(String(e.message || e)); }
  render(opts);
}
