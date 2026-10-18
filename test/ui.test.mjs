// content/ui.js 单测：元件规整 / 锚点解析 / 命中测试 / 格子布局。
// 重点守一条：**默认配置的坐标必须与改造前的硬编码逐像素一致**，
// 否则“把布局搬进数据”这一步就引入了视觉回归。
import { strict as assert } from "assert";
import {
  normalizeUi, normalizeUiComponent, uiComponent, resolvePos,
  hitComponent, hitTop, slotRect, UI_KINDS, UI_ANCHORS,
} from "../src/content/ui.js";
import { defaultUi, defaultUiComponents, DEFAULT_UI_METRICS } from "../src/content/uiDefault.js";

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
