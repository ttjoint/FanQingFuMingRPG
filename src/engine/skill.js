// 引擎核心：技能 / 攻击方式（attack mode）纯逻辑。无 DOM 依赖，可在 Node 中测试。
//
// 设计目标（阶段 A）：
//  - 把“一次攻击如何发生”从玩家 / NPC 两套代码里抽出来，统一成数据驱动。
//  - 引入 attackMode：melee（近战，瞬间结算）/ ranged（远程，可挂弹道）。
//  - 本阶段 **不改变任何现有行为**：melee/ranged 仍都在命中时刻瞬间结算伤害，
//    ranged 只是为后续阶段的弹道（projectile）预留语义。
//
// 技能数据（assets/skills.json，经 normalizeSkill 规整）字段：
//   { name, type, range, mode, mp, reqLevel, power, sound, icon, frames, desc }
//   type: 0 = 治疗（自身 / 后续可扩展为队友），1 = 攻击
//   mode: "melee" | "ranged"

export const MODE_MELEE = "melee";
export const MODE_RANGED = "ranged";

// 近战 / 远程的分界射程（像素）**仅作为引擎内置默认值**；
// 实际分界由游戏配置 combat.meleeMaxRange 提供（见 content/schema.js 的 normalizeSkill）。
export const MELEE_RANGE = 60;

export const isMelee = sk => (sk ? sk.mode !== MODE_RANGED : true);
export const isRanged = sk => (sk ? sk.mode === MODE_RANGED : false);

// 技能生效射程：至少为 rangeMin（原版“贴脸也能打”的下限）。
export function skillRange(sk, rangeMin) {
  const r = sk && typeof sk.range === "number" ? sk.range : 0;
  return Math.max(rangeMin || 0, r);
}

// 依据距离判断目标是否在射程内。
export function inRange(sk, rangeMin, dist) {
  return dist <= skillRange(sk, rangeMin);
}

// 近战/远程的“命中判定”差异。
//  近战：square=false（普通随机）
//  远程：square=true（原版对远程用平方分布，命中率感更低）
// 目前仅玩家侧区分 usage；预留为统一入口，便于弹道阶段复用。
export function rollAttackHit(mode, randomFn) {
  const rnd = randomFn || Math.random;
  if (mode === MODE_RANGED) {
    const r = Math.floor(rnd() * 100);
    return (r * r) % 100;
  }
  return Math.floor(rnd() * 100);
}

// 伤害公式（与 combat.dealDamage 等价，抽成纯函数便于测试与复用）。
export function damage(atk, power, def) {
  return Math.max(1, (atk | 0) + (power | 0) - Math.floor((def | 0) / 2));
}
