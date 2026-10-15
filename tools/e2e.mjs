// 端到端冒烟测试（需要先启动本地服务器与带调试端口的 Chrome）。
//
//   python serve.py 8123
//   chrome --headless=new --remote-debugging-port=9236 --user-data-dir=/tmp/chrs about:blank
//   node tools/e2e.mjs 9236 http://127.0.0.1:8123/index.html
//
// 校验：新版引导（ContentDB/MapDoc）后游戏可玩、编辑器可开、地图补丁保存、
// 撤销/重做、NPC 内容补丁保存，且运行期无异常。
const DBG = process.argv[2] || "9236";
const URL_ = process.argv[3] || "http://127.0.0.1:8123/index.html";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWs() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${DBG}/json/list`); const l = await r.json(); const p = l.find(t => t.type === "page" && t.webSocketDebuggerUrl); if (p) return p.webSocketDebuggerUrl; } catch (e) { }
    await sleep(300);
  }
  throw new Error("未找到 CDP 目标，请确认 Chrome 已带 --remote-debugging-port=" + DBG + " 启动");
}
const ws = new WebSocket(await getWs());
let id = 0; const pending = new Map(); const exceptions = [];
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") { const ex = m.params.exceptionDetails; exceptions.push((ex.exception && (ex.exception.description || ex.exception.value)) || ex.text); }
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
};
const send = (method, params = {}) => { const i = ++id; return new Promise((res, rej) => { pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }); };
async function ev(expr) { const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: URL_ });
await sleep(800);
await ev("try { localStorage.clear(); } catch (e) {}").catch(() => { });
await send("Page.reload");
for (let i = 0; i < 100; i++) { const s = await ev("window.__GAME__?window.__GAME__.G.scene:null").catch(() => null); if (s && s !== "boot") break; await sleep(250); }

const out = {};
out.contentOk = await ev("(() => { const A=window.__GAME__.A; return !!(A.content && A.content.npcs && A.content.mapDocs && Object.keys(A.content.mapDocs).length>=9); })()");
out.npcCount = await ev("window.__GAME__.A.npcsData.length");

await ev(`(async () => { const { getRuntime } = await import('/src/runtime/context.js'); const m = await import('/src/systems/scene.js'); m.startGame(getRuntime()); return 1; })()`);
for (let i = 0; i < 40; i++) { if (await ev("window.__GAME__.G.scene") === "game") break; await sleep(100); }
out.gameScene = await ev("window.__GAME__.G.scene");
out.map = await ev("window.__GAME__.G.currentMap");
out.player = await ev("!!window.__GAME__.G.player");
out.saveRoundTrip = await ev(`(async () => { const { getRuntime } = await import('/src/runtime/context.js'); const m = await import('/src/systems/save.js'); window.__GAME__.G.stats.hp = 123; const saved = m.saveSlot(getRuntime(), 5); const ok = m.loadSlot(getRuntime(), 5); return !!(saved && ok && window.__GAME__.G.stats.hp === 123); })()`);
out.pathOk = await ev(`(async () => {
  const pf = await import('/src/world/pathfinding.js');
  const { getRuntime } = await import('/src/runtime/context.js');
  const u = await import('/src/core/utils.js');
  const G = window.__GAME__.G, p = G.player, w = G.map.width;
  const from = u.worldToCell(p.x, p.y);
  let target = null;
  for (let r = 0; r < w && !target; r++) for (let c = 0; c < w; c++) {
    if (G.map.flags[r*w+c] === 1 && (Math.abs(r-from.row) + Math.abs(c-from.col)) > 4) { target = { row: r, col: c }; break; }
  }
  if (!target) return 'no-target';
  const path = pf.findPath(getRuntime(), from.row, from.col, target.row, target.col);
  return !!(path && path.length && path.every(pt => G.map.flags[pt.row*w+pt.col] === 1));
})()`);
out.combatOk = await ev(`(async () => {
  const { getRuntime } = await import('/src/runtime/context.js');
  const c = await import('/src/systems/combat.js');
  const { makeNPC } = await import('/src/world/npc.js');
  const G = window.__GAME__.G, rt = getRuntime(), A = window.__GAME__.A;
  let enemy = G.npcs.find(n => n.attackable);
  if (!enemy) {
    const def = A.npcsData.find(n => n.attack > 0);
    enemy = makeNPC(def, 0, 0);
    enemy.x = G.player.x; enemy.y = G.player.y + 30;
    G.npcs.push(enemy);
  }
  G.player.x = enemy.x; G.player.y = enemy.y + 30; G.player.target = enemy;
  G.stats.hit = 100; G.stats.attack = 9999;
  const dead0 = enemy.dead;
  for (let i = 0; i < 120 && !enemy.dead; i++) c.playerAttackTarget(rt);
  return !dead0 && enemy.dead === true;
})()`);
out.invOk = await ev(`(async () => {
  const inv = await import('/src/systems/inventory.js');
  const G = window.__GAME__.G;
  const before = inv.countItem(G, "金创药");
  inv.addItem(G, "金创药", 2);
  const after = inv.countItem(G, "金创药");
  inv.reindex(G);
  return after === before + 2 && G.inventory["金创药"] >= 2;
})()`);
out.shopOk = await ev(`(async () => {
  const { getRuntime } = await import('/src/runtime/context.js');
  const shop = await import('/src/systems/shop.js');
  const goods = shop.shopGoods(getRuntime(), { name: "x", model: "卖药人" });
  return Array.isArray(goods) && goods.length > 0;
})()`);

out.idbOk = await ev(`(async () => {
  const s = await import('/src/content/store.js');
  const id = "__idbtest" + Date.now();
  const pack = { format: "gsxy.pack", version: 2, id, name: "idbtest", base: "__default__", patch: {}, images: { "assets/x.png": "data:image/png;base64,AAAA" } };
  const r = await s.savePack(pack);
  const back = await s.loadPack(id);
  const stored = JSON.parse(localStorage.getItem("gsxy.pack.v2." + id));
  const ok = r.ok && back && back.images["assets/x.png"] === "data:image/png;base64,AAAA" && !stored.images;
  await s.deletePack(id);
  return ok;
})()`);

await ev(`(() => { window.prompt = () => "E2E"; window.confirm = () => true; return 1; })()`);
await ev(`(async () => { const m = await import('/src/editor/index.js'); await m.openEditor(); return 1; })()`);
for (let i = 0; i < 40; i++) { if (await ev("!!document.getElementById('editorRoot')")) break; await sleep(100); }
out.editorOpen = await ev("!!document.getElementById('editorRoot')");
await sleep(400);

const clickChip = label => ev(`(() => { const e=[...document.querySelectorAll('.ed-chip')].find(x=>x.textContent===${JSON.stringify(label)}); if(!e) return 'missing'; e.click(); return 'ok'; })()`);
const act = (type, btn, x, y) => ev(`(() => { const c=document.querySelector('.ed-map-wrap canvas'); const r=c.getBoundingClientRect();
  if (${JSON.stringify(type)} === 'down') c.dispatchEvent(new MouseEvent('mousedown',{button:${btn},clientX:r.left+${x},clientY:r.top+${y},bubbles:true}));
  else if (${JSON.stringify(type)} === 'up') window.dispatchEvent(new MouseEvent('mouseup',{button:${btn},bubbles:true}));
  else c.dispatchEvent(new MouseEvent('mousemove',{clientX:r.left+${x},clientY:r.top+${y},bubbles:true}));
  return 1; })()`);
const key = (k, ctrl, shift) => ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},ctrlKey:${!!ctrl},shiftKey:${!!shift},bubbles:true}))`);
const save = async () => { await ev(`(() => { [...document.querySelectorAll('.ed-bar button')].find(x=>x.textContent==='保存').click(); return 1; })()`); await sleep(300); };
const readPack = () => ev(`(() => { const idx=JSON.parse(localStorage.getItem('gsxy.packs.v2')); if(!idx) return null; return JSON.parse(localStorage.getItem('gsxy.pack.v2.'+idx.active)); })()`);


// 地图补丁 + 撤销/重做
await clickChip("地面"); await sleep(120);
await clickChip("刷地面"); await sleep(120);
await ev(`(() => { const c=document.querySelector('.ed-palette .ed-palette-cv'); const r=c.getBoundingClientRect(); const pcols=Math.round(c.width/50); const i=100; const col=i%pcols,row=Math.floor(i/pcols); c.dispatchEvent(new MouseEvent('click',{clientX:r.left+col*50+5,clientY:r.top+row*26+5,bubbles:true})); return 1; })()`);
const cx = await ev("Math.round(document.querySelector('.ed-map-wrap canvas').width/2)");
const cy = await ev("Math.round(document.querySelector('.ed-map-wrap canvas').height/2)");
await act("down", 0, cx, cy); await act("up", 0, cx, cy);
await sleep(600);
await save();
const curMap = out.map;
let pack = await readPack();
out.patchAfterPaint = !!(pack && pack.patch && pack.patch.maps && pack.patch.maps[curMap]);
{
  const m = pack.patch && pack.patch.maps && pack.patch.maps[curMap];
  out.patchIsMapDoc = !!(m && Array.isArray(m.ground) && Array.isArray(m.collision) && Array.isArray(m.decorations) && Array.isArray(m.units) && !("cells" in m));
}

await key("z", true, false); await sleep(400); await save(); pack = await readPack();
out.patchAfterUndo = !!(pack && pack.patch && pack.patch.maps && pack.patch.maps[curMap]);
await key("y", true, false); await sleep(400); await save(); pack = await readPack();
out.patchAfterRedo = !!(pack && pack.patch && pack.patch.maps && pack.patch.maps[curMap]);

// NPC 内容补丁
await ev(`(() => { const b=[...document.querySelectorAll('.ed-nav button')].find(x=>x.textContent==='NPC'); b.click(); return 1; })()`);
await sleep(250);
out.npcEdited = await ev(`(() => { const rows=[...document.querySelectorAll('.ed-main .ed-row')]; const r=rows.find(f=>f.querySelector('label')&&f.querySelector('label').textContent==='移动速度'); if(!r) return false; const i=r.querySelector('input'); i.value='99'; i.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
await save(); pack = await readPack();
out.patchContentNpcs = !!(pack && pack.patch && pack.patch.content && pack.patch.content.npcs);

// 单位实例覆盖：选中第 1 个单位，开启“本实例独立配置”，改移动速度为 111
await ev(`(() => { [...document.querySelectorAll('.ed-nav button')].find(x=>x.textContent==='地图').click(); return 1; })()`);
await sleep(250);
await clickChip("单位"); await sleep(200);
await ev(`(() => { document.querySelector('.ed-side .ed-thumbcell').click(); return 1; })()`);
await sleep(300);
out.instToggle = await ev(`(() => { const f=[...document.querySelectorAll('.ed-side .ed-field')].find(x=>x.querySelector('label')&&x.querySelector('label').textContent.includes('本实例')); if(!f) return false; const c=f.querySelector('input[type=checkbox]'); c.checked=true; c.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
await sleep(350);
await ev(`(() => { const r=[...document.querySelectorAll('.ed-side .ed-row')].find(f=>f.querySelector('label')&&f.querySelector('label').textContent==='移动速度'); const i=r.querySelector('input'); i.value='111'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
await sleep(300);
await save(); pack = await readPack();
{
  const units = pack && pack.patch && pack.patch.maps && pack.patch.maps[curMap] && pack.patch.maps[curMap].units;
  out.overrideSaved = !!(units && units.some(u => u.overrides && u.overrides.speed === 111));
}

// 多选/框选：装饰层从画布角落拖拽框选（尝试多个起点）
await clickChip("装饰"); await sleep(200);
{
  const w = await ev("document.querySelector('.ed-map-wrap canvas').width");
  const h = await ev("document.querySelector('.ed-map-wrap canvas').height");
  const starts = [[6,6],[w-6,6],[6,h-6],[w-6,h-6],[Math.floor(w/2),6],[6,Math.floor(h/2)]];
  out.marqueeDbg = [];
  for (const [sx,sy] of starts) {
    await act("down", 0, sx, sy); await act("move", 0, Math.floor(w/2), Math.floor(h/2)); await act("move", 0, w-6, h-6); await act("up", 0, 0, 0);
    await sleep(120);
    const h3 = await ev(`[...document.querySelectorAll('.ed-side h3')].map(e=>e.textContent)`);
    out.marqueeDbg.push(h3.join("|"));
    const m = h3.find(t => t.startsWith("装饰物：已选"));
    if (m) { out.marqueeN = parseInt(m.replace(/[^0-9]/g, ""), 10) || 0; break; }
  }
  if (out.marqueeN == null) out.marqueeN = 0;
}

// 关闭编辑器，重开游戏：实例覆盖应在运行时生效
await ev(`(async () => { const m = await import('/src/editor/index.js'); m.closeEditor(true); return 1; })()`);
await sleep(200);
out.sceneAfterClose = await ev("window.__GAME__.G.scene");
await ev(`(async () => { const { getRuntime } = await import('/src/runtime/context.js'); const m = await import('/src/systems/scene.js'); m.startGame(getRuntime()); return 1; })()`);
for (let i = 0; i < 40; i++) { if (await ev("window.__GAME__.G.scene") === "game") break; await sleep(100); }
out.overrideRuntime = await ev("window.__GAME__.G.npcs.some(n => n.speed === 111)");

console.log(JSON.stringify(out, null, 1));
console.log("exceptions:", exceptions.length, exceptions.slice(0, 3));
const ok = out.contentOk && out.npcCount === 39 && out.gameScene === "game" && out.player && out.saveRoundTrip && out.pathOk && out.combatOk && out.invOk && out.shopOk && out.idbOk && out.editorOpen
  && out.patchAfterPaint && out.patchAfterUndo === false && out.patchAfterRedo === true
  && out.marqueeN > 0 && out.patchIsMapDoc && out.npcEdited && out.patchContentNpcs
  && out.instToggle && out.overrideSaved && out.overrideRuntime
  && out.sceneAfterClose === "menu" && exceptions.length === 0;
console.log(ok ? "RESULT: PASS" : "RESULT: FAIL");
ws.close(); process.exit(ok ? 0 : 1);
