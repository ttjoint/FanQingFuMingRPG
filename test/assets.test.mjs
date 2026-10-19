
// ---------------------------------------------------------------------------
// 回归：线上「除主角外所有 NPC 图片都不显示」
//
// 根因（三条叠加，全部在 core/assets.js）：
//   1) getImg 的 onload/onerror 从不清 PENDING，而 onerror 又写 IMG[path]=null，
//      于是任何一次失败都会让该路径**永久**返回 null（`if (PENDING[path]) return null`
//      永远拦住），没有重试机会。
//   2) preload() 用 PENDING 做「已排队」标记。预载排进去的路径因此被 getImg
//      当成「正在加载」直接返回 null —— 排队中的图在轮到自己之前完全不可用。
//   3) 开场 preloadChar("role") 一次排进 360 个帧文件，并发只有 3。真实网络
//      （GitHub Pages/CDN）要跑十几到几十秒；实测在线 **26 秒**内所有 NPC 隐形，
//      而本地 127.0.0.1 因为快，完全看不出来。
//
// 这里用假的 Image 做行为级断言（不打真实网络）。
// ---------------------------------------------------------------------------
function fakeImageClass() {
  const insts = [];
  class FakeImage {
    constructor() { this.onload = null; this.onerror = null; this._src = null; this.naturalWidth = 16; this.naturalHeight = 16; insts.push(this); FakeImage.all.push(this); }
    set src(v) { this._src = v; FakeImage.pending.push(this); }
    get src() { return this._src; }
    complete() { return this.onload && this.onload(); }
    finish() { if (this.onload) this.onload(); }
    fail() { if (this.onerror) this.onerror(); }
  }
  FakeImage.pending = [];
  FakeImage.all = [];   // 按创建顺序记录所有实例
  return { FakeImage, insts };
}

export async function assetsGetImgRetriesAfterError() {
  const { getImg, __resetAssetsForTest } = await import("../src/core/assets.js");
  const { FakeImage } = fakeImageClass();
  const saved = globalThis.Image;
  globalThis.Image = FakeImage;
  try {
    __resetAssetsForTest && __resetAssetsForTest();
    const p = "assets/role/__t_retry.png";
    // 第一次：返回 null 并创建 Image；让它失败
    if (getImg(p) !== null) throw new Error("getImg 首次应返回 null");
    FakeImage.pending.at(-1).fail();
    // 失败后必须能重试（不能永久 null）：第二次应再次创建 Image
    const before = FakeImage.pending.length;
    getImg(p);
    if (FakeImage.pending.length === before) throw new Error("失败后应允许重试（重新发起加载）");
    FakeImage.pending.at(-1).finish();
    // 成功后应返回图片对象
    const im = getImg(p);
    if (!im) throw new Error("重试成功后 getImg 应返回图片");
    return;
  } finally { globalThis.Image = saved; }
}

export async function assetsPreloadDoesNotBlockGetImg() {
  const { getImg, preload, __resetAssetsForTest } = await import("../src/core/assets.js");
  const { FakeImage } = fakeImageClass();
  const saved = globalThis.Image;
  globalThis.Image = FakeImage;
  try {
    __resetAssetsForTest && __resetAssetsForTest();
    const p = "assets/role/__t_prio.png";
    // 排进预载队列（并发被占满，不会立刻发出）
    for (let i = 0; i < 8; i++) preload("assets/role/__t_filler" + i + ".png");
    preload(p);
    const before = FakeImage.pending.length;
    // 渲染那边要立刻拿到这张图：必须能自己发起请求，不能被预载队列的预约挡住
    getImg(p);
    if (FakeImage.pending.length === before) throw new Error("getImg 应能越过预载队列自行发起请求");
    const last = FakeImage.pending.at(-1);
    if (!/__t_prio/.test(last.src)) throw new Error("getImg 发起的应是它自己那张图");
    last.finish();
    if (!getImg(p)) throw new Error("预载与即时加载共存后 getImg 应拿到图片");
    return;
  } finally { globalThis.Image = saved; }
}

export async function assetsPreloadCharStandFirst() {
  const mod = await import("../src/core/assets.js");
  const { preloadChar, __resetAssetsForTest } = mod;
  const stateMod = await import("../src/core/state.js");
  const A = stateMod.A;
  const saved = globalThis.Image;
  const savedChars = A && A.chars;
  const { FakeImage } = fakeImageClass();
  globalThis.Image = FakeImage;
  try {
    __resetAssetsForTest && __resetAssetsForTest();
    FakeImage.all.length = 0;
    // 单测环境没跑 boot，A.chars 是空的：这里只补一个最小的 role 模型定义。
    // 不伪造任何“加载成功”的结果，测的是「发起顺序」这一个纯逻辑。
    A.chars = {
      role: {
        walk: [["npc001_walk2_0.bmp", "npc001_walk2_1.bmp"]],
        stand: [["npc001_st2_000.bmp", "npc001_st2_020.bmp"]],
      },
    };
    preloadChar("role");
    // 预载队列是异步泵：把已发出的逐个完成，直到队列排空。
    for (let guard = 0; guard < 100; guard++) {
      const p = FakeImage.pending.shift();
      if (p) { p.finish(); continue; }
      if (!FakeImage.all.length || !mod.__pendingQueueForTest().length) break;
    }
    const srcs = FakeImage.all.map(i => i.src || "");
    if (srcs.length !== 4) throw new Error("应发起 4 张帧的预载，实际 " + srcs.length);
    const standAt = srcs.findIndex(x => /npc001_st2_/.test(x));
    const walkAt = srcs.findIndex(x => /npc001_walk/.test(x));
    if (standAt < 0) throw new Error("role 的 stand 帧应被预载");
    if (walkAt >= 0 && walkAt < standAt)
      throw new Error("stand 帧应排在其他动作之前（否则开局单位会隐形几十秒）");
    return;
  } finally {
    if (savedChars !== undefined && A) A.chars = savedChars;
    globalThis.Image = saved;
  }
}

// ---------------------------------------------------------------------------
// 回归：素材应在后台「陆续」加载，而不是用的时候才现拉
//
// 实机反馈：走动时动作帧一张张卡出来、进新地图敌人立绘半天不显。
// 根因是启动只预载了主角的站立帧，其余素材全靠 getImg 临用现拉。
// 现在应把全部角色帧分层排进后台队列，并且低优先级的排在后面。
// ---------------------------------------------------------------------------
export async function assetsPreloadAllCharsCoversEveryModel() {
  const mod = await import("../src/core/assets.js");
  const { preloadAllChars, __resetAssetsForTest, __pendingQueueForTest } = mod;
  const stateMod = await import("../src/core/state.js");
  const A = stateMod.A;
  const saved = globalThis.Image;
  const savedChars = A && A.chars;
  const { FakeImage } = fakeImageClass();
  globalThis.Image = FakeImage;
  try {
    __resetAssetsForTest && __resetAssetsForTest();
    A.chars = {
      role: { stand: [["r_st_0.bmp"]], walk: [["r_walk_0.bmp"]] },
      npcA: { stand: [["a_st_0.bmp"]] },
      npcB: { stand: [["b_st_0.bmp"]], fight: [["b_fight_0.bmp"]] },
    };
    preloadAllChars();
    // pump 会同步把队首几张变成 Image，所以“全部被登记过”要同时看队列和已发出的请求。
    const names = [...FakeImage.all.map(i => i.src || ""), ...__pendingQueueForTest()]
      .filter(x => /\/role\//.test(x)).map(x => decodeURIComponent(x.split("/role/")[1]));
    for (const need of ["r_st_0.png", "r_walk_0.png", "a_st_0.png", "b_st_0.png", "b_fight_0.png"]) {
      if (!names.includes(need)) throw new Error("后台预载应覆盖 " + need + "，实际队列：" + names.join(","));
    }
    return;
  } finally {
    if (savedChars !== undefined && A) A.chars = savedChars;
    globalThis.Image = saved;
  }
}

export async function assetsPreloadPriorityOrder() {
  const mod = await import("../src/core/assets.js");
  const { preload, preloadChar, __resetAssetsForTest, __pendingQueueForTest } = mod;
  const stateMod = await import("../src/core/state.js");
  const A = stateMod.A;
  const saved = globalThis.Image;
  const savedChars = A && A.chars;
  const { FakeImage } = fakeImageClass();
  globalThis.Image = FakeImage;
  try {
    __resetAssetsForTest && __resetAssetsForTest();
    A.chars = { far: { stand: [["far_st_0.bmp"]], walk: [["far_walk_0.bmp"]] } };
    // 先把后台并发占满（占位的两张不会被撤回，这是有意为之：
    // 已经发出去的请求没必要 abort）。之后排进来的都只能待在队列里，
    // 这才是在比「调度顺序」。
    preload("assets/role/__busy1.png", 1);
    preload("assets/role/__busy2.png", 1);
    const inflight = FakeImage.all.length;
    if (inflight < 2) throw new Error("后台并发应已被占满，实际在途 " + inflight);
    // 低优先级先排，高优先级后排：队列里高优先级必须在前。
    preloadChar("far", { level: 3 });
    preload("assets/role/near_0.png", 1);
    const names = __pendingQueueForTest().map(x => x.split("/role/")[1]);
    const nearAt = names.indexOf("near_0.png");
    const farStAt = names.indexOf("far_st_0.png");
    const farWalkAt = names.indexOf("far_walk_0.png");
    if (nearAt < 0 || farStAt < 0) throw new Error("队列内容不符：" + names.join(","));
    if (nearAt > farStAt) throw new Error("高优先级素材应排在低优先级之前（实际 " + names.join(",") + "）");
    if (farWalkAt >= 0 && farWalkAt < farStAt) throw new Error("同一模型内 stand 帧应排在动作帧之前（实际 " + names.join(",") + "）");
    return;
  } finally {
    if (savedChars !== undefined && A) A.chars = savedChars;
    globalThis.Image = saved;
  }
}
