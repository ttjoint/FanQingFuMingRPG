// 引擎核心：货物背包（容器）与商店货源（纯函数，DOM/状态无关，可在 Node 中测试）。
//
// 设计：商店 = 单位身上的一个通用「货物背包」组件（inventory 字段）。
//   拥有非空货物背包的单位即可在条件满足时与玩家交易（见 systems/shop.js 的 openShop）。
//   货源与 NPC 的名称 / 模型完全解耦，纯数据驱动。
//
// inventory 结构：
//   { stock?: [{ name, count }], auto?: "potion" | "weapon" | "armor" | "accessory" }
//   - stock：显式货物（优先），可多堆叠、可含数量
//   - auto ：按物品分类自动补货
//   - 两者皆空 / 无该字段 = 非商人

const AUTO_TYPES = { weapon: [1], armor: [2], accessory: [3] };

// 单位是否拥有可交易的货物背包。
export function hasGoods(unit) {
  const inv = unit && unit.inventory;
  if (!inv || typeof inv !== "object") return false;
  return (Array.isArray(inv.stock) && inv.stock.length > 0) || !!inv.auto;
}

// 计算商店在售物品名列表；非商人 / 无可售物品时返回 null。
// items 为全部物品数据（ctx.assets.items）。
export function goodsList(inv, items) {
  if (!inv || typeof inv !== "object") return null;
  const all = items || [];
  if (Array.isArray(inv.stock) && inv.stock.length) {
    const seen = new Set(), out = [];
    for (const e of inv.stock) {
      if (!e || !e.name || seen.has(e.name)) continue;
      if (!all.some(i => i.name === e.name)) continue;   // 忽略不存在的物品
      seen.add(e.name); out.push(e.name);
    }
    return out.length ? out : null;
  }
  // auto:"potion" 按原版语义只卖药/水（金创药/活气水等）。
  // 仅靠 type/hp/mp 判定会把「猴皮(+10精力)」「豹牙(+20体力)」这类
  // 任务材料也摆上货架 —— 原版商人不收这些。名字含药/水才是原版口径。
  if (inv.auto === "potion") return all.filter(i => i.type === 0 && (i.hp > 0 || i.mp > 0) && i.price > 0 && /药|水/.test(i.name)).map(i => i.name);
  const types = AUTO_TYPES[inv.auto];
  if (types) return all.filter(i => types.includes(i.type) && i.price > 0).map(i => i.name);
  return null;
}
