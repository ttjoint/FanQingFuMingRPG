// 资源选择弹窗：给"图片类字段"用的通用选图/换图对话框。
//
// 设计目标（对应需求）：
//   - 不让人手打资源路径；点"更换"弹出本窗，在**带预览**的情况下挑。
//   - 资源可以是静态图，也可以是帧动画（选一整组帧 → 返回帧名数组）。
//   - 顶部搜索框实时过滤（无需回车），左列缩略图 + 右列大预览。
//   - 支持"上传本地图片"作为当前版本的覆盖资源。

import { h, clear } from "./dom.js";
import { searchAssets, groupOf, groupRank, assetSrc, fileName, assetIndex, buildAssetIndexAsync } from "./assets-index.js";

// 读取本地文件为 data URL。
export function readImageFile(file) {
  return new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result || ""));
    fr.readAsDataURL(file);
  });
}

// opts:
//   title      标题
//   dir        纯文件名时的目录前缀（如 "items_icons"），用于把"金创药.bmp"解析成完整路径
//   value      当前值（字符串或数组）
//   multi      true 时允许多选（帧动画）
//   onPick     回调 (value) => void；字符串 或 数组
//   onInline   （可选）处理"上传本地图"：返回要写入 ED.images 的 {key,dataURL}
export function openAssetPicker(opts) {
  const o = opts || {};
  const dir = (o.dir || "").replace(/\/$/, "");
  let multi = !!o.multi;
  let sel = new Set();       // 选中的资源键（完整 assets/... 路径）
  let query = "";

  // 当前值 → 选中集合
  const curList = Array.isArray(o.value) ? o.value.filter(Boolean) : (o.value ? [o.value] : []);
  for (const v of curList) sel.add(normalizeKey(v, dir));

  const mask = h("div", { class: "ed-modal-mask" });
  const dlg = h("div", { class: "ed-modal" });
  mask.append(dlg);

  const close = () => { mask.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
  document.addEventListener("keydown", onKey);

  // ---- 标题行 ----
  const head = h("div", { class: "ed-modal-head" },
    h("span", { class: "ed-modal-title" }, o.title || "选择资源"),
    h("label", { class: "ed-chk" },
      (() => { const cb = h("input", { type: "checkbox" }); cb.checked = multi; cb.onchange = () => { multi = cb.checked; if (!multi && sel.size > 1) { const f = [...sel][0]; sel = new Set([f]); } drawList(); drawPreview(); }; return cb; })(),
      h("span", null, "多选（帧动画）")),
    h("button", { class: "ed-btn ghost ed-btnicon", onclick: close, title: "关闭 (Esc)" }, "✕"));
  dlg.append(head);

  // ---- 搜索 ----
  const searchIn = h("input", { type: "text", placeholder: "搜索资源（空格分隔多关键词）…" });
  const cnt = h("span", { class: "ed-count" });
  const fileIn = h("input", { type: "file", accept: "image/*", style: "display:none" });
  const pickLocal = h("button", { class: "ed-btn", title: "把本地图片作为本版本的覆盖资源" }, "上传本地图…");
  pickLocal.onclick = () => fileIn.click();
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; if (!f) return;
    const data = await readImageFile(f);
    const key = "assets/" + (dir ? dir + "/" : "") + f.name.replace(/\.(bmp|jpg|jpeg|webp)$/i, ".png");
    ED_IMAGES_SET(key, data);   // 写入编辑器的 images 覆盖表
    // 让新上传的图立刻出现在清单里
    if (o.onIndexAdd) o.onIndexAdd(key);
    sel = new Set([key]);
    query = ""; searchIn.value = "";
    drawList(); drawPreview();
  };
  dlg.append(h("div", { class: "ed-tools" }, h("div", { class: "ed-search" }, searchIn), cnt, pickLocal, fileIn));

  searchIn.oninput = () => { query = searchIn.value; drawList(); };

  // ---- 主体：左缩略图列表 + 右大预览 ----
  const body = h("div", { class: "ed-modal-body" });
  const listEl = h("div", { class: "ed-modal-list" });
  const prevEl = h("div", { class: "ed-modal-prev" });
  body.append(listEl, prevEl);
  dlg.append(body);

  // ---- 底部 ----
  const foot = h("div", { class: "ed-modal-foot" });
  dlg.append(foot);

  let previewKey = [...sel][0] || null;

  function drawList() {
    clear(listEl);
    const all = searchAssets(query);
    // 只显示与目标目录相关的资源优先；但如果搜索了关键词，就全库搜（跨目录更好找）
    const relevant = query ? all : all.filter(p => !dir || p.includes("/" + dir + "/") || groupOf(p) === groupOf("assets/" + dir));
    const show = relevant.length ? relevant : all;
    cnt.textContent = "共 " + show.length + " 项" + (sel.size ? " / 已选 " + sel.size : "");
    // 分组显示（已知目录在前，"其它"垫底；组内保持路径顺序）
    const sorted = show.slice().sort((a, b) => groupRank(groupOf(a)) - groupRank(groupOf(b)));
    let lastGroup = null;
    for (const p of sorted) {
      const g = groupOf(p);
      if (g !== lastGroup) { listEl.append(h("div", { class: "ed-modal-group" }, g)); lastGroup = g; }
      const on = sel.has(p);
      const im = h("img", { src: assetSrc(p), loading: "lazy" });
      im.onerror = () => { im.style.opacity = "0.12"; };
      const row = h("div", { class: "ed-modal-item" + (on ? " on" : "") + (p === previewKey ? " cur" : ""), title: p },
        im, h("span", { class: "ed-modal-name" }, fileName(p)));
      row.onclick = () => {
        if (multi) {
          if (sel.has(p)) sel.delete(p); else sel.add(p);
        } else { sel = new Set([p]); }
        previewKey = p;
        drawList(); drawPreview();
      };
      listEl.append(row);
    }
    if (!show.length) listEl.append(h("div", { class: "ed-empty" }, "没有匹配的资源"));
    drawPreview();
  }

  function drawPreview() {
    clear(prevEl);
    const keys = [...sel];
    if (!keys.length) { prevEl.append(h("div", { class: "ed-empty" }, "点击左侧图片选择")); drawFoot(); return; }
    const k = previewKey && sel.has(previewKey) ? previewKey : keys[0];
    previewKey = k;
    prevEl.append(h("div", { class: "ed-modal-big" }, (() => {
      const im = h("img", { src: assetSrc(k) });
      im.onerror = () => { im.style.opacity = "0.12"; };
      return im;
    })()));
    prevEl.append(h("div", { class: "ed-modal-path" }, k));
    if (keys.length > 1) {
      // 帧动画：把已选帧按顺序排成缩略图条
      const strip = h("div", { class: "ed-modal-strip" });
      keys.forEach((p, i) => {
        const im = h("img", { src: assetSrc(p), title: p });
        im.onerror = () => { im.style.opacity = "0.12"; };
        const cell = h("div", { class: "ed-modal-frame" + (p === k ? " on" : "") }, im, h("span", null, String(i + 1)));
        cell.onclick = () => { previewKey = p; drawPreview(); drawList(); };
        strip.append(cell);
      });
      prevEl.append(h("div", { class: "ed-hint" }, "已选 " + keys.length + " 帧（按选择顺序）："), strip);
    }
    drawFoot();
  }

  function drawFoot() {
    clear(foot);
    foot.append(h("span", { class: "ed-hint" }, multi ? "多选模式：可挑选多张图组成帧序列" : "单选模式"));
    foot.append(h("button", { class: "ed-btn ghost", onclick: () => { sel = new Set(); previewKey = null; drawList(); } }, "清空"),
      h("button", { class: "ed-btn ghost", onclick: close }, "取消"),
      h("button", { class: "ed-btn", onclick: () => {
        const keys = [...sel];
        if (!keys.length) { close(); return; }
        if (o.onPick) o.onPick(stripDir(keys, dir));
        close();
      } }, "确定"));
  }

  document.body.append(mask);
  // 索引可能尚未建立（从其它分页直接点"更换…"时）：先异步建好再画。
  if (!assetIndex().length) {
    clear(listEl);
    listEl.append(h("div", { class: "ed-empty" }, "正在建立资源索引…"));
    buildAssetIndexAsync({ currentId: (typeof o.currentId === "string" ? o.currentId : undefined), images: o.images || {} })
      .then(() => { if (document.body.contains(mask)) drawList(); });
  } else {
    drawList();
  }
  searchIn.focus();
  return { close };
}

// 把当前值规整成完整 assets/... 键，方便与索引比较。
function normalizeKey(v, dir) {
  const s = String(v || "");
  if (!s) return "";
  if (s.startsWith("assets/")) return s.replace(/\.bmp$/i, ".png");
  if (/^(data:|blob:|https?:)/i.test(s)) return s;
  return "assets/" + (dir ? dir + "/" : "") + s.replace(/\.bmp$/i, ".png");
}

// 返回值：如果所有选中的图都在同一个已知目录下，就剥掉 "assets/<dir>/" 前缀，
// 只回文件名 —— 这样写回数据时与老格式（items.json 的 icon 只存文件名）一致。
function stripDir(keys, dir) {
  const full = keys.map(k => (k.startsWith("assets/") ? k : k));
  const d = dir ? "assets/" + dir + "/" : "";
  if (d && full.every(k => k.startsWith(d))) return full.map(k => k.slice(d.length));
  // 否则返回完整路径（不同目录/帧动画跨目录时保留全路径最安全）
  return full;
}

// 编辑器全局 images 覆盖表的写入口（由 index.js 注入，避免循环依赖）。
/** @type {(key: string, dataUrl: string) => void} */
let ED_IMAGES_SET = () => {};
export function setImagesWriter(fn) { ED_IMAGES_SET = fn; }
