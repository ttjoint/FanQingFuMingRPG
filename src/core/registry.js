// 静态数据表查询（物品 / 技能）。
import { A } from "./state.js";

export function itemByName(n) { return A.items.find(i => i.name === n); }
export function skillByName(n) { return A.skills.find(s => s.name === n); }
