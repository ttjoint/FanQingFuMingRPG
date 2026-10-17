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

  let searchT = 0;
  searchIn.oninput = () => {
    query = searchIn.value;
    clearTimeout(searchT);
    searchT = setTimeout(drawList, 160);
  };

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

  // 性能：点选时**不重建列表**（资源上千条，重建会重新请求/解码所有缩略图，
  // 点一下卡一下）。只有搜索/上传/多选模式切换才重建 DOM；点选只改 class。
  const rowByPath = new Map();
  let io = null;
  const LIST_MAX = 3000;
  const ioNow = () => {
    if (io) return io;
    io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = /** @type {HTMLImageElement} */ (e.target);
        const src = img.dataset.lazy;
        if (src) { img.src = src; delete img.dataset.lazy; }
        io.unobserve(img);
      }
    }, { root: listEl, rootMargin: "260px" });
    return io;
  };
  const refreshMarks = () => {
    for (const [p, row] of rowByPath) {
      row.classList.toggle("on", sel.has(p));
      row.classList.toggle("cur", p === previewKey);
    }
    cnt.textContent = "共 " + rowByPath.size + " 项" + (sel.size ? " / 已选 " + sel.size : "");
  };

  function drawList() {
    if (io) { io.disconnect(); io = null; }
    rowByPath.clear();
    clear(listEl);
    const all = searchAssets(query);
    // 只显示与目标目录相关的资源优先；但如果搜索了关键词，就全库搜（跨目录更好找）
    const relevant = query ? all : all.filter(p => !dir || p.includes("/" + dir + "/") || groupOf(p) === groupOf("assets/" + dir));
    const show = relevant.length ? relevant : all;
    // 分组显示（已知目录在前，"其它"垫底；组内保持路径顺序）
    const sorted = show.slice().sort((a, b) => groupRank(groupOf(a)) - groupRank(groupOf(b)));
    const obs = ioNow();
    let lastGroup = null;
    let shown = 0;
    for (const p of sorted) {
      if (shown >= LIST_MAX) break;
      shown++;
      const g = groupOf(p);
      if (g !== lastGroup) { listEl.append(h("div", { class: "ed-modal-group" }, g)); lastGroup = g; }
      const on = sel.has(p);
      const im = h("img", { loading: "lazy", decoding: "async" });
      im.dataset.lazy = assetSrc(p);
      im.onerror = () => { im.style.opacity = "0.12"; };
      const row = h("div", { class: "ed-modal-item" + (on ? " on" : "") + (p === previewKey ? " cur" : ""), title: p },
        im, h("span", { class: "ed-modal-name" }, fileName(p)));
      row.onclick = () => {
        if (multi) {
          if (sel.has(p)) sel.delete(p); else sel.add(p);
        } else { sel = new Set([p]); }
        previewKey = p;
        refreshMarks();     // 只改 class，不重建列表
        drawPreview();
      };
      rowByPath.set(p, row);
      listEl.append(row);
      obs.observe(im);
    }
    if (!show.length) listEl.append(h("div", { class: "ed-empty" }, "没有匹配的资源"));
    else if (sorted.length > shown) listEl.append(h("div", { class: "ed-empty" }, "还有 " + (sorted.length - shown) + " 项未列出，请用搜索缩小范围"));
    refreshMarks();
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
        cell.onclick = () => { previewKey = p; refreshMarks(); drawPreview(); };
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

// ---------------------------------------------------------------------------
// 行走图（.pmg 模型名）选择器
//
// NPC 的 model 字段存的是 chars.json 里的**模型名**，不是资源路径，所以不能走
// 图片选择器。这里给一个缩略图网格：每格显示该模型的站立首帧 + 名字，
// 搜索按模型名模糊匹配。
// ---------------------------------------------------------------------------
/**
 * @param {{title?:string, models:string[], modelSrc?:(m:string)=>string|null,
 *          value?:string, onPick:(v:string)=>void}} o
 */
export function openModelPicker(o) {
  const src = o.modelSrc || (() => null);
  const mask = h("div", { class: "ed-modal-mask" });
  const box = h("div", { class: "ed-modal" });
  const close = () => mask.remove();

  const searchIn = h("input", { type: "text", placeholder: "搜索模型名…" });
  const listEl = h("div", { class: "ed-modal-list" });
  const gridEl = h("div", { class: "ed-modelgrid" });
  listEl.append(gridEl);

  let cur = o.value || (o.models[0] || "");
  const preview = h("div", { class: "ed-modal-prev" });
  const prevImg = h("img", { style: "max-width:200px;max-height:200px;image-rendering:pixelated" });
  const prevName = h("div", { class: "ed-modal-path" });
  preview.append(prevImg, prevName);

  const drawGrid = () => {
    clear(gridEl);
    const q = searchIn.value.trim().toLowerCase();
    const show = q ? o.models.filter(m => m.toLowerCase().includes(q)) : o.models;
    for (const m of show) {
      const s = src(m);
      const cell = h("div", { class: "ed-modelcell" + (m === cur ? " on" : ""), title: m });
      const im = h("img", { src: s || "", style: "image-rendering:pixelated" });
      if (!s) { im.style.visibility = "hidden"; im.style.width = "40px"; im.style.height = "40px"; }
      cell.append(im, h("span", null, m));
      cell.onclick = () => {
        cur = m;
        for (const c of gridEl.children) c.classList.remove("on");
        cell.classList.add("on");
        const ps = src(m);
        if (ps) { prevImg.src = ps; prevImg.style.display = ""; } else prevImg.style.display = "none";
        prevName.textContent = m;
      };
      gridEl.append(cell);
    }
    if (!show.length) gridEl.append(h("div", { class: "ed-empty" }, "没有匹配的模型"));
  };
  searchIn.oninput = drawGrid;

  box.append(h("div", { class: "ed-modal-head" },
    h("div", { class: "ed-modal-title" }, o.title || "选择行走图"),
    h("div", { class: "ed-search" }, searchIn)));
  box.append(h("div", { class: "ed-modal-body" }, listEl, preview));
  box.append(h("div", { class: "ed-modal-foot" },
    h("button", { class: "ed-btn ghost", onclick: close }, "取消"),
    h("button", { class: "ed-btn", onclick: () => { if (cur) o.onPick(cur); close(); } }, "确定")));
  mask.append(box);
  mask.addEventListener("mousedown", e => { if (e.target === mask) close(); });
  document.body.append(mask);
  drawGrid();
  const ps = src(cur);
  if (ps) { prevImg.src = ps; } else prevImg.style.display = "none";
  prevName.textContent = cur;
}
