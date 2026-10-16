// 入口：加载资源 → 构建规范内容模型（ContentDB + MapDoc）→ 经运行时上下文派生视图 → 启动主循环。
// 装配职责在 runtime/context.js；本文件只负责“加载 + 启动”。
import { VW, VH, cv } from "./core/constants.js";
import { G, A, MAPS } from "./core/state.js";
import { loadJSON, loadImg, getImg, preloadChar, setAssetOverrides } from "./core/assets.js";
import { DEFAULT_CONFIG } from "./core/config.js";
import { screenToWorld } from "./core/utils.js";
import { buildContentDB, applyPatch } from "./content/contentdb.js";
import { buildMapData } from "./world/map.js";
import { fromLegacyMap } from "./content/mapDoc.js";
import { loadPack, defaultPack, loadIndex } from "./content/store.js";
import { getRuntime } from "./runtime/context.js";
import { loadSettings } from "./systems/audio.js";
import { addInput } from "./input/input.js";
import { advanceDialog } from "./script/vm.js";
import { enterBoot } from "./systems/scene.js";
import { preloadSceneArt } from "./render/scene-ui.js";
import { update } from "./systems/update.js";
import { render } from "./render/renderer.js";

const runtime = getRuntime();

// 版本标记（控制台可见，用于确认是否加载到最新代码）
import { BUILD } from "./core/constants.js";
console.log("[gsxy] build:", BUILD);

// 调试入口（控制台 / E2E 脚本可用）：window.__GAME__
globalThis.__GAME__ = { G, A, MAPS, runtime, screenToWorld, advanceDialog: ans => advanceDialog(runtime, ans), update, render };

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  // 测试用暂停开关：置 true 时暂停 update（渲染照常），
  // 便于 e2e 在 evaluate 中独占推进逻辑，避免与 rAF 竞争。
  if (!globalThis.__GAME_PAUSED__) { update(dt); }
  render();
  requestAnimationFrame(loop);
}

function fit() {
  const s = Math.max(1, Math.floor(Math.min(window.innerWidth / VW, window.innerHeight / VH) * 2) / 2);
  cv.style.width = (VW * s) + "px"; cv.style.height = (VH * s) + "px";
}
window.addEventListener("resize", fit); fit();

// 逻辑数据文件名 → 版本文件夹内的相对路径。原版从 versions/default/assets 读；
// 磁盘版本可从 versions/<id>/assets/<同名> 覆盖为不同数据，实现“每个版本一个文件夹”。
const DATA_FILES = [
  "atlas.json", "chars.json", "anchors.json", "npcs.json", "items.json", "skills.json",
  "scripts.json", "factions.json", "ais.json", "buffs.json", "config.json", "game.json",
  "effects.json", "transitions.json", "maps_index.json", "maps_manifest.json",
];

// 从指定版本文件夹读取数据文件：先取原版，再（若存在）用版本自身 assets/ 覆盖。
async function loadVersionData(versionId) {
  // 原版基准（版本文件夹中的 default/assets）
  const base = {};
  await Promise.all(DATA_FILES.map(async f => { base[f] = await fetch("versions/default/assets/" + f).then(r => (r.ok ? r.json() : null)).catch(() => null); }));
  // 若当前是磁盘版本，尝试用版本自己的 assets/ 覆盖（不存在则沿用原版）。
  if (versionId && versionId !== "default" && versionId !== "__default__") {
    const dir = "versions/" + encodeURIComponent(versionId) + "/assets/";
    await Promise.all(DATA_FILES.map(async f => {
      const v = await fetch(dir + f).then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (v != null) base[f] = v;
    }));
  }
  return base;
}

export async function boot() {
  // 1) 选定内容包（v2：补丁式）。
  const idx = loadIndex();
  const pack = (await loadPack(idx.active)) || defaultPack();
  A.activePack = pack; A.versionId = pack.id;
  setAssetOverrides(pack.images || {});

  // 1b) 数据按版本文件夹读取：原版 versions/default/assets，磁盘版本可用自身 assets/ 覆盖。
  const data = await loadVersionData(pack.id);

  // 2) 基础素材 / 表。
  A.atlasJson = data["atlas.json"];
  A.atlas = await loadImg("assets/atlas.png");
  A.obj = await loadImg("assets/obj.png");
  A.chars = data["chars.json"];
  A.anchors = data["anchors.json"] || {};
  loadSettings(G);

  const assets = {
    npcs: data["npcs.json"],
    items: data["items.json"],
    skills: data["skills.json"],
    scripts: data["scripts.json"],
    factions: data["factions.json"] || [],
    ais: data["ais.json"] || [],
    buffs: data["buffs.json"] || [],
    effects: data["effects.json"] || [],
    config: data["config.json"] || DEFAULT_CONFIG,
    game: data["game.json"] || {},
    transitions: data["transitions.json"] || {},
    mapsIndex: data["maps_index.json"] || {},
  };

  // 3) 载入原版全部地图并转成图层化 MapDoc。
  const names = data["maps_manifest.json"] || [];
  assets.mapsManifest = names;
  const loaded = await Promise.all(names.map(n => loadJSON("assets/maps/" + encodeURIComponent(n) + ".json").catch(() => null)));
  const mapDocs = {};
  names.forEach((n, i) => { if (loaded[i]) mapDocs[n] = fromLegacyMap(loaded[i]); });

  // 4) 规范内容模型：基准 ContentDB + 内容包补丁；经运行时上下文装配为 A / MAPS。
  const base = buildContentDB(assets, mapDocs);
  const content = applyPatch(base, pack.patch || {});
  runtime.install(content, base, buildMapData);

  for (const it of A.items) if (it.icon) getImg("assets/items_icons/" + it.icon.replace(/\.bmp$/, ".png"));
  for (const sk of A.skills) if (sk.icon) getImg("assets/skill_icons/" + sk.icon.replace(/\.bmp$/, ".png"));

  preloadChar("role");
  preloadSceneArt();
  addInput();
  enterBoot(runtime);
  const el = document.getElementById("load"); if (el) el.remove();
  requestAnimationFrame(loop);
}

boot().catch(e => { const el = document.getElementById("load"); if (el) el.textContent = "加载失败：" + e + "（请用本地服务器打开）"; console.error(e); });
