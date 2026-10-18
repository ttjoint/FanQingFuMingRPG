import { buildFactionTable, defaultFaction, factionsHostile, isHostile, canAttack, nearestHostile, hasAnyHostile } from "../src/engine/faction.js";
import { normalizeFactions } from "../src/content/schema.js";
import { assert, assertEq } from "./helpers.mjs";

// 阵营纯逻辑：关系表内置、双向敌对判定、实例阵营可变、无 faction 的兼容派生。
// 重点：默认（未指定 faction）时必须复现原版行为——有攻击力者只与玩家敌对。

const TABLE = buildFactionTable([
  { id: "player", name: "玩家", hostileTo: [] },
  { id: "enemy", name: "敌对", hostileTo: ["player"] },
  { id: "ming", name: "明军", hostileTo: ["qing"] },
  { id: "qing", name: "清军", hostileTo: ["ming"] },
  { id: "bandit", name: "强盗", hostileTo: ["player", "ming", "qing"] },
  { id: "beast", name: "野兽", hostileTo: ["player", "ming", "qing", "bandit"] },
  { id: "neutral", name: "中立", hostileTo: [] },
]);

const player = { x: 0, y: 0, isPlayer: true, faction: "player", attackable: true };   // 玩家的攻击力在 G.stats 里，实体上标 attackable
const qing = { x: 10, y: 0, faction: "qing", atk: 20 };
const ming = { x: 20, y: 0, faction: "ming", atk: 20 };
const bandit = { x: 30, y: 0, faction: "bandit", atk: 20 };
const villager = { x: 40, y: 0, faction: "neutral" };

export function symmetryHostility() {
  assertEq(factionsHostile("qing", "ming", TABLE), true, "清↔明 敌对");
  assertEq(factionsHostile("ming", "qing", TABLE), true, "明↔清 敌对（对称）");
  assertEq(factionsHostile("qing", "qing", TABLE), false, "同阵营不敌对");
  assertEq(factionsHostile("player", "ming", TABLE), false, "玩家与明军不敌对（表未声明）");
}

export function banditHostileToAll() {
  assertEq(factionsHostile("bandit", "player", TABLE), true, "强盗敌视玩家");
  assertEq(factionsHostile("bandit", "ming", TABLE), true, "强盗敌视明军");
  assertEq(factionsHostile("bandit", "qing", TABLE), true, "强盗敌视清军");
}

export function beastFaction() {
  assertEq(isHostile({ faction: "beast" }, ming, TABLE), true, "野兽敌视明军");
  assertEq(isHostile(villager, ming, TABLE), false, "平民不敌视明军");
}

export function canAttackNeedsWeapon() {
  assertEq(canAttack(qing, ming, TABLE), true, "清军可攻击明军");
  // 主要场景：强盗（与所有人敌对）攻击玩家
  assertEq(canAttack(bandit, player, TABLE), true, "强盗可攻击玩家");
  // 玩家攻击强盗（玩家实体标 attackable）
  assertEq(canAttack(player, bandit, TABLE), true, "玩家可攻击强盗");
  // 玩家不能攻击同为友方的明军（表未声明敌对）
  assertEq(canAttack(player, ming, TABLE), false, "玩家与明军非敌对");
  // 无攻击力者不可攻击任何人
  assertEq(canAttack({ faction: "qing" }, ming, TABLE), false, "无攻击力不可攻击");
  // 同阵营不可攻击
  assertEq(canAttack(qing, { faction: "qing", atk: 5 }, TABLE), false, "同阵营不可攻击");
  // 死者不可被攻击
  assertEq(canAttack(player, { faction: "qing", atk: 5, dead: true }, TABLE), false, "死者不可被攻击");
}

export function defaultFactionLegacyCompat() {
  // 无 faction 字段：玩家 -> player；有攻击力 -> enemy；否则 neutral（原版行为）
  assertEq(defaultFaction(player), "player");
  assertEq(defaultFaction({ attackable: true }), "enemy");
  assertEq(defaultFaction({ attack: 30 }), "enemy");
  assertEq(defaultFaction({ atk: 5 }), "enemy");
  assertEq(defaultFaction({ attack: 0 }), "neutral");
  assertEq(defaultFaction({}), "neutral");
}

export function legacyEnemyOnlyFightsPlayer() {
  // 关键回归：未指定阵营的老数据里，“敌人”只与玩家敌对，不与平民/其它敌人互斗
  const oldEnemy = { x: 5, y: 5, attack: 50 };      // 无 faction
  const oldVillager = { x: 6, y: 5 };               // 无 faction、无攻击力
  assertEq(canAttack(oldEnemy, player, TABLE), true, "老敌人打玩家");
  assertEq(canAttack(oldEnemy, oldVillager, TABLE), false, "老敌人不打平民（行为不变）");
  assertEq(canAttack(oldVillager, oldEnemy, TABLE), false, "平民不打敌人");
}

export function nearestHostilePicksClosest() {
  const me = { x: 0, y: 0, faction: "beast", atk: 10 };   // 野兽敌视所有人
  const units = [{ ...qing, x: 5, y: 0 }, { ...ming, x: 100, y: 0 }, villager];
  const t = nearestHostile(me, units, TABLE);
  assert(!!t, "应找到敌对目标");
  assertEq(t.faction, "qing", "最近的是清军（5px）而非明军（100px）");
}

export function nearestHostileRangeLimit() {
  const me = { x: 0, y: 0, faction: "beast", atk: 10 };
  const far = { faction: "qing", atk: 5, x: 500, y: 0 };
  assertEq(nearestHostile(me, [far], TABLE, 100), null, "超出警戒范围则不索敌");
  assert(nearestHostile(me, [far], TABLE, 600) === far, "范围内则索敌");
}

export function hasAnyHostileCheck() {
  const me = { faction: "bandit", atk: 10 };
  assertEq(hasAnyHostile(me, [villager], TABLE), false, "只剩平民则无敌人");
  assertEq(hasAnyHostile(me, [villager, ming], TABLE), true, "有明军则存在敌人");
}

export function dynamicInstanceFaction() {
  // 实例阵营可变：同一个 NPC 改成不同阵营后敌对关系随之变化
  const u = { faction: "neutral", atk: 10 };
  assertEq(isHostile(u, player, TABLE), false, "中立时不敌视玩家");
  u.faction = "bandit";
  assertEq(isHostile(u, player, TABLE), true, "改成强盗后敌视玩家");
}

export function normalizeFactionsRules() {
  const out = normalizeFactions([
    { id: "a", name: "甲", hostileTo: ["b"] },
    { id: "b" },
    { name: "无 id 应丢弃" },
    null,
  ]);
  assertEq(out.length, 2, "丢弃无 id 项");
  assertEq(out[1].name, "b", "缺 name 用 id 兜底");
  assertEq(out[1].hostileTo, [], "缺 hostileTo 补空数组");
}
