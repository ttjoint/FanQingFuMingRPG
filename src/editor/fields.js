// 表单向导：由 schema 生成可编辑控件，供 NPC / 物品 / 技能 / 数值 / 结局等复用。
import { h, clear } from "./dom.js";
import { openAssetPicker, openModelPicker } from "./asset-picker.js";
import { assetSrc, audioSrc } from "./assets-index.js";

let dlSeq = 0;

/**
 * 图片占位块：没有图片 / 图片加载失败时显示的**空图案**。
 * 之前是显示 <img> 加载失败的破图（浏览器默认的问号/裂图），或者只放一行灰字，
 * 视觉上很脏。这里统一成一个虚线框 + 灰图标 + 提示文字，
 * 尺寸跟真实预览图一致（96px，frames 用 72px），所以切换时布局不会跳。
 * @param {string} [text] 提示文字，默认「无图片」
 * @param {boolean} [small] 是否用帧序列的较小尺寸
 */
export function imgPlaceholder(text, small) {
  return h("div", { class: "ed-imgph" + (small ? " small" : ""), title: text || "无图片" },
    h("span", { class: "ed-imgph-icon" }, "🖼"),
    h("span", { class: "ed-imgph-text" }, text || "无图片"));
}

/**
 * 把一个 <img> 挂上「加载失败 → 换成占位图」的行为。
 * 返回的 replace() 可在需要时手动切换。图片加载失败很常见
 * （数据里引用了不存在/改名过的文件），不能让它一直显示破图。
 */
export function guardImage(im, text, small) {
  const ph = imgPlaceholder(text, small);
  ph.style.display = "none";
  const host = h("span", { class: "ed-imgslot" }, im, ph);
  im.onerror = () => { im.style.display = "none"; ph.style.display = ""; };
  im.onload = () => { im.style.display = ""; ph.style.display = "none"; };
  return host;
}

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
// 稀有度选项：留空 = 跟随怪物等级曲线（engine/lootScale.js），
// 显式指定则固定该品质（剧情/首领固定掉落用得上）。
const DROP_RARITY_OPTS = [
  ["", "跟随等级"],
  ["common", "普通"],
  ["magic", "魔法"],
  ["rare", "稀有"],
  ["unique", "暗金"],
];

export function renderDrops(host, obj, f, onChange) {
  const arr = Array.isArray(obj[f.k]) ? obj[f.k] : (obj[f.k] = []);
  // 每条掉落一行：物品 | 几率% | 数量 min~max | 品质 | 删
  // 数量用 min/max 表达（旧数据只有 count，读出来当 min=max 显示）。
  // 几率默认 100，品质默认「跟随等级」——都是中性值，不改动既有掉落。
  const numInput = (val, w, onChangeVal, min) => {
    const inp = h("input", { type: "number", value: val, style: "width:" + w + "px", min: min == null ? 0 : min });
    inp.oninput = () => { onChangeVal(Number(inp.value)); onChange && onChange(f); };
    return inp;
  };
  const redraw = () => {
    clear(host);
    // 表头，便于对齐阅读
    host.append(h("div", { class: "ed-row ed-drops-head" },
      h("span", { style: "flex:1" }, "物品"),
      h("span", { style: "width:56px" }, "几率%"),
      h("span", { style: "width:56px" }, "最少"),
      h("span", { style: "width:56px" }, "最多"),
      h("span", { style: "width:78px" }, "品质"),
      h("span", { style: "width:34px" }, ""),
    ));
    arr.forEach((d, i) => {
      const sel = h("select", { onchange: () => { d.name = sel.value; onChange && onChange(f); } });
      const names = f.items || [];
      for (const nm of names) sel.append(h("option", { value: nm }, nm));
      if (d.name && !names.includes(d.name)) sel.append(h("option", { value: d.name }, d.name + "（无此物品）"));
      sel.value = d.name || names[0] || "";
      sel.style.flex = "1"; sel.style.minWidth = "80px";

      const chance = numInput(d.chance == null ? 100 : d.chance, 52, v => { d.chance = v; });
      // 数量区间：没有 min/max 时用 count 兜底
      const minV = d.min != null ? d.min : (d.count != null ? d.count : 1);
      const maxV = d.max != null ? d.max : minV;
      const mn = numInput(minV, 52, v => { d.min = Math.max(1, v | 0); if (d.max == null) d.max = d.min; }, 1);
      const mx = numInput(maxV, 52, v => { d.max = Math.max(d.min || 1, v | 0); }, 1);

      const rar = h("select", { style: "width:74px", onchange: () => { d.rarity = rar.value || null; onChange && onChange(f); } });
      for (const [v, lab] of DROP_RARITY_OPTS) rar.append(h("option", { value: v }, lab));
      rar.value = d.rarity || "";

      host.append(h("div", { class: "ed-row" }, sel, chance, mn, mx, rar,
        h("button", { class: "ed-btn danger", onclick: () => { arr.splice(i, 1); onChange && onChange(f); redraw(); } }, "删")));
    });
    host.append(h("button", {
      class: "ed-btn",
      onclick: () => {
        arr.push({ name: (f.items && f.items[0]) || "", chance: 100, min: 1, max: 1, count: 1 });
        onChange && onChange(f); redraw();
      },
    }, "＋ 添加掉落"));
  };
  redraw();
}

// 货物背包（容器）编辑器：obj[f.k] = { stock?: [{name,count}], auto?: string } 或 null。
// 无货物 = 非商人（不展开交易）。与 NPC 名称/模型无关，纯数据驱动。
const INV_AUTO_OPTS = [["", "（不自动）"], ["potion", "药/水类自动"], ["weapon", "武器类自动"], ["armor", "防具类自动"], ["accessory", "饰品类自动"]];

// 技能协同（synergy）编辑器：obj[f.k] = [{ skill, per, max, stat }]
// 「技能」每 1 级给本技能 +per 的加成（作用于 stat 指定的数值），最多累加到 max。
const SYNERGY_STATS = [["power", "威力"], ["range", "射程"], ["duration", "持续时间"]];

export function renderSynergy(host, obj, f, onChange) {
  const arr = Array.isArray(obj[f.k]) ? obj[f.k] : (obj[f.k] = []);
  const redraw = () => {
    clear(host);
    if (!arr.length) host.append(h("div", { class: "ed-ghint" }, "（无协同加成）"));
    arr.forEach((sy, i) => {
      const sel = h("select", { style: "flex:1;min-width:80px" });
      for (const nm of (f.skills || [])) sel.append(h("option", { value: nm }, nm));
      if (sy.skill && !(f.skills || []).includes(sy.skill)) sel.append(h("option", { value: sy.skill }, sy.skill + "（无此技能）"));
      sel.value = sy.skill || (f.skills && f.skills[0]) || "";
      sel.onchange = () => { sy.skill = sel.value; onChange && onChange(f); };

      const per = h("input", { type: "number", value: sy.per == null ? 0.1 : sy.per, step: 0.01, title: "每级加成比例（0.1 = +10%/级）", style: "width:62px" });
      per.oninput = () => { sy.per = Number(per.value) || 0; onChange && onChange(f); };
      const max = h("input", { type: "number", value: sy.max == null ? 0.4 : sy.max, step: 0.05, title: "加成上限（0 = 不限）", style: "width:62px" });
      max.oninput = () => { sy.max = Number(max.value) || 0; onChange && onChange(f); };

      const stat = h("select", { style: "width:78px" });
      for (const [v, lab] of SYNERGY_STATS) stat.append(h("option", { value: v }, lab));
      stat.value = sy.stat || "power";
      stat.onchange = () => { sy.stat = stat.value; onChange && onChange(f); };

      host.append(h("div", { class: "ed-row" }, sel, per, max, stat,
        h("button", { class: "ed-btn danger", onclick: () => { arr.splice(i, 1); onChange && onChange(f); redraw(); } }, "删")));
    });
    host.append(h("button", {
      class: "ed-btn",
      onclick: () => {
        arr.push({ skill: (f.skills && f.skills[0]) || "", per: 0.1, max: 0.4, stat: "power" });
        onChange && onChange(f); redraw();
      },
    }, "＋ 添加协同"));
  };
  redraw();
}

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
  // 字段分组：schema 里写 `{ group: "标题" }` 作为分隔项，其后字段都归入该组；
  // 也可在单个字段上写 `f.group`，等价于在它前面插入分组。
  // 这样「已有字段」可以按语义重新编排顺序（身份 / 数值 / 表现 / 关联…）。
  let groupHost = host;
  const startGroup = (title, hint) => {
    groupHost = h("div", { class: "ed-group" });
    groupHost.append(h("div", { class: "ed-grouptitle" }, title));
    if (hint) groupHost.append(h("div", { class: "ed-ghint" }, hint));
    host.append(groupHost);
  };
  let curGroup = null;
  for (const f of schema) {
    if (f && f.group != null && !f.k) { curGroup = f.group; startGroup(f.group, f.hint); continue; }
    if (f.group != null && f.group !== curGroup) { curGroup = f.group; startGroup(f.group, f.hint); }
    const lab = h("label", null, f.label || f.k);
    let ctl;
    const v = valOf(f, obj);
    if (f.type === "drops") {
      const box = h("div", { class: "ed-drops" });
      renderDrops(box, obj, f, onChange);
      groupHost.append(h("div", { class: "ed-field wide" }, lab, box));
      continue;
    }
    if (f.type === "inventory") {
      const box = h("div", { class: "ed-drops" });
      renderInventory(box, obj, f, onChange);
      groupHost.append(h("div", { class: "ed-field wide" }, lab, box));
      continue;
    }
    if (f.type === "strlist") {
      const box = h("div", { class: "ed-drops" });
      renderStrList(box, obj, f, onChange);
      groupHost.append(h("div", { class: "ed-field wide" }, lab, box));
      continue;
    }
    if (f.type === "synergy") {
      const box = h("div", { class: "ed-drops" });
      renderSynergy(box, obj, f, onChange);
      groupHost.append(h("div", { class: "ed-field wide" }, lab, box));
      continue;
    }
    if (f.type === "resist") {
      const box = h("div", { class: "ed-drops" });
      renderResist(box, obj, f, onChange);
      groupHost.append(h("div", { class: "ed-field wide" }, lab, box));
      continue;
    }
    if (f.type === "buffeffects") {
      const box = h("div", { class: "ed-drops" });
      renderBuffEffects(box, obj, f, onChange);
      groupHost.append(h("div", { class: "ed-field wide" }, h("label", null, f.label || f.k), box));
      continue;
    }
    if (f.type === "model") {
      // 行走图（.pmg 模型名）：值是一个模型名字符串，对应 chars.json 里的一套帧。
      // 用原生 datalist 在不少浏览器里点了箭头打不开，所以改成「缩略图 + 选择…」弹窗，
      // 与图片字段保持一致的交互。f.models 为可选模型名，f.modelSrc(name) 给缩略图。
      const box = h("div", { class: "ed-imgfield" });
      const thumbs = h("div", { class: "ed-imgthumbs" });
      const drawThumbs = () => {
        clear(thumbs);
        const m = pathGet(obj, f.k);
        if (!m) { thumbs.append(imgPlaceholder("未选择行走图")); return; }
        const src = f.modelSrc ? f.modelSrc(m) : null;
        if (src) {
          thumbs.append(guardImage(h("img", { src, title: String(m) }), "该模型无预览"));
        } else {
          thumbs.append(imgPlaceholder("该模型无预览"));
        }
        thumbs.append(h("span", { class: "ed-modelname" }, String(m)));
      };
      const btn = h("button", { class: "ed-btn" }, "选择…");
      btn.onclick = () => openModelPicker({
        title: f.label || f.k,
        models: f.models || [],
        modelSrc: f.modelSrc,
        value: pathGet(obj, f.k),
        onPick: v => { pathSet(obj, f.k, v); drawThumbs(); flag(f); },
      });
      const reset = h("button", { class: "ed-btn ghost", onclick: () => { pathSet(obj, f.k, ""); drawThumbs(); flag(f); } }, "清除");
      box.append(thumbs, h("div", { class: "ed-row" }, btn, reset));
      groupHost.append(h("div", { class: "ed-field wide" }, lab, box));
      drawThumbs();
      continue;
    }
    if (f.type === "image" || f.type === "frames") {
      // 图片类字段：显示缩略图 + 「更换…」按钮，不让人手打资源路径。
      // f.dir 指定目录（如 "items_icons"），把值（可能只是纯文件名）解析成可显示 URL。
      // f.type === "frames" 时值为字符串数组（帧动画），点选可多选。
      const isFrames = f.type === "frames";
      const box = h("div", { class: "ed-imgfield" });
      // frames 加类名 → CSS 用略小的格子（帧数多，避免把表单撑得太长）
      const thumbs = h("div", { class: isFrames ? "ed-imgthumbs frames" : "ed-imgthumbs" });
      const drawThumbs = () => {
        clear(thumbs);
        const raw = isFrames ? (Array.isArray(pathGet(obj, f.k)) ? pathGet(obj, f.k) : []) : [pathGet(obj, f.k)];
        const list = raw.filter(x => x != null && x !== "");
        if (!list.length) {
          thumbs.append(imgPlaceholder(isFrames ? "未选择帧图" : "未设置图片", isFrames));
          return;
        }
        for (const v of list) {
          // 引用不存在 / 改名过的文件时给占位图，而不是浏览器的破图
          thumbs.append(guardImage(h("img", { src: assetSrc(v, f.dir), title: String(v) }),
            "文件不存在：" + String(v), isFrames));
        }
      };
      const btn = h("button", { class: "ed-btn" }, isFrames ? "选择帧…" : "更换…");
      btn.onclick = () => openAssetPicker({
        title: (f.label || f.k) + (isFrames ? "（选帧动画）" : ""),
        dir: f.dir, multi: isFrames,
        value: pathGet(obj, f.k),
        onPick: val => {
          const picked = isFrames ? (Array.isArray(val) ? val : [val]) : (Array.isArray(val) ? val[0] : val);
          pathSet(obj, f.k, picked);
          drawThumbs(); flag(f);
        },
      });
      const reset = h("button", { class: "ed-btn ghost", onclick: () => { pathSet(obj, f.k, isFrames ? [] : ""); drawThumbs(); flag(f); } }, "清除");
      box.append(thumbs, h("div", { class: "ed-row" }, btn, reset));
      groupHost.append(h("div", { class: "ed-field wide" }, lab, box));
      drawThumbs();
      continue;
    }
    if (f.type === "textarea" || f.type === "lines") {
      ctl = h("textarea", { rows: f.rows || (f.type === "lines" ? 6 : 4) });
      ctl.value = v;
      ctl.oninput = () => {
        pathSet(obj, f.k, f.type === "lines" ? ctl.value.split("\n").map(s => s.trimEnd()).filter(s => s.length) : ctl.value);
        autoGrow(ctl, f.rows || 4);
        flag(f);
      };
      // 不再只靠 rows 定高：随内容增高（下限由 f.rows 换算），保证多行内容能看全。
      if (f.grow !== false) queueMicrotask(() => autoGrow(ctl, f.rows || (f.type === "lines" ? 6 : 4)));
    } else if (f.type === "select") {
      ctl = h("select");
      // f.fx：选项来自内容特效表（effects.json）；由调用方通过 f.options 注入，此处只保证首项为空。
      const options = f.options;
      for (const o of (options || [])) {
        const value = Array.isArray(o) ? o[0] : o.v, label = Array.isArray(o) ? o[1] : o.label;
        ctl.append(h("option", { value }, label));
      }
      ctl.value = String(pathGet(obj, f.k));
      ctl.style.flex = "1";
      ctl.onchange = () => { pathSet(obj, f.k, f.numeric ? Number(ctl.value) : ctl.value); flag(f); };
    } else if (f.type === "audio") {
      // 音频字段：下拉选择 + 试听按钮（不再手打文件名）。
      // f.files：候选音频路径数组，如 ["assets/music/start.mp3", ...]
      // f.useDir：是否把值规范化成"纯文件名"（地图/场景里 music 存的就是文件名）
      const wrap = h("div", { style: "display:flex;gap:6px;flex:1;min-width:0;align-items:center" });
      ctl = h("select", { style: "flex:1;min-width:0" });
      // files 可直接给数组；filesFn 则是惰性取值（索引是异步建立的，模块加载时还没有数据）
      const files = (f.filesFn ? (f.filesFn() || []) : (f.files || [])).slice();
      const cur = String(pathGet(obj, f.k) == null ? "" : pathGet(obj, f.k));
      const base = x => String(x).split("/").pop();
      ctl.append(h("option", { value: "" }, "（无）"));
      let hit = false;
      // 原版数据里存在"引用 .wma、磁盘只有同名 .mp3"这类扩展名对不上的情况
      // （几处地图音乐就一直是坏的，游戏里静音）。选择器按「同名不同扩展名」匹配，
      // 这样这类值会正常高亮，并在保存时顺手规范成实际存在的文件名。
      const stem = x => String(x).replace(/\.[a-z0-9]+$/i, "").toLowerCase();
      const stemHit = files.find(fp => stem(base(fp)) === stem(cur));
      for (const fp of files) {
        const v = f.useDir === false ? fp : base(fp);
        if (v === cur || (stemHit === fp)) hit = true;
        ctl.append(h("option", { value: v }, v));
      }
      // 当前值不在候选里（手改过/版本缺文件）也保留，避免静默清空
      if (cur && !hit) ctl.append(h("option", { value: cur }, cur + "（不在列表中）"));
      // 同名不同扩展名时，直接落到磁盘上真实存在的那个（并回写，修掉指向 .wma 的坏引用）
      if (cur && stemHit && stem(base(stemHit)) === stem(cur)) {
        const fixed = f.useDir === false ? stemHit : base(stemHit);
        pathSet(obj, f.k, fixed); ctl.value = fixed; flag(f);
      } else {
        ctl.value = cur;
      }
      ctl.onchange = () => { pathSet(obj, f.k, ctl.value); flag(f); playBtn.disabled = !ctl.value; };
      const playBtn = h("button", { class: "ed-btn ghost", title: "试听" }, "▶");
      playBtn.disabled = !cur;
      /** @type {HTMLAudioElement|null} */
      let au = null;
      playBtn.onclick = () => {
        if (au) { au.pause(); au = null; playBtn.textContent = "▶"; return; }
        const v = ctl.value; if (!v) return;
        // 必须走 audioSrc：资源根是 versions/<id>/，裸写 assets/... 会 404。
        // 目录由候选里的完整路径决定（技能音效在 assets/sound/，音乐在 assets/music/），
        // 找不到候选时按扩展名猜：wav 多为音效。
        const full = files.find(x => base(x) === v) || "";
        const dir = full.includes("/sound/") ? "sound" : (full.includes("/music/") ? "music" : (/\.wav$/i.test(v) ? "sound" : "music"));
        au = new Audio(audioSrc(full || v, dir));
        au.onended = () => { au = null; playBtn.textContent = "▶"; };
        au.onerror = () => { au = null; playBtn.textContent = "▶"; };
        au.play().then(() => { playBtn.textContent = "■"; }).catch(() => { au = null; playBtn.textContent = "▶"; });
      };
      wrap.append(ctl, playBtn);
      ctl = wrap;
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
    // 布局：文本域这类"大段内容"独占一整行且加高；其余单行控件与 label 同排。
    // label 右对齐、字号与控件一致（见 style.js 的 .ed-row > label）。
    const wide = f.type === "textarea" || f.type === "lines" || f.type === "audio" || f.wide === true;
    groupHost.append(h("div", { class: wide ? "ed-row wide" : "ed-row" }, lab, ctl));
    // 图片字段：若有 f.img(obj)，在控件下方显示预览（随输入/选择实时刷新）
    if (typeof f.img === "function") {
      const im = h("img", { class: "ed-fieldimg" });
      const ph = imgPlaceholder("无图片");
      const host = h("span", { class: "ed-imgslot" }, im, ph);
      const wrap = h("div", { class: "ed-imgwrap" }, host);
      const refresh = () => {
        const s = f.img(obj);
        if (s) { im.src = s; im.style.display = ""; ph.style.display = "none"; }
        else { im.removeAttribute("src"); im.style.display = "none"; ph.style.display = ""; }
      };
      im.onerror = () => { im.style.display = "none"; ph.style.display = ""; };
      im.onload = () => { im.style.display = ""; ph.style.display = "none"; };
      refreshers.push(refresh); refresh();
      groupHost.append(wrap);
    }
  }
}

// 双栏拖拽手柄：左栏宽度存在 localStorage，双击恢复默认。
// 各列表页共用同一套行为，保证“每个分页都能左右拖收放”。
export function mkSplitResizer(key, leftEl) {
  const storeKey = "ed.width." + key;
  const el = h("div", { class: "ed-resizer", title: "拖动调整列表宽度 / 双击恢复默认" });
  const apply = w => { leftEl.style.flex = "0 0 " + w + "px"; leftEl.style.width = w + "px"; };
  const saved = parseInt(localStorage.getItem(storeKey) || "", 10);
  if (saved > 0) apply(saved);
  let startX = 0, startW = 0;
  const onMove = e => apply(Math.max(200, Math.min(900, startW + (e.clientX - startX))));
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    el.classList.remove("dragging");
    document.body.classList.remove("ed-resizing");
    localStorage.setItem(storeKey, String(Math.round(leftEl.getBoundingClientRect().width)));
  };
  el.addEventListener("mousedown", e => {
    if (window.matchMedia("(max-width: 900px)").matches) return;   // 窄屏上下堆叠，不拖
    e.preventDefault();
    startX = e.clientX; startW = leftEl.getBoundingClientRect().width;
    el.classList.add("dragging");
    document.body.classList.add("ed-resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
  el.addEventListener("dblclick", () => {
    leftEl.style.flex = ""; leftEl.style.width = "";
    localStorage.removeItem(storeKey);
  });
  return el;
}

// 列表 + 选中项表单 + 增删。list 为数组（会被就地修改）。
export function renderListEditor(host, opts) {
  const { list, schema, columns, makeNew } = opts;
  let sel = opts.sel != null ? opts.sel : 0;
  // 桌面端筛选：按名称/任意列文本模糊匹配（真实索引仍用 list 下标）。
  let query = "";
  const match = it => {
    if (!query) return true;
    const q = query.toLowerCase();
    // 只要任一列命中即显示（含 id / 名称等主键列）。
    for (const c of columns) {
      const v = c.get ? c.get(it) : it[c.k];
      if (v != null && String(v).toLowerCase().includes(q)) return true;
    }
    return false;
  };
  const redraw = () => {
    // 选中项以内部 sel 为准（只有新建/复制/删除才改它）。
    // 之前这里每帧从 opts.sel 重置，导致「点了左侧某行，右侧不跟着变」。
    if (sel == null || sel >= list.length) sel = list.length ? 0 : null;
    clear(host);

    // ---- 工具栏 ----
    const searchIn = h("input", { type: "text", placeholder: "搜索…", value: query, style: "min-width:160px" });
    const cntEl = h("span", { class: "ed-count" });
    const updateCount = () => {
      const vis = list.filter(match).length;
      cntEl.textContent = "共 " + list.length + (query ? " / 显示 " + vis : "") + " 项";
    };
    searchIn.oninput = () => { query = searchIn.value; drawTable(); updateCount(); };
    host.append(h("div", { class: "ed-tools" },
      h("button", { class: "ed-btn", onclick: () => { list.push(makeNew()); opts.sel = list.length - 1; opts.onStructural && opts.onStructural(); redraw(); } }, "＋ 新建"),
      h("button", { class: "ed-btn", onclick: () => { if (sel == null || !list[sel]) return; list.splice(sel + 1, 0, JSON.parse(JSON.stringify(list[sel]))); opts.sel = sel + 1; opts.onStructural && opts.onStructural(); redraw(); } }, "复制"),
      h("button", { class: "ed-btn danger", onclick: () => { if (sel == null || !list[sel]) return; list.splice(sel, 1); opts.sel = Math.max(0, sel - 1); opts.onStructural && opts.onStructural(); redraw(); } }, "删除"),
      h("div", { class: "ed-search" }, searchIn),
      cntEl,
    ));

    // ---- 主区域：桌面双栏（表格 | 编辑表单），窄屏上下堆叠 ----
    const split = h("div", { class: "ed-split" });
    const left = h("div", { class: "ed-split-list" });
    const right = h("div", { class: "ed-split-form" });
    split.append(left, mkSplitResizer(opts.splitKey || ("list." + (opts.key || "default")), left), right);
    host.append(split);

    const tbl = h("table", { class: "ed-table" });
    const head = h("tr");
    // 有缩略图时首列是图列（无表头文字，窄列）
    const hasThumb = !!opts.thumb;
    if (hasThumb) head.append(h("th", { class: "ed-thumb" }));
    for (const c of columns) head.append(h("th", null, c.label));
    tbl.append(h("thead", null, head));
    const body = h("tbody");
    tbl.append(body);
    // 表格放进专用滚动容器，sticky 表头才能生效；左栏高度不随行数撑高。
    left.append(h("div", { class: "ed-tablescroll" }, tbl));

    // 行内容填充（首列缩略图 + 各列文本）。每次重绘都以数据为准，避免残留旧 DOM。
    // 行内容同步。**尽量复用已有 DOM**：只改文本 / 只在缩略图地址变化时换 src，
    // 否则每次表单输入都会重新创建 <img>，浏览器要重新解码图片，列表一大就卡。
    const fillRow = (tr, it) => {
      if (hasThumb) {
        let td = /** @type {HTMLElement|null} */ (tr.firstElementChild);
        if (!td || !td.classList.contains("ed-thumb")) {
          td = h("td", { class: "ed-thumb" });
          tr.insertBefore(td, tr.firstChild);
        }
        const src = opts.thumb(it);
        let im = td.querySelector("img");
        // 列表格子里的占位（26px 左右的小方块），不用破图也不用纯留白
        let cellPh = /** @type {HTMLElement|null} */ (td.querySelector(".ed-imgph"));
        if (src) {
          if (!im) {
            im = h("img", { loading: "lazy", decoding: "async" });
            im.onerror = () => { im.style.display = "none"; if (cellPh) cellPh.style.display = ""; };
            im.onload = () => { im.style.display = ""; if (cellPh) cellPh.style.display = "none"; };
            clear(td);
            cellPh = imgPlaceholder("", true);
            cellPh.style.display = "none";
            td.append(im, cellPh);
          }
          const want = new URL(String(src), location.href).href;
          if (im.src !== want) {
            im.style.display = "";
            if (cellPh) cellPh.style.display = "none";
            im.src = String(src);
          }
        } else {
          if (im) im.remove();
          if (!cellPh) {
            cellPh = imgPlaceholder("", true);
            cellPh.classList.add("cell");
            td.append(cellPh);
          }
          cellPh.style.display = "";
        }
      }
      const off = hasThumb ? 1 : 0;
      for (let i = 0; i < columns.length; i++) {
        const c = columns[i];
        const txt = c.get ? String(c.get(it) ?? "") : (it[c.k] == null ? "" : String(it[c.k]));
        let td = /** @type {HTMLElement} */ (tr.children[off + i]);
        if (!td) { td = h("td", null, txt); tr.append(td); }
        else if (td.textContent !== txt) td.textContent = txt;
      }
      // 多余的单元格（列数变少时）删掉
      while (tr.children.length > off + columns.length) tr.lastElementChild?.remove();
    };

    let formHost = null;
    const drawTable = () => {
      clear(body);
      list.forEach((it, i) => {
        if (!match(it)) return;
        const tr = h("tr", { class: i === sel ? "on" : "", onclick: () => { sel = i; opts.sel = i; drawSelection(); fadeAll(); tr.className = "on"; } });
        fillRow(tr, it);
        body.append(tr);
      });
      if (!body.children.length) body.append(h("tr", null, h("td", { colspan: columns.length + (hasThumb ? 1 : 0) }, h("div", { class: "ed-empty" }, "没有匹配的项"))));
    };
    const fadeAll = () => { for (const tr of body.children) tr.className = ""; };

    // 重绘右侧表单（选中项变化时调用，不重建左侧列表，保留滚动位置）
    const drawSelection = () => {
      clear(right);
      const cur = list[sel];
      if (!cur) { right.append(h("div", { class: "ed-empty" }, "左侧选择一个条目开始编辑")); return; }
      right.append(h("h3", null, "编辑：" + (cur.name || cur.id || ("#" + sel))));
      formHost = h("div", { class: "ed-grid" });
      right.append(formHost);
      renderForm(formHost, schema, cur, () => {
        opts.onChange && opts.onChange();
        // 表单里改名/换图要让左侧表格即时反映：只重填**当前这一行**，
        // 不碰其它行（列表可能上千条，全量重填会卡且会丢滚动位置）。
        const tr = body.querySelector("tr.on");
        if (tr && list[sel]) fillRow(tr, list[sel]);
      });
    };

    drawTable();
    updateCount();
    drawSelection();
  };
  redraw();
  return { redraw, getSel: () => opts.sel };
}

/**
 * 给一个 textarea 套上「可调字号」的编辑器外壳。
 * 字号记在 localStorage（`ed.fontsize`），A-/A+ 与数字显示；
 * Ctrl+滚轮 也能调，方便大屏/小屏下换到舒服的字号。
 * @param {HTMLTextAreaElement} ta
 * @param {{extra?:Node[], key?:string}} [opts]
 * @returns {HTMLDivElement} 包含工具栏与 textarea 的容器（撑满父级高度）
 */
export function editorShell(ta, opts) {
  const o = opts || {};
  const storeKey = o.key || "ed.fontsize";
  const MIN = 10, MAX = 28;
  let fs = parseInt(localStorage.getItem(storeKey) || "", 10);
  if (!(fs >= MIN && fs <= MAX)) fs = 12;

  const wrap = h("div", { class: "ed-editorwrap", style: "display:flex;flex-direction:column;flex:1 1 auto;min-height:0" });
  const val = h("span", { class: "ed-fsval" }, fs + "px");
  const apply = () => {
    ta.style.setProperty("--ed-fs", fs + "px");
    ta.classList.add("ed-editor");
    val.textContent = fs + "px";
    localStorage.setItem(storeKey, String(fs));
  };
  const step = d => { fs = Math.max(MIN, Math.min(MAX, fs + d)); apply(); };
  const bar = h("div", { class: "ed-tools", style: "padding:4px 0" });
  const fsbar = h("div", { class: "ed-fsbar" },
    h("button", { title: "缩小字号", onclick: () => step(-1) }, "A-"),
    val,
    h("button", { title: "放大字号", onclick: () => step(1) }, "A+"),
    h("button", { title: "恢复 12px", onclick: () => { fs = 12; apply(); } }, "↺"));
  if (o.extra) for (const n of o.extra) bar.append(n);
  bar.append(fsbar);
  wrap.append(bar, ta);

  // Ctrl / Cmd + 滚轮调字号
  ta.addEventListener("wheel", e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    step(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  apply();
  return wrap;
}

/**
 * textarea 随内容自动增高。
 * 之前多行文本框高度只由 `rows` 决定，长文本只能在小框里滚动，看不到全貌。
 * 这里按 scrollHeight 撑开，下限 minRows 行（避免空值塌成一条线），
 * 上限由 CSS 的 max-height 控制（用户仍可手动拖动 resize 手柄）。
 * @param {HTMLTextAreaElement} ta
 * @param {number} [minRows]
 */
export function autoGrow(ta, minRows) {
  const rows = minRows || 3;
  ta.style.height = "auto";
  const cs = getComputedStyle(ta);
  const line = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 12) * 1.5;
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const min = Math.round(line * rows + pad);
  const need = Math.max(min, ta.scrollHeight + 2);
  ta.style.height = need + "px";
}

// 抗性编辑器：obj[f.k] 为 [{type, value}]（schema.normalizeResist 的输出）。
// 也兼容映射 {fire:50} / 单数值 50 的旧写法，编辑时统一成数组。
// f.options 为可选的伤害类型列表（编辑器从配置/常量给出）。
export function renderResist(host, obj, f, onChange) {
  const types = f.options || [];
  // 把各种写法统一成数组（就地替换，保持与 schema 一致）
  const list = () => {
    let v = obj[f.k];
    if (!Array.isArray(v)) {
      const conv = [];
      if (typeof v === "number" && isFinite(v) && v !== 0) conv.push({ type: "all", value: v });
      else if (v && typeof v === "object") {
        for (const k of Object.keys(v)) {
          const n = Number(v[k]);
          if (Number.isFinite(n) && n !== 0) conv.push({ type: k, value: n });
        }
      }
      v = obj[f.k] = conv;
    }
    return v;
  };
  const redraw = () => {
    clear(host);
    const arr = list();
    arr.forEach((e, i) => {
      const sel = h("select", { onchange: () => { e.type = sel.value; onChange && onChange(f); } });
      for (const t of types) {
        const tv = Array.isArray(t) ? t[0] : (t.value ?? t);
        const tl = Array.isArray(t) ? t[1] : (t.label ?? String(t));
        sel.append(h("option", { value: tv }, tl));
      }
      // 允许手写的未知类型，避免静默改写用户数据
      if (e.type && !types.some(t => (Array.isArray(t) ? t[0] : (t.value ?? t)) === e.type))
        sel.append(h("option", { value: e.type }, e.type + "（未知）"));
      sel.value = e.type;
      const num = h("input", { type: "number", value: String(e.value ?? 0), style: "width:72px",
        oninput: () => { e.value = Number(num.value) || 0; onChange && onChange(f); } });
      host.append(h("div", { class: "ed-row" }, sel, num, h("span", { class: "ed-dim" }, "%"),
        h("button", { class: "ed-btn danger", onclick: () => { arr.splice(i, 1); onChange && onChange(f); redraw(); } }, "删")));
    });
    host.append(h("button", { class: "ed-btn", onclick: () => {
      const t0 = types[0];
      arr.push({ type: (Array.isArray(t0) ? t0[0] : (t0?.value ?? t0)) || "all", value: 0 });
      onChange && onChange(f); redraw();
    } }, "＋ 添加抗性"));
  };
  redraw();
}
