// 共享仓库（stash）纯逻辑：无 DOM / 无全局状态。
//
// 为什么需要：背包 25 格，而掉落系统（P2）现在会持续产出物品。没有沉淀空间，
// 玩家唯一的处置方式是卖掉或丢地上——地面掉落不跨图（loadMap 会清 G.ground），
// 等于扔了就没了。装备循环因此缺一个"攒 → 换 → 卖"的中间环节。
//
// 模型：
//   - 仓库存放**物品实例**（entry = { name, count, inst }），与背包同一套结构。
//   - 仓库本身是固定格数的数组（默认 100），空格为 null。
//   - 仓库是**账号级**的，不在 G 上按角色存——所以它单独走浏览器持久化的
//     一个 key，由 systems/stash.js 负责读写；本文件只管数组操作，不碰存储。

export const STASH_SIZE = 100;

// 规整仓库数组：补齐到 size、裁掉多余、去掉非法项。
// 保留 null 占位（格子位置有意义，玩家会按位置记忆）。
export function normalizeStash(list, size) {
  const n = Math.max(0, Math.floor(Number(size) || STASH_SIZE));
  const src = Array.isArray(list) ? list : [];
  const out = new Array(n).fill(null);
  for (let i = 0; i < n && i < src.length; i++) {
    const e = src[i];
    if (!e || typeof e !== "object") continue;
    const name = String(e.name == null ? "" : e.name).trim();
    if (!name) continue;
    // count 至少 1；实例物品（有 inst）恒为 1 件，不叠。
    const inst = e.inst && typeof e.inst === "object" ? e.inst : null;
    const count = inst ? 1 : Math.max(1, Math.floor(Number(e.count) || 1));
    out[i] = inst ? { name, count: 1, inst } : { name, count };
  }
  return out;
}

// 空格数。
export function freeCount(stash) {
  let n = 0;
  for (const s of stash) if (!s) n++;
  return n;
}

// 是否为满。
export function isFull(stash) {
  return freeCount(stash) === 0;
}

// 放入一件。可堆叠的（同名、无实例、未超上限）优先叠到已有格。
// 返回实际放入后的仓库（就地修改）与被放入的格号列表；放不下时返回空数组。
// maxStack 由调用方从物品模板取（缺省 99）。
export function addToStash(stash, entry, maxStack) {
  if (!entry || !entry.name) return [];
  const cap = Math.max(1, Math.floor(Number(maxStack) || 99));
  const inst = entry.inst && typeof entry.inst === "object" ? entry.inst : null;
  let left = inst ? 1 : Math.max(1, Math.floor(Number(entry.count) || 1));
  const used = [];
  // 实例物品不叠：找空格
  if (inst) {
    const i = stash.indexOf(null);
    if (i < 0) return [];
    stash[i] = { name: entry.name, count: 1, inst };
    return [i];
  }
  // 先叠到已有同类格
  for (let i = 0; i < stash.length && left > 0; i++) {
    const s = stash[i];
    if (!s || s.inst || s.name !== entry.name || s.count >= cap) continue;
    const room = cap - s.count;
    const take = Math.min(room, left);
    s.count += take; left -= take;
    used.push(i);
  }
  // 再占新格
  for (let i = 0; i < stash.length && left > 0; i++) {
    if (stash[i]) continue;
    const take = Math.min(cap, left);
    stash[i] = { name: entry.name, count: take };
    left -= take;
    used.push(i);
  }
  // 放不下的部分直接丢弃（调用方应先 freeCount 检查）；返回实际用的格。
  return used;
}

// 取走某格的全部内容。返回取出的 entry 或 null。
export function takeFromStash(stash, i) {
  if (!stash || i < 0 || i >= stash.length) return null;
  const e = stash[i];
  if (!e) return null;
  stash[i] = null;
  return e;
}

// 从仓库移除指定数量（按格顺序）。返回实际移除的数量。
// 用于"取出部分数量"的场景（如存入堆叠后取一半）。
export function removeFromStash(stash, name, count) {
  let left = Math.max(0, Math.floor(Number(count) || 0));
  let removed = 0;
  for (let i = 0; i < stash.length && left > 0; i++) {
    const s = stash[i];
    if (!s || s.inst || s.name !== name) continue;
    const take = Math.min(s.count, left);
    s.count -= take; left -= take; removed += take;
    if (s.count <= 0) stash[i] = null;
  }
  return removed;
}

// 统计某物品在仓库里的总数量（实例物品按 1 件算）。
export function countInStash(stash, name) {
  let n = 0;
  for (const s of stash) if (s && s.name === name) n += s.inst ? 1 : s.count;
  return n;
}

// 能否完整放入（不产生丢弃）。
// 逐件模拟——不能只比较 freeCount，因为可堆叠物品能叠进已有格。
export function canFit(stash, entry, maxStack) {
  if (!entry || !entry.name) return false;
  const cap = Math.max(1, Math.floor(Number(maxStack) || 99));
  const inst = entry.inst && typeof entry.inst === "object" ? entry.inst : null;
  if (inst) return freeCount(stash) > 0;
  let left = Math.max(1, Math.floor(Number(entry.count) || 1));
  for (const s of stash) {
    if (!s || s.inst || s.name !== entry.name || s.count >= cap) continue;
    left -= Math.min(cap - s.count, left);
    if (left <= 0) return true;
  }
  return left <= freeCount(stash) * cap;
}
