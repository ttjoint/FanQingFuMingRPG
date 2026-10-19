// 输入：鼠标 / 键盘，包含世界点击（移动、攻击、对话）、物品拖拽、UI 交互分发。
import { G as GLOBAL_STATE } from "../core/state.js";
import { VW, VH, cv } from "../core/constants.js";
import { screenPos, worldToCell, walkable, cellCenter } from "../core/utils.js";
import { nearestWalkable, nearestWalkablePixel, findPathPoints } from "../world/pathfinding.js";
import { groundAt, dropGround } from "../systems/ground.js";
import { setMoveMarker, setLock, clearLock } from "../systems/indicators.js";
import { canAddItem, useItemSlot, reindex } from "../systems/inventory.js";
import { skillByName } from "../core/registry.js";
import { castSelf, playerCanAttack } from "../systems/combat.js";
import { setPlayerRun } from "../systems/motion.js";
import { hasGoods, openShop, closeShop, sellCursor } from "../systems/shop.js";
import { advanceDialog, startScript, openSay } from "../script/vm.js";
import { slotAt, insideShop, insideShopClose, insideDialog, settingsHit, fnButtonAt, settingsBar } from "../core/layout.js";
import { handleSlotClick } from "./slots.js";
import { waypointAt, WP_BOX, stashSlotAt, stashRect, STASH_BOX } from "../render/panels.js";
import { storeFromPack, takeToPack, toggleStashPanel, stashOf } from "../systems/stash.js";
import { smithButtonAt, smithRect, diffRowAt, DIFF_BOX } from "../render/panels.js";
import { normalizeDifficulties } from "../engine/difficulty.js";
import { mercRowAt, MERC_BOX } from "../render/panels.js";
import { hire, dismiss, toggleMercPanel, mercList, mercInfo } from "../systems/merc.js";
import { repairAll, identifyAll, gamble, toggleSmith } from "../systems/smith.js";
import { togglePanel, travelTo } from "../systems/waypoint.js";
import { saveBtnAt, saveSlot, loadSlot } from "../systems/save.js";
import { applyVolumes, playSound, saveSettings } from "../systems/audio.js";
import { enterMenu, startGame, flashPics, pageIdOf } from "../systems/scene.js";
import { pageHit } from "../content/page.js";
import { pageFor } from "../render/scene-ui.js";
import { getRuntime } from "../runtime/context.js";
import { isEditorAvailable } from "../content/store.js";
import { openSurface, closeSurface, closeAll, topSurface, toggleSurface } from "../systems/surfaces.js";

// P5：输入层的状态绑定。
//
// input.js 有 100+ 处直接读 G。逐处改签名收益很低，而且事件回调是注册时
// 就绑死的，加参数还得层层透传。这里改成"绑定一次、全局生效"：
//   addInput(rt) → bindState(rt) → 之后所有回调读的就是这份状态。
// 不绑定时回退到全局实例（既有行为，测试/热重载都能跑）。
let BOUND = null;
function G_now() { return BOUND || GLOBAL_STATE; }
function bindState(rt) {
  BOUND = (rt && rt.state) ? rt.state : (rt || null);
  return BOUND;
}
// 局部别名：保留既有 `G.xxx` 写法不变，但每次读都走当前绑定。
/** @type {any} */
const G = new Proxy(/** @type {any} */ ({}), {
  get(_t, k) { return G_now()[k]; },
  set(_t, k, v) { G_now()[k] = v; return true; },
  has(_t, k) { return k in G_now(); },
  ownKeys() { return Reflect.ownKeys(G_now()); },
  getOwnPropertyDescriptor(_t, k) {
    return { configurable: true, enumerable: true, value: G_now()[k] };
  },
});

// 五个功能窗口（属性/记事/荣辱/任务/菜单/设置）互斥：开一个就关掉其余，避免互相遮挡。
// 互斥本身交给 UI 管理器（systems/surfaces.js）："menu" 与 "info" 在同一个
// screen/panel 体系里各自只允许一个打开。
function setPanel(kind) {
  const cur = G.savePanel ? "menu" : G.panel;
  const next = cur === kind ? null : kind;   // 再点同一个 = 关闭
  if (!next) { closeSurface(G, "menu"); closeSurface(G, "info"); return; }
  if (next === "menu") openSurface(G, "menu");
  else openSurface(G, "info", next);
}

export function npcAt(wx, wy) {
  for (let i = G.npcs.length - 1; i >= 0; i--) {
    const n = G.npcs[i]; if (n.dead) continue;
    if (Math.abs(wx - n.x) < 26 && wy > n.y - 60 && wy < n.y + 8) return n;
  }
  return null;
}

// 全屏页面（标题 / 片头 / 关于 / 结算 / 告别）的点击分发。
//
// 页面是数据（PageDoc），所以这里不再按 scene 名字硬编码行为，而是统一：
//   1) 点中元件 → 执行它的 action
//   2) 没点中元件但页面声明 clickAnywhere → 返回标题
//   3) 闪屏页 → 点任意处跳到下一张 / 结束
//
// 改造前的分支（scene==="menu" 里逐 k 判断）已删除：菜单按钮现在是
// page.items，各自带 action，加一个按钮不再需要改这个文件。
export function handleSceneClick(sx, sy) {
  const rt = getRuntime();
  const id = pageIdOf(G.scene);
  const page = pageFor(rt, id);

  // 闪屏页：优先"推进一张"，语义与改造前一致（data 里的图片序列由页面给出）。
  if (id === "flash") {
    const n = flashPics(rt).length;
    if (G.flashStep < n - 1) { G.flashStep++; G.flashT = 0; } else enterMenu(rt);
    return;
  }

  // 1) 命中元件
  const comp = page ? pageHit(page, sx, sy, VW, VH) : null;
  if (comp && comp.action) { runPageAction(comp.action, rt); return; }

  // 2) 页面声明了"点任意处返回"
  if (page && page.clickAnywhere) { enterMenu(rt); return; }

  // 3) 没有页面数据时的兜底：非 title 页一律返回标题（不卡死）。
  if (!page && id !== "title") { enterMenu(rt); return; }
}

/**
 * 执行页面元件的动作。action 的类型表见 content/page.js 的 PAGE_ACTIONS。
 * 未知类型一律忽略（只诊断，不猜）。
 */
export function runPageAction(action, rt) {
  const r = rt || getRuntime();
  const type = action && action.type;
  if (!type || type === "none") return;
  if (type === "start") { startGame(r); return; }
  if (type === "load") { openSurface(G, "save"); return; }
  if (type === "scene") { const to = action.to; if (to) G.scene = to; return; }
  if (type === "surface") { const to = action.to; if (to) openSurface(G, to); return; }
  if (type === "exit") { G.scene = "farewell"; if (G.bgm) G.bgm.pause(); return; }
  if (type === "version") { import("../content/versions-ui.js").then(m => m.openVersionManager()); return; }
  if (type === "editor") {
    if (!isEditorAvailable()) return;
    import("../editor/index.js").then(m => m.openEditor()).catch(e => {
      console.error(e); G.tip = "编辑器加载失败"; G.tipT = 3;
    });
    return;
  }
}

export function handleLeft(wx, wy) {
  const p0 = G.player;
  const g = groundAt(G, wx, wy);
  if (g) {                                  // 点地面掉落物：走近并自动拾取
    if (!p0) return;
    if (!canAddItem(G, g.name, g.count || 1)) { G.tip = "物品栏已满，无法拾取"; G.tipT = 2; return; }
    p0.pickup = g;
    const c = worldToCell(g.x, g.y);
    const t = nearestWalkable(getRuntime(), c.row, c.col) || c;
    const cc = worldToCell(p0.x, p0.y);
    const pts = findPathPoints(getRuntime(), cc.row, cc.col, t.row, t.col, { avoidUnits: true, mover: p0 }, { x: p0.x, y: p0.y });
    if (pts && pts.length) { p0.target = null; p0.path = pts; p0.speed = 90; p0.running = false; }
    return;
  }
  if (p0) p0.pickup = null;
  const sk = skillByName(G, G.skill);
  const n = npcAt(wx, wy);
  if (sk && sk.type === 0 && !n) { castSelf(getRuntime()); return; }
  if (n) {
    // 左键点中任何单位 = 锁定该目标（敌对红圈 / 友好蓝圈）
    setLock(G, n);
    if (playerCanAttack(getRuntime(), n)) { if (G.player) { G.player.target = n; setPlayerRun(G, true); G.player.path = null; G.player.atkT = 0; } }
    else { // 友善 NPC：仅走近，不攻击
      const c = worldToCell(n.x, n.y);
      const p = nearestWalkable(getRuntime(), c.row, c.col);
      if (p && G.player) { const cc = worldToCell(G.player.x, G.player.y);
        const pts = findPathPoints(getRuntime(), cc.row, cc.col, p.row, p.col, { avoidUnits: true, mover: G.player }, { x: G.player.x, y: G.player.y });
        if (pts && pts.length) { G.player.target = null; G.player.path = pts; G.player.speed = 90; G.player.running = false; } }
    }
    return;
  }
  const c = worldToCell(wx, wy);
  const onCell = !!(G.map && walkable(c.row, c.col));
  let cell, exact;
  if (onCell) { cell = c; exact = { x: wx, y: wy }; }                       // 可走格 → 精确停在点击像素
  else { const n = nearestWalkablePixel(getRuntime(), wx, wy); if (!n) return; cell = { row: n.row, col: n.col }; exact = { x: n.x, y: n.y }; }   // 不可走 → 贴近的最近可走像素
  if (!G.player) return;
  if (Math.hypot(exact.x - G.player.x, exact.y - G.player.y) < 24) { G.player.path = null; G.player.target = null; return; }   // 已很近→原地不动，防抖动
  G.player.target = null;
  // 注意：点地板**不再取消锁定**。锁定圈只会在目标死亡 / 离开视野 / 切图时解除。
  setPlayerRun(G, true);   // 左键=跑（但精力为 0 时自动降为走路）
  setMoveMarker(G, exact.x, exact.y);   // 点击地面：落点光圈动画
  const cc = worldToCell(G.player.x, G.player.y);
  const pts = findPathPoints(getRuntime(), cc.row, cc.col, cell.row, cell.col, { avoidUnits: true, mover: G.player }, { x: G.player.x, y: G.player.y }, exact);
  if (pts && pts.length) G.player.path = pts;
}

export function handleRight(wx, wy) {
  const n = npcAt(wx, wy);
  if (n && !n.dead) {
    setLock(G, n);   // 右键点中单位同样锁定
    if (playerCanAttack(getRuntime(), n)) {
      const line = n.talks && n.talks.length ? n.talks[Math.floor(Math.random() * n.talks.length)] : "";
      if (line) openSay(getRuntime(), n.name, line.replace(/\\n/g, "\n"), n.portrait);
      else { G.tip = n.name + "：……"; G.tipT = 2; }
      return;
    }
    // 拥有货物背包（inventory 组件）的单位才与玩家交易
    if (hasGoods(n)) { if (G.shop && G.shop.npc === n) closeShop(getRuntime()); else openShop(getRuntime(), n); return; }
    if (!G.script && !G.dialog) {
      if (n.script) startScript(getRuntime(), n.script);
      else if (n.talks && n.talks.length) { const line = n.talks[Math.floor(Math.random() * n.talks.length)]; openSay(getRuntime(), n.name, line.replace(/\\n/g, "\n"), n.portrait); }
      else { G.tip = n.name + "：……"; G.tipT = 2; }
    }
    return;
  }
  // 注意：右键点空地**不再取消锁定**（见 handleLeft 同处注释）。
  const c = worldToCell(wx, wy);
  const onCell = !!(G.map && walkable(c.row, c.col));
  let cell, exact;
  if (onCell) { cell = c; exact = { x: wx, y: wy }; }
  else { const n = nearestWalkablePixel(getRuntime(), wx, wy); if (!n) return; cell = { row: n.row, col: n.col }; exact = { x: n.x, y: n.y }; }
  if (!G.player) return;
  if (Math.hypot(exact.x - G.player.x, exact.y - G.player.y) < 24) { G.player.path = null; G.player.target = null; return; }
  G.player.target = null;
  G.player.running = false;
  const cc = worldToCell(G.player.x, G.player.y);
  const pts = findPathPoints(getRuntime(), cc.row, cc.col, cell.row, cell.col, { avoidUnits: true, mover: G.player }, { x: G.player.x, y: G.player.y }, exact);
  if (pts && pts.length) { G.player.path = pts; G.player.speed = 90; }
}

export function cycleSkill(d) {
  if (!G.skills.length) return;
  let i = G.skills.indexOf(G.skill);
  i = (i + d + G.skills.length) % G.skills.length;
  G.skill = G.skills[i]; G.tip = "技能：" + G.skill; G.tipT = 2;
}

export function addInput(rt) {
  bindState(rt);
  // 拖动音量条：按下后移动持续调整（否则只能“点一下跳一格”，很难用）。
  cv.addEventListener("mousemove", e => {
    if (!G.volDrag) return;
    const sp = screenPos(e.clientX, e.clientY);
    const { w: bw, x: bx } = settingsBar();
    const v = Math.max(0, Math.min(1, (sp.x - bx) / bw));
    G.settings[G.volDrag] = v;
    applyVolumes(G);
  });
  window.addEventListener("mouseup", () => { if (G.volDrag) { G.volDrag = null; saveSettings(G); } });

  cv.addEventListener("mousedown", e => {
    const sp = screenPos(e.clientX, e.clientY);
    const w = { x: sp.x + G.cam.x, y: sp.y + G.cam.y };
    G.mouse.sx = sp.x; G.mouse.sy = sp.y; G.mouse.wx = w.x; G.mouse.wy = w.y;
    if (G.bgm && G.bgm.paused && G.bgmSrc && G.settings.bgm > 0) G.bgm.play().catch(() => { });
    const sh = settingsHit(sp.x, sp.y);
    if (sh) {
      const { w: bw, x: bx } = settingsBar();
      if (sh.k === "bgm") { G.settings.bgm = Math.max(0, Math.min(1, (sp.x - bx) / bw)); G.volDrag = "bgm"; }
      else if (sh.k === "sfx") { G.settings.sfx = Math.max(0, Math.min(1, (sp.x - bx) / bw)); G.volDrag = "sfx"; }
      else if (sh.k === "mutBgm") G.settings.bgm = G.settings.bgm > 0 ? 0 : 0.6;
      else if (sh.k === "mutSfx") G.settings.sfx = G.settings.sfx > 0 ? 0 : 0.8;
      // 系统菜单按钮
      else if (sh.k === "resume") { applyVolumes(G); G.settingsPanel = false; return; }
      else if (sh.k === "save") { applyVolumes(G); G.settingsPanel = false; G.savePanel = true; return; }
      else if (sh.k === "quit") { applyVolumes(G); G.settingsPanel = false; quitToEngine(); return; }
      // 注意：applyVolumes 的参数是**游戏状态 G**（它读 g.settings），不是 runtime。
      // 早先误传 getRuntime() 导致 g.settings 为 undefined，赋值 bgm.volume=undefined 抛错，
      // 音量完全不生效、设置也不落盘。
      applyVolumes(G); return;
    }
    if (G.settingsPanel) return;
    const sb = saveBtnAt(getRuntime(), sp.x, sp.y);
    if (sb) { if (sb.act === "save") saveSlot(getRuntime(), sb.i); else loadSlot(getRuntime(), sb.i); return; }
    if (G.scene === "game") {
      // 右下角功能按钮：属性 / 记事 / 荣辱 / 任务 / 菜单（菜单=存读档，可再点关闭）
      const fn = fnButtonAt(sp.x, sp.y);
      if (fn) { setPanel(fn); return; }
    }
    // 传送面板是模态的：点列表项传送，点面板外关闭。
    if (G.waypointPanel) {
      const wp = waypointAt(sp.x, sp.y, getRuntime());
      if (wp) { travelTo(getRuntime(), wp.id); return; }
      if (sp.x < WP_BOX.x || sp.x > WP_BOX.x + WP_BOX.w || sp.y < WP_BOX.y || sp.y > WP_BOX.y + WP_BOX.h) togglePanel(getRuntime(), false);
      return;
    }
    if (G.savePanel) { if (pageIdOf(G.scene) === "title") G.savePanel = false; return; }
    if (G.scene !== "game") { handleSceneClick(sp.x, sp.y); return; }
    if (G.dialog) {
      // 点中对话窗体内部 = 继续；点窗体以外的地板 = 中断对话
      if (insideDialog(sp.x, sp.y)) { if (G.dialog.kind === "say") advanceDialog(getRuntime()); return; }
      G.dialog = null; G.script = null;
      return;
    }
    if (G.gameOver) return;
    // 随从面板：未招募点行 = 招募；已招募点第二行 = 遣散。
    if (G.mercPanel) {
      const mi = mercRowAt(sp.x, sp.y, getRuntime());
      if (mi >= 0) {
        const rt = getRuntime();
        const info = mercInfo(rt);
        if (info) { if (mi === 1) dismiss(rt); }
        else { const list = mercList(rt); if (list[mi]) hire(rt, list[mi].id); }
        return;
      }
      if (sp.x >= MERC_BOX.x && sp.x <= MERC_BOX.x + MERC_BOX.w && sp.y >= MERC_BOX.y && sp.y <= MERC_BOX.y + MERC_BOX.h) return;
    }
    // 难度面板：点一行即切换（立即生效；已出场的怪不改，新出场的按新倍率）。
    if (G.diffPanel) {
      const di = diffRowAt(sp.x, sp.y, getRuntime());
      if (di >= 0) {
        const arr = normalizeDifficulties(getRuntime().config && getRuntime().config.difficulties);
        if (arr[di]) {
          G.difficulty = arr[di].id;
          G.tip = "难度：" + arr[di].name + "（重新进入地图后生效）"; G.tipT = 2.5;
        }
        return;
      }
      if (sp.x >= DIFF_BOX.x && sp.x <= DIFF_BOX.x + DIFF_BOX.w && sp.y >= DIFF_BOX.y && sp.y <= DIFF_BOX.y + DIFF_BOX.h) return;
    }
    // 铁匠面板：三个按钮分别对应赌博 / 鉴定全部 / 修理全部。
    if (G.smithPanel) {
      const btn = smithButtonAt(sp.x, sp.y, getRuntime());
      if (btn) {
        const rt = getRuntime();
        if (btn === "gamble") gamble(rt);
        else if (btn === "identify") identifyAll(rt);
        else if (btn === "repair") repairAll(rt);
        return;
      }
      const B = smithRect();
      if (sp.x >= B.x && sp.x <= B.x + B.w && sp.y >= B.y && sp.y <= B.y + B.h) return;   // 面板空白处：吞掉
    }
    // 仓库面板：左键取出到背包。面板在背包左侧，先判定避免穿透到下面。
    if (G.stashPanel) {
      stashOf(getRuntime());                       // 确保 G.stash 已载入（首帧可能还没渲染过）
      const si = stashSlotAt(sp.x, sp.y, getRuntime());
      if (si >= 0) { if (e.button === 0) takeToPack(getRuntime(), si); return; }
      const B = stashRect();
      if (sp.x >= B.x && sp.x <= B.x + B.w && sp.y >= B.y && sp.y <= B.y + B.h) return;   // 点在面板空白处：吞掉
    }
    const slot = slotAt(sp.x, sp.y);
    if (slot) { handleSlotClick(slot, e.button, e.shiftKey, null, e.ctrlKey); return; }
    if (G.shop && insideShopClose(sp.x, sp.y)) { closeShop(getRuntime()); G.hold = null; return; }   // 底部“关闭”按钮
    if (G.shop && insideShop(sp.x, sp.y)) {   // 商店窗内非格子：商品拖拽=放下，背包物品=卖出
      if (G.cursor) { if (G.cursor.fromShop) G.cursor = null; else sellCursor(getRuntime()); }
      return;
    }
    if (G.shop) { if (e.button === 0) { closeShop(getRuntime()); G.hold = null; return; } }          // 点地板 = 关商店
    // 光标拿着背包物品时，左键点地板 = 丢下
    if (e.button === 0 && G.cursor && !G.cursor.fromShop) {
      const c = worldToCell(w.x, w.y);
      const p = (G.map && walkable(c.row, c.col)) ? c : nearestWalkable(getRuntime(), c.row, c.col);
      if (p) {
        const pos = cellCenter(p.row, p.col);
        dropGround(G, G.cursor, pos.x, pos.y, { owner: G.player, from: "player" });
        G.cursor = null; reindex(G); playSound(G, "drop_item.wav");
      }
      return;
    }
    const onNpc = !!npcAt(w.x, w.y);
    if (e.button === 0) { handleLeft(w.x, w.y); if (!onNpc) { G.hold = 0; G.holdCell = null; G.holdTarget = null; } }
    else if (e.button === 2) { handleRight(w.x, w.y); if (!onNpc) { G.hold = 2; G.holdCell = null; G.holdTarget = null; } }
  });
  window.addEventListener("mouseup", () => { G.hold = null; G.holdCell = null; G.holdTarget = null; });
  cv.addEventListener("contextmenu", e => e.preventDefault());
  cv.addEventListener("mousemove", e => {
    const sp = screenPos(e.clientX, e.clientY);
    G.mouse.sx = sp.x; G.mouse.sy = sp.y; G.mouse.wx = sp.x + G.cam.x; G.mouse.wy = sp.y + G.cam.y;
  });
  // 鼠标离开画布（出屏幕范围）= 丢失锁定。
  // 鼠标离开画布只停悬停提示，**不取消锁定**（锁定只由死亡/离开视野/切图解除）。
  cv.addEventListener("mouseleave", () => { G.mouse.onCanvas = false; });
  cv.addEventListener("mouseenter", () => { G.mouse.onCanvas = true; });
  // 退出游戏 → 回引擎入口页（选版本 / 进编辑器），不是游戏内标题菜单。
  //
  // 旧实现回的是游戏自己的标题菜单（enterMenu），于是玩家点「退出游戏」
  // 后仍在游戏里打转，出不去。入口页是模块级 DOM 浮层，而且游戏已经
  // boot 过（资源/定时器/AI 帧全部在跑），就地重新打开入口页会残留
  // 上一局的状态。最干净的做法是重新加载页面。
  //
  // 关键：必须去掉 URL 上的 ?ver=<id>。wantedVersion() 见到 ?ver= 就会
  // 直接进该版本、跳过入口页 —— 重新加载后会原样再进一次游戏，
  // 玩家会觉得“退出按钮没用”。
  function quitToEngine() {
    const G = getRuntime().state;
    closeAll(G);
    G.cursor = null;
    G.script = null;
    G.player = null; G.currentMap = null; G.map = null;
    G.npcs = []; G.ground = []; G.effects = []; G.fx = []; G.projectiles = [];
    G.lockTarget = null; G.uiFx = null; G.moveMarker = null;
    try {
      const url = new URL(location.href);
      url.searchParams.delete("ver");
      location.replace(url.toString());
    } catch (e) { /* 非浏览器环境（测试）忽略 */ }
    return true;
  }

  // 打开设置面板（Esc 主入口；会收起其它面板，避免层层叠叠）。
  function openSettings() {
    toggleSurface(G, "settings");
  }

  // Esc 的统一语义：**从最上层往下逐层关闭；全部关完时打开设置面板**。
  // 这样 Esc 既能关掉当前窗口，也能在游戏里唤出设置，不再需要单独记 F10。
  function escapeKey() {
    // 从最上层往下逐层关闭：顺序完全由 UI 注册表的 layer 决定，不再手写 if 链。
    // 例外：对话中的 Esc 不关闭对话（交给 advanceDialog 流程）、info 面板底于对话。
    const top = topSurface(G);
    if (top && top !== "dialog" && top !== "tip") {
      if (top === "settings") { closeSurface(G, "settings"); saveSettings(G); return; }
      if (top === "waypoint") { togglePanel(getRuntime(), false); return; }
      if (top === "stash") { toggleStashPanel(getRuntime(), false); return; }
      if (top === "shop") { closeShop(getRuntime()); return; }
      if (top === "pack") { closeSurface(G, "pack"); G.cursor = null; return; }
      closeSurface(G, top);
      return;
    }
    if (G.cursor) { G.cursor = null; return; }
    if (G.dialog) { return; }        // 对话中的 Esc 不处理，交给 advanceDialog 流程
    openSettings();                  // 无任何面板 → 唤出设置
  }

  window.addEventListener("keydown", e => {
    if (G.scene === "editor" || G.scene === "version") return;   // 编辑器/版本界面自己处理键盘
    if (G.scene !== "game") {
      // 设置面板是全局模态：任何场景下 Esc 都能开关它（选单界面同样需要调音量）。
      if (e.key === "Escape") {
        e.preventDefault();
        if (G.settingsPanel) { G.settingsPanel = false; saveSettings(G); return; }
        if (pageIdOf(G.scene) === "title") { G.settingsPanel = true; return; }
        // 片头/关于/结局：Esc 回标题
        enterMenu(getRuntime()); return;
      }
      if (G.settingsPanel) return;              // 面板打开时吞掉其它按键
      if (G.scene === "flash" && (e.key === "Enter" || e.key === " ")) handleSceneClick(0, 0);
      else if (pageIdOf(G.scene) === "title" && (e.key === "Enter" || e.key === " ")) startGame(getRuntime());
      return;
    }
    if (G.dialog) {
      if (G.dialog.kind === "say" && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); advanceDialog(getRuntime()); }
      else if (G.dialog.kind === "ask") { if (e.key === "y" || e.key === "Y") advanceDialog(getRuntime(), 1); else if (e.key === "n" || e.key === "N") advanceDialog(getRuntime(), 0); }
      return;
    }
    if (e.key >= "1" && e.key <= "9") { useItemSlot(G, +e.key - 1); return; }
    // 多边形调试：原绑 P，但下方随从面板也用 P，且这里较早 return 导致随从永远打不开。
    // 改用 Shift+P，P 留给游戏功能。
    if ((e.key === "p" || e.key === "P") && e.shiftKey) { window.__POLY_DEBUG__ = !window.__POLY_DEBUG__; G.tip = "多边形调试：" + (window.__POLY_DEBUG__ ? "开" : "关"); G.tipT = 1.5; e.preventDefault(); return; }
    if (e.key === "F5" || e.key === "F8") { setPanel("menu"); e.preventDefault(); return; }
    // 设置面板：Esc 开关（F10 保留为兼容快捷键）。
    if (e.key === "F10") { openSettings(); e.preventDefault(); return; }
    if (e.key === "Tab") {
      // 首次打开背包时惰性建格子（旧行为）；打开本身走 UI 管理器以参与互斥。
      if (!G.packOpen && !G.pack.length) G.pack = new Array(25).fill(null);
      toggleSurface(G, "pack");
      e.preventDefault(); return;
    }
    if (e.key === "m" || e.key === "M") { togglePanel(getRuntime()); e.preventDefault(); return; }
    if (e.key === "b" || e.key === "B") { toggleStashPanel(getRuntime()); e.preventDefault(); return; }
    if (e.key === "n" || e.key === "N") { toggleSmith(getRuntime()); e.preventDefault(); return; }
    if (e.key === "p" || e.key === "P") { toggleMercPanel(getRuntime()); e.preventDefault(); return; }
    if (e.key === "F2") { toggleSurface(getRuntime().state, "difficulty"); e.preventDefault(); return; }
    if (e.key === "F4") { setPanel("mission"); return; }
    if (e.key === "F1") { setPanel("note"); return; }
    if (e.key === "q" || e.key === "Q") cycleSkill(-1);
    if (e.key === "e" || e.key === "E") cycleSkill(1);
    if (e.key === "r" || e.key === "R") castSelf(getRuntime());
    if (e.key === "Escape") { e.preventDefault(); escapeKey(); return; }
  });
}
