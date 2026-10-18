// 共享仓库系统（P4）：存取物品 + localStorage 持久化。
//
// 为什么仓库是"账号级"而不是存在 G（角色）上：
//   - 仓库的用途就是跨角色/跨周目沉淀物品；存在存档里就退化成大背包。
//   - 因此单独走一个 localStorage key，读档/新开局都不清。
//
// 仓库数据格式：{ version, slots: [null | { name, count } | { name, count:1, inst }] }
import { normalizeStash, addToStash, canFit, countInStash, takeFromStash, STASH_SIZE } from "../engine/stash.js";

const KEY = "gsxy_stash";
const VERSION = 1;

// localStorage 在隐私模式 / file:// / 无 DOM 下可能抛错，统一包一层。
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
};

// 仓库格子数：可由配置覆盖（config.stash.size），缺省 100。
export function stashSize(ctx) {
  const c = ctx && ctx.config && ctx.config.stash;
  return Math.max(1, Math.floor(Number(c && c.size) || STASH_SIZE));
}

// 从 localStorage 读仓库。损坏/不存在时返回空仓库（不抛）。
export function loadStash(ctx) {
  const raw = store.get(KEY);
  if (!raw) return normalizeStash([], stashSize(ctx));
  try {
    const d = JSON.parse(raw);
    return normalizeStash(d && d.slots, stashSize(ctx));
  } catch (e) {
    return normalizeStash([], stashSize(ctx));
  }
}

// 写回 localStorage。返回是否成功（隐私模式下会失败，但不影响本次游戏）。
export function saveStash(ctx, slots) {
  return store.set(KEY, JSON.stringify({ version: VERSION, slots }));
}

// 取当前仓库（按需从存档载入并缓存在 G.stash 上）。
// 缓存在 G 上是为了让渲染层每帧读到同一份数组，避免每帧 JSON.parse。
export function stashOf(ctx) {
  const G = ctx.state;
  if (!G.stash) G.stash = loadStash(ctx);
  return G.stash;
}

// 把背包某格存入仓库。成功返回 true。
// 整格转移（不拆分）：仓库放不下就整格拒绝，避免"存了一半"的歧义状态。
export function storeFromPack(ctx, packIndex) {
  const G = ctx.state;
  const s = stashOf(ctx);
  const e = G.pack[packIndex];
  if (!e) return false;
  const maxStack = maxStackOf(ctx, e.name);
  if (!canFit(s, e, maxStack)) { G.tip = "仓库已满"; G.tipT = 2; return false; }
  const used = addToStash(s, e, maxStack);
  if (!used.length) { G.tip = "仓库已满"; G.tipT = 2; return false; }
  G.pack[packIndex] = null;
  saveStash(ctx, s);
  G.tip = "已存入仓库"; G.tipT = 1.5;
  return true;
}

// 从仓库某格取出到背包。成功返回 true。
export function takeToPack(ctx, slotIndex) {
  const G = ctx.state;
  const s = stashOf(ctx);
  const free = G.pack.indexOf(null);
  if (free < 0) { G.tip = "背包已满"; G.tipT = 2; return false; }
  const e = takeFromStash(s, slotIndex);
  if (!e) return false;
  G.pack[free] = e;
  saveStash(ctx, s);
  G.tip = "已取出"; G.tipT = 1.5;
  return true;
}

// 物品的堆叠上限（从模板取，缺省 99）。实例物品恒为 1（不叠）。
export function maxStackOf(ctx, name) {
  const items = (ctx.assets && ctx.assets.items) || [];
  const def = items.find(x => x && x.name === name);
  if (!def) return 99;
  return Math.max(1, Math.floor(Number(def.maxStack) || (def.stackable === false ? 1 : 99)));
}

// 打开/关闭仓库面板（与商店、存档、传送点互斥）。
export function toggleStashPanel(ctx, force) {
  const G = ctx.state;
  const want = force == null ? !G.stashPanel : !!force;
  G.stashPanel = want;
  if (want) { G.shop = null; G.savePanel = false; G.waypointPanel = false; G.packOpen = true; }
  return want;
}
