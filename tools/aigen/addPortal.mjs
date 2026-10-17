// 给 aitest 版本添加「孙家庄 ↔ 试验场」的传送入口。
//
// 机制：地图格（cell）的 events[i] = {trigger, map}，
// 玩家踩上去时 world/triggers.js 会把 map 当作 mapsIndex 的 id 解析并 loadMap。
// 所以传送 = 在目标格写入 { map: <目标地图的数字 id> }。
//
// patch.maps 存的是 **MapDoc** 格式，这里全程用 MapDoc 操作，
// 用 toLegacyMap/fromLegacyMap 与原版地图互换，避免手写格式出错。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fromLegacyMap, toLegacyMap } from "../../src/content/mapDoc.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEF = path.join(ROOT, "versions/default/assets");
const PATCH = path.join(ROOT, "versions/aitest/patch.json");
const readJSON = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

const HOME = "孙家庄";      // 开局地图（main.gsp 的 LoadInitialMap）
const TEST = "试验场";      // 试验场景
const TEST_ID = 90;

const patch = readJSON(PATCH);
const mapsIndex = patch.content.mapsIndex || {};
// 试验场必须在 mapsIndex 注册，triggers 才能把 cell.map=90 解析成地图名。
mapsIndex[String(TEST_ID)] = TEST;
patch.content.mapsIndex = mapsIndex;

// ---- 1. 孙家庄：玩家起点 (11,11) 右侧两格 → 试验场 ----
const homeDoc = patch.maps[HOME] || fromLegacyMap(readJSON(path.join(DEF, "maps", HOME + ".json")));
{
  const w = homeDoc.width;
  // 放在起点旁 (11,13)：开局走两步就能看到，不会误触，也不破坏原有布局。
  const spots = [[11, 13], [11, 14]];
  for (const [r, c] of spots) {
    const i = r * w + c;
    if (homeDoc.collision[i] === 0) {
      console.warn(`跳过 ${r},${c}：该格不可通行`);
      continue;
    }
    homeDoc.events[i] = { ...(homeDoc.events[i] || {}), map: TEST_ID };
    console.log(`孙家庄 (${r},${c}) → 试验场`);
  }
  patch.maps[HOME] = homeDoc;
}

// ---- 2. 试验场：入口旁放一个回程格 → 孙家庄 ----
const HOME_ID = Number(Object.keys(mapsIndex).find((k) => mapsIndex[k] === HOME));
{
  const doc = patch.maps[TEST];
  const w = doc.width;
  const [er, ec] = doc.entry || [3, 3];
  // 回程格必须与入口**留出距离**：玩家传送后会落在 entry 上，
  // 若回程格紧邻 entry 会被立刻弹回去（来回震荡）。
  const r = Math.max(0, er - 3), c = ec;
  const i = r * w + c;
  doc.events[i] = { ...(doc.events[i] || {}), map: HOME_ID };
  patch.maps[TEST] = doc;
  console.log(`试验场 (${r},${c}) → 孙家庄 (id ${HOME_ID})`);
}

// ---- 3. 在孙家庄入口附近写一段提示（玩家走到附近时知道这里有传送）----
// 用地图的 events 无法直接给提示，改成：在试验场 entry 处设置 tip 由 triggers 自动显示
// （triggers.js 已实现「进入 X」提示）。这里额外记录入口坐标供文档/调试使用。
patch.content.portals = {
  "孙家庄": { to: "试验场", cells: [[11, 13], [11, 14]] },
  "试验场": { to: "孙家庄", cells: [[0, 3]] },
};

fs.writeFileSync(PATCH, JSON.stringify(patch));
console.log("\n已写入", path.relative(ROOT, PATCH));
console.log("mapsIndex:", JSON.stringify(mapsIndex));
