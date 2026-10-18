// 系统层：雇佣兵（招募 / 跟随 / 薪水 / 复活）。
//
// 随从就是一个 friendly 的 NPC 实例，挂在 G.mercenary 上，
// 直接塞进 G.npcs 让现有的 AI/寻路/动画/伤害结算全部复用。
import { makeNPC } from "../world/npc.js";
import { cellCenter } from "../core/utils.js";
import {
  normalizeMercs, mercById, feesDue, reviveCost, reviveState, followStep,
  canHire, FOLLOW_LEAD, FOLLOW_STOP, REVIVE_DELAY,
} from "../engine/merc.js";

// 配置里的随从表（编辑器可覆盖），缺省用内置。
export function mercList(ctx) {
  return normalizeMercs(ctx && ctx.config && ctx.config.mercenaries);
}

// 招募一个随从。返回 { ok, reason, cost }。
export function hire(ctx, id) {
  const G = ctx.state;
  const def = mercById(mercList(ctx), id);
  const gate = canHire(def, G.stats.money, G.mercenary);
  if (!gate.ok) { G.tip = gate.reason; G.tipT = 2; return gate; }
  G.stats.money -= gate.cost;
  G.mercenary = {
    defId: def.id,
    dead: false, deadT: 0,
    feeT: 0,                       // 距上次发薪的秒数
    unit: null,
  };
  spawnMerc(ctx);
  G.tip = "招募：" + def.name + " -" + gate.cost; G.tipT = 2.5;
  return { ok: true, reason: "", cost: gate.cost };
}

// 解雇（不退款）。返回是否成功。
export function dismiss(ctx) {
  const G = ctx.state;
  if (!G.mercenary) return false;
  removeUnit(ctx);
  G.mercenary = null;
  G.tip = "已遣散随从"; G.tipT = 2;
  return true;
}

// 把随从实体放进当前地图（在主人附近找个位置）。
export function spawnMerc(ctx) {
  const G = ctx.state;
  const m = G.mercenary;
  if (!m) return null;
  const def = mercById(mercList(ctx), m.defId);
  if (!def) return null;
  const p = G.player || { x: 0, y: 0 };
  // 主人右下方一格：与玩家错开，不会一出现就贴脸
  const cell = { row: (p.row || 1) + 1, col: (p.col || 1) + 1 };
  const pos = cellCenter(cell.row, cell.col);
  const npc = makeNPC({
    id: "mercenary_" + def.id, name: def.name, model: def.model,
    hp: def.hp, hpMax: def.hp, atk: def.atk, defence: def.def,
    level: G.stats.level, exp: 0,
    faction: "player",           // 与玩家同阵营：现有 AI 的 ally 判定直接生效
    speed: def.speed, attackRange: def.range, attackCD: def.cd,
    attackable: true,
  }, cell.row, cell.col, null, ctx);
  npc.isMercenary = true;
  npc.mercId = def.id;
  npc.ownerIsPlayer = true;
  // 不占 spawns（不会随 loadMap 重建出第二份），跟随由 mercSystem 驱动。
  G.npcs.push(npc);
  m.unit = npc;
  return npc;
}

// 从场上移除随从实体。
export function removeUnit(ctx) {
  const G = ctx.state;
  const m = G.mercenary;
  if (!m || !m.unit) return;
  const i = G.npcs.indexOf(m.unit);
  if (i >= 0) G.npcs.splice(i, 1);
  m.unit = null;
}

// 每帧：跟随 + 薪水 + 死亡/复活。
export function mercSystem(ctx, dt) {
  const G = ctx.state;
  const m = G.mercenary;
  if (!m) return;
  const def = mercById(mercList(ctx), m.defId);

  // 1) 死亡：从场上摘掉，开始计时；到点且钱够就复活。
  if (m.unit && m.unit.dead) {
    removeUnit(ctx);
    m.dead = true;
    m.deadT = 0;
  }
  if (m.dead) {
    m.deadT += dt;
    if (reviveState(m) === "ready" && G.player && !G.player.dead) {
      const cost = reviveCost(def);
      if (G.stats.money >= cost) {
        G.stats.money -= cost;
        m.dead = false; m.deadT = 0;
        spawnMerc(ctx);
        G.tip = def.name + " 归队 -" + cost; G.tipT = 2;
      }
      // 钱不够就一直等着（不永久消失，也不偷偷免费复活）
    }
    return;
  }

  // 2) 场上实体丢了（切图/读档后）：补一个。
  if (!m.unit || G.npcs.indexOf(m.unit) < 0) spawnMerc(ctx);
  if (!m.unit || !G.player) return;

  // 3) 跟随：只在自己没在战斗时才跟（跟着玩家跑会打断正在打的架）。
  const u = m.unit;
  const busy = u.atkT > 0 || (u.ai$ && u.ai$.target && !u.ai$.target.dead);
  if (!busy) {
    const step = followStep(u, G.player, FOLLOW_LEAD, FOLLOW_STOP);
    if (step.move) {
      u.path = null;                       // 跟随用直线目标，不走寻路：
                                           // 伙伴卡墙时由 AI 的游荡兜底，比死等寻路好
      u.moveGoal = { x: step.x, y: step.y };
      u.pathTarget = null;
    } else if (u.moveGoal && !u.target) {
      u.moveGoal = null;
    }
  }

  // 4) 薪水：按周期扣，钱不够就自动遣散（不会出现"欠薪的随从"）。
  m.feeT += dt;
  const due = feesDue(def, m.feeT);
  if (due > 0) {
    m.feeT -= Math.floor(m.feeT / 60) * 60;   // 只保留不足一个周期的余数
    if (G.stats.money < due) {
      dismiss(ctx);
      G.tip = "银两不足，随从已离开"; G.tipT = 3;
    } else {
      G.stats.money -= due;
      G.tip = "随从薪水 -" + due; G.tipT = 2;
    }
  }
}

// 打开/关闭随从面板。
export function toggleMercPanel(ctx, force) {
  const G = ctx.state;
  const want = force == null ? !G.mercPanel : !!force;
  G.mercPanel = want;
  if (want) { G.shop = null; G.savePanel = false; G.waypointPanel = false; G.stashPanel = false; G.smithPanel = false; G.diffPanel = false; }
  return want;
}

// 当前随从信息（UI 用）。
export function mercInfo(ctx) {
  const G = ctx.state;
  const m = G.mercenary;
  if (!m) return null;
  const def = mercById(mercList(ctx), m.defId);
  if (!def) return null;
  const u = m.unit;
  return {
    def, dead: !!m.dead, deadT: m.deadT || 0,
    hp: u ? u.hp : 0, hpMax: u ? u.hpMax : def.hp,
    state: reviveState(m),
    reviveCost: reviveCost(def),
    nextFeeIn: Math.max(0, 60 - (m.feeT || 0)),
  };
}
