// 编辑器「界面」页：可视化编辑 HUD / 背包 / 商店等界面元件。
//
// 布局数据在 content/ui 的 ui 域（元件数组），这里提供三件事：
//   1) 画布预览（640×480 等比缩放）+ 拖拽移动 / 右下角拖拽缩放 / 方向键微调；
//   2) 左侧元件列表 + 增删（含“新增元件”“复制”“删除”）；
//   3) 右侧属性面板（渲染成普通表单，复用 renderForm 的字段体系）。
//
// 之所以不复用 listTab：界面元件需要“所见即所得”的画布交互，
// 纯表格改数字体验太差（这本来就是用户提的诉求）。
import { h, clear } from "./dom.js";
import { createHistory } from "./history.js";
import { renderForm } from "./fields.js";
import { UI_KINDS, UI_ANCHORS, UI_BINDS, VIS_BINDS, UI_DRAWN_BY, resolvePos, hitTop } from "../content/ui.js";
import { getImg } from "../core/assets.js";

const VW = 640, VH = 480;   // 逻辑分辨率（与 core/constants.js 一致，但此处不 import 以免取 DOM）

const kindLabel = k => ({
  panel: "面板", bar: "状态条", slotgrid: "格子组", button: "按钮", label: "文字", image: "图片",
}[k] || k);

const visBindLabel = v => ({
  "": "（恒显示）", packOpen: "背包打开", shop: "商店打开", stashPanel: "仓库",
  waypointPanel: "传送点", smithPanel: "铁匠", mercPanel: "随从", savePanel: "存档",
  settingsPanel: "设置", dialog: "对话中", panel: "信息面板",
}[v] || v);

const drawnByLabel = d => ({ hud: "HUD 通用循环", none: "专用函数独占" }[d] || d);
const anchorLabel = a => ({
  topLeft: "左上", topRight: "右上", bottomLeft: "左下", bottomRight: "右下", center: "居中",
}[a] || a);

// 元件字段表（顺序即表单顺序）。
const SCHEMA = [
  { group: "基本" },
  { k: "id", label: "标识 id", type: "text", hint: "唯一；hud.* / pack.* / shop.* 前缀影响运行时语义" },
  { k: "kind", label: "类型", type: "select", options: UI_KINDS.map(k => [k, kindLabel(k)]) },
  { k: "visible", label: "显示", type: "bool" },
  { k: "visibleBind", label: "显隐条件", type: "select", options: VIS_BINDS.map(v => [v, visBindLabel(v)]),
    hint: "组件何时显示：例如背包面板绑“背包打开”。留空则恒由上面的“显示”控制" },
  { k: "drawnBy", label: "绘制归属", type: "select", options: UI_DRAWN_BY.map(d => [d, drawnByLabel(d)]),
    hint: "“专用函数独占”= 不走通用循环（如背包/商店底图由各自绘制函数画），避免同一层画两遍" },
  { k: "z", label: "层级 z", type: "num", hint: "越大越靠上；命中测试同样按它排序" },

  { group: "位置与尺寸" },
  { k: "anchor", label: "锚点", type: "select", options: UI_ANCHORS.map(a => [a, anchorLabel(a)]) },
  { k: "x", label: "偏移 x", type: "num", hint: "相对锚点的像素偏移（右下锚点用负值向左）" },
  { k: "y", label: "偏移 y", type: "num" },
  { k: "w", label: "宽", type: "num" },
  { k: "h", label: "高", type: "num" },

  { group: "外观" },
  { k: "img", label: "底图", type: "text", hint: "assets/ 下的图片路径，留空则用纯色" },
  { k: "color", label: "主色", type: "text", hint: "如 #c0392b" },
  { k: "bg", label: "背景色", type: "text" },
  { k: "text", label: "文字", type: "text" },

  { group: "数据绑定（bar / label）" },
  { k: "bind", label: "绑定", type: "select", options: [["", "（无）"]].concat(UI_BINDS.map(b => [b, b])) },

  { group: "格子（slotgrid）" },
  { k: "cols", label: "列", type: "num" },
  { k: "rows", label: "行", type: "num" },
  { k: "pitch", label: "格间距", type: "num" },
  { k: "padX", label: "左内边距", type: "num" },
  { k: "padY", label: "上内边距", type: "num" },
  { k: "slotW", label: "格宽", type: "num" },
  { k: "slotH", label: "格高", type: "num" },
];

// 新建元件：给一组能立刻看见的默认值（放在画面中间偏左，避免与既有元件完全重叠）。
function newComponent(ui) {
  const n = (ui.components || []).length + 1;
  let id = "ui.comp" + n;
  const taken = new Set((ui.components || []).map(c => c.id));
  let k = n;
  while (taken.has(id)) { k++; id = "ui.comp" + k; }
  return {
    id, kind: "panel", anchor: "topLeft", x: 40 + (n % 8) * 12, y: 40 + (n % 8) * 12,
    w: 120, h: 60, z: 100, img: "", color: "", bg: "rgba(24,28,36,0.85)", text: "", bind: "",
    visible: true, visibleBind: "", drawnBy: "hud",
    // slotgrid 需要的字段一并给上，切换 kind 时不用再补
    cols: 4, rows: 4, pitch: 34, padX: 6, padY: 6, slotW: 30, slotH: 30,
  };
}

// 挂载界面编辑页。返回清理函数（切页时调用，移除监听）。
export function mountUiTab(host, ui, opts) {
  const o = opts || {};
  const onChange = () => { o.onChange && o.onChange(ui); };
  let sel = 0;                     // 当前选中元件的下标
  let drag = null;                 // { mode:"move"|"resize", sx, sy, c, ox, oy, ow, oh }

  // ---- 撤销/重做 ----
  // 与 map-editor 一样用快照式历史：一次"操作"（拖拽结束 / 改字段 / 增删）
  // 存一份整表快照。界面元件表很小（十几项），快照成本可忽略，
  // 但换来的是任何操作都能可靠回退，不必为每个动作写逆操作。
  const history = createHistory(100);
  let lastSnap = snap();           // 与 map-editor 同样的基线策略：进页面先记一份

  function snap() { return JSON.stringify(ui.components); }
  // 一次操作结束：把"操作前"的快照记为 before、"操作后"记为 after 入栈。
  function commit(label) {
    const after = snap();
    if (after === lastSnap) return;            // 没实际变化（例如只点了一下）不入栈
    history.push({ before: lastSnap, after, label: label || "编辑界面" });
    lastSnap = after;
    syncUndoBtns();
  }
  // 撤销后尽量保持"同一个元件"仍被选中：元件增删会让下标整体错位，
  // 只钳制下标会让选中项漂到不相干的元件上（用户接着拖拽就会拖错东西）。
  // 记住的是 id 链：当前选中不存在时，回退到最近一次仍存在的历史选中。
  let recentIds = [];
  function rememberSel() {
    const c = ui.components[sel];
    if (!c) return;
    recentIds = [c.id].concat(recentIds.filter(x => x !== c.id)).slice(0, 30);
  }
  function restore(json) {
    rememberSel();                       // 先记下"撤销前选的是谁"
    ui.components = JSON.parse(json);
    sel = Math.max(0, Math.min(sel, ui.components.length - 1));
    // 从最近的 id 往回找，取第一个在新快照里仍存在的
    for (const id of recentIds) {
      const i = ui.components.findIndex(c => c.id === id);
      if (i >= 0) { sel = i; break; }
    }
    dirty(); renderAll(); syncUndoBtns();
  }
  function undo() {
    const e = history.undo();
    if (!e) return;
    lastSnap = e.before; restore(e.before);
  }
  function redo() {
    const e = history.redo();
    if (!e) return;
    lastSnap = e.after; restore(e.after);
  }

  // ---------- 布局：左列表 | 中画布 | 右属性 ----------
  const left = h("div", { class: "ed-ui-list" });
  const mid = h("div", { class: "ed-ui-canvas" });
  const right = h("div", { class: "ed-ui-props" });
  host.append(h("div", { class: "ed-ui-wrap" }, left, mid, right));

  // ---------- 画布 ----------
  const cv = h("canvas", { class: "ed-ui-cv" });
  const tip = h("div", { class: "ed-ui-tip" },
    "拖动移动，右下角拖动缩放，方向键微调（Shift 步长 10）");
  mid.append(cv, tip);
  const c2d = cv.getContext("2d");

  // 逻辑坐标 ↔ 画布坐标（等比缩放，留 12px 边距）。
  let scale = 1, padX = 0, padY = 0;
  function layoutCanvas() {
    const box = mid.getBoundingClientRect();
    const availW = Math.max(160, box.width - 24);
    const availH = Math.max(120, box.height - 44);
    scale = Math.min(availW / VW, availH / VH);
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.round(VW * scale), cssH = Math.round(VH * scale);
    cv.style.width = cssW + "px"; cv.style.height = cssH + "px";
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    padX = Math.round((box.width - cssW) / 2);
    padY = 12;
    cv.style.marginLeft = padX + "px";
  }
  const toLogical = ev => {
    const r = cv.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale };
  };

  // ---------- 绘制 ----------
  function draw() {
    if (!cv.width) return;
    const dpr = window.devicePixelRatio || 1;
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cv.width / dpr, H = cv.height / dpr;
    c2d.clearRect(0, 0, W, H);
    // 逻辑画布底色（模拟游戏画面）
    c2d.save();
    c2d.scale(scale, scale);
    c2d.fillStyle = "#0a0a0a"; c2d.fillRect(0, 0, VW, VH);
    // 画布网格（每 40 逻辑像素一条），便于对位
    c2d.strokeStyle = "rgba(120,140,170,0.10)"; c2d.lineWidth = 1 / scale;
    for (let x = 0; x <= VW; x += 40) { c2d.beginPath(); c2d.moveTo(x, 0); c2d.lineTo(x, VH); c2d.stroke(); }
    for (let y = 0; y <= VH; y += 40) { c2d.beginPath(); c2d.moveTo(0, y); c2d.lineTo(VW, y); c2d.stroke(); }
    // 安全区参考线（旧 HUD 上沿 y=380）
    c2d.strokeStyle = "rgba(232,190,82,0.22)"; c2d.setLineDash([6, 6]);
    c2d.beginPath(); c2d.moveTo(0, VH - 100); c2d.lineTo(VW, VH - 100); c2d.stroke();
    c2d.setLineDash([]);

    // 元件（按 z 升序，与运行时一致）
    const list = sorted(ui);
    for (const c of list) if (c.visible !== false) drawComponent(c2d, c);
    // 选中框
    const sc = ui.components[sel];
    if (sc) {
      const p = resolvePos(sc, VW, VH);
      c2d.strokeStyle = "#4ea1ff"; c2d.lineWidth = Math.max(1, 1.5 / scale);
      c2d.strokeRect(p.x + .5 / scale, p.y + .5 / scale, sc.w, sc.h);
      // 右下角缩放手柄
      const s = 10 / scale;
      c2d.fillStyle = "#4ea1ff";
      c2d.fillRect(p.x + sc.w - s / 2, p.y + sc.h - s / 2, s, s);
      // id 标签
      c2d.fillStyle = "#8fd0ff"; c2d.font = (11 / scale) + "px 'Microsoft YaHei',sans-serif";
      c2d.fillText(sc.id, p.x, Math.max(11 / scale, p.y - 3 / scale));
    }
    c2d.restore();
  }

  function drawComponent(g, c) {
    const p = resolvePos(c, VW, VH);
    const img = c.img ? getImg(c.img) : null;
    if (img) g.drawImage(img, p.x, p.y, c.w, c.h);
    else if (c.bg) { g.fillStyle = c.bg; g.fillRect(p.x, p.y, c.w, c.h); }

    if (c.kind === "bar") {
      g.fillStyle = c.bg || "#111111"; g.fillRect(p.x, p.y, c.w, c.h);
      const fill = barRatio();
      g.fillStyle = c.color || "#c0392b";
      g.fillRect(p.x, p.y, Math.round(c.w * fill), c.h);
    } else if (c.kind === "slotgrid") {
      const total = Math.min(c.cols * c.rows, 25);
      for (let i = 0; i < total; i++) {
        const col = i % c.cols, row = Math.floor(i / c.cols);
        const sx = p.x + c.padX + col * c.pitch, sy = p.y + c.padY + row * c.pitch;
        g.strokeStyle = "rgba(184,164,104,0.75)"; g.lineWidth = 1 / scale;
        g.strokeRect(sx + .5 / scale, sy + .5 / scale, c.slotW, c.slotH);
      }
    }
    if (!img && !c.bg) {
      // 无底图无背景色：画虚线框，保证空元件也看得见
      g.strokeStyle = "rgba(140,160,190,0.5)"; g.setLineDash([3 / scale, 3 / scale]);
      g.strokeRect(p.x + .5 / scale, p.y + .5 / scale, c.w, c.h); g.setLineDash([]);
    }
    if (c.kind === "label" || c.kind === "button") {
      g.fillStyle = c.color || "#e8e8e8";
      g.font = (12 / scale) + "px 'Microsoft YaHei',sans-serif";
      g.textBaseline = "middle";
      g.fillText(String(c.text || c.id), p.x + 4, p.y + c.h / 2);
      g.textBaseline = "alphabetic";
    }
  }

  // 预览里的 bar 填充比例用固定值（0.62），避免依赖运行时状态——
  // 这是布局编辑器，要看清条的“形状”，不是看真实血量。
  const barRatio = () => 0.62;

  // ---------- 左列表 ----------
  let undoBtnEl = null, redoBtnEl = null;
  function syncUndoBtns() {
    if (undoBtnEl) undoBtnEl.disabled = !history.canUndo();
    if (redoBtnEl) redoBtnEl.disabled = !history.canRedo();
  }
  function renderLeft() {
    clear(left);
    left.append(h("div", { class: "ed-ui-ltitle" }, "界面元件（" + ui.components.length + "）"));
    ui.components.forEach((c, i) => {
      const row = h("div", {
        class: "ed-ui-lrow" + (i === sel ? " on" : "") + (c.visible === false ? " off" : ""),
        onclick: () => { sel = i; rememberSel(); renderAll(); },
      },
        h("span", { class: "ed-ui-lkind" }, kindLabel(c.kind)),
        h("span", { class: "ed-ui-lid" }, c.id));
      left.append(row);
    });
    const bar = h("div", { class: "ed-ui-lbar" });
    bar.append(
      h("button", { class: "ed-btn", onclick: addComp }, "新增"),
      h("button", { class: "ed-btn", onclick: dupComp }, "复制"),
      h("button", { class: "ed-btn danger", onclick: delComp }, "删除"),
    );
    left.append(bar);
    // 撤销/重做（与 Ctrl+Z / Ctrl+Y 等价）
    undoBtnEl = h("button", { class: "ed-btn", title: "撤销 (Ctrl+Z)", onclick: undo }, "撤销");
    redoBtnEl = h("button", { class: "ed-btn", title: "重做 (Ctrl+Y)", onclick: redo }, "重做");
    left.append(h("div", { class: "ed-ui-lbar" }, undoBtnEl, redoBtnEl));
    syncUndoBtns();
  }

  function addComp() {
    ui.components.push(newComponent(ui));
    sel = ui.components.length - 1;
    dirty(); renderAll(); commit("新增元件");
  }
  function dupComp() {
    const src = ui.components[sel];
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    const taken = new Set(ui.components.map(c => c.id));
    let k = 1, id = src.id + "_copy";
    while (taken.has(id)) { k++; id = src.id + "_copy" + k; }
    copy.id = id; copy.x += 12; copy.y += 12;
    ui.components.splice(sel + 1, 0, copy);
    sel++; dirty(); renderAll(); commit("复制元件");
  }
  function delComp() {
    if (!ui.components[sel]) return;
    const name = ui.components[sel].id;
    if (!confirm("删除界面元件「" + name + "」？")) return;
    ui.components.splice(sel, 1);
    sel = Math.max(0, Math.min(sel, ui.components.length - 1));
    dirty(); renderAll(); commit("删除元件");
  }
  const dirty = () => { onChange(); };

  // ---------- 右属性 ----------
  function renderRight() {
    clear(right);
    const c = ui.components[sel];
    if (!c) { right.append(h("div", { class: "ed-hint" }, "没有选中元件。")); return; }
    right.append(h("div", { class: "ed-ui-ptitle" }, c.id + "（" + kindLabel(c.kind) + "）"));
    // renderForm 会 clear(host)，所以不能直接传 right，否则标题被清掉。
    const box = h("div");
    right.append(box);
    renderForm(box, SCHEMA, c, () => {
      // 改 id 时保证唯一：重名自动加后缀（否则运行时按 id 查表会取错元件）
      const ids = ui.components.map(x => x.id);
      if (ids.filter(x => x === c.id).length > 1) {
        let k = 2, id = c.id + "_" + k;
        while (ids.includes(id)) { k++; id = c.id + "_" + k; }
        c.id = id;
        recentIds = [id].concat(recentIds.filter(x => x !== id)).slice(0, 30);
        renderAll();            // id 变了要重画左右两侧
        dirty(); commit("改元件 id"); return;
      }
      dirty(); draw(); renderLeft();
      commit("改元件属性");
    });
  }

  function renderAll() { renderLeft(); renderRight(); layoutCanvas(); draw(); }

  // ---------- 鼠标交互 ----------
  const onDown = ev => {
    layoutCanvas();
    const q = toLogical(ev);
    const c = ui.components[sel];
    // 先判断是否点在当前选中元件的缩放手柄上
    if (c && c.visible !== false) {
      const p = resolvePos(c, VW, VH);
      const s = 12 / scale;
      if (q.x >= p.x + c.w - s && q.x <= p.x + c.w + s && q.y >= p.y + c.h - s && q.y <= p.y + c.h + s) {
        drag = { mode: "resize", sx: q.x, sy: q.y, c, ow: c.w, oh: c.h, base: snap() };
        ev.preventDefault();
        return;
      }
    }
    // 否则按 z 从上到下命中（跳过不可见）
    const hitList = sorted(ui).filter(x => x.visible !== false).reverse();
    const hit = hitList.find(x => {
      const p = resolvePos(x, VW, VH);
      return q.x >= p.x && q.x < p.x + x.w && q.y >= p.y && q.y < p.y + x.h;
    });
    if (hit) {
      sel = ui.components.indexOf(hit);
      drag = { mode: "move", sx: q.x, sy: q.y, c: hit, ox: hit.x, oy: hit.y, base: snap() };
      renderAll();
      ev.preventDefault();
    }
  };
  const onMove = ev => {
    if (!drag) return;
    const q = toLogical(ev);
    const c = drag.c;
    if (drag.mode === "move") {
      c.x = Math.round(drag.ox + (q.x - drag.sx));
      c.y = Math.round(drag.oy + (q.y - drag.sy));
    } else {
      c.w = Math.max(4, Math.round(drag.ow + (q.x - drag.sx)));
      c.h = Math.max(4, Math.round(drag.oh + (q.y - drag.sy)));
    }
    renderRight(); draw(); dirty();
    ev.preventDefault();
  };
  const onUp = () => {
    if (!drag) return;
    const moved = drag.base !== snap();
    drag = null;
    // 一次拖拽只入一条历史（否则每个 mousemove 都会推一条，撤销要点上百次）
    if (moved) { history.push({ before: lastSnap, after: snap(), label: "拖拽元件" }); lastSnap = snap(); syncUndoBtns(); }
  };

  // 方向键微调（挂在画布上，避免抢全局快捷键）
  const onKey = ev => {
    const c = ui.components[sel];
    if (!c) return;
    const step = ev.shiftKey ? 10 : 1;
    const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = map[ev.key];
    if (!d) return;
    c.x += d[0]; c.y += d[1];
    ev.preventDefault(); renderRight(); draw(); dirty(); commit("微调位置");
  };

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y：撤销重做。
  // 挂在 document 上（而不是画布），因为用户改完属性框里也可能想直接撤销；
  // 但在输入框里打字时让浏览器自己的撤销生效，不抢。
  const onUndoKey = ev => {
    const el = /** @type {any} */ (ev.target);
    const tag = (el && el.tagName) || "";
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(tag) || !!(el && el.isContentEditable);
    if (!(ev.ctrlKey || ev.metaKey)) return;
    const k = ev.key.toLowerCase();
    if (k === "z" && !ev.shiftKey) {
      if (typing) return;                 // 输入框内交给浏览器
      ev.preventDefault(); undo();
    } else if ((k === "z" && ev.shiftKey) || k === "y") {
      if (typing) return;
      ev.preventDefault(); redo();
    }
  };

  cv.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  cv.addEventListener("keydown", onKey);
  document.addEventListener("keydown", onUndoKey);
  cv.tabIndex = 0;                       // 可聚焦以接收方向键
  // 容器尺寸变化时重排（编辑器栏可拖拽缩放）
  const ro = ("ResizeObserver" in window) ? new ResizeObserver(() => { layoutCanvas(); draw(); }) : null;
  if (ro) ro.observe(mid);

  layoutCanvas();
  renderAll();

  return () => {
    cv.removeEventListener("mousedown", onDown);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    cv.removeEventListener("keydown", onKey);
    document.removeEventListener("keydown", onUndoKey);
    if (ro) ro.disconnect();
  };
}

// 按 z 升序（同 z 保持原顺序），与 render/hud.js 的 sortedComps 一致。
function sorted(ui) {
  return ui.components
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.z - b.c.z) || (a.i - b.i))
    .map(x => x.c);
}
