// 难度分级：纯逻辑，无 DOM。
//
// 为什么需要：现在所有敌人数值都是写死的。想"再来一遍更硬"只能改 NPC 表，
// 而改 NPC 表会同时影响所有玩家和所有存档。难度应该是**玩家侧的一个乘数**，
// 与内容数据正交。
//
// 设计取向：
//   - 只放大怪物侧（血量/伤害/经验/掉落），不削弱玩家。
//     削弱玩家会让同一套装备在不同难度下手感割裂，而且"我变弱了"的负反馈
//     比"敌人变强了"更让人困惑。
//   - 线性而非指数：暗黑类游戏的难度差主要来自"容错变低"，
//     指数曲线会在中段直接变成"一击必杀"，失去可玩性。
//   - 掉落加成**小于**强度加成：高难度的回报是"能打到更好的东西"，
//     不是"同样时间收获翻倍"，否则最优解永远是无脑开最高难度。

// 内置三档。id 稳定，存档里记 id（不记下标，否则改顺序会串档）。
export const DIFFICULTIES = [
  { id: "normal", name: "普通", hp: 1, damage: 1, exp: 1, drop: 1, desc: "标准体验" },
  { id: "nightmare", name: "噩梦", hp: 2.2, damage: 1.6, exp: 1.5, drop: 1.25, desc: "敌人更硬、更疼；掉落略好" },
  { id: "hell", name: "地狱", hp: 4, damage: 2.4, exp: 2.2, drop: 1.5, desc: "高容错要求；掉落明显提升" },
];

// 归一化单个难度项。缺省值为 1（中性），id 必须有。
export function normalizeDifficulty(d) {
  const o = d || {};
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 1; };
  return {
    id: String(o.id || "").trim() || "normal",
    name: String(o.name || o.id || "普通"),
    hp: num(o.hp),
    damage: num(o.damage),
    exp: num(o.exp),
    drop: num(o.drop),
    desc: o.desc != null ? String(o.desc) : "",
  };
}

// 归一化难度表。空表退回内置三档；按 id 去重（重复 id 会让存档指向歧义）。
export function normalizeDifficulties(list) {
  const src = Array.isArray(list) && list.length ? list : DIFFICULTIES;
  const seen = new Set();
  const out = [];
  for (const d of src) {
    const n = normalizeDifficulty(d);
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out.length ? out : DIFFICULTIES.map(normalizeDifficulty);
}

// 按 id 取难度。找不到时退回第一档（而不是报错——存档可能来自旧版本，
// 那里删掉的难度不该让游戏直接进不去）。
export function difficultyById(list, id) {
  const arr = normalizeDifficulties(list);
  return arr.find(d => d.id === id) || arr[0];
}

// 应用到一个基数上。用于血量/伤害/经验这类"乘一下就完事"的字段。
export function scaleBy(amount, mul) {
  const a = Number(amount);
  if (!Number.isFinite(a)) return 0;
  // mul 为 null/undefined/NaN 时按 1（"没有倍率"），但 **0 是合法值**（例如无掉落）。
  // 注意 Number(null) === 0，所以这里必须显式排除 null，不能直接 Number.isFinite。
  const ok = mul != null && mul !== "" && Number.isFinite(Number(mul)) && Number(mul) >= 0;
  const mm = ok ? Number(mul) : 1;
  return Math.round(a * mm);
}

// 怪物强度倍率（供 systems 层一次性取用）。
export function monsterMults(diff) {
  const d = normalizeDifficulty(diff);
  return { hp: d.hp, damage: d.damage, exp: d.exp, drop: d.drop };
}

// 当前难度在列表里的下标（UI 上下切换用）。
export function difficultyIndex(list, id) {
  const arr = normalizeDifficulties(list);
  const i = arr.findIndex(d => d.id === id);
  return i < 0 ? 0 : i;
}

// 循环切换（上/下）。返回新难度的 id。
export function cycleDifficulty(list, id, step) {
  const arr = normalizeDifficulties(list);
  const i = difficultyIndex(arr, id);
  const n = arr.length;
  const next = ((i + (step || 1)) % n + n) % n;
  return arr[next].id;
}
