// 端到端测试（Playwright）：新版引导 → 游戏玩法 → 编辑器 → 内容包补丁/IDB。
// 运行：npx playwright test   （自动起 `python serve.py 8131`）
import { test, expect } from "@playwright/test";

const waitBoot = page => page.waitForFunction(
  () => window.__GAME__ && window.__GAME__.G.scene && window.__GAME__.G.scene !== "boot",
  null, { timeout: 40_000 });

async function canvasBox(page) { return await page.locator(".ed-map-wrap canvas").boundingBox(); }
async function canvasClick(page, x, y) {
  const b = await canvasBox(page);
  await page.mouse.move(b.x + x, b.y + y); await page.mouse.down(); await page.mouse.up();
}
async function savePack(page) { await page.locator('.ed-bar button:has-text("保存")').click(); await page.waitForTimeout(350); }
async function readPack(page) {
  return await page.evaluate(() => {
    const idx = JSON.parse(localStorage.getItem("gsxy.packs.v2"));
    return idx ? JSON.parse(localStorage.getItem("gsxy.pack.v2." + idx.active)) : null;
  });
}

test("游戏可玩 + 编辑器 + 内容管线", async ({ page }) => {
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));

  await page.goto("/index.html");
  await waitBoot(page);
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) { } });
  await page.reload();
  await waitBoot(page);

  // 规范内容模型
  const contentOk = await page.evaluate(() => {
    const A = window.__GAME__.A;
    return !!(A.content && A.content.npcs && A.content.mapDocs && Object.keys(A.content.mapDocs).length >= 9 && A.npcsData.length === 39);
  });
  expect(contentOk).toBe(true);

  // 开始游戏
  await page.evaluate(async () => {
    const { getRuntime } = await import("/src/runtime/context.js");
    const m = await import("/src/systems/scene.js");
    m.startGame(getRuntime());
  });
  await page.waitForFunction(() => window.__GAME__.G.scene === "game");
  expect(await page.evaluate(() => window.__GAME__.G.currentMap)).toBe("孙家庄");
  expect(await page.evaluate(() => !!window.__GAME__.G.player)).toBe(true);

  // 存读档往返
  expect(await page.evaluate(async () => {
    const { getRuntime } = await import("/src/runtime/context.js");
    const m = await import("/src/systems/save.js");
    window.__GAME__.G.stats.hp = 123;
    return m.saveSlot(getRuntime(), 5) && m.loadSlot(getRuntime(), 5) && window.__GAME__.G.stats.hp === 123;
  })).toBe(true);

  // 寻路
  expect(await page.evaluate(async () => {
    const pf = await import("/src/world/pathfinding.js");
    const { getRuntime } = await import("/src/runtime/context.js");
    const u = await import("/src/core/utils.js");
    const G = window.__GAME__.G, w = G.map.width, from = u.worldToCell(G.player.x, G.player.y);
    let t = null;
    for (let r = 0; r < w && !t; r++) for (let c = 0; c < w; c++) if (G.map.flags[r * w + c] === 1 && (Math.abs(r - from.row) + Math.abs(c - from.col)) > 4) { t = { row: r, col: c }; break; }
    if (!t) return false;
    const p = pf.findPath(getRuntime(), from.row, from.col, t.row, t.col);
    return !!(p && p.length && p.every(pt => G.map.flags[pt.row * w + pt.col] === 1));
  })).toBe(true);

  // 战斗击杀
  expect(await page.evaluate(async () => {
    const { getRuntime } = await import("/src/runtime/context.js");
    const c = await import("/src/systems/combat.js");
    const { makeNPC } = await import("/src/world/npc.js");
    const G = window.__GAME__.G, A = window.__GAME__.A, rt = getRuntime();
    let enemy = G.npcs.find(n => n.attackable);
    if (!enemy) { enemy = makeNPC(A.npcsData.find(n => n.attack > 0), 0, 0); enemy.x = G.player.x; enemy.y = G.player.y + 30; G.npcs.push(enemy); }
    G.player.x = enemy.x; G.player.y = enemy.y + 30; G.player.target = enemy;
    G.stats.hit = 100; G.stats.attack = 9999;
    for (let i = 0; i < 120 && !enemy.dead; i++) c.playerAttackTarget(rt);
    return enemy.dead === true;
  })).toBe(true);

  // 背包 / 商店
  expect(await page.evaluate(async () => {
    const inv = await import("/src/systems/inventory.js");
    const G = window.__GAME__.G, before = inv.countItem(G, "金创药");
    inv.addItem(G, "金创药", 2); inv.reindex(G);
    return inv.countItem(G, "金创药") === before + 2 && G.inventory["金创药"] >= 2;
  })).toBe(true);
  expect(await page.evaluate(async () => {
    const { getRuntime } = await import("/src/runtime/context.js");
    const shop = await import("/src/systems/shop.js");
    const g = shop.shopGoods(getRuntime(), { name: "x", model: "卖药人" });
    return Array.isArray(g) && g.length > 0;
  })).toBe(true);

  // ---- 编辑器 ----
  await page.evaluate(() => { window.prompt = () => "PW版本"; window.confirm = () => true; });
  await page.evaluate(async () => { const m = await import("/src/editor/index.js"); await m.openEditor(); });
  await expect(page.locator("#editorRoot")).toBeVisible();
  await page.waitForTimeout(400);

  // 地面刷贴图
  await page.locator('.ed-chip:has-text("地面")').first().click();
  await page.locator('.ed-chip:has-text("刷地面")').click();
  const pbox = await page.locator(".ed-palette .ed-palette-cv").boundingBox();
  await page.mouse.click(pbox.x + 505, pbox.y + 5);   // 选一个图块
  const cbox = await canvasBox(page);
  await canvasClick(page, Math.round(cbox.width / 2), Math.round(cbox.height / 2));
  await page.waitForTimeout(600);
  await savePack(page);
  const curMap = await page.evaluate(() => window.__GAME__.G.currentMap);
  let pack = await readPack(page);
  expect(!!(pack.patch && pack.patch.maps && pack.patch.maps[curMap])).toBe(true);
  expect(await page.evaluate(m => {
    const map = JSON.parse(localStorage.getItem("gsxy.pack.v2." + JSON.parse(localStorage.getItem("gsxy.packs.v2")).active)).patch.maps[m];
    return !!(map && Array.isArray(map.ground) && Array.isArray(map.collision) && Array.isArray(map.decorations) && Array.isArray(map.units) && !("cells" in map));
  }, curMap)).toBe(true);   // 补丁即图层化 MapDoc

  // 撤销 / 重做
  await page.keyboard.press("Control+z"); await page.waitForTimeout(400); await savePack(page);
  pack = await readPack(page);
  expect(!!(pack.patch && pack.patch.maps && pack.patch.maps[curMap])).toBe(false);
  await page.keyboard.press("Control+y"); await page.waitForTimeout(400); await savePack(page);
  pack = await readPack(page);
  expect(!!(pack.patch && pack.patch.maps && pack.patch.maps[curMap])).toBe(true);

  // NPC 内容补丁
  await page.locator('.ed-nav button:has-text("NPC")').click(); await page.waitForTimeout(250);
  await page.locator('.ed-main .ed-row:has-text("移动速度") input').first().fill("99");
  await savePack(page); pack = await readPack(page);
  expect(!!(pack.patch && pack.patch.content && pack.patch.content.npcs)).toBe(true);

  // 单位实例覆盖
  await page.locator('.ed-nav button:has-text("地图")').click(); await page.waitForTimeout(250);
  await page.locator('.ed-chip:has-text("单位")').first().click(); await page.waitForTimeout(200);
  await page.locator(".ed-side .ed-thumbcell").first().click(); await page.waitForTimeout(300);
  await page.locator('.ed-side .ed-field:has-text("本实例独立配置") input[type=checkbox]').check();
  await page.waitForTimeout(300);
  await page.locator('.ed-side .ed-row:has-text("移动速度") input').first().fill("111");
  await page.waitForTimeout(200);
  await savePack(page); pack = await readPack(page);
  const units = pack.patch && pack.patch.maps && pack.patch.maps[curMap] && pack.patch.maps[curMap].units;
  expect(!!(units && units.some(u => u.overrides && u.overrides.speed === 111))).toBe(true);

  // 框选（装饰层，从角落拖拽）
  await page.locator('.ed-chip:has-text("装饰")').first().click(); await page.waitForTimeout(200);
  const b2 = await canvasBox(page);
  let marqueeN = 0;
  for (const [sx, sy] of [[6, 6], [b2.width - 6, 6], [6, b2.height - 6], [b2.width - 6, b2.height - 6]]) {
    await page.mouse.move(b2.x + sx, b2.y + sy); await page.mouse.down();
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
    await page.mouse.move(b2.x + b2.width - 6, b2.y + b2.height - 6); await page.mouse.up();
    await page.waitForTimeout(150);
    const h3 = await page.locator(".ed-side h3").allTextContents();
    const m = h3.find(t => t.startsWith("装饰物：已选"));
    if (m) { marqueeN = parseInt(m.replace(/[^0-9]/g, ""), 10) || 0; break; }
  }
  expect(marqueeN).toBeGreaterThan(0);

  // 内容包图片 IndexedDB 存读
  expect(await page.evaluate(async () => {
    const s = await import("/src/content/store.js");
    const id = "__pw" + Date.now();
    const pack = { format: "gsxy.pack", version: 2, id, name: "t", base: "__default__", patch: {}, images: { "assets/x.png": "data:image/png;base64,AAAA" } };
    const r = await s.savePack(pack);
    const back = await s.loadPack(id);
    const stored = JSON.parse(localStorage.getItem("gsxy.pack.v2." + id));
    const ok = r.ok && back && back.images["assets/x.png"] === "data:image/png;base64,AAAA" && !stored.images;
    await s.deletePack(id);
    return ok;
  })).toBe(true);

  // 关闭编辑器 → 重开游戏，实例覆盖生效
  await page.evaluate(async () => { const m = await import("/src/editor/index.js"); await m.closeEditor(true); });
  await page.waitForFunction(() => window.__GAME__.G.scene === "menu");
  await page.evaluate(async () => { const { getRuntime } = await import("/src/runtime/context.js"); const m = await import("/src/systems/scene.js"); m.startGame(getRuntime()); });
  await page.waitForFunction(() => window.__GAME__.G.scene === "game");
  expect(await page.evaluate(() => window.__GAME__.G.npcs.some(n => n.speed === 111))).toBe(true);

  expect(errors).toEqual([]);
});
