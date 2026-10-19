// content/ui.js 单测：元件规整 / 锚点解析 / 命中测试 / 格子布局。
// 重点守一条：**默认配置的坐标必须与改造前的硬编码逐像素一致**，
// 否则“把布局搬进数据”这一步就引入了视觉回归。
import { strict as assert } from "assert";
import fs from "fs";
import {
  normalizeUi, normalizeUiComponent, uiComponent, resolvePos,
  hitComponent, hitTop, slotRect, UI_KINDS, UI_ANCHORS,
} from "../src/content/ui.js";
import { defaultUi, defaultUiComponents, DEFAULT_UI_METRICS } from "../src/content/uiDefault.js";
import { installUiLayout, uiBox, settingsBox, settingsBar, settingsButtons } from "../src/core/layout.js";
import { stashSlotRect, smithButtons, mercRowRect, diffRowRect } from "../src/render/panels.js";

const VW = 640, VH = 480;

export function kindsAndAnchorsExist() {
  assert.ok(UI_KINDS.includes("panel"));
  assert.ok(UI_KINDS.includes("bar"));
  assert.ok(UI_KINDS.includes("slotgrid"));
  assert.ok(UI_ANCHORS.includes("bottomLeft"));
}

export function normalizeComponentDefaults() {
  const c = normalizeUiComponent({ id: "a" });
  assert.equal(c.id, "a");
  assert.equal(c.kind, "panel");          // 缺省 kind
  assert.equal(c.anchor, "topLeft");      // 缺省锚点
  assert.equal(c.visible, true);
  assert.equal(c.w, 0);
  // 非法 kind / anchor 回退
  assert.equal(normalizeUiComponent({ kind: "nope" }).kind, "panel");
  assert.equal(normalizeUiComponent({ anchor: "nope" }).anchor, "topLeft");
  // 负尺寸钳到 0
  assert.equal(normalizeUiComponent({ w: -5 }).w, 0);
  // 未知字段保留（向前兼容）
  const keep = normalizeUiComponent({ id: "b", myCustom: 42 });
  assert.equal(keep.myCustom, 42);
}

export function normalizeSlotGrid() {
  const c = normalizeUiComponent({ id: "g", kind: "slotgrid" });
  assert.equal(c.cols, 5);
  assert.equal(c.rows, 5);
  assert.equal(c.pitch, 40);
  assert.equal(c.padX, 8);
  assert.equal(c.padY, 28);
  assert.equal(c.slotW, 38);
  // cols/rows 至少 1
  assert.equal(normalizeUiComponent({ kind: "slotgrid", cols: 0 }).cols, 1);
}

export function normalizeUiAssignsIds() {
  const ui = normalizeUi([{ kind: "bar" }, { kind: "bar" }, { id: "x" }]);
  assert.equal(ui.components.length, 3);
  // 缺失 / 重复 id 会被补成唯一值
  const ids = ui.components.map(c => c.id);
  assert.equal(new Set(ids).size, 3, "id 必须唯一");
  assert.ok(ids.includes("x"));
  // 接受裸数组 / {components} / 映射写法
  assert.equal(normalizeUi(null).components.length, 0);
  assert.equal(normalizeUi({ components: [{ id: "q" }] }).components.length, 1);
  assert.equal(normalizeUi({ a: { kind: "bar" } }).components[0].id, "a");
}

export function uiComponentLookup() {
  const ui = normalizeUi([{ id: "find-me", kind: "bar" }]);
  assert.equal(uiComponent(ui, "find-me").kind, "bar");
  assert.equal(uiComponent(ui, "nope"), null);
  assert.equal(uiComponent(null, "x"), null);
}

export function anchorsResolve() {
  const base = { w: 100, h: 50, x: 10, y: 20 };
  assert.deepEqual(resolvePos({ ...base, anchor: "topLeft" }, VW, VH), { x: 10, y: 20 });
  assert.deepEqual(resolvePos({ ...base, anchor: "topRight" }, VW, VH), { x: 640 - 100 + 10, y: 20 });
  assert.deepEqual(resolvePos({ ...base, anchor: "bottomLeft" }, VW, VH), { x: 10, y: 480 - 50 + 20 });
  assert.deepEqual(resolvePos({ ...base, anchor: "bottomRight" }, VW, VH), { x: 640 - 100 + 10, y: 480 - 50 + 20 });
  // center：居中后再加偏移
  assert.deepEqual(resolvePos({ ...base, anchor: "center" }, VW, VH), { x: (640 - 100) / 2 + 10, y: (480 - 50) / 2 + 20 });
}

export function hitTestBasics() {
  const c = { w: 100, h: 50, x: 10, y: 20, anchor: "topLeft" };
  assert.equal(hitComponent(c, 10, 20, VW, VH), true);        // 左上含
  assert.equal(hitComponent(c, 109, 69, VW, VH), true);       // 右下不含（半开区间）
  assert.equal(hitComponent(c, 110, 69, VW, VH), false);
  assert.equal(hitComponent(c, 9, 20, VW, VH), false);
}

export function hitTopPrefersHigherZ() {
  const ui = normalizeUi([
    { id: "low", kind: "panel", anchor: "topLeft", x: 0, y: 0, w: 100, h: 100, z: 1 },
    { id: "high", kind: "panel", anchor: "topLeft", x: 0, y: 0, w: 100, h: 100, z: 5 },
  ]);
  assert.equal(hitTop(ui, 50, 50, VW, VH).id, "high");
  // 不可见元件不参与命中
  const ui2 = normalizeUi([
    { id: "hidden", kind: "panel", anchor: "topLeft", x: 0, y: 0, w: 100, h: 100, z: 9, visible: false },
    { id: "shown", kind: "panel", anchor: "topLeft", x: 0, y: 0, w: 100, h: 100, z: 1 },
  ]);
  assert.equal(hitTop(ui2, 50, 50, VW, VH).id, "shown");
}

export function slotRectLayout() {
  const c = normalizeUiComponent({
    id: "g", kind: "slotgrid", anchor: "topLeft", x: 100, y: 50,
    cols: 5, rows: 5, pitch: 40, padX: 8, padY: 28, slotW: 40, slotH: 40,
  });
  assert.deepEqual(slotRect(c, 0, VW, VH), { x: 108, y: 78, w: 40, h: 40 });
  // 第 5 格换行
  assert.deepEqual(slotRect(c, 5, VW, VH), { x: 108, y: 118, w: 40, h: 40 });
  // 第 6 格在同一行第二列
  assert.deepEqual(slotRect(c, 6, VW, VH), { x: 148, y: 118, w: 40, h: 40 });
}

// ---- 关键回归：默认 UI 与旧硬编码常量对齐 ----
export function defaultUiMatchesHardcodedLayout() {
  assert.equal(DEFAULT_UI_METRICS.VW, 640);
  assert.equal(DEFAULT_UI_METRICS.VH, 480);
  assert.equal(DEFAULT_UI_METRICS.HUD_Y, 380);

  const comps = defaultUiComponents();
  const byId = id => comps.find(c => c.id === id);
  assert.ok(byId("hud.panel"), "缺少底部面板");

  // 底部面板必须贴底：bottomLeft 锚点 + y=0 → 屏幕 y = 380
  const panel = resolvePos(byId("hud.panel"), VW, VH);
  assert.equal(panel.x, 0);
  assert.equal(panel.y, 380, "状态栏底图必须贴在 y=380（旧 VH-100）");

  // 三条状态条：x 与旧硬编码一致，屏幕 y = 380+48 = 428
  for (const [id, x, w] of [["hud.hp", 44, 159], ["hud.mp", 259, 159], ["hud.exp", 475, 159]]) {
    const c = byId(id);
    assert.equal(c.x, x, id + " x 与旧布局不一致");
    assert.equal(c.w, w, id + " 宽度与旧布局不一致");
    assert.equal(c.h, 7);
    const p = resolvePos(c, VW, VH);
    assert.equal(p.y, 428, id + " 应位于 y=428（旧 Y+48）");
  }

  // 快捷栏：首格 x=6、间距 37、宽高 35（旧 userpanel.bmp 格位）
  const hb = byId("hud.hotbar");
  assert.equal(hb.x, 6);
  assert.equal(hb.pitch, 37);
  assert.equal(hb.slotW, 35);
  assert.equal(hb.cols, 9);
  const s0 = slotRect(hb, 0, VW, VH);
  assert.equal(s0.x, 6);
  assert.equal(s0.y, 380 + 61);
  const s1 = slotRect(hb, 1, VW, VH);
  assert.equal(s1.x, 6 + 37);

  // 装备栏 4 格：旧硬编码 [492,530,566,603]（步进≈37，最后格有 2px 宽容）
  const eq = byId("hud.equip");
  assert.equal(eq.x, 492);
  assert.equal(eq.pitch, 37);
  assert.equal(eq.cols, 4);

  // 功能按钮：旧 FN_BUTTONS x0=454，5 个各 34 宽、步进 37
  const fn = byId("hud.fn");
  assert.equal(fn.x, 454);
  assert.equal(fn.pitch, 37);
  assert.equal(fn.cols, 5);
  assert.equal(fn.slotW, 34);
  assert.equal(resolvePos(fn, VW, VH).y, 380 + 61);

  // 背包 / 商店面板与旧 PACK_BOX / SHOP_BOX 一致
  const pack = byId("pack.panel");
  assert.deepEqual({ x: pack.x, y: pack.y, w: pack.w, h: pack.h }, { x: 220, y: 60, w: 200, h: 300 });
  const shop = byId("shop.panel");
  assert.deepEqual({ x: shop.x, y: shop.y, w: shop.w, h: shop.h }, { x: 8, y: 60, w: 200, h: 300 });
}

export function defaultUiIdsUnique() {
  const ui = normalizeUi(defaultUi());
  const ids = ui.components.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, "默认 UI 的 id 必须唯一");
  // 规整应当是无损的（幂等）
  const again = normalizeUi(ui);
  assert.deepEqual(again.components.map(c => c.id), ids);
}

export function defaultUiCoversUserAskedPanels() {
  const ui = normalizeUi(defaultUi());
  const ids = ui.components.map(c => c.id);
  // 用户明确点名要看得到/能改的几类界面
  assert.ok(ids.includes("hud.hp") && ids.includes("hud.mp"), "状态栏组件");
  assert.ok(ids.includes("pack.panel") && ids.includes("pack.grid"), "物品栏组件");
  assert.ok(ids.includes("shop.panel") && ids.includes("shop.grid"), "商店栏组件");
}

// ---- 与 ContentDB 的补丁往返（编辑器保存路径）----
import { buildContentDB, diffContent, applyPatch } from "../src/content/contentdb.js";

export function uiPatchRoundTrip() {
  const assets = { npcs: [], items: [], skills: [], scripts: {} };
  const base = buildContentDB(assets, {});
  // 缺省时应当拿到默认布局（= 旧硬编码）
  assert.ok(base.ui && Array.isArray(base.ui.components));
  assert.ok(base.ui.components.length > 0);

  // 改动：移动血条 + 删掉金钱标签 + 新增一个自定义面板
  const next = JSON.parse(JSON.stringify(base));
  const hp = next.ui.components.find(c => c.id === "hud.hp");
  hp.x = 99;
  next.ui.components = next.ui.components.filter(c => c.id !== "hud.money");
  next.ui.components.push({ id: "custom.banner", kind: "panel", anchor: "center", x: 0, y: -100, w: 200, h: 30, z: 500 });

  const patch = diffContent(base, next);
  assert.ok(patch.content.ui, "改动 UI 必须产生补丁");
  assert.equal(patch.content.ui.components.length, next.ui.components.length);

  // applyPatch 后与 next 一致（编辑器保存 → 重新加载的路径）
  const merged = applyPatch(base, patch);
  assert.equal(merged.ui.components.length, next.ui.components.length);
  assert.equal(merged.ui.components.find(c => c.id === "hud.hp").x, 99);
  assert.equal(merged.ui.components.find(c => c.id === "hud.money"), undefined);
  assert.equal(merged.ui.components.find(c => c.id === "custom.banner").kind, "panel");

  // 未改动时不产生 ui 补丁（避免每次保存都重写整表）
  const noop = diffContent(base, JSON.parse(JSON.stringify(base)));
  assert.equal(noop.content && noop.content.ui, undefined);
}

// ---- 命中测试与绘制"同源"的不变量 ----
// core/layout.js 不能 import content/（架构分层），它通过 installUiLayout 注入配置，
// 并**自己复制了一份** compPos/compSlot 的几何计算。两份实现必须逐点一致，
// 否则"画在哪"和"点在哪"会错位。这里直接对照 content/ui.js 的权威实现。
//
// 注意：这里不 import core/layout.js —— 它经由 core/constants.js 依赖 DOM canvas，
// 在 Node 里无法加载。真正端到端的点选验证放在 e2e（浏览器里跑）。
export function resolvePosIsStableAcrossAnchors() {
  // content/ui.js 的 resolvePos 是权威实现；core/layout.js 里的 compPos 是它的镜像。
  // 这条用例固化锚点语义，任何人改动都必须同步改两处（否则 e2e 会报错位）。
  const c = { w: 200, h: 300, x: 8, y: 60 };
  assert.deepEqual(resolvePos({ ...c, anchor: "topLeft" }, VW, VH), { x: 8, y: 60 });
  assert.deepEqual(resolvePos({ ...c, anchor: "bottomLeft" }, VW, VH), { x: 8, y: 480 - 300 + 60 });
  // slotgrid 格子：首格 = 面板左上 + (padX, padY)，之后按 pitch 平移
  const g = normalizeUiComponent({
    id: "g", kind: "slotgrid", anchor: "topLeft", x: 8, y: 60,
    cols: 5, rows: 5, pitch: 40, padX: 8, padY: 28, slotW: 38, slotH: 38,
  });
  assert.deepEqual(slotRect(g, 0, VW, VH), { x: 16, y: 88, w: 38, h: 38 });
  assert.deepEqual(slotRect(g, 1, VW, VH), { x: 56, y: 88, w: 38, h: 38 });
  assert.deepEqual(slotRect(g, 5, VW, VH), { x: 16, y: 128, w: 38, h: 38 });
}

export function layoutConstantsMatchCoreLayout() {
  // defaultUiComponents 里的数字来自 core/layout.js。这里通过**读源码文本**
  // 校验关键常量没有单边漂移（不 import，避免 DOM 依赖）。
  // 任何一边改了数字，这条测试立刻失败，提醒同步。
  const src = fs.readFileSync(new URL("../src/core/layout.js", import.meta.url), "utf8");
  const m = DEFAULT_UI_METRICS;
  assert.ok(src.includes("HOTBAR_X0 = " + m.HOTBAR.x0), "快捷栏首格 x 与 core/layout.js 不一致");
  assert.ok(src.includes("HOTBAR_DX = " + m.HOTBAR.dx), "快捷栏间距与 core/layout.js 不一致");
  assert.ok(src.includes("HOTBAR_Y = " + m.HOTBAR.y), "快捷栏 y 与 core/layout.js 不一致");
  assert.ok(src.includes("x: 220, y: 60, w: 200, h: 300"), "背包面板与 core/layout.js 不一致");
  assert.ok(src.includes("x: 8, y: 60, w: 200, h: 300"), "商店面板与 core/layout.js 不一致");
  // 居中弹窗：旧 render/panels.js 把 420x300 / 460x340 写死在 (VW-w)/2, y=40
  assert.ok(src.includes("PACK_BOX = { x: 220, y: 60"), "包裹面板常量缺失");
}

export function centeredPanelsMatchOldHardcode() {
  // info.panel / save.panel 用 center 锚点表达"水平居中、y=40"。
  // 旧代码是 x=(VW-w)/2, y=40 —— 这里校验换算后逐像素一致，
  // 防止锚点语义改动后弹窗悄悄偏位（单测抓不到绘制，只能靠这里的几何）。
  const byId = Object.fromEntries(defaultUiComponents().map(c => [c.id, c]));
  const info = byId["info.panel"], save = byId["save.panel"];
  assert.ok(info && save, "缺少 info.panel / save.panel");
  const ri = resolvePos(info, VW, VH), rs = resolvePos(save, VW, VH);
  // resolvePos 只给位置，尺寸从元件上取（与绘制侧一致）
  assert.deepEqual(ri, { x: (VW - 420) / 2, y: 40 });
  assert.deepEqual(rs, { x: (VW - 460) / 2, y: 40 });
  assert.equal(info.w, 420); assert.equal(info.h, 300);
  assert.equal(save.w, 460); assert.equal(save.h, 340);
  // 锚点必须是 center：换成 topLeft 会让它们贴到左上角（曾经踩过的坑）
  assert.equal(info.anchor, "center");
  assert.equal(save.anchor, "center");
}

// ---- visibleBind：组件显隐由游戏状态驱动 ----
// 回归背景（P1 遗留 bug）：pack.panel / shop.panel / info.panel / save.panel
// 被搬进 ui.json 后丢掉了原来的 packOpen / shop / panel / savePanel 守卫，
// drawHUD 无条件绘制它们 → 进游戏就有一个关不掉的背包框和全屏暗块。
export function normalizeVisibleBind() {
  // 合法值保留
  assert.equal(normalizeUiComponent({ visibleBind: "packOpen" }).visibleBind, "packOpen");
  assert.equal(normalizeUiComponent({ visibleBind: "shop" }).visibleBind, "shop");
  assert.equal(normalizeUiComponent({ visibleBind: "panel" }).visibleBind, "panel");
  // 缺省 / 非法值回退为空串（恒可见）
  assert.equal(normalizeUiComponent({}).visibleBind, "");
  assert.equal(normalizeUiComponent({ visibleBind: "nope" }).visibleBind, "");
}

export function defaultUiPanelsHaveVisibleBind() {
  // 默认数据里这四个面板必须带 visibleBind，否则会常驻屏幕。
  const ui = defaultUi();
  const must = { "pack.panel": "packOpen", "pack.grid": "packOpen", "shop.panel": "shop", "shop.grid": "shop", "shop.close": "shop", "info.panel": "panel", "save.panel": "savePanel" };
  for (const [id, vb] of Object.entries(must)) {
    const c = uiComponent(ui, id);
    assert.ok(c, id + " 存在");
    assert.equal(c.visibleBind, vb, id + " 的 visibleBind 应为 " + vb);
  }
  // HUD 常驻元件不得带 visibleBind（否则会消失）
  for (const id of ["hud.panel", "hud.hotbar", "hud.equip", "hud.fn"]) {
    const c = uiComponent(ui, id);
    assert.ok(c, id + " 存在");
    assert.ok(!c.visibleBind, id + " 不应绑可见性");
  }
}

// ---- P1-1：六个硬编码面板已搬进 UI 配置 ----
// 这些面板原先的坐标写死在 render/panels.js 的 XXX_BOX 常量里，绘制与命中各写一份。
// 现在统一走 uiBox("xxx.panel", 默认值)，本组断言锁住三件事：
//   1) ui.json 与 uiDefault.js 两份数据不漂移（手工同步，最易腐化）
//   2) 配置里的坐标与旧硬编码一致（否则搬完画面会跳位）
//   3) uiBox 真的优先读配置、缺配置时回退默认（不能把面板弄丢）

const PANELS = [
  { id: "stash.panel",      bind: "stashPanel",    box: { x: 12,  y: 40,  w: 316, h: 338 } },
  { id: "smith.panel",      bind: "smithPanel",    box: { x: 150, y: 110, w: 340, h: 250 } },
  { id: "difficulty.panel", bind: "diffPanel",     box: { x: 190, y: 130, w: 260, h: 190 } },
  { id: "merc.panel",       bind: "mercPanel",     box: { x: 170, y: 100, w: 300, h: 250 } },
  { id: "waypoint.panel",   bind: "waypointPanel", box: { x: 150, y: 50,  w: 340, h: 320 } },
  { id: "settings.panel",   bind: "settingsPanel", box: { x: 130, y: 80,  w: 380, h: 320 } },
];

export function defaultUiHasMigratedPanels() {
  const comps = defaultUiComponents();
  for (const p of PANELS) {
    const c = comps.find(x => x.id === p.id);
    assert.ok(c, `默认 UI 缺少 ${p.id}`);
    assert.equal(c.visibleBind, p.bind, `${p.id} 的 visibleBind 应为 ${p.bind}`);
    assert.equal(c.drawnBy, "none", `${p.id} 由专用绘制函数独占，应标 drawnBy=none`);
    assert.deepEqual({ x: c.x, y: c.y, w: c.w, h: c.h }, p.box, `${p.id} 坐标与旧硬编码不一致`);
  }
}

export function uiJsonHasMigratedPanels() {
  // ui.json 是磁盘数据（编辑器保存的形态），与 uiDefault.js 必须保持一致。
  // 两份手工同步是已知的腐化风险，这里做逐字段比对。
  const raw = fs.readFileSync(new URL("../versions/default/assets/ui.json", import.meta.url), "utf8");
  const data = JSON.parse(raw);
  const comps = data.components || data;
  const defs = defaultUiComponents();
  for (const p of PANELS) {
    const disk = comps.find(x => x.id === p.id);
    assert.ok(disk, `ui.json 缺少 ${p.id}`);
    assert.deepEqual({ x: disk.x, y: disk.y, w: disk.w, h: disk.h }, p.box, `ui.json 的 ${p.id} 坐标不对`);
    assert.equal(disk.visibleBind, p.bind, `ui.json 的 ${p.id} visibleBind 不对`);
    assert.equal(disk.drawnBy, "none", `ui.json 的 ${p.id} drawnBy 不对`);
    // 与默认值逐字段对照，防止两份数据静默分叉
    const def = defs.find(x => x.id === p.id);
    for (const k of ["kind", "anchor", "x", "y", "w", "h", "visibleBind", "drawnBy"]) {
      assert.deepEqual(disk[k], def[k], `${p.id} 的 ${k} 在 ui.json 与 uiDefault.js 中不一致`);
    }
  }
}

export function uiBoxPrefersConfigAndFallsBack() {
  const fallback = { x: 1, y: 2, w: 3, h: 4 };
  // 未注入配置 → 回退默认（不能返回 null，否则面板会消失）
  installUiLayout(null);
  assert.deepEqual(uiBox("smith.panel", fallback), fallback, "未注入配置时应回退默认值");

  // 注入配置 → 取配置值
  installUiLayout(normalizeUi(defaultUi()));
  const r = uiBox("smith.panel", fallback);
  assert.deepEqual({ x: r.x, y: r.y, w: r.w, h: r.h }, PANELS[1].box, "注入配置后应取配置坐标");

  // 配置里没有该元件 → 仍回退
  assert.deepEqual(uiBox("no.such.panel", fallback), fallback, "配置缺该元件时应回退");

  installUiLayout(null);
}

export function migratedPanelsFollowConfigInRows() {
  // 面板挪动后，内部行/格/按钮必须跟着走（否则点不到）。
  installUiLayout(null);
  const beforeStash = stashSlotRect(0);
  const beforeSmith = smithButtons()[0];
  const beforeMerc = mercRowRect(0);
  const beforeDiff = diffRowRect(0);

  // 注入一个把所有面板整体右移 100、下移 50 的配置
  const ui = normalizeUi(defaultUi());
  for (const c of ui.components) {
    if (c.id.endsWith(".panel") && PANELS.some(p => p.id === c.id)) { c.x += 100; c.y += 50; }
  }
  installUiLayout(ui);
  try {
    assert.equal(stashSlotRect(0).x - beforeStash.x, 100, "仓库格子应跟随面板横移");
    assert.equal(stashSlotRect(0).y - beforeStash.y, 50, "仓库格子应跟随面板纵移");
    assert.equal(smithButtons()[0].x - beforeSmith.x, 100, "铁匠按钮应跟随面板横移");
    assert.equal(mercRowRect(0).x - beforeMerc.x, 100, "随从行应跟随面板横移");
    assert.equal(diffRowRect(0).y - beforeDiff.y, 50, "难度行应跟随面板纵移");
  } finally {
    installUiLayout(null);
  }
}

export function settingsUsesConfigurableBox() {
  installUiLayout(null);
  const d = settingsBox();
  assert.deepEqual({ x: d.x, y: d.y, w: d.w, h: d.h }, PANELS[5].box, "未注入时设置面板用默认几何");

  const ui = normalizeUi(defaultUi());
  const c = ui.components.find(x => x.id === "settings.panel");
  c.x += 40;
  installUiLayout(ui);
  try {
    assert.equal(settingsBox().x, PANELS[5].box.x + 40, "设置面板矩形应跟随配置");
    assert.equal(settingsBar().x, settingsBox().x + 110, "音量条应跟随面板偏移");
    assert.equal(settingsButtons()[0].x, settingsBox().x + 30, "系统菜单按钮应跟随面板偏移");
  } finally {
    installUiLayout(null);
  }
}
