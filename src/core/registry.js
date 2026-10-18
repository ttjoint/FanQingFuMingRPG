// 静态数据表查询（物品 / 技能）。
//
// ⚠ 已知技术债：这里直接依赖 `A` 全局单例，而 `A` 由 runtime/context.js 持有。
// 后果：任何调用 `itemByName/skillByName` 的模块（包括 systems/）实际上都被
// 隐式绑定到全局状态 —— 这与“逻辑层只收 ctx/g”的目标不一致，也让单测更麻烦。
// 目标形态：签名改为 `itemByName(ctx, name)`（或调用方直接 `ctx.assets.items`），
// 与 systems/ 其他函数一致。共 31 处调用点（input/render/systems），需分批迁移；
// 未迁移前请勿新增对 `A` 的直接依赖。
import { A } from "./state.js";

export function itemByName(n) { return A.items.find(i => i.name === n); }
export function skillByName(n) { return A.skills.find(s => s.name === n); }
