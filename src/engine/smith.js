// 铁匠三件套：赌博 / 鉴定 / 修理。纯逻辑，无 DOM。
//
// 为什么这三件事要一起做：它们是同一个"装备循环"的三个缺口。
//   - 修理：耐久已经会掉（items.durabilityLossOnHit），归零后装备加成被拒，
//     而此前**没有任何办法修回来** —— 等于装备会慢慢自己死掉，只能扔掉重打。
//   - 鉴定：掉落能出词缀实例（P2），但玩家一眼就看见全部词缀，
//     稀有度只体现在"词缀条数"上，没有"冒险感"。
//   - 赌博：金币此前只有买卖两个出口，中期就溢出，没有"用钱搏一把"的玩法。
//
// 三者共用一条铁匠 NPC 交互（systems/shop.js 已按 NPC 开面板，这里只补逻辑）。

// engine 层内部小工具，与 engine/item.js 的 num 同语义（那边未导出）。
// 注意：Number.isFinite(Infinity) === false，所以 num(Infinity) 会退化成默认值（0）。
// 调用方**不要**用 Infinity 表示"余额无限"——那会被当成没钱。
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : (d == null ? 0 : d); }

// ---- 修理 ----
// 修理费用按"缺失耐久占比 × 物品价格 × 系数"算。
// 用占比而非绝对值，让高耐久物品不会因为修一次就破产；
// 价格参与是为了让好装备修起来更贵（保持金币有去处）。
export const REPAIR_RATE = 0.6;

// 单件修理报价。不可修（无耐久 / 未损坏）返回 0。
export function repairCost(entry, def, cfg) {
  const inst = entry && entry.inst;
  if (!inst) return 0;
  const max = num((def && def.maxDurability) || inst.maxDurability, 0);
  if (max <= 0) return 0;
  const cur = Math.max(0, num(inst.durability, max));
  const missing = max - cur;
  if (missing <= 0) return 0;
  const rate = num((cfg && cfg.items && cfg.items.repairRate), REPAIR_RATE);
  const price = Math.max(1, num(def && def.price, 1));
  // 至少 1 金币：缺一点耐久也要收钱，否则可以免费无穷修。
  return Math.max(1, Math.ceil(price * rate * (missing / max)));
}

// 修理单件（就地改 inst）。返回 { ok, cost, reason }。
export function repairEntry(entry, def, cfg, money) {
  const cost = repairCost(entry, def, cfg);
  if (cost <= 0) return { ok: false, cost: 0, reason: "无需修理" };
  if (num(money, 0) < cost) return { ok: false, cost, reason: "金币不足" };
  entry.inst.durability = num((def && def.maxDurability) || entry.inst.maxDurability, 0);
  return { ok: true, cost, reason: "" };
}

// 批量修理报价（给"全部修理"按钮用）。
// list 元素形如 { entry, def }。
export function repairAllCost(list, cfg) {
  let total = 0;
  for (const it of list || []) total += repairCost(it.entry, it.def, cfg);
  return total;
}

// ---- 鉴定 ----
// 未鉴定物品：inst.unid === true。鉴定前词缀数值对玩家隐藏（由 tooltip 层负责显示）。
export function isUnidentified(entry) {
  return !!(entry && entry.inst && entry.inst.unid);
}

// 鉴定费随稀有度升高（毕竟是"看好东西"的服务）。
const IDENT_RARITY_MUL = { common: 1, magic: 1.5, rare: 2.5, unique: 4, quest: 0 };
export const IDENT_BASE = 20;

export function identifyCost(entry, cfg) {
  if (!isUnidentified(entry)) return 0;
  const base = num((cfg && cfg.items && cfg.items.identifyBase), IDENT_BASE);
  const mul = IDENT_RARITY_MUL[(entry.inst && entry.inst.rarity) || "common"];
  if (mul === 0) return 0;                 // 任务物品不收费（也不该未鉴定）
  return Math.max(1, Math.ceil(base * (mul == null ? 1 : mul)));
}

// 鉴定。返回 { ok, cost, reason }。
export function identifyEntry(entry, cfg, money) {
  if (!isUnidentified(entry)) return { ok: false, cost: 0, reason: "无需鉴定" };
  const cost = identifyCost(entry, cfg);
  if (cost > 0 && num(money, 0) < cost) return { ok: false, cost, reason: "金币不足" };
  delete entry.inst.unid;
  return { ok: true, cost: cost > 0 ? cost : 0, reason: "" };
}

// ---- 赌博 ----
// 产出"未知"物品：类型随机、稀有度按经济旋钮 roll、一定未鉴定。
// 与掉落的区别：掉落有确定来源（打谁掉什么），赌博是纯概率投入。
export const GAMBLE_BASE_PRICE = 120;

// 赌博价：随物品等级/角色等级上升，避免前期就能刷出终局装备。
export function gamblePrice(level, cfg) {
  const base = num((cfg && cfg.economy && cfg.economy.gambleBase), GAMBLE_BASE_PRICE);
  const step = num((cfg && cfg.economy && cfg.economy.gambleLevelStep), 8);
  const lv = Math.max(1, Math.floor(num(level, 1)));
  return Math.max(1, Math.ceil(base + step * (lv - 1)));
}

// 从候选模板里挑一个可作为赌博产物的（有价格的、非任务/非宝石的消耗品）。
// 纯函数：调用方给 rng。
export function gamblePool(items) {
  return (items || []).filter(it => {
    if (!it || !it.name) return false;
    if (num(it.price, 0) <= 0) return false;
    const t = num(it.type, 0);
    // type: 0=消耗 1=武器 2=防具 3=饰品 4=卷轴 7=包 8=任务 9=宝石
    return t === 1 || t === 2 || t === 3;
  });
}
