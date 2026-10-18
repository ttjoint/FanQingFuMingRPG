// 物品模板 / 实例（engine/item.js）纯逻辑测试。
import { assert, assertEq, readJSON, ASSETS_DIR } from "./helpers.mjs";
import {
  normalizeItemDef, kindFromType, typeFromKind, defaultStackable, equipSlotOf,
  newInstance, normalizeInstance, newInstanceId, instanceStats, displayName, rarityColor, canStack,
} from "../src/engine/item.js";

export function typeKindRoundTrip() {
  assertEq(kindFromType(0), "consumable");
  assertEq(kindFromType(1), "weapon");
  assertEq(kindFromType(2), "armor");
  assertEq(kindFromType(3), "trinket");
  assertEq(kindFromType(4), "scroll");
  assertEq(kindFromType(7), "pack");
  assertEq(kindFromType(8), "quest");
  for (const t of [0, 1, 2, 3, 4, 7, 8]) assertEq(typeFromKind(kindFromType(t)), t, "kind/type roundtrip " + t);
}

export function stackableDefaults() {
  assert(defaultStackable({ type: 0 }), "消耗品默认可堆叠");
  assert(defaultStackable({ type: 8 }), "剧情物品默认可堆叠");
  assert(!defaultStackable({ type: 1 }), "武器默认不可堆叠");
  assert(!defaultStackable({ type: 2 }), "防具默认不可堆叠");
  assert(!defaultStackable({ type: 3 }), "饰品默认不可堆叠");
}

export function equipSlots() {
  assertEq(equipSlotOf({ kind: "weapon" }), "weapon");
  assertEq(equipSlotOf({ kind: "armor" }), "armor");
  assertEq(equipSlotOf({ kind: "trinket" }), "trinket");
  assertEq(equipSlotOf({ kind: "consumable" }), null);
}

export function instanceIdUnique() {
  const a = newInstanceId(), b = newInstanceId();
  assert(a !== b, "实例 id 应唯一");
  assert(/^it_/.test(a), "实例 id 前缀 it_");
}

export function instanceStatsWithAffixes() {
  const def = normalizeItemDef({ name: "测试剑", type: 1, attack: 10, hp: 5 });
  const inst = normalizeInstance(newInstance(null, { affixes: [{ name: "锋利", mods: { atk: 3 } }] }));
  const st = instanceStats({ name: "测试剑", count: 1, inst }, def);
  assertEq(st.atk, 10 + 3, "攻击 = 基础 + 词缀");
  assertEq(st.hp, 5, "生命不受词缀影响");
}

export function instanceStatsEnhancePerLevel() {
  const def = normalizeItemDef({ name: "测试剑", type: 1, attack: 10 });
  const inst = normalizeInstance(newInstance(null, { enhance: 2 }));
  const st = instanceStats({ name: "测试剑", count: 1, inst }, def, { enhancePerLevel: 2 });
  assertEq(st.atk, 10 + 4, "强化按每级加成累加");
}

export function displayNameWithSuffix() {
  const def = normalizeItemDef({ name: "测试剑", type: 1, attack: 10 });
  const inst = normalizeInstance(newInstance(null, { enhance: 1 }));
  const n = displayName({ name: "测试剑", count: 1, inst }, def);
  assert(n.indexOf("测试剑") === 0, "显示名以模板名开头");
  assert(n.indexOf("+1") >= 0, "显示名含强化后缀");
}

export function canStackRules() {
  const def = normalizeItemDef({ name: "药", type: 0 });
  assert(canStack({ name: "药", count: 1 }, { name: "药", count: 1 }, def), "同名可堆叠");
  assert(!canStack({ name: "药", count: 1, inst: newInstance(null) }, { name: "药", count: 1 }, def), "实例条目不可堆叠");
  assert(!canStack({ name: "药", count: 1 }, { name: "其他", count: 1 }, def), "异名不可堆叠");
}

export function rarityColors() {
  assert(/^#/.test(rarityColor("rare")), "稀有度返回颜色");
  assertEq(rarityColor("nope"), "#d8d0b8", "未知稀有度回落普通色");
}

export function templateDefaults() {
  const d = normalizeItemDef({ name: "剑", type: 1, attack: 12 });
  assertEq(d.mods.atk, 12, "旧字段 attack 收敛到 mods.atk");
  assertEq(d.attack, 12, "旧字段攻击被保留");
  assertEq(d.maxStack, 1, "不可堆叠物品最大堆叠为 1");
  assertEq(d.equipSlot, "weapon", "武器推断装备槽");
  assertEq(d.socketCount, 0, "默认无镶嵌孔");
}

export function itemsJsonNormalizes() {
  const items = readJSON(ASSETS_DIR + "/items.json");
  assert(items.length >= 30, "items.json 条目数正常");
  for (const it of items.slice(0, 8)) {
    const d = normalizeItemDef(it);
    assertEq(d.name, it.name, "归一化保留名称");
    assert(d.kind, "归一化产生 kind");
    assertEq(typeof d.attack, "number", "attack 为数字");
  }
}

// ---- 镶嵌 / 强化 / 耐久 ----
import { canSocket, socketGem, unsocketGem, enhanceCost, canEnhance, enhance, wearDurability, isBroken } from "../src/engine/item.js";

export function socketGemAddsStats() {
  const def = normalizeItemDef({ name: "剑", type: 1, attack: 10, socketCount: 2 });
  const inst = newInstance(def, {});
  const entry = { name: "剑", count: 1, inst };
  const r = socketGem(entry, { name: "红宝石", gem: { mods: { atk: 5 } } });
  assert(r.ok, "镶嵌成功");
  assertEq(r.slot, 0, "占第一个空孔");
  const st = instanceStats(entry, def);
  assertEq(st.atk, 15, "宝石属性计入");
}

export function socketFullRejected() {
  const def = normalizeItemDef({ name: "剑", type: 1, attack: 10, socketCount: 1 });
  const entry = { name: "剑", count: 1, inst: newInstance(def, {}) };
  assert(socketGem(entry, { name: "红宝石" }).ok, "第一颗成功");
  const r = canSocket(entry, { name: "蓝宝石" });
  assert(!r.ok, "孔已满应拒绝");
}

export function noSocketRejected() {
  const r = canSocket({ name: "剑", count: 1, inst: newInstance(null, {}) }, { name: "宝石" });
  assert(!r.ok, "无孔装备不可镶嵌");
}

export function unsocketReturnsGem() {
  const def = normalizeItemDef({ name: "剑", type: 1, attack: 10, socketCount: 1 });
  const entry = { name: "剑", count: 1, inst: newInstance(def, {}) };
  socketGem(entry, { name: "红宝石", gem: { mods: { atk: 5 } } });
  const gem = unsocketGem(entry, 0);
  assertEq(gem.name, "红宝石");
  assertEq(entry.inst.sockets[0], null, "孔已清空");
  assertEq(instanceStats(entry, def).atk, 10, "属性回落");
}

export function unsocketEmptySlot() {
  const def = normalizeItemDef({ name: "剑", type: 1, socketCount: 1 });
  const entry = { name: "剑", count: 1, inst: newInstance(def, {}) };
  assertEq(unsocketGem(entry, 0), null, "空孔取出返回 null");
  assertEq(unsocketGem(entry, 9), null, "越界返回 null");
}

export function enhanceRaisesLevelAndStats() {
  const def = normalizeItemDef({ name: "剑", type: 1, attack: 10 });
  const entry = { name: "剑", count: 1, inst: newInstance(def, {}) };
  const cfg = { maxEnhance: 3, enhancePerLevel: 2 };
  assert(enhance(entry, cfg).ok);
  assertEq(entry.inst.enhance, 1);
  assertEq(instanceStats(entry, def, cfg).atk, 12, "强化 +1 → +2 攻");
}

export function enhanceCapRespected() {
  const def = normalizeItemDef({ name: "剑", type: 1, attack: 10 });
  const entry = { name: "剑", count: 1, inst: newInstance(def, {}) };
  const cfg = { maxEnhance: 2, enhancePerLevel: 2 };
  enhance(entry, cfg); enhance(entry, cfg);
  const r = canEnhance(entry, cfg);
  assert(!r.ok, "达到上限应拒绝");
  assert(!enhance(entry, cfg).ok);
  assertEq(entry.inst.enhance, 2, "等级不超上限");
}

export function enhanceCostGrows() {
  const cfg = { enhancePriceBase: 50, enhancePriceMul: 1.6 };
  const c0 = enhanceCost(null, 0, cfg), c3 = enhanceCost(null, 3, cfg);
  assert(c3 > c0, "强化费用随等级增长");
  assertEq(c0, 50, "+0 费用 = 基础价");
}

export function durabilityWear() {
  const inst = newInstance(null, { durability: 10 });
  const entry = { name: "剑", count: 1, inst };
  assertEq(wearDurability(entry, 3), 7);
  assertEq(wearDurability(entry, 100), 0, "不低于 0");
  assert(isBroken(entry, { maxDurability: 10 }), "耐久为 0 时判定损坏");
}

export function noDurabilityNeverBreaks() {
  const entry = { name: "剑", count: 1, inst: newInstance(null, {}) };
  assertEq(wearDurability(entry, 5), 0, "无耐久返回 0");
  assert(!isBroken(entry, { maxDurability: 0 }), "无耐久概念不算损坏");
}

export function gemKindSupported() {
  assertEq(kindFromType(9), "gem");
  assertEq(typeFromKind("gem"), 9);
  assert(defaultStackable({ type: 9 }), "宝石可堆叠");
  const d = normalizeItemDef({ name: "红宝石", type: 9, gem: { mods: { atk: 5 } } });
  assertEq(d.kind, "gem");
  assertEq(d.gem.mods.atk, 5, "宝石属性保留");
}

export function gemsJsonPresent() {
  const items = readJSON(ASSETS_DIR + "/items.json");
  const gems = items.filter(i => i.type === 9 || i.kind === "gem");
  assert(gems.length >= 4, "应存在至少 4 种宝石，实得 " + gems.length);
  for (const g of gems) assert(g.gem && g.gem.mods, "宝石 " + g.name + " 应有 gem.mods");
}
