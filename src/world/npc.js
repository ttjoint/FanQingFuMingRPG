// NPC 创建与 AI（可组合行为：idle/wander/guard/chase/attack/flee/assist 等）。
// AI 决策在 engine/ai.js（纯逻辑），动作副作用在 systems/aiActions.js（移动/攻击）。
import { cellCenter, worldToCell, walkable, overlapsUnit } from "../core/utils.js";
import { preloadChar } from "../core/assets.js";
import { resolveNpc } from "../content/contentdb.js";
import { npcFieldsFromTemplate } from "../content/npcFields.js";
import { attachAll } from "../engine/ecs.js";
import { UNIT_COMPONENTS } from "../runtime/components.js";
import { buildAiTable, normalizeProfile, makeBlackboard, stepAi } from "../engine/ai.js";
import { createAiRuntime } from "../systems/aiActions.js";

// 无 ai 引用时的兼容默认：有攻击力就按“主动野兽”打，否则原地游荡。
// targeting 的索敌半径等缺省值由游戏配置派生（见 config.combat），不写死在引擎。
let _defaultPlans = null;
function defaultPlans(ctx) {
  if (_defaultPlans) return _defaultPlans;
  const def = { aggroRange: (ctx && ctx.config && ctx.config.combat && ctx.config.combat.npcAggro) || undefined };
  _defaultPlans = {
    wander: normalizeProfile({ id: "wander", idle: { action: "wander", radius: 160, interval: [2, 6] } }, def),
    beast: normalizeProfile({
      id: "beast", idle: { action: "wander", radius: 160, interval: [2, 6] },
      targeting: { retaliate: true, giveUpT: 6, leash: 420 },
      rules: [
        { when: { targetInRange: "melee" }, do: { action: "attack", cooldown: 1.1 } },
        { when: { hasTarget: true }, do: { action: "chase", stopRange: "melee" } },
      ],
    }, def),
  };
  return _defaultPlans;
}

export function npcDataByName(ctx, nm) { return ctx.assets.npcsData.find(n => n.name === nm); }

export function makeNPC(d, row, col, overrides) {
  d = resolveNpc(d, overrides);   // 地图单位实例可用 overrides 单独覆盖模板属性
  const p = cellCenter(row, col);
  /** @type {any} */
  const n = { id: d.id, ...npcFieldsFromTemplate(d),
    x: p.x, y: p.y, row, col, dir: 4, action: "stand", frame: 0, ft: 0,
    target: null, path: null, attackCD: 0, aggro: false, dead: false, dieT: 0, dmgT: 0, wanderT: 1 + Math.random() * 3 };
  attachAll(n, UNIT_COMPONENTS);   // 统一补齐组件默认字段（半径/速度/姿态…）
  preloadChar(n.model);
  placeFree(n);   // 防止出生点与已有单位重叠
  return n;
}

// 若当前位置与其它单位重叠，就在附近格心找一个空位（最多外扩 3 圈）。
export function placeFree(e) {
  if (!overlapsUnit(e, e.x, e.y)) return true;
  const c = worldToCell(e.x, e.y);
  for (let r = 1; r <= 3; r++) {
    for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== r) continue;   // 只看当前一圈
      const rr = c.row + dr, cc = c.col + dc;
      if (!walkable(rr, cc)) continue;
      const p = cellCenter(rr, cc);
      if (!overlapsUnit(e, p.x, p.y)) { e.x = p.x; e.y = p.y; e.row = rr; e.col = cc; return true; }
    }
  }
  return false;
}

export function spawnNPC(ctx, id, row, col, overrides) {
  const d = ctx.assets.npcsData.find(n => n.id === id);
  return d ? makeNPC(d, row, col, overrides) : null;
}

// 解析单位要用的 AI plan：优先 n.ai 引用 assets.ais；否则按是否有攻击力给默认。
export function planFor(ctx, n) {
  const table = (ctx.assets && ctx.assets.aiTable) || null;
  if (table && n.ai != null && n.ai !== "") {
    const p = table.get(String(n.ai));
    if (p) return p;
  }
  const armed = n.attackable || (n.atk | 0) > 0;
  const dp = defaultPlans(ctx);
  return armed ? dp.beast : dp.wander;
}

export function spawnByName(ctx, name, x, y, isCol) {
  const d = npcDataByName(ctx, name);
  if (!d) return null;
  // 脚本按 (x,y) 传，x=列, y=行
  const npc = makeNPC(d, y, x);
  ctx.state.npcs.push(npc);
  return npc;
}

export function npcAI(ctx, n, dt) {
  const g = ctx.state;
  if (n.dead) return;
  if (n.attackCD > 0) n.attackCD -= dt;
  if (n.dmgT > 0) n.dmgT -= dt;

  // 挥砍“提交”：一旦出手就把这一刀播完（不因目标移动/死亡而中断）。动作层已实现，
  // 这里只负责把挥砍阶段往前推（因为挥砍期不进入规则决策）。
  if (n.atkT > 0) {
    const rt = runtimeFor(ctx);
    rt.run(bbOf(n), "attack", {}, dt);
    return;
  }

  const plan = planFor(ctx, n);
  const bb = bbOf(n);
  bb.plan = plan;
  bb.self = n;
  bb.hp = n.hp == null ? 1 : n.hp; bb.hpMax = n.hpMax || 100; bb.mp = n.mp || 0; bb.mpMax = n.mpMax || 0;
  stepAi(plan, bb, runtimeFor(ctx), dt);
}

// 每个单位一份 AI 黑板（挂在 n.ai$），跨帧保存目标/计时等状态。
function bbOf(n) { return n.ai$ || (n.ai$ = makeBlackboard(n)); }

// 运行时仅需构造一次（内部状态只依赖 ctx）。
function runtimeFor(ctx) { return ctx._aiRt || (ctx._aiRt = createAiRuntime(ctx)); }
