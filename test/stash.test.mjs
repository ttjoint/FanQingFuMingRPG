// P4 共享仓库：纯逻辑（engine/stash.js）。
import assert from "node:assert/strict";
import {
  STASH_SIZE, normalizeStash, freeCount, isFull, addToStash,
  takeFromStash, removeFromStash, countInStash, canFit,
} from "../src/engine/stash.js";

const empty = size => new Array(size == null ? 10 : size).fill(null);

export function normalizeFillsToSize() {
  // 补齐：存档里格子数可能小于当前配置
  const s = normalizeStash([{ name: "药", count: 2 }], 5);
  assert.equal(s.length, 5);
  assert.equal(s[0].name, "药");
  assert.equal(s[0].count, 2);
  assert.equal(s[1], null, "空位保留为 null（位置有意义）");
  // 超出部分裁掉
  const big = normalizeStash(new Array(50).fill({ name: "药", count: 1 }), 10);
  assert.equal(big.length, 10);
  // 非法项变空
  const bad = normalizeStash([null, { name: "" }, { count: 5 }, "x", { name: "好", count: 1 }], 5);
  assert.equal(bad[0], null);
  assert.equal(bad[1], null);
  assert.equal(bad[2], null);
  assert.equal(bad[3], null);
  assert.equal(bad[4].name, "好");
  // 缺省尺寸
  assert.equal(normalizeStash([]).length, STASH_SIZE);
}

export function normalizeClampsCounts() {
  const s = normalizeStash([{ name: "药", count: 0 }, { name: "毒", count: -3 }, { name: "草", count: 2.7 }], 3);
  assert.equal(s[0].count, 1, "count 0 应抬到 1，否则等于凭空消失");
  assert.equal(s[1].count, 1);
  assert.equal(s[2].count, 2);
}

export function normalizeForcesInstanceCountTo1() {
  // 实例物品（带词缀）不叠：count 恒为 1
  const s = normalizeStash([{ name: "剑", count: 5, inst: { rarity: "rare" } }], 3);
  assert.equal(s[0].count, 1);
  assert.deepEqual(s[0].inst, { rarity: "rare" });
}

export function freeAndFull() {
  const s = empty(3);
  assert.equal(freeCount(s), 3);
  assert.equal(isFull(s), false);
  s[0] = { name: "药", count: 1 };
  assert.equal(freeCount(s), 2);
  s[1] = { name: "药", count: 1 };
  s[2] = { name: "药", count: 1 };
  assert.equal(isFull(s), true);
}

export function addStacksFirst() {
  const s = empty(3);
  s[0] = { name: "药", count: 2 };
  // maxStack=5：先叠到 s[0] 再占新格
  const used = addToStash(s, { name: "药", count: 4 }, 5);
  assert.deepEqual(used, [0, 1]);
  assert.equal(s[0].count, 5, "先叠满已有的");
  assert.equal(s[1].count, 1, "剩下的进新格");
}

export function addDoesNotMergeInstances() {
  const s = empty(3);
  const used = addToStash(s, { name: "剑", count: 1, inst: { atk: 5 } });
  assert.deepEqual(used, [0]);
  assert.equal(s[0].count, 1);
  // 同名词缀不同：必须占两格，不能叠
  const used2 = addToStash(s, { name: "剑", count: 1, inst: { atk: 9 } });
  assert.deepEqual(used2, [1]);
  assert.notDeepEqual(s[0].inst, s[1].inst);
}

export function addFailsWhenFull() {
  const s = empty(1);
  s[0] = { name: "甲", count: 1 };
  assert.deepEqual(addToStash(s, { name: "乙", count: 1 }), []);
  assert.equal(s[0].name, "甲", "放不下时不能破坏已有物品");
}

export function addIgnoresBlank() {
  const s = empty(2);
  assert.deepEqual(addToStash(s, { name: "" }), []);
  assert.deepEqual(addToStash(s, null), []);
  assert.equal(freeCount(s), 2);
}

export function takeRemovesSlot() {
  const s = empty(2);
  s[0] = { name: "药", count: 3 };
  const got = takeFromStash(s, 0);
  assert.equal(got.name, "药");
  assert.equal(got.count, 3);
  assert.equal(s[0], null);
  // 空格取出来是 null
  assert.equal(takeFromStash(s, 0), null);
  // 越界不崩
  assert.equal(takeFromStash(s, 99), null);
  assert.equal(takeFromStash(s, -1), null);
}

export function removePartialCount() {
  const s = empty(3);
  s[0] = { name: "药", count: 3 };
  s[1] = { name: "药", count: 4 };
  assert.equal(removeFromStash(s, "药", 5), 5);
  assert.equal(s[0], null, "第一格被取空后应清掉");
  assert.equal(s[1].count, 2);
  // 要的比有的多：只移除实际有的
  assert.equal(removeFromStash(s, "药", 99), 2);
  assert.equal(countInStash(s, "药"), 0);
  // 不存在 / 非法
  assert.equal(removeFromStash(s, "不存在", 1), 0);
  assert.equal(removeFromStash(s, "药", 0), 0);
}

export function removeSkipsInstances() {
  // 实例物品不按名移除（玩家必须精确拿走那件）
  const s = empty(2);
  s[0] = { name: "剑", count: 1, inst: { atk: 5 } };
  assert.equal(removeFromStash(s, "剑", 1), 0);
  assert.ok(s[0], "实例物品不该被按名抹掉");
}

export function countIncludesInstances() {
  const s = empty(4);
  s[0] = { name: "药", count: 3 };
  s[1] = { name: "剑", count: 1, inst: {} };
  assert.equal(countInStash(s, "药"), 3);
  assert.equal(countInStash(s, "剑"), 1);
  assert.equal(countInStash(s, "无"), 0);
}

export function canFitAccountsForStacking() {
  const s = empty(1);
  s[0] = { name: "药", count: 2 };
  // 满格，但能叠进 s[0]（maxStack=5，还差 3）
  assert.equal(isFull(s), true);
  assert.equal(canFit(s, { name: "药", count: 3 }, 5), true);
  assert.equal(canFit(s, { name: "药", count: 4 }, 5), false, "超出堆叠上限且没空格 → 放不下");
  // 不同物品没空格 → 放不下
  assert.equal(canFit(s, { name: "乙", count: 1 }, 5), false);
}

export function canFitHandlesMultipleStacks() {
  const s = empty(2);
  // 一格能放 5 个，两格共 10
  assert.equal(canFit(s, { name: "药", count: 10 }, 5), true);
  assert.equal(canFit(s, { name: "药", count: 11 }, 5), false);
}

export function canFitRejectsBlank() {
  const s = empty(2);
  assert.equal(canFit(s, null, 5), false);
  assert.equal(canFit(s, { name: "" }, 5), false);
}
