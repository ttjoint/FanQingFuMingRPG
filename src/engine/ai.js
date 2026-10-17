// 引擎核心：可组合、可扩展的单位 AI（纯逻辑 + 可注册原语，无 DOM）。
//
// 设计（见 docs）：
//   AI Profile（内容，按 id 引用）  --编译-->  Behavior Plan  --每帧解释-->  动作
//   - profile.rules 顺序匹配，首个 when 全为真的规则生效；
//   - when 是条件对象（可组合：all/any/not），do 是动作描述 { action, ...参数 }；
//   - 条件与动作都是**注册表**：引擎内置一批，宿主可 registerCondition/registerAction 扩展。
//
// 本模块只做「决策 + 动作描述」，具体移动/攻击等副作用由运行时注入的动作实现完成
// （见 systems/aiActions.js），因此本模块可在 Node 中完整单测。

// ---------------------------------------------------------------------------
// 条件原语（condition registry）
// 每个条件签名：(bb, value, ctx) => boolean
//   bb  = blackboard（单位 AI 黑板，含 self/target/allies/enemies/state...）
//   value = 条件里写的参数（如 { hpBelow: 0.3 } 的 0.3）
//   ctx = { self, target, units, table, dist, now, ... } 由运行时装配
// ---------------------------------------------------------------------------
export const CONDITIONS = {};
export function registerCondition(name, fn) { CONDITIONS[name] = fn; }
export function conditionNames() { return Object.keys(CONDITIONS); }

const frac = (a, b) => (b > 0 ? a / b : 0);

registerCondition("always", () => true);
registerCondition("never", () => false);
registerCondition("hpBelow", (bb, v) => frac(bb.hp, bb.hpMax) < v);
registerCondition("hpAbove", (bb, v) => frac(bb.hp, bb.hpMax) > v);
registerCondition("mpBelow", (bb, v) => frac(bb.mp, bb.mpMax) < v);
registerCondition("mpAbove", (bb, v) => frac(bb.mp, bb.mpMax) > v);
registerCondition("hasTarget", bb => !!bb.target);
registerCondition("noTarget", bb => !bb.target);
registerCondition("targetDead", bb => !bb.target || bb.target.dead);
// 距离条件：v 可为数字（像素）、"melee"（近战距离）或 "aggro"（索敌半径）
registerCondition("targetInRange", (bb, v, c) => !!bb.target && c.dist(bb.self, bb.target) <= c.resolveRange(v, bb));
registerCondition("targetDistBelow", (bb, v, c) => !!bb.target && c.dist(bb.self, bb.target) < v);
registerCondition("targetDistAbove", (bb, v, c) => !!bb.target && c.dist(bb.self, bb.target) > v);
// 追击/脱离的时间控制
registerCondition("aggroOver", (bb, v) => (bb.state.aggroT || 0) > v);
registerCondition("lostOver", (bb, v) => (bb.state.lostT || 0) > v);
registerCondition("hasAggro", bb => (bb.state.aggroT || 0) > 0);
// 同阵营/敌对数量（用于“附近有同阵营被打就一起上”“敌人太多就撤”）
registerCondition("allyBeingAttacked", (bb, v, c) => c.allyBeingAttacked(bb, v === true || v == null ? 300 : v));
registerCondition("nearbyEnemyCount", (bb, v, c) => c.nearbyCount(bb, "hostile", v) >= v);
registerCondition("nearbyAllyCount", (bb, v, c) => c.nearbyCount(bb, "ally", v) >= v);
registerCondition("allyCountBelow", (bb, v, c) => c.nearbyCount(bb, "ally", v) < v);
// 随机 / 冷却（技能释放频率、随机行为）
registerCondition("random", (bb, v) => Math.random() < v);
registerCondition("cooldownReady", (bb, v) => (bb.state.cd[v] || 0) <= 0);
registerCondition("leashExceeded", (bb, v, c) => c.dist(bb.self, bb.home) > (v === undefined ? Infinity : v));

// 组合子：all / any / not（值本身又是条件对象）
registerCondition("all", (bb, obj, c) => Object.keys(obj).every(k => evalCondition(k, obj[k], bb, c)));
registerCondition("any", (bb, obj, c) => Object.keys(obj).some(k => evalCondition(k, obj[k], bb, c)));
registerCondition("not", (bb, obj, c) => !evalWhen(obj, bb, c));

// 求值一个条件对象（可能含多个键，全部需满足）。
export function evalCondition(name, value, bb, ctx) {
  const fn = CONDITIONS[name];
  if (!fn) return false;
  return !!fn(bb, value, ctx);
}
export function evalWhen(when, bb, ctx) {
  if (!when) return true;                     // 无条件 = 恒真
  for (const k of Object.keys(when)) if (!evalCondition(k, when[k], bb, ctx)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// 动作原语（action registry）
// 每个动作签名：(rt, bb, params, ctx) => { done?: boolean, state?: object }
//   rt = 动作运行时（由 systems/aiActions.js 注入：moveTo/attack/flee/...）
//   返回的 state 会合并进 bb.state（用于 cooldown 等）。
// 动作只“描述意图”，移动/攻击的像素级副作用由 rt 实现。
// ---------------------------------------------------------------------------
export const ACTIONS = {};
export function registerAction(name, fn) { ACTIONS[name] = fn; }
export function actionNames() { return Object.keys(ACTIONS); }

// ---------------------------------------------------------------------------
// 编译：profile(> 轻量校验/补默认) -> plan
// profile 结构：
//   { id, name, idle: { action, ...params }, targeting: { aggroRange, retaliate, giveUpT, leash }, rules: [{ when, do }] }
// ---------------------------------------------------------------------------
// leashFrom: 允许离开出生/巡逻锚点的最大距离（缺省 = leash）。
//   超出即放弃追击并返回原地 —— 避免"追着玩家横穿整张地图"。
export const DEFAULT_TARGETING = { aggroRange: 260, retaliate: true, giveUpT: 8, leash: 480, leashFrom: 0 };

// 字段缺省值可注入：runtime 可传入由游戏配置派生的 targeting 默认，
// 使“索敌半径/追丢时间/拴绳距离”等平衡数值不再写死在引擎里。
export function normalizeProfile(p, defaults) {
  const def = Object.assign({}, DEFAULT_TARGETING, defaults || {});
  const o = p && typeof p === "object" ? p : {};
  const t = o.targeting && typeof o.targeting === "object" ? o.targeting : {};
  return {
    id: String(o.id == null ? "" : o.id),
    name: o.name ? String(o.name) : "",
    idle: (o.idle && typeof o.idle === "object") ? o.idle : { action: "idle" },
    targeting: {
      aggroRange: num(t.aggroRange, def.aggroRange),
      retaliate: t.retaliate !== false,
      giveUpT: num(t.giveUpT, def.giveUpT),
      leash: num(t.leash, def.leash),
      leashFrom: num(t.leashFrom, def.leashFrom != null ? def.leashFrom : num(t.leash, def.leash)),
    },
    rules: Array.isArray(o.rules) ? o.rules.filter(r => r && typeof r === "object")
      .map(r => ({ when: (r.when && typeof r.when === "object") ? r.when : null, do: (r.do && typeof r.do === "object") ? r.do : { action: "idle" } })) : [],
  };
}

function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : (v == null || v === "" ? d : (Number(v) || d)); }

// 一批 profile（数组/记录）-> Map<id, plan>
export function buildAiTable(list, defaults) {
  const byId = new Map();
  for (const p of (list || [])) {
    if (!p || p.id == null) continue;
    byId.set(String(p.id), normalizeProfile(p, defaults));
  }
  return byId;
}

// ---------------------------------------------------------------------------
// 决策：给定黑板与上下文，选出这一帧要执行的动作。
//   - 无有效目标时：执行 idle（并按 targeting 尝试索敌）
//   - 有目标时：按 rules 顺序，首个 when 命中的规则生效
//   - 无规则命中时：默认行为 = 进入攻击距离则攻击，否则追击
// 返回 { action, params }。
// ---------------------------------------------------------------------------
export function decide(plan, bb, ctx) {
  if (!plan) return { action: "idle", params: {} };
  const hasTarget = !!bb.target && !bb.target.dead;
  // 规则始终从上到下匹配（首个命中生效）。有些规则不需要目标
  // （如 allyBeingAttacked / random / hpBelow 逃跑），因此在无目标时也要评估。
  for (const r of plan.rules) {
    if (evalWhen(r.when, bb, ctx)) return { action: r.do.action, params: r.do };
  }
  if (!hasTarget) return { action: plan.idle.action || "idle", params: plan.idle };
  // 缺省战斗逻辑
  return ctx.dist(bb.self, bb.target) <= ctx.resolveRange("melee", bb)
    ? { action: "attack", params: { cooldown: 1.1 } }
    : { action: "chase", params: { stopRange: "melee" } };
}

// ---------------------------------------------------------------------------
// 每帧推进：装配黑板 -> 决策 -> 执行动作 -> 更新计时状态。
// 依赖（rt）由运行时注入，便于单测与扩展：
//   rt = {
//     run(ctx, bb, action, params, dt) -> { done, statePatch },   // 执行动作
//     pickTarget(ctx, bb) -> unit|null,                           // 索敌
//     now() -> number,                                            // 时间（秒）
//   }
// 本函数的职责：目标生命周期（索敌/失去/超时）、aggtT/lostT/cd 计时、规则匹配。
// ---------------------------------------------------------------------------
export function stepAi(plan, bb, rt, dt) {
  const ctx = rt.ctx;
  const st = bb.state;
  // 冷却计时
  for (const k in st.cd) if (st.cd[k] > 0) st.cd[k] = Math.max(0, st.cd[k] - dt);

  // 目标生命周期：死亡 / 超出 leash / 不再敌对（如阵营被动态改变）则丢弃
  const had = bb.target;
  if (had && (had.dead || rt.lost(bb, had) || (rt.canKeep && !rt.canKeep(bb, had)))) {
    bb.target = null;
    st.lostT = 0;
  }
  if (!bb.target) {
    const t = rt.pickTarget(bb);
    if (t) {
      bb.target = t;
      st.aggroT = 0; st.lostT = 0;
    } else {
      st.aggroT = 0;
      // 无目标：仍然让规则决策（如 assist / 随机行为 / 待机游荡）
    }
  } else {
    st.aggroT = (st.aggroT || 0) + dt;
  }

  // 仇恨衰减（若运行时提供）：长时间未被攻击则清除 lastAttacker。
  if (rt.decayAggro) rt.decayAggro(bb, dt);

  const { action, params } = decide(plan, bb, ctx);
  const res = rt.run(bb, action, params, dt);
  applyPatch(st, res && res.statePatch);
  return res;
}

function applyPatch(st, patch) { if (patch) for (const k in patch) st[k] = patch[k]; }

// 黑板工厂：为某个单位建立/复用 AI 黑板。
export function makeBlackboard(unit) {
  return {
    self: unit,
    target: null,
    home: { x: unit.x, y: unit.y },
    hp: 0, hpMax: 1, mp: 0, mpMax: 1,
    state: { aggroT: 0, lostT: 0, cd: {}, wanderT: 0, wanderDest: null },   // 可序列化的 AI 状态
  };
}
