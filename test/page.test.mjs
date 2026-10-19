// 页面域（PageDoc）测试。
//
// 这一层的存在理由：标题/片头/关于/结算/告别这 5 个页面原先写死在
// render/scene-ui.js 的 switch 与 core/layout.js 的 MENU_BUTTONS 里。
// 搬进数据后必须守住三件事：
//   1) **默认数据的渲染结果与改造前逐像素一致**（否则就是视觉回归）
//   2) 页面是数据，改动数据就能改页面（不再需要改代码）
//   3) 未知/缺失数据不崩、不卡死（回退到能继续操作的最小状态）
import { strict as assert } from "assert";
import fs from "fs";
import { normalizePage, normalizePages, pageById, pageHit, PAGE_KINDS, DEFAULT_PAGE_ID } from "../src/content/page.js";
import { defaultPages, defaultPageTable, VW, VH } from "../src/content/pageDefault.js";

// ---- 1) 默认页面与改造前的硬编码按钮一致 ----

// 改造前 core/layout.js 的 MENU_BUTTONS（4 个原版按钮 + 2 个引擎入口按钮）。
// 引擎入口按钮**已上移到 launcher**，所以这里只保留 4 个游戏内按钮。
const OLD_MENU_BUTTONS = [
  { k: "start", img: "start", x: 43, y: 439 },
  { k: "load", img: "load", x: 197, y: 439 },
  { k: "about", img: "about", x: 351, y: 439 },
  { k: "exit", img: "exit", x: 506, y: 439 },
];

export function defaultTitleMatchesOldLayout() {
  const pages = defaultPages();
  const title = pages.find(p => p.id === "title");
  assert.ok(title, "必须有 title 页面");
  assert.equal(title.kind, "menu");
  assert.equal(title.background, "assets/ui/mainmenu.png", "标题页背景需与改造前一致");
  assert.equal(title.items.length, OLD_MENU_BUTTONS.length,
    "标题页按钮数量应与改造前的游戏内按钮一致（版本/编辑两个入口已上移到 launcher）");

  for (let i = 0; i < OLD_MENU_BUTTONS.length; i++) {
    const old = OLD_MENU_BUTTONS[i], now = title.items[i];
    assert.equal(now.x, old.x, `第 ${i} 个按钮 x 漂移`);
    assert.equal(now.y, old.y, `第 ${i} 个按钮 y 漂移（旧硬编码是 439）`);
    assert.equal(now.w, 80, "按钮宽 80");
    assert.equal(now.h, 18, "按钮高 18");
    assert.equal(now.img, "assets/ui/" + old.img + ".png", `第 ${i} 个按钮图片`);
  }
}

export function titleActionsAreWired() {
  const title = defaultPages().find(p => p.id === "title");
  const byId = Object.fromEntries(title.items.map(c => [c.id, c]));
  assert.equal(byId["title.start"].action.type, "start");
  assert.equal(byId["title.load"].action.type, "load");
  assert.equal(byId["title.about"].action.type, "scene");
  assert.equal(byId["title.about"].action.to, "about");
  assert.equal(byId["title.exit"].action.type, "exit");
}

export function noEngineEntryInGamePages() {
  // 引擎入口按钮不能再出现在游戏页面里——否则又"埋进了世界里"。
  for (const p of normalizePages(defaultPages())) {
    for (const c of p.items) {
      assert.notEqual(c.action.type, "editor", `${p.id}/${c.id} 不应含编辑器入口`);
      assert.notEqual(c.action.type, "version", `${p.id}/${c.id} 不应含版本管理入口`);
    }
  }
}

export function defaultPageIdsCoverAll() {
  const ids = defaultPages().map(p => p.id);
  // 改造前 switch 里的 5 个分支
  for (const id of ["title", "flash", "about", "ending", "farewell"]) {
    assert.ok(ids.includes(id), `缺少页面 ${id}`);
  }
  assert.equal(new Set(ids).size, ids.length, "页面 id 必须唯一");
}

export function defaultPageKindsValid() {
  for (const p of normalizePages(defaultPages())) {
    assert.ok(PAGE_KINDS.includes(p.kind), `${p.id} 的 kind ${p.kind} 非法`);
  }
  // 片头页要能被 flash 播放逻辑识别
  const flash = normalizePages(defaultPages()).find(p => p.id === "flash");
  assert.equal(flash.kind, "flash");
  const ending = normalizePages(defaultPages()).find(p => p.id === "ending");
  assert.equal(ending.kind, "score", "结算页应是 score 类型");
  assert.ok(ending.slots.length > 0, "结算页应有数据槽位");
}

export function defaultInitialPageIsFlash() {
  // 与改造前一致：先看片头，已看过则由 enterBoot 直接进标题。
  assert.equal(defaultPageTable().initial, "flash");
}

// ---- 2) 规整与查找 ----

export function normalizePageDefaults() {
  const p = normalizePage({});
  assert.equal(p.id, "");
  assert.equal(p.kind, "board", "未知 kind 回退 board（不是 menu，避免空页面也能点 start）");
  assert.deepEqual(p.items, []);
  assert.deepEqual(p.flash, []);
  assert.deepEqual(p.lines, []);
  assert.deepEqual(p.slots, []);
  assert.equal(p.closeSurfaces, true);
  assert.equal(p.clickAnywhere, false);
}

export function normalizePageIsIdempotent() {
  const once = normalizePages(defaultPages());
  const twice = normalizePages(once);
  assert.deepEqual(twice, once, "规整必须幂等");
}

export function normalizePagesDropsDuplicatesAndEmptyIds() {
  const out = normalizePages([
    { id: "a", kind: "menu" },
    { id: "a", kind: "board" },
    { id: "", kind: "menu" },
    { kind: "menu" },
  ]);
  assert.equal(out.length, 1, "重复 id 与空 id 应被丢弃");
  assert.equal(out[0].kind, "menu", "保留第一次出现的定义");
}

export function normalizePagesAcceptsRecord() {
  const out = normalizePages({ x: { id: "x", kind: "menu" }, y: { id: "y", kind: "board" } });
  assert.deepEqual(out.map(p => p.id), ["x", "y"]);
}

export function pageByIdWorks() {
  const pages = normalizePages(defaultPages());
  assert.equal(pageById(pages, "title").id, "title");
  assert.equal(pageById(pages, "nope"), null);
  assert.equal(pageById(null, "title"), null);
}

export function unknownActionFallsBackToNone() {
  const p = normalizePage({ id: "x", items: [{ id: "b", action: { type: "hack" } }] });
  assert.equal(p.items[0].action.type, "none", "未知 action 类型回退 none（只诊断不猜）");
}

export function actionAcceptsStringShorthand() {
  const p = normalizePage({ id: "x", items: [{ id: "b", action: "start" }] });
  assert.equal(p.items[0].action.type, "start");
  const bad = normalizePage({ id: "x", items: [{ id: "b", action: "nonsense" }] });
  assert.equal(bad.items[0].action.type, "none");
}

export function flashEntriesNormalized() {
  const p = normalizePage({ id: "f", kind: "flash", flash: ["a.bmp", { file: "b.bmp", duration: 3 }, { name: "c.bmp" }, null, {}] });
  assert.equal(p.flash.length, 3, "空条目应被丢弃");
  assert.deepEqual(p.flash.map(f => f.file), ["a.bmp", "b.bmp", "c.bmp"]);
  assert.deepEqual(p.flash.map(f => f.duration), [2, 3, 2], "缺省时长 2 秒");
}

// ---- 3) 命中测试复用 UI 层几何 ----

export function pageHitFindsButtons() {
  const title = normalizePage(defaultPages().find(p => p.id === "title"));
  // 第一个按钮 (43,439,80,18) 的中心
  const hit = pageHit(title, 43 + 40, 439 + 9, VW, VH);
  assert.ok(hit, "应命中 start 按钮");
  assert.equal(hit.id, "title.start");
  // 空白处
  assert.equal(pageHit(title, 10, 200, VW, VH), null);
  // 空页面
  assert.equal(pageHit(normalizePage({ id: "e" }), 0, 0, VW, VH), null);
  assert.equal(pageHit(null, 0, 0, VW, VH), null);
}

export function pageHitRespectsAnchor() {
  // 页面元件复用 ui.js，锚点语义必须一致：bottomRight 锚点下 x/y 是**相对右下角**的偏移，
  // 所以贴住右下角的按钮应写 x=0,y=0（原点已在 VW-w / VH-h 处），不需要再减宽高。
  const p = normalizePage({
    id: "x", items: [{ id: "b", kind: "button", anchor: "bottomRight", x: 0, y: 0, w: 80, h: 18, action: "start" }],
  });
  const hit = pageHit(p, VW - 40, VH - 9, VW, VH);
  assert.ok(hit, "bottomRight 锚点的按钮应能命中右下角");
  assert.equal(hit.id, "b");
  // 屏幕左上角不应命中
  assert.equal(pageHit(p, 10, 10, VW, VH), null);
}

// ---- 4) 磁盘数据与代码默认值不漂移 ----

export function pagesJsonMatchesDefaults() {
  const raw = fs.readFileSync(new URL("../versions/default/assets/pages.json", import.meta.url), "utf8");
  const disk = JSON.parse(raw);
  assert.ok(disk.pages, "pages.json 应有 pages 字段");
  assert.equal(disk.initial, defaultPageTable().initial, "initial 页不一致");
  const a = normalizePages(disk.pages);
  const b = normalizePages(defaultPages());
  assert.deepEqual(a.map(p => p.id), b.map(p => p.id), "页面 id 序列不一致");
  // 逐字段比对：坐标/图片/动作任一漂移都会让"换数据"与"换代码"结果不同
  for (const pb of b) {
    const pa = a.find(x => x.id === pb.id);
    assert.equal(pa.kind, pb.kind, `${pb.id} kind 不一致`);
    assert.equal(pa.background, pb.background, `${pb.id} background 不一致`);
    assert.equal(pa.clickAnywhere, pb.clickAnywhere, `${pb.id} clickAnywhere 不一致`);
    assert.equal(pa.items.length, pb.items.length, `${pb.id} 元件数量不一致`);
    for (let i = 0; i < pb.items.length; i++) {
      const x = pa.items[i], y = pb.items[i];
      for (const k of ["id", "kind", "anchor", "x", "y", "w", "h", "img"]) {
        assert.deepEqual(x[k], y[k], `${pb.id} 第 ${i} 个元件的 ${k} 不一致`);
      }
      assert.deepEqual(x.action, y.action, `${pb.id} 第 ${i} 个元件的 action 不一致`);
    }
  }
}

export function defaultPageIdConstant() {
  assert.equal(DEFAULT_PAGE_ID, "title");
}
