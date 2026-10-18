// P4 铁匠三件套：修理 / 鉴定 / 赌博。纯逻辑。
import assert from "node:assert/strict";
import {
  repairCost, repairEntry, repairAllCost, isUnidentified, identifyCost,
  identifyEntry, gamblePrice, gamblePool, REPAIR_RATE, IDENT_BASE, GAMBLE_BASE_PRICE,
} from "../src/engine/smith.js";

const CFG = { items: { durabilityLossOnHit: 0.5 }, economy: {} };
// 定义：价格 100，满耐久 100
const DEF = { name: "剑", price: 100, maxDurability: 100 };

export function repairCostProportional() {
  // 缺 50/100 耐久 → 100 * 0.6 * 0.5 = 30
  const e = { name: "剑", count: 1, inst: { durability: 50 } };
  assert.equal(repairCost(e, DEF, CFG), 30);
  // 满耐久不收费
  const full = { name: "剑", count: 1, inst: { durability: 100 } };
  assert.equal(repairCost(full, DEF, CFG), 0);
  // 全损：100 * 0.6 * 1 = 60
  const dead = { name: "剑", count: 1, inst: { durability: 0 } };
  assert.equal(repairCost(dead, DEF, CFG), 60);
}

export function repairCostCheapItemStillCostsOne() {
  // 便宜物品缺一点耐久：不能算出 0，否则可以免费无限修
  const cheap = { name: "匕首", price: 1, maxDurability: 100 };
  const e = { name: "匕首", count: 1, inst: { durability: 99 } };
  assert.equal(repairCost(e, cheap, CFG), 1);
}

export function repairCostIgnoresNoDurabilityItems() {
  // 没有耐久概念的物品（inst 无 durability 且 def 无 maxDurability）
  const e = { name: "戒指", count: 1, inst: {} };
  assert.equal(repairCost(e, { name: "戒指", price: 100 }, CFG), 0);
  // 非实例物品（普通消耗品）
  assert.equal(repairCost({ name: "药", count: 3 }, { price: 10 }, CFG), 0);
  assert.equal(repairCost(null, DEF, CFG), 0);
}

export function repairCostUsesConfigRate() {
  const cfg = { items: { repairRate: 1 } };   // 全额
  const e = { name: "剑", count: 1, inst: { durability: 50 } };
  assert.equal(repairCost(e, DEF, cfg), 50);
  assert.notEqual(REPAIR_RATE, 1, "默认系数不应是 1（免费修理会让金币失去意义）");
}

export function repairEntryGates() {
  const e = { name: "剑", count: 1, inst: { durability: 50 } };
  // 钱不够
  const poor = repairEntry(e, DEF, CFG, 10);
  assert.equal(poor.ok, false);
  assert.equal(poor.reason, "金币不足");
  assert.equal(e.inst.durability, 50, "失败时不能改耐久");
  // 钱够
  const ok = repairEntry(e, DEF, CFG, 100);
  assert.equal(ok.ok, true);
  assert.equal(ok.cost, 30);
  assert.equal(e.inst.durability, 100, "修满了");
  // 再修：无需修理
  assert.equal(repairEntry(e, DEF, CFG, 100).reason, "无需修理");
}

export function repairAllSums() {
  const list = [
    { entry: { inst: { durability: 50 } }, def: DEF },     // 30
    { entry: { inst: { durability: 0 } }, def: DEF },      // 60
    { entry: { inst: { durability: 100 } }, def: DEF },    // 0
  ];
  assert.equal(repairAllCost(list, CFG), 90);
  assert.equal(repairAllCost([], CFG), 0);
  assert.equal(repairAllCost(null, CFG), 0);
}

export function identifyBasics() {
  const e = { name: "剑", count: 1, inst: { rarity: "magic", unid: true } };
  assert.equal(isUnidentified(e), true);
  assert.equal(identifyCost(e, CFG), Math.ceil(IDENT_BASE * 1.5));
  const r = identifyEntry(e, CFG, 1000);
  assert.equal(r.ok, true);
  assert.equal(isUnidentified(e), false, "鉴定后标记被清掉");
  assert.equal(identifyEntry(e, CFG, 1000).reason, "无需鉴定");
  // 非实例物品不算未鉴定
  assert.equal(isUnidentified({ name: "药", count: 1 }), false);
  assert.equal(isUnidentified(null), false);
}

export function identifyGatesOnMoney() {
  const e = { name: "剑", count: 1, inst: { rarity: "unique", unid: true } };
  const cost = identifyCost(e, CFG);
  assert.equal(cost, IDENT_BASE * 4);
  const poor = identifyEntry(e, CFG, cost - 1);
  assert.equal(poor.ok, false);
  assert.equal(poor.reason, "金币不足");
  assert.equal(isUnidentified(e), true, "钱不够不能白鉴定");
}

export function identifyRarityScales() {
  const mk = r => ({ inst: { rarity: r, unid: true } });
  const c = r => identifyCost(mk(r), CFG);
  assert.ok(c("common") < c("magic"), "越稀有越贵");
  assert.ok(c("magic") < c("rare"));
  assert.ok(c("rare") < c("unique"));
  assert.equal(c("quest"), 0, "任务物品不该收费");
}

export function gamblePriceGrowsWithLevel() {
  const p1 = gamblePrice(1, CFG);
  assert.equal(p1, GAMBLE_BASE_PRICE);
  assert.ok(gamblePrice(20, CFG) > p1, "等级越高越贵");
  // 至少 1
  assert.ok(gamblePrice(0, CFG) >= 1);
  assert.ok(gamblePrice(-5, CFG) >= 1);
}

export function gamblePoolFilters() {
  const items = [
    { name: "剑", type: 1, price: 100 },
    { name: "甲", type: 2, price: 80 },
    { name: "戒", type: 3, price: 50 },
    { name: "药", type: 0, price: 10 },        // 消耗品：不进池
    { name: "卷", type: 4, price: 10 },       // 卷轴：不进池
    { name: "包", type: 7, price: 10 },       // 背包：不进池
    { name: "任务", type: 8, price: 10 },     // 任务品：不进池
    { name: "宝", type: 9, price: 10 },       // 宝石：不进池
    { name: "赠品", type: 1, price: 0 },      // 无价：不进池
    null,
    { type: 1, price: 10 },                   // 无名：不进池
  ];
  const pool = gamblePool(items);
  assert.deepEqual(pool.map(x => x.name), ["剑", "甲", "戒"]);
  assert.deepEqual(gamblePool(null), []);
}

export function moneyInfinityMeansNoMoney() {
  // num(Infinity) 会退化成 0（Number.isFinite(Infinity) === false）。
  // 这曾经导致 repairAll 传 Infinity 时"钱扣了但一件都没修"，
  // 所以把语义钉住：Infinity 当 0 处理，调用方必须传真实余额。
  const e = { name: "剑", count: 1, inst: { durability: 50 } };
  const r = repairEntry(e, DEF, CFG, Infinity);
  assert.equal(r.ok, false, "Infinity 不能被当作余额无限");
  assert.equal(r.reason, "金币不足");
  assert.equal(e.inst.durability, 50);
}
