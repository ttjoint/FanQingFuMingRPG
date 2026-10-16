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
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function fit() {
  const s = Math.max(1, Math.floor(Math.min(window.innerWidth / VW, window.innerHeight / VH) * 2) / 2);
  cv.style.width = (VW * s) + "px"; cv.style.height = (VH * s) + "px";
}
window.addEventListener("resize", fit); fit();

export async function boot() {
  // 1) 选定内容包（v2：补丁式）。
  const idx = loadIndex();
  const pack = (await loadPack(idx.active)) || defaultPack();
  A.activePack = pack; A.versionId = pack.id;
  setAssetOverrides(pack.images || {});

  // 2) 基础素材 / 表。
  A.atlasJson = await loadJSON("assets/atlas.json");
  A.atlas = await loadImg("assets/atlas.png");
  A.obj = await loadImg("assets/obj.png");
  A.chars = await loadJSON("assets/chars.json");
  A.anchors = await loadJSON("assets/anchors.json").catch(() => ({}));
  loadSettings(G);

  const assets = {
    npcs: await loadJSON("assets/npcs.json"),
    items: await loadJSON("assets/items.json"),
    skills: await loadJSON("assets/skills.json"),
    scripts: await loadJSON("assets/scripts.json"),
    config: await loadJSON("assets/config.json").catch(() => DEFAULT_CONFIG),
    game: await loadJSON("assets/game.json").catch(() => ({})),
    transitions: await loadJSON("assets/transitions.json").catch(() => ({})),
    mapsIndex: await loadJSON("assets/maps_index.json").catch(() => ({})),
  };

  // 3) 载入原版全部地图并转成图层化 MapDoc。
  const fallbackMaps = ["孙家庄", "后山", "平原", "战场", "扬州", "扬州_屠城", "清军大营", "龙家庄", "龙家庄_师亡"];
  const names = await loadJSON("assets/maps_manifest.json").catch(() => fallbackMaps);
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
