// UI 表面管理器（systems/surfaces.js）的回归测试。
//
// 这些断言锁的是「界面之间不会叠成一团」这一行为事实：
// 历史上每个模块各自手写"关掉其它几个"，新增面板时必然漏
// （实测 bug：按 B 开仓库后再按 Tab，仓库留在屏幕上被背包盖住）。
import {
  SURFACES, surfaceDef, isOpen, openSurfaces, topSurface, groupMembers,
  openSurface, closeSurface, closeTop, closeAll, toggleSurface,
} from "../src/systems/surfaces.js";

// 与运行时 G 同形状的最小状态（缺的字段按 false/null 处理）。
function freshG() {
  return {
    savePanel: false, settingsPanel: false, diffPanel: false,
    packOpen: false, stashPanel: false, smithPanel: false, mercPanel: false,
    waypointPanel: false, shop: null, panel: null, dialog: null, tip: null, tipT: 0,
  };
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

// ---- 注册表本身 ----
export function testSurfaceTableIsWellFormed() {
  const ids = new Set();
  for (const s of SURFACES) {
    assert(typeof s.id === "string" && s.id, "每个界面都要有 id");
    assert(typeof s.field === "string" && s.field, `${s.id} 要有 field`);
    assert(typeof s.layer === "number", `${s.id} 要有 layer`);
    assert(typeof s.group === "string", `${s.id} 要有 group`);
    assert(!ids.has(s.id), `界面 id 重复：${s.id}`);
    ids.add(s.id);
  }
  // 每个 field 必须落在状态里，否则 isOpen 永远读不到。
  const g = freshG();
  for (const s of SURFACES) assert(s.field in g, `${s.id} 的字段 ${s.field} 不在游戏状态里`);
}

export function testSurfaceDefLookup() {
  assert(surfaceDef("pack") && surfaceDef("pack").field === "packOpen", "pack 应映射到 packOpen");
  assert(surfaceDef("nope") === null, "未知 id 应返回 null（不猜）");
}

// ---- 基本开关 ----
export function testOpenCloseRoundTrip() {
  const g = freshG();
  assert(!isOpen(g, "pack"), "初始不应打开");
  openSurface(g, "pack");
  assert(isOpen(g, "pack"), "打开后应可见");
  closeSurface(g, "pack");
  assert(!isOpen(g, "pack"), "关闭后应不可见");
}

export function testValueSurfaces() {
  const g = freshG();
  // shop / info 的值不是布尔，非 null 即视为打开。
  openSurface(g, "shop", { npc: { name: "商人" }, goods: [] });
  assert(isOpen(g, "shop"), "shop 有对象即为打开");
  openSurface(g, "info", "mission");
  assert(isOpen(g, "info"), "info 有页名即为打开");
  assert(g.panel === "mission", "info 应把值写进 G.panel");
}

export function testTipCloseClearsCountdown() {
  const g = freshG();
  g.tip = "提示"; g.tipT = 2;
  closeSurface(g, "tip");
  // tipT 残留会让别处误判"还有提示在显示"。
  assert(g.tip === null && g.tipT === 0, "关闭提示要连倒计时一起清");
}

// ---- 互斥（核心不变量） ----
// 仓库与背包是同一个操作界面的两个格子区，允许共存；其余同组成员必须互斥。
function sameInterface(a, b) {
  return (a === "stash" && b === "pack") || (a === "pack" && b === "stash");
}

export function testPanelGroupIsMutuallyExclusive() {
  const members = groupMembers("panel");
  assert(members.length >= 5, "panel 组应包含背包/仓库/铁匠/随从/传送/商店");
  for (const a of members) {
    for (const b of members) {
      if (a === b) continue;
      const g = freshG();
      openSurface(g, a);
      openSurface(g, b);
      assert(isOpen(g, b), `打开 ${b} 后它自己应可见`);
      if (sameInterface(a, b)) {
        assert(isOpen(g, a), `${a} 与 ${b} 同属一个界面，应允许共存`);
      } else {
        assert(!isOpen(g, a), `打开 ${b} 应关掉同组的 ${a}（否则会叠在一起）`);
      }
    }
  }
}

export function testScreenGroupIsMutuallyExclusive() {
  const g = freshG();
  openSurface(g, "settings");
  openSurface(g, "menu");
  assert(isOpen(g, "menu") && !isOpen(g, "settings"), "菜单与设置互斥");
  // 难度面板是游戏内面板（panel 组），与场景窗口（screen 组）本就可叠，
  // 但它必须与其它游戏内面板互斥。
  openSurface(g, "difficulty");
  assert(isOpen(g, "difficulty"), "难度面板应打开");
  openSurface(g, "smith");
  assert(isOpen(g, "smith") && !isOpen(g, "difficulty"), "难度面板与铁匠互斥");
}

export function testInfoAndDialogCanCoexist() {
  // 信息面板是底层，对话盖在上面——这是唯一允许跨组共存的一对。
  const g = freshG();
  openSurface(g, "info", "note");
  openSurface(g, "dialog", { kind: "say", text: "hi" });
  assert(isOpen(g, "info"), "对话不应关掉信息面板");
  assert(isOpen(g, "dialog"), "对话应打开");
}

// ---- 历史 bug 的真实复现 ----
export function testStashOpensPackCompanion() {
  // 仓库界面 = 左背包 + 右仓库，两个格子区同屏才可用。
  const g = freshG();
  openSurface(g, "stash");
  assert(isOpen(g, "stash"), "仓库应打开");
  assert(isOpen(g, "pack"), "开仓库应连带打开左侧背包");
}

export function testClosingStashClosesPackCompanion() {
  // 反向：关仓库必须连带关背包，否则留下"背包开着但仓库已关"的半截状态。
  const g = freshG();
  openSurface(g, "stash");
  closeSurface(g, "stash");
  assert(!isOpen(g, "stash") && !isOpen(g, "pack"), "关仓库应连带关背包");
}

export function testStashClosedWhenOpeningOtherPanel() {
  // 实测 bug：按 B 开仓库后再按 Tab / N（铁匠），仓库被留在屏幕上被新面板盖住。
  const g = freshG();
  openSurface(g, "stash");
  openSurface(g, "smith");
  assert(isOpen(g, "smith"), "铁匠应打开");
  assert(!isOpen(g, "stash"), "打开铁匠时仓库必须被关掉，不能留孤儿");
  assert(!isOpen(g, "pack"), "随属的背包也不能留");
}

export function testEveryPanelClosesAllOthers() {
  // 穷举：任意"先开后开"组合，最终只能有一个 panel 组界面活着。
  const members = groupMembers("panel");
  for (const first of members) {
    for (const second of members) {
      const g = freshG();
      openSurface(g, first);
      openSurface(g, second);
      const alive = openSurfaces(g).filter(id => members.includes(id));
      // 合法终态：只剩 second；或 second 是仓库时 = {stash, pack}（同一界面的两个格子区）。
      // 仓库与背包是同一界面的两个格子区，谁后开都合法共存。
      const isStashPair = (second === "stash" || second === "pack")
        && alive.length === 2 && alive.includes("stash") && alive.includes("pack");
      assert((alive.length === 1 && alive[0] === second) || isStashPair,
        `先开 ${first} 再开 ${second} 后，panel 组应只剩 ${second}，实际 ${JSON.stringify(alive)}`);
    }
  }
}

// ---- 分层与关闭顺序 ----
export function testTopSurfaceFollowsLayer() {
  const g = freshG();
  openSurface(g, "pack");                                  // layer 20
  openSurface(g, "dialog", { kind: "say", text: "x" });    // layer 30
  assert(topSurface(g) === "dialog", "对话在面板之上");
  openSurface(g, "tip");                                   // layer 40
  assert(topSurface(g) === "tip", "提示在最上层");
  closeSurface(g, "tip");
  assert(topSurface(g) === "dialog", "关掉提示后应回到对话");
}

export function testCloseTopPopsOneLayerAtATime() {
  const g = freshG();
  openSurface(g, "pack");
  openSurface(g, "dialog", { kind: "say", text: "x" });
  assert(closeTop(g) === "dialog", "第一次关最上层（对话）");
  assert(isOpen(g, "pack"), "下面的背包应还在");
  assert(closeTop(g) === "pack", "第二次关背包");
  assert(closeTop(g) === false, "没有可关的界面时返回 false");
}

export function testCloseAllKeepsRequested() {
  const g = freshG();
  openSurface(g, "pack");
  openSurface(g, "shop", { npc: null, goods: [] });
  openSurface(g, "settings");
  closeAll(g, ["settings"]);
  assert(!isOpen(g, "pack") && !isOpen(g, "shop"), "closeAll 应关掉未保留的界面");
  assert(isOpen(g, "settings"), "closeAll 要保留请求豁免的界面");
  assert(openSurfaces(g).length === 1, "只剩保留的那个");
}

// ---- toggle 语义 ----
export function testToggleFlips() {
  const g = freshG();
  assert(toggleSurface(g, "pack") === true, "第一次切换应打开");
  assert(toggleSurface(g, "pack") === false, "第二次切换应关闭");
}

export function testToggleBeforeOpenGuardCanVeto() {
  // 传送面板：没有任何传送点时不允许打开（业务守卫）。
  const g = freshG();
  const ok = toggleSurface(g, "waypoint", { beforeOpen: () => false });
  assert(ok === false, "守卫返回 false 时应拒绝打开");
  assert(!isOpen(g, "waypoint"), "被拒绝时不应写入状态");
}

export function testToggleAfterOpenRuns() {
  const g = freshG();
  let ran = false;
  toggleSurface(g, "settings", { afterOpen: () => { ran = true; } });
  assert(ran, "打开成功应执行 afterOpen");
}

// ---- 未知 id 不崩 ----
export function testUnknownIdIsInert() {
  const g = freshG();
  assert(openSurface(g, "nope") === false, "未知 id 打开返回 false");
  assert(closeSurface(g, "nope") === false, "未知 id 关闭返回 false");
  assert(toggleSurface(g, "nope") === false, "未知 id 切换返回 false");
  assert(openSurfaces(g).length === 0, "不应产生任何状态");
}
