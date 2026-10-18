// 测试辅助：读取真实 assets 数据（默认版本 versions/default/assets）。
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

export const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
// 默认版本的资源根（原 assets/ 已迁入 versions/default/assets）。
export const ASSETS_DIR = "versions/default/assets";
export function readJSON(rel) { return JSON.parse(readFileSync(path.join(ROOT, rel), "utf8")); }
export function mapNames() { return readJSON(ASSETS_DIR + "/maps_manifest.json"); }
export function loadMap(name) { return readJSON(ASSETS_DIR + "/maps/" + name + ".json"); }
export function loadAllMaps() { const out = {}; for (const n of mapNames()) out[n] = loadMap(n); return out; }
export function loadAssets() {
  return {
    npcs: readJSON(ASSETS_DIR + "/npcs.json"),
    items: readJSON(ASSETS_DIR + "/items.json"),
    skills: readJSON(ASSETS_DIR + "/skills.json"),
    scripts: readJSON(ASSETS_DIR + "/scripts.json"),
    factions: readJSON(ASSETS_DIR + "/factions.json"),
    ais: readJSON(ASSETS_DIR + "/ais.json"),
    config: readJSON(ASSETS_DIR + "/config.json"),
    game: readJSON(ASSETS_DIR + "/game.json"),
    transitions: readJSON(ASSETS_DIR + "/transitions.json"),
    mapsIndex: readJSON(ASSETS_DIR + "/maps_index.json"),
    mapsManifest: mapNames(),
  };
}
export function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
export function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
export function assertEq(a, b, msg) { if (!eq(a, b)) throw new Error((msg || "not equal") + "\n  a=" + JSON.stringify(a).slice(0, 300) + "\n  b=" + JSON.stringify(b).slice(0, 300)); }
