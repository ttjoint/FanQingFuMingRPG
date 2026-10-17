// 资源索引：编辑器里所有"图片类字段"共用的可选资源清单。
//
// 为什么需要它：
//   版本 assets/ 是**覆盖式**的 —— aitest 只放了它自己新增的 15 张图，
//   其余全部回落到 default。编辑器的资源列表若只扫当前版本，aitest 里
//   就只剩这 15 张，原有的角色/物品图标/界面图全部"消失"。
//   所以清单必须是：**默认版本资源 ∪ 当前版本资源 ∪ 清单里登记的资源 ∪ 已内联的覆盖**。
//
// 另外，role/ 下的行走图是"模型名 → 帧文件"的推导关系（见 core/assets.js
// 的 preloadChar / charFramePath），清单里那 2777 个 role 文件名无法直接反查，
// 所以行走图另走"按模型名推导帧路径"的专用通道。

import { assetURL, getAssetRoot } from "../core/assets.js";

// 资源按目录归类，供选择器分组显示。
// 顺序即分组显示顺序；label 是中文名。
export const ASSET_GROUPS = [
  ["assets/items_icons/", "物品图标"],
  ["assets/skill_icons/", "技能图标"],
  ["assets/skill/", "技能特效帧"],
  ["assets/projectile/", "投射物帧"],
  ["assets/buff_icons/", "Buff 图标"],
  ["assets/face/", "头像"],
  ["assets/role/", "行走图帧"],
  ["assets/props/", "装饰物贴图"],
  ["assets/ui/", "界面图"],
  ["assets/tiles/", "地面贴图"],
  ["assets/fx/", "特效帧"],
  ["assets/effects/", "特效帧"],
  ["assets/", "其它"],
];

// 分组排序权重："其它" 永远排最后，其余按 ASSET_GROUPS 顺序。
export function groupRank(label) {
  for (let i = 0; i < ASSET_GROUPS.length; i++) if (ASSET_GROUPS[i][1] === label) return i;
  return ASSET_GROUPS.length;
}

export function groupOf(path) {
  const p = String(path || "");
  for (const [pre, label] of ASSET_GROUPS) {
    if (pre === "assets/") continue;
    if (p.startsWith(pre)) return label;
  }
  return "其它";
}

let INDEX = null;      // Set<string>，已排序
let MANIFEST_LOADED = false;

function add(set, p) {
  if (!p) return;
  const s = String(p);
  // 只收图片；数据文件不进资源选择器。
  if (!/\.(png|jpg|jpeg|gif|webp|bmp)$/i.test(s)) return;
  set.add(s.replace(/^versions\/[^/]+\//, ""));
}

// 由"命名约定"补充一批常见路径：即便清单里没有，也让用户能选到。
// 这些目录里的文件名是固定的（ui 图、图标目录用 items 的名字）。
function addConventional(set, ctx) {
  const items = (ctx && ctx.items) || [];
  const skills = (ctx && ctx.skills) || [];
  const npcs = (ctx && ctx.npcs) || [];
  const buffs = (ctx && ctx.buffs) || [];
  const maps = (ctx && ctx.maps) || [];

  const push = (dir, name) => { if (name) add(set, "assets/" + dir + "/" + String(name).replace(/\.bmp$/i, ".png")); };
  for (const it of items) if (it.icon) push("items_icons", it.icon);
  for (const sk of skills) {
    if (sk.icon) push("skill_icons", sk.icon);
    for (const f of (sk.frames || [])) push("skill", f);
    for (const f of ((sk.projectile && sk.projectile.frames) || [])) push("projectile", f);
  }
  for (const b of buffs) if (b.icon) push("buff_icons", b.icon);
  for (const n of npcs) if (n.portrait) push("face", n.portrait);
  // 行走图：chars[model] = { stand:[[frames]], walk:[[frames]], ... }，帧名拼在 assets/role/ 下。
  // （与 core/assets.js 的 preloadChar 同一规则：`assets/role/` + 帧文件名）
  const charsMap = (ctx && ctx.charsMap) || {};
  for (const model in charsMap) {
    const ch = charsMap[model];
    if (!ch || typeof ch !== "object") continue;
    for (const act in ch) {
      const blocks = ch[act];
      if (!Array.isArray(blocks)) continue;
      for (const block of blocks) {
        if (!Array.isArray(block)) continue;
        for (const fr of block) push("role", fr);
      }
    }
  }
  // 装饰物贴图：地图 objects 里登记的 sprite 路径
  for (const map of maps) {
    for (const o of ((map && map.objects) || [])) {
      if (o && o.sprite) add(set, Array.isArray(o.sprite) ? o.sprite[0] : o.sprite);
    }
  }
  // 界面图（原版固定这批名字）
  for (const u of ["mainmenu", "content", "end", "start", "load", "about", "exit", "team", "kouhao", "userpanel", "dlgpanel", "packpanel"])
    add(set, "assets/ui/" + u + ".png");
}

// 从一个版本的 assets 数组里收图片键。
function addVersionAssets(set, list) {
  for (const p of (list || [])) add(set, p);
}

// 构建索引。data 为 main.js 里 loadVersionData 的结果形状：
//   { versions?: [{id, assets:[...]}], images?: {...}, items, skills, npcs, buffs, chars, maps }
// 静态版本清单（versions/index.json）：静态服务器列不出目录，靠它发现磁盘版本的全部资产。
// 这是"aitest 里看不到自带素材"的根因——索引必须同时覆盖 default 与当前版本。
let STATIC_VERSIONS = null;
async function loadStaticVersions() {
  if (STATIC_VERSIONS) return STATIC_VERSIONS;
  try {
    const r = await fetch("versions/index.json", { cache: "no-cache" });
    if (!r.ok) return (STATIC_VERSIONS = []);
    const j = await r.json();
    STATIC_VERSIONS = Array.isArray(j && j.versions) ? j.versions : [];
  } catch { STATIC_VERSIONS = []; }
  return STATIC_VERSIONS;
}

export async function buildAssetIndexAsync(opts) {
  const o = opts || {};
  if (!o.versions || !o.versions.length) o.versions = await loadStaticVersions();
  return buildAssetIndex(o);
}

export function buildAssetIndex(opts) {
  const o = opts || {};
  const set = new Set();
  // 1) 默认版本 + 当前版本登记的资产（静态部署下由 versions/index.json 提供）
  const vs = o.versions || [];
  const def = vs.find(v => v.id === "default");
  const curId = o.currentId;
  if (def) addVersionAssets(set, def.assets);
  for (const v of vs) if (v.id === curId) addVersionAssets(set, v.assets);
  // 2) 当前版本若已知资产键列表（磁盘后端能读到真实目录）
  if (Array.isArray(o.currentAssets)) addVersionAssets(set, o.currentAssets);
  if (Array.isArray(o.defaultAssets)) addVersionAssets(set, o.defaultAssets);
  // 3) 按命名约定补充
  addConventional(set, o);
  // 4) 已内联的覆盖（编辑器里上传过的图，逻辑键即路径）
  for (const p in (o.images || {})) add(set, p);
  INDEX = [...set].sort();
  MANIFEST_LOADED = true;
  return INDEX;
}

export function assetIndex() { return INDEX || []; }

export function resetAssetIndex() { INDEX = null; MANIFEST_LOADED = false; }

// 模糊检索：空格分隔多关键词，全部命中（AND）才算匹配。
export function searchAssets(query, limit) {
  const list = assetIndex();
  const q = String(query || "").trim().toLowerCase();
  if (!q) return limit ? list.slice(0, limit) : list;
  const words = q.split(/\s+/).filter(Boolean);
  const out = [];
  for (const p of list) {
    const low = p.toLowerCase();
    let ok = true;
    for (const w of words) if (!low.includes(w)) { ok = false; break; }
    if (ok) { out.push(p); if (limit && out.length >= limit) break; }
  }
  return out;
}

// 把一个"资源引用"解析成可显示的 URL。
// 资源引用有三种形态：
//   - 已内联的 data URL / http URL → 原样
//   - "assets/xxx/yyy.png" 逻辑键 → 走版本的 assetURL（自动回落 default）
//   - 纯文件名（老数据，如 items.json 的 icon 只写 "金创药.bmp"）→ 由调用方给 dir 前缀
export function assetSrc(ref, dir) {
  if (!ref) return "";
  const s = String(ref);
  if (/^(data:|blob:|https?:)/i.test(s)) return s;
  if (s.startsWith("assets/")) return assetURL(s);
  if (dir) return assetURL("assets/" + dir.replace(/\/$/, "") + "/" + s.replace(/\.bmp$/i, ".png"));
  return assetURL(s);
}

// 该资源是否存在于当前版本（"覆盖"里有）；用于在列表里标记"本版新增"。
// 取路径末段文件名（列表与详情标题都要用）。
export function fileName(p) {
  const s = String(p || "");
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}

export function isVersionOwned(key) {
  const root = getAssetRoot();
  if (!root) return false;
  const id = root.split("/").pop();
  return id !== "default";
}
