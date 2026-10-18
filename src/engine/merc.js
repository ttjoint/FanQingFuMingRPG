// 雇佣兵（随从）：纯逻辑，无 DOM。
//
// 为什么需要：现在玩家永远是孤身一人。暗黑类的"带一个伙伴"不只是数值加成，
// 它改变了战斗节奏——有人帮你挡一下，走位才有意义。
//
// 设计取舍：
//   - 雇佣兵**不是**新的实体类型，就是一个 friendly 的 NPC 实例，
//     挂在 G.mercenary 上。这样 AI/寻路/动画/伤害结算全部复用，
//     不需要为它写第二套战斗逻辑。
//   - 招募 = 一次性花钱；之后按时间扣薪水（金币有持续去处，
//     和铁匠的三个出口互补：赌/鉴/修是一次性，薪水是持续的）。
//   - 死掉不会永久消失（暗黑里会"回去等你赎"），否则玩家会因为一次失误
//     丢掉几百金币的投入而读档。这里简化成：死后冷却一段时间自动复活，
//     但要重新付一次复活的费用。
//   - 跟随用"离主人太远就靠过来"的简单逻辑，不做队列/编队——
//     在有寻路的 2D 场景里，编队只会让伙伴卡在墙边。

// 招募列表（内置）。id 稳定，存档记 id。
export const MERCENARIES = [
  { id: "swordsman", name: "护卫", model: "role2", hp: 180, atk: 14, def: 8, speed: 105, range: 46, cd: 1.1, fee: 25, price: 200 },
  { id: "archer", name: "弓手", model: "role3", hp: 110, atk: 20, def: 4, speed: 100, range: 190, cd: 1.4, fee: 35, price: 320 },
];

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : (d == null ? 1 : d); };

// 归一化一条雇佣兵定义。
export function normalizeMerc(m) {
  const o = m || {};
  const pos = (v, d) => Math.max(0, num(v, d));
  return {
    id: String(o.id || "").trim() || "merc",
    name: String(o.name || o.id || "随从"),
    model: String(o.model || "role2"),
    hp: Math.max(1, pos(o.hp, 100)),
    atk: pos(o.atk, 10),
    def: pos(o.def, 0),
    speed: Math.max(10, pos(o.speed, 100)),
    range: Math.max(1, pos(o.range, 46)),
    cd: Math.max(0.05, pos(o.cd, 1.1)),
    fee: pos(o.fee, 0),           // 每 X 秒扣的薪水
    price: pos(o.price, 0),       // 招募一次性费用
    desc: o.desc != null ? String(o.desc) : "",
  };
}

// 归一化列表。空表退回内置；按 id 去重。
export function normalizeMercs(list) {
  const src = Array.isArray(list) && list.length ? list : MERCENARIES;
  const seen = new Set();
  const out = [];
  for (const m of src) {
    const n = normalizeMerc(m);
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    out.push(n);
  }
  return out.length ? out : MERCENARIES.map(normalizeMerc);
}

export function mercById(list, id) {
  const arr = normalizeMercs(list);
  return arr.find(m => m.id === id) || null;
}

// ---- 薪水 ----
// 薪水周期（秒）。按时间扣而不是按"每次进图扣"，因为玩家可能一直在同一张图刷。
export const FEE_PERIOD = 60;

// 该发多少薪水了。返回应扣金额（0 = 还不到周期）。
export function feesDue(merc, sinceSec) {
  const period = FEE_PERIOD;
  const n = Math.floor(Math.max(0, sinceSec) / period);
  return n * Math.max(0, num(merc && merc.fee, 0));
}

// 剩余多少秒到下个周期（UI 显示用）。
export function nextFeeIn(sinceSec) {
  const period = FEE_PERIOD;
  const s = Math.max(0, num(sinceSec, 0));
  return period - (s % period);
}

// ---- 复活 ----
// 死后多久可以复活（秒）。比招募冷却短，避免"失误一次等半天"。
export const REVIVE_DELAY = 20;
// 复活费用 = 招募价的一部分。
export const REVIVE_RATE = 0.3;

export function reviveCost(merc) {
  const price = Math.max(0, num(merc && merc.price, 0));
  return Math.max(1, Math.ceil(price * REVIVE_RATE));
}

// 死亡状态推进。返回 'alive' | 'waiting' | 'ready'。
// dead 时 t 为已等待秒数。
export function reviveState(merc) {
  if (!merc) return "alive";
  if (!merc.dead) return "alive";
  const t = num(merc.deadT, 0);
  return t >= REVIVE_DELAY ? "ready" : "waiting";
}

// ---- 跟随 ----
// 主人走远就靠过来。lead = 允许的自由活动半径；
// 超过 lead 就追，追到 lead*0.6 以内就停（滞回，避免在边界反复启停）。
export const FOLLOW_LEAD = 140;
export const FOLLOW_STOP = 84;

// 是否需要移动，以及朝哪。返回 { move: bool, x, y }。
export function followStep(merc, owner, lead, stop) {
  if (!merc || !owner) return { move: false, x: 0, y: 0 };
  const L = num(lead, FOLLOW_LEAD), S = num(stop, FOLLOW_STOP);
  const dx = num(owner.x, 0) - num(merc.x, 0);
  const dy = num(owner.y, 0) - num(merc.y, 0);
  const d = Math.hypot(dx, dy);
  if (d <= L) return { move: false, x: 0, y: 0 };
  // 目标点：主人身边 stop 距离处（不是主人脚下，避免叠在主人身上）
  const k = d > 0 ? (d - S) / d : 0;
  return { move: true, x: num(merc.x, 0) + dx * k, y: num(merc.y, 0) + dy * k, dist: d };
}

// 能否招募：钱够、还没有随从。
export function canHire(merc, money, current) {
  if (!merc) return { ok: false, reason: "没有这个随从" };
  if (current) return { ok: false, reason: "已经有随从了" };
  const price = Math.max(0, num(merc.price, 0));
  if (num(money, 0) < price) return { ok: false, reason: "银两不足" };
  return { ok: true, reason: "", cost: price };
}
