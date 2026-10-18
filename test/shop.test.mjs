import { goodsList, hasGoods } from "../src/engine/inventory.js";
import { assert } from "./helpers.mjs";

// 货物背包（inventory 组件）驱动的商店：与 NPC 名称/模型完全解耦。

const ITEMS = [
  { name: "金创药", type: 0, price: 50, hp: 100, mp: 0 },
  { name: "活气水", type: 0, price: 60, hp: 0, mp: 100 },
  { name: "猴皮", type: 0, price: 60, hp: 0, mp: 0 },          // 材料（无 hp/mp）不应上药铺
  { name: "乌木剑", type: 1, price: 100 },
  { name: "铁布衫", type: 2, price: 100 },
  { name: "武者之戒", type: 3, price: 150 },
  { name: "拜师函", type: 8, price: 0 },
];

const shopOf = inv => goodsList(inv, ITEMS);

export function noInventoryNotMerchant() {
  assert(!hasGoods({ name: "路人" }), "无 inventory 字段 = 非商人");
  assert(shopOf(null) === null, "无背包返回 null");
  assert(shopOf({ stock: [], auto: "" }) === null, "空背包返回 null");
}

export function nameAndModelIrrelevant() {
  // 关键：不再依赖 NPC 名称 / 模型（旧实现按 “冰糖葫芦贩”/卖药人.pmg 猜）
  const inv = { stock: [{ name: "乌木剑", count: 1 }] };
  const a = goodsList(inv, ITEMS);
  const b = goodsList(inv, ITEMS);
  assert(JSON.stringify(a) === JSON.stringify(b), "货源只由 inventory 决定，与名称/模型无关");
  assert(a.length === 1 && a[0] === "乌木剑", "显式货物应原样列出");
}

export function explicitStockDedupAndSkipMissing() {
  const g = shopOf({ stock: [
    { name: "乌木剑", count: 2 }, { name: "乌木剑", count: 3 },
    { name: "不存在的物品", count: 1 },
  ] });
  assert(JSON.stringify(g) === JSON.stringify(["乌木剑"]), "重复货物去重、无效货物忽略，得到 " + JSON.stringify(g));
}

export function autoPotionExcludesMaterials() {
  const g = shopOf({ auto: "potion" });
  assert(g.includes("金创药") && g.includes("活气水"), "药铺应含药/水");
  assert(!g.includes("猴皮"), "药铺不应含无 hp/mp 的材料");
}

export function autoWeaponArmorAccessory() {
  assert(JSON.stringify(shopOf({ auto: "weapon" })) === JSON.stringify(["乌木剑"]), "武器铺");
  assert(JSON.stringify(shopOf({ auto: "armor" })) === JSON.stringify(["铁布衫"]), "防具铺");
  assert(JSON.stringify(shopOf({ auto: "accessory" })) === JSON.stringify(["武者之戒"]), "饰品铺");
}

export function explicitStockBeatsAuto() {
  // 同时配置时，显式 stock 优先
  const g = shopOf({ stock: [{ name: "拜师函", count: 1 }], auto: "weapon" });
  assert(JSON.stringify(g) === JSON.stringify(["拜师函"]), "显式货物优先于自动分类，得到 " + JSON.stringify(g));
}

// ---- 货物背包数据规范化（schema.normalizeInventory）----
import { normalizeInventory } from "../src/content/schema.js";

export function normalizeInventoryRules() {
  assert(normalizeInventory(null) === null, "null → null");
  assert(normalizeInventory({}) === null, "空对象 → null（非商人）");
  assert(normalizeInventory({ stock: [] }) === null, "空 stock 且无 auto → null");
  const a = normalizeInventory({ auto: "potion" });
  assert(a && a.auto === "potion", "仅 auto 保留");
  const b = normalizeInventory({ stock: [{ name: "金创药", count: 3 }, { name: "" }] });
  assert(b && b.stock.length === 1 && b.stock[0].count === 3, "过滤无名货物并保留数量");
  const c = normalizeInventory({ stock: [{ name: "乌木剑" }] });
  assert(c.stock[0].count === 1, "缺省数量补 1");
}
