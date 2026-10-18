// 静态数据表查询（物品 / 技能）。
//
// 迁移历史（P5）：
//   阶段 1（已完成）：签名从 `itemByName(name)` 改为 `itemByName(ctx, name)`。
//   `ctx` 可以是运行时上下文（`{ assets }` 或 `{ content }`）也可是旧的 `g`（游戏状态），
//   都通过 `assetsOf()` 归一。**保留单参调用**作为兼容路径（回退到全局 A），
//   这样 30 个调用点可以分批迁完而不必一次性全改。
//
// 目标形态：所有调用点都传 ctx，届时删掉下面的 fallback 分支与 state.js 依赖即可。
// 未迁移的调用点在 `scripts` 里可以扫出来：`node tools/check-arch.mjs --legacy`。
import { A } from "./state.js";

// 测试用：替换全局资产表（Node 下单测没有 runtime 装配，需要注入口）。
export function setAssets(next) {
  A.items = (next && next.items) || [];
  A.skills = (next && next.skills) || [];
  return A;
}

// 从各种形状的对象里取出资产表。返回 null 表示"无法判定"。
function assetsOf(x) {
  if (!x) return null;
  // 注意：必须是 **items** 而不是 skills —— 游戏状态 g 也有个 skills 数组
  // （玩家已学技能名列表），按 items 判定才区分得开。踩过一次。
  if (Array.isArray(x.items)) return x;                                     // 直接是 assets
  if (x.assets) return x.assets;                                            // runtime ctx
  if (x.content && Array.isArray(x.content.items)) return x.content;
  // 游戏状态 g：它本身没有资产表，但传它进来表示"调用方已经意识到上下文"，
  // 资产仍从运行时取（与全局 A 是同一份数据，行为不变）。
  if (x.stats || x.equip || x.pack || x.hotbar) return A;
  return null;
}

// 解出 (assets, name)：兼容单参与双参两种调用。
function resolve(ctxOrName, maybeName) {
  if (maybeName === undefined && typeof ctxOrName === "string") {
    // 旧签名：itemByName("包裹")
    return { assets: A, name: ctxOrName };
  }
  const a = assetsOf(ctxOrName);
  return { assets: a || A, name: maybeName };
}

export function itemByName(ctx, name) {
  const r = resolve(ctx, name);
  const list = r.assets.items || [];
  return list.find(i => i.name === r.name);
}

export function skillByName(ctx, name) {
  const r = resolve(ctx, name);
  const list = r.assets.skills || [];
  return list.find(s => s.name === r.name);
}
