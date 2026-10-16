// 引擎核心：阵营（faction）纯逻辑。无 DOM 依赖，可在 Node 中测试。
//
// 设计约束（与项目一致）：
//  - **关系表是内容的一部分**（随资源版本固定，内置），运行时只读；
//  - **单位实例的阵营可变**（脚本 / 技能可动态改某个实例的 faction）；
//  - 单位没有 faction 字段时，用兼容层 defaultFaction() 派生，保证原版行为不变。
//
// 关系表结构（来自 assets/factions.json，经 normalizeFactions 规整）：
//   [{ id, name, hostileTo: [id, ...] }, ...]
// 判定为“双向对称”：只要 a 敌视 b 或 b 敌视 a，即视为敌对。

export const FACTION_PLAYER = "player";
export const FACTION_ENEMY = "enemy";
export const FACTION_NEUTRAL = "neutral";

// 把原始阵营定义表规整为 { byId: Map, list } 形式。
export function buildFactionTable(list) {
  const byId = new Map();
  for (const f of (list || [])) {
    if (!f || !f.id) continue;
    byId.set(String(f.id), {
      id: String(f.id),
      name: f.name || String(f.id),
      hostileTo: Array.isArray(f.hostileTo) ? f.hostileTo.map(String) : [],
    });
  }
  return { byId, list: Array.from(byId.values()) };
}

// 兼容层：没有显式 faction 的单位如何归类。
//  - 有攻击力（attackable 或 atk>0）的 NPC -> "enemy"（原版：有攻击力即可被玩家攻击）
//  - 其余 -> "neutral"
// 玩家单独标注（由调用方传 role="player" 或 faction 直接给 "player"）。
export function defaultFaction(unit) {
  if (!unit) return FACTION_NEUTRAL;
  if (unit.isPlayer || unit.role === "player") return FACTION_PLAYER;
  if (unit.faction) return String(unit.faction);
  if (unit.attackable || (unit.atk | 0) > 0 || (unit.attack | 0) > 0) return FACTION_ENEMY;
  return FACTION_NEUTRAL;
}

// 取某阵营的敌对集合（对象形式，便于 O(1) 查询）。
function hostileSet(table, id) {
  const f = table && table.byId && table.byId.get(id);
  return (f && f.hostileTo) || [];
}

// 两个阵营是否敌对。任一方向敌视即敌对（对称）。同阵营永不敌对。
export function factionsHostile(a, b, table) {
  if (!a || !b) return false;
  if (a === b) return false;
  const fa = hostileSet(table, a), fb = hostileSet(table, b);
  return fa.indexOf(b) >= 0 || fb.indexOf(a) >= 0;
}

// 单位 a 是否敌视单位 b（先解出各自阵营，再查表）。
export function isHostile(a, b, table) {
  if (!a || !b || a === b) return false;
  return factionsHostile(defaultFaction(a), defaultFaction(b), table);
}

// 单位 a 能否攻击单位 b：需要 a 具备攻击力，且两者敌对。
// 兼容层：若未提供 table（无阵营数据），退化为“a 有攻击力且 b 不是 a 自己”。
export function canAttack(a, b, table) {
  if (!a || !b || a === b || b.dead) return false;
  const armed = !!(a.attackable || (a.atk | 0) > 0 || (a.attack | 0) > 0);
  if (!armed) return false;
  if (!table) return true;
  return isHostile(a, b, table);
}

// 从单位列表中找出离 a 最近的敌对且存活单位（可选 range 像素上限）。
export function nearestHostile(a, units, table, range) {
  let best = null, bestD = range === undefined ? Infinity : range;
  for (const u of (units || [])) {
    if (!u || u === a || u.dead) continue;
    if (!canAttack(a, u, table)) continue;
    const d = Math.hypot(u.x - a.x, u.y - a.y);
    if (d < bestD) { bestD = d; best = u; }
  }
  return best;
}

// 某个单位是否应当主动敌对（用于“自动索敌”的 aggressive 判断）：
// 只有当它至少敌视一个候选目标时才需要 aggro 机制。
export function hasAnyHostile(a, units, table) {
  for (const u of (units || [])) if (u && u !== a && !u.dead && canAttack(a, u, table)) return true;
  return false;
}
