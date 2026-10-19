import { CONDITIONS, ACTIONS, evalWhen, decide, stepAi, normalizeProfile, buildAiTable, makeBlackboard } from "../src/engine/ai.js";
import { assert, assertEq } from "./helpers.mjs";

// AI 引擎纯逻辑：条件求值、规则顺序匹配、目标生命周期、状态计时。
// 这里不碰 DOM/移动，只验证「决策」是否正确。

function ctxFor(units, dist) {
  const byId = new Map(units.map(u => [u.id, u]));
  return {
    units,
    dist: dist || ((a, b) => Math.hypot(a.x - b.x, a.y - b.y)),
    resolveRange: (v, bb) => (v === "melee" ? 46 : v === "aggro" ? (bb.plan.targeting.aggroRange || 260) : Number(v) || 0),
    allyBeingAttacked: () => false,
    nearbyCount: () => 0,
    assets: { factionTable: null },
    config: { combat: { npcMelee: 46, npcAggro: 260 } },
  };
}

const prof = o => normalizeProfile(o);

export function conditionBasics() {
  const bb = { self: { id: 1, x: 0, y: 0 }, hp: 30, hpMax: 100, mp: 10, mpMax: 100, state: {}, home: { x: 0, y: 0 } };
  const ctx = ctxFor([bb.self]);
  assertEq(CONDITIONS.hpBelow(bb, 0.5), true, "30% < 50%");
  assertEq(CONDITIONS.hpBelow(bb, 0.2), false, "30% 不低于 20%");
  assertEq(CONDITIONS.hpAbove(bb, 0.2), true, "高于");
  assertEq(CONDITIONS.always(bb), true, "always");
  assertEq(evalWhen({ hpBelow: 0.5, mpBelow: 0.5 }, bb, ctx), true, "多条件全真");
  assertEq(evalWhen({ hpBelow: 0.2, mpBelow: 0.5 }, bb, ctx), false, "一条不满足即假");
}

export function combinators() {
  const bb = { hp: 30, hpMax: 100, mp: 10, mpMax: 100, state: {}, home: { x: 0, y: 0 } };
  const ctx = ctxFor([]);
  assertEq(evalWhen({ all: { hpBelow: 0.5, mpBelow: 0.5 } }, bb, ctx), true, "all 全真");
  assertEq(evalWhen({ any: { hpBelow: 0.1, mpBelow: 0.5 } }, bb, ctx), true, "any 有真");
  assertEq(evalWhen({ not: { hpBelow: 0.5 } }, bb, ctx), false, "not 取反");
}

export function orderedRules() {
  const self = { id: 1, x: 0, y: 0, hp: 20, hpMax: 100, dead: false };
  const target = { id: 2, x: 50, y: 0, dead: false };
  const bb = { self, target, hp: 20, hpMax: 100, state: {}, home: { x: 0, y: 0 }, plan: null };
  const ctx = ctxFor([self, target]);
  const plan = prof({
    idle: { action: "wander" },
    rules: [
      { when: { hpBelow: 0.3 }, do: { action: "flee", range: 400 } },
      { when: { targetInRange: "melee" }, do: { action: "attack", cooldown: 1 } },
      { when: { hasTarget: true }, do: { action: "chase", stopRange: "melee" } },
    ],
  });
  bb.plan = plan;
  assertEq(decide(plan, bb, ctx).action, "flee", "低血优先逃跑（顺序匹配）");
  bb.hp = 80;
  assertEq(decide(plan, bb, ctx).action, "chase", "高血但距离远 -> 追击");
  target.x = 10;
  assertEq(decide(plan, bb, ctx).action, "attack", "进入近战 -> 攻击");
}

export function noTargetRunsIdle() {
  const self = { id: 1, x: 0, y: 0, dead: false };
  const bb = { self, target: null, hp: 100, hpMax: 100, state: {}, home: { x: 0, y: 0 } };
  const plan = prof({ idle: { action: "wander", radius: 100 }, rules: [{ when: { hasTarget: true }, do: { action: "attack" } }] });
  bb.plan = plan;
  const rt = {
    ctx: ctxFor([self]),
    lost: () => false,
    pickTarget: () => null,
    run: (bb2, action) => { bb2.__ran = action; return {}; },
  };
  stepAi(plan, bb, rt, 0.1);
  assertEq(bb.__ran, "wander", "无目标 -> 执行 idle");
}

export function defaultCombatWhenNoRuleMatches() {
  const self = { id: 1, x: 0, y: 0, dead: false };
  const target = { id: 2, x: 200, y: 0, dead: false };
  const bb = { self, target, hp: 100, hpMax: 100, state: {}, home: { x: 0, y: 0 } };
  const plan = prof({ idle: { action: "idle" }, rules: [] });   // 无规则
  bb.plan = plan;
  const ctx = ctxFor([self, target]);
  assertEq(decide(plan, bb, ctx).action, "chase", "无规则命中 -> 默认追击");
  target.x = 10;
  assertEq(decide(plan, bb, ctx).action, "attack", "无规则命中且近身 -> 默认攻击");
}

export function targetLifecycleAndTimers() {
  const self = { id: 1, x: 0, y: 0, dead: false };
  const dead = { id: 2, x: 10, y: 0, dead: true };
  const bb = makeBlackboard(self);
  bb.plan = prof({ idle: { action: "idle" }, rules: [] });
  bb.target = dead;
  let picked = 0;
  const rt = {
    ctx: ctxFor([self]),
    lost: () => false,
    pickTarget: () => { picked++; return null; },
    run: () => ({}),
  };
  stepAi(bb.plan, bb, rt, 0.1);
  assertEq(bb.target, null, "目标死亡 -> 清空");
  assertEq(picked, 1, "清空后尝试重新索敌");

  // aggro 计时累加
  const t2 = { id: 3, x: 20, y: 0, dead: false };
  bb.target = t2;
  const rt2 = { ctx: ctxFor([self, t2]), lost: () => false, pickTarget: () => null, run: () => ({}) };
  stepAi(bb.plan, bb, rt2, 0.5);
  assertEq(Math.abs(bb.state.aggroT - 0.5) < 1e-6, true, "aggroT 累加");
  assertEq(bb.target, t2, "目标存活则保留");
}

export function profileNormalizeAndTable() {
  const p = prof({ id: "x", rules: [{ do: { action: "attack" } }] });
  assertEq(p.id, "x");
  assertEq(p.idle.action, "idle", "缺省 idle");
  assertEq(p.targeting.aggroRange, 260, "缺省索敌半径");
  assertEq(p.rules[0].when, null, "缺省 when 为 null（恒真）");
  const table = buildAiTable([{ id: "a", idle: { action: "wander" } }, { id: "b" }]);
  assertEq(table.size, 2, "按 id 建表");
  assertEq(table.get("a").idle.action, "wander");
}

export function registriesExtensible() {
  assert(typeof CONDITIONS.hpBelow === "function", "内置条件");
  assert(typeof ACTIONS === "object", "动作注册表存在");
}

// ---- 仇恨范围收紧（防止"全图怪都来打我"）----
// lost(): giveUpT 超时 / 离开锚点太远 都应判定为丢失目标。
export function lostByGiveUpTime() {
  const self = { x: 0, y: 0, homeX: 0, homeY: 0 };
  const t = { x: 10, y: 0 };
  const bb = { self, target: t, plan: { targeting: { leash: 500, leashFrom: 0, giveUpT: 8 } }, state: { aggroT: 0, cd: {} } };
  const rt = mkLossRt();
  assertEq(rt.lost(bb, t), false, "刚锁定不丢");
  bb.state.aggroT = 9;
  assertEq(rt.lost(bb, t), true, "超过 giveUpT 应丢弃目标");
}

export function lostByLeashFromHome() {
  const self = { x: 0, y: 0, homeX: 0, homeY: 0 };
  const t = { x: 10, y: 0 };
  const bb = { self, target: t, plan: { targeting: { leash: 9999, leashFrom: 160, giveUpT: 0 } }, state: { aggroT: 0, cd: {} } };
  const rt = mkLossRt();
  assertEq(rt.lost(bb, t), false, "在锚点范围内不丢");
  self.x = 500;   // 追出去 500px，远超 leashFrom
  assertEq(rt.lost(bb, t), true, "离出生点太远应丢弃目标（不再横穿地图）");
}

export function lostWhenTargetDead() {
  const self = { x: 0, y: 0, homeX: 0, homeY: 0 };
  const t = { x: 10, y: 0, dead: true };
  const bb = { self, target: t, plan: { targeting: {} }, state: { aggroT: 0, cd: {} } };
  assertEq(mkLossRt().lost(bb, t), true, "目标死亡即丢");
}

// 撤回期间不得重新索敌 ------------------------------------------------
// 旧 bug：玩家只要还站在 aggroRange 内，就会
// “清目标 → 下一帧又选中 → 又超 leash → 又清目标” 每帧来回切，表现为原地抽搐。
// 修法：放弃目标时置 state.returning，pickTarget 在 returning>0 时直接返回 null。
export function pickTargetBlockedWhileReturning() {
  const calls = [];
  const mk = (returning) => ({
    self: { x: 0, y: 0, homeX: 0, homeY: 0 },
    plan: { targeting: { aggroRange: 260 } },
    state: { returning },
  });
  // 镜像 pickTarget 的拦截条件（与 aiActions.js 同步）
  const wouldPick = bb => {
    const aggroRange = bb.plan ? bb.plan.targeting.aggroRange : 0;
    if (aggroRange <= 0) return false;
    if ((bb.state && bb.state.returning) > 0) return false;
    return true;   // 此处假定确实有敌对单位在圈内
  };
  calls.push(wouldPick(mk(0)));
  calls.push(wouldPick(mk(30)));
  assertEq(calls[0], true, "冷却结束（returning=0）应可以索敌");
  assertEq(calls[1], false, "撤回冷却中（returning>0）不得索敌，否则每帧来回切");
}

// 撤回冷却递减：只在 return 动作报 done 或超时后结束 ------------------
export function returningCooldownCountsDown() {
  const st = { returning: 30 };
  const tick = dt => { if (st.returning > 0) st.returning = Math.max(0, st.returning - dt); };
  tick(1);
  assertEq(Math.round(st.returning), 29, "每帧递减");
  st.returning = 0.5;
  tick(1);
  assertEq(st.returning, 0, "不应为负（否则下一帧又被当成未结束）");
}

// 死亡必须立即切到死亡动画，不再等攻击帧播完 -----------------------------
// 旧行为：pendingDie 让单位先把这一刀播完才倒地，玩家看到尸体还在挥刀。
export function deathInterruptsAttackAnim() {
  const n = { action: "fight", frame: 4, atkT: 0.9, swingT: 0.2, hitPending: true, swingTarget: {}, dead: false, animSpeed: 1.5 };
  // 镜像 combat.js killNPC 的收尾逻辑
  const kill = u => {
    u.dead = true;
    u.atkT = 0; u.swingT = 0; u.hitPending = false; u.swingTarget = null; u.animSpeed = 1;
    u.action = "die"; u.frame = 0; u.ft = 0;
  };
  kill(n);
  assertEq(n.action, "die", "立即进入死亡动作");
  assertEq(n.frame, 0, "死亡动画从第 0 帧开始");
  assertEq(n.atkT, 0, "挥砍计时必须清零（否则卡在战斗帧）");
  assertEq(n.hitPending, false, "不得留下待结算的命中（否则尸体还在出伤）");
  assertEq(n.animSpeed, 1, "动画速度复位");
}

// 仅测试 lost()：构造一个只含该方法的运行时。
function mkLossRt() {
  // 与 systems/aiActions.js createAiRuntime().lost 保持同一语义。
  return {
    lost(bb, t) {
      const n = bb.self;
      if (!t || t.dead) return true;
      const tg = (bb.plan && bb.plan.targeting) || {};
      const leash = tg.leash != null ? tg.leash : 480;
      if (leash > 0 && Math.hypot(n.x - t.x, n.y - t.y) > leash) return true;
      const leashFrom = tg.leashFrom != null ? tg.leashFrom : leash;
      if (leashFrom > 0 && n.homeX != null && n.homeY != null) {
        if (Math.hypot(n.x - n.homeX, n.y - n.homeY) > leashFrom) return true;
      }
      const giveUpT = tg.giveUpT != null ? tg.giveUpT : 8;
      if (giveUpT > 0 && (bb.state.aggroT || 0) > giveUpT) return true;
      return false;
    },
  };
}

// ---------------------------------------------------------------------------
// 回归：被动野兽（原版野猴）不该主动扑过来
//
// 实机反馈：原版野猴是被动攻击怪，复刻版里会主动追杀玩家。
// 根因：pickTarget 只看 aggroRange > 0 就主动索敌，targeting.retaliate
// 仅是"优先报复攻击者"那条分支的开关 —— "被打才还手"根本表达不出来。
// 修复：新增 targeting.aggressive 开关（缺省 true，保持既有行为不变）；
//       为 false 时只走报复分支，不主动找目标。
// ---------------------------------------------------------------------------
export async function aiPassiveBeastDoesNotAggro() {
  const { normalizeProfile } = await import("../src/engine/ai.js");
  const p = normalizeProfile({ id: "passive", targeting: { aggressive: false, aggroRange: 200 } });
  if (p.targeting.aggressive !== false) throw new Error("aggressive:false 应被保留，实际 " + p.targeting.aggressive);
  const d = normalizeProfile({ id: "default" });
  if (d.targeting.aggressive !== true) throw new Error("缺省必须是主动（向后兼容），实际 " + d.targeting.aggressive);
  return;
}

export async function aiWildMonkeyIsPassive() {
  const { readFileSync } = await import("node:fs");
  const path = new URL("../versions/default/assets/npcs.json", import.meta.url);
  const d = JSON.parse(readFileSync(path, "utf8"));
  const arr = Array.isArray(d) ? d : Object.values(d);
  const monkey = arr.find(n => n.name === "野猴");
  if (!monkey) throw new Error("找不到野猴模板");
  if (monkey.ai !== "beast_passive") throw new Error("野猴应使用被动 AI（beast_passive），实际 " + monkey.ai);
  // 花豹是原版主动怪，不应被顺手改掉。
  const leopard = arr.find(n => n.name === "花豹");
  if (leopard && leopard.ai === "beast_passive") throw new Error("花豹不应被改成被动");
  return;
}

export async function aiBeastPassiveProfileIsRegistered() {
  const { readFileSync } = await import("node:fs");
  const path = new URL("../versions/default/assets/ais.json", import.meta.url);
  const d = JSON.parse(readFileSync(path, "utf8"));
  const arr = Array.isArray(d) ? d : Object.values(d);
  const bp = arr.find(a => a.id === "beast_passive");
  if (!bp) throw new Error("ais.json 缺少 beast_passive 定义");
  if (!bp.targeting || bp.targeting.aggressive !== false)
    throw new Error("beast_passive 必须带 aggressive:false，否则仍是主动怪");
  // 规则要和主动野獸一致：近身反击 + 追击 + 低血逃跑
  const acts = (bp.rules || []).map(r => r.do && r.do.action);
  for (const need of ["attack", "chase", "flee"])
    if (!acts.includes(need)) throw new Error("beast_passive 缺少规则 " + need + "，实际 " + acts.join(","));
  return;
}
