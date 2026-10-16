// 引擎核心：技能目标选择（targeting）纯逻辑。无 DOM 依赖，可在 Node 中测试。
//
// 设计（阶段 D）：
//  - 把「一次技能作用于哪些单位」从 combat / aiActions 里抽出来，变成数据驱动。
//  - 目标类型（kind）：
//      "enemy"（默认）—— 敌对单位
//      "ally"          —— 同阵营单位（不含自己，除非 includeSelf）
//      "self"          —— 自己（治疗 / 增益）
//      "point"         —— 以落点为中心的范围（AOE），不依赖单体目标
//  - AOE：aoe=true + radius，命中「主目标（或施法者/落点）周围 radius 内」的全部合法单位。
//
// 技能数据字段（经 normalizeSkill 规整）：skills.json 的 targeting:
//   { kind: "enemy"|"ally"|"self"|"point", aoe: bool, radius: 像素, maxTargets: N, includeSelf: bool }

export const TARGET_ENEMY = "enemy";
export const TARGET_ALLY = "ally";
export const TARGET_SELF = "self";
export const TARGET_POINT = "point";

const n = (v, d) => (typeof v === "number" && isFinite(v) ? v : (v == null || v === "" ? d : (Number(v) || d)));

const KINDS = [TARGET_ENEMY, TARGET_ALLY, TARGET_SELF, TARGET_POINT];

// 规整 targeting 配置。空 / 缺失时返回默认（单体敌对），保证旧技能行为不变。
export function normalizeTargeting(t) {
  const o = t && typeof t === "object" ? t : {};
  const kind = KINDS.includes(o.kind) ? o.kind : TARGET_ENEMY;
  return {
    kind,
    aoe: !!o.aoe,
    radius: n(o.radius, 0),
    maxTargets: Math.max(0, Math.floor(n(o.maxTargets, 0))),   // 0 = 不限
    includeSelf: !!o.includeSelf,
  };
}

// 目标类型是否为“以施法者自身为唯一目标”。
export const isSelfOnly = tg => tg && tg.kind === TARGET_SELF;
// 目标是否需要单体目标（enemy/ally 单体）。
export const needsPrimary = tg => tg && (tg.kind === TARGET_ENEMY || tg.kind === TARGET_ALLY);

// 判断某单位是否属于该 targeting 的“合法对象”。
//   isHostile(self, unit) 由调用方注入（复用阵营表），避免 engine 依赖 faction。
export function isValidTarget(tg, self, unit, isHostile) {
  if (!tg || !unit || unit === self) return false;
  if (unit.dead) return false;
  switch (tg.kind) {
    case TARGET_SELF: return unit === self;
    case TARGET_ALLY: return !isHostile(self, unit);
    case TARGET_POINT: return true;
    case TARGET_ENEMY:
    default: return isHostile(self, unit);
  }
}

// 选择技能作用目标。
//   candidates: 参与筛选的单位列表（一般 = 玩家 + 全部 NPC，已排除施法者自身由函数内处理）
//   primary:    主目标（单体技能必填；AOE 时作为范围中心；point 时为落点 {x,y}）
// 返回：单位数组（去重、已按 maxTargets 截断）。
export function selectTargets(tg, self, primary, candidates, isHostile) {
  const t = normalizeTargeting(tg);
  if (isSelfOnly(t)) return self ? [self] : [];
  const list = Array.isArray(candidates) ? candidates : [];
  // 单体：只返回主目标（若合法）
  if (!t.aoe) {
    if (!primary || primary === self) return [];
    return isValidTarget(t, self, primary, isHostile) ? [primary] : [];
  }
  // AOE：以主目标（或施法者）为中心，收集半径内全部合法单位
  const center = primary && typeof primary.x === "number" ? primary : self;
  if (!center) return [];
  const r = t.radius || 0;
  const out = [];
  // 施法者自身是否纳入（治疗/增益 AOE 常用）
  if (t.includeSelf && self && (t.kind === TARGET_ALLY || t.kind === TARGET_POINT)) out.push(self);
  for (const u of list) {
    if (u === self) continue;
    if (!isValidTarget(t, self, u, isHostile)) continue;
    if (Math.hypot(u.x - center.x, u.y - center.y) > r) continue;
    out.push(u);
  }
  return t.maxTargets > 0 ? out.slice(0, t.maxTargets) : out;
}

// ---- 冷却（cooldown）----
// 技能级冷却：单位上维护 skillCDs = { [skillName]: 剩余秒 }。
// 与自动攻击的 attackCD 分离：切换技能后各自的冷却互不影响。
export function normalizeCooldown(sk) {
  const c = sk && sk.cooldown;
  return Math.max(0, c == null ? 0 : Number(c) || 0);
}

export function cdRemaining(unit, sk) {
  if (!unit || !sk) return 0;
  const m = unit.skillCDs;
  return m && m[sk.name] ? m[sk.name] : 0;
}

// 技能是否已就绪（冷却为 0）。
export function isReady(unit, sk) {
  return cdRemaining(unit, sk) <= 0;
}

// 触发技能冷却（施放成功后调用）。
export function startCooldown(unit, sk) {
  const cd = normalizeCooldown(sk);
  if (!unit || !sk || cd <= 0) return 0;
  if (!unit.skillCDs) unit.skillCDs = {};
  unit.skillCDs[sk.name] = cd;
  return cd;
}

// 推进冷却计时。
export function tickCooldowns(unit, dt) {
  if (!unit || !unit.skillCDs) return;
  const m = unit.skillCDs;
  for (const k in m) {
    m[k] -= dt;
    if (m[k] <= 0) delete m[k];
  }
}

// ---- 击退 / 位移（knockback）----
// 计算把目标朝「远离施法者」方向推开 dist 像素后的落点。
export function knockbackTarget(self, target, dist) {
  if (!self || !target) return null;
  let dx = target.x - self.x, dy = target.y - self.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
  return { x: target.x + dx * (dist || 0), y: target.y + dy * (dist || 0) };
}
