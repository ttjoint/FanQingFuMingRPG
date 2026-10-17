// 引擎核心：弹道（projectile）纯逻辑。无 DOM 依赖，可在 Node 中测试。
//
// 设计（阶段 B）：
//  - 弹道只是一个“会飞的命中触发器”：从 (x,y) 飞向目标点，抵达或超时后触发 resolveHit。
//  - 伤害/命中的判定**完全复用 combat.resolveHit**，本模块不碰伤害逻辑。
//  - 飞行过程支持“追踪目标”（homing）与“直线”（linear）两种；中途可被目标闪避（miss）。
//
// 数据（skill.projectile，经 normalizeProjectile 规整）：
//   { speed?: number, radius?: number, homing?: boolean, frames?: string[], hitFrames?: number }
//   - speed   飞行速度（像素/秒），默认 320
//   - radius  命中半径（像素），默认 18
//   - homing  true = 追踪目标（目标移动则转向）；false = 直线飞向出手点
//   - frames  飞行动画帧（assets/projectile/*.png）；空则用默认圆点
//   - pierce  穿透数（0 = 命中即消失）

export const DEFAULT_PROJ = {
  speed: 320,
  radius: 18,
  homing: true,
  frames: [],
  pierce: 0,
};

// 规整一个 projectile 配置（技能数据里可缺省）。
export function normalizeProjectile(p) {
  if (!p || typeof p !== "object") return null;
  const o = {};
  o.speed = typeof p.speed === "number" ? p.speed : DEFAULT_PROJ.speed;
  o.radius = typeof p.radius === "number" ? p.radius : DEFAULT_PROJ.radius;
  o.homing = p.homing === undefined ? DEFAULT_PROJ.homing : !!p.homing;
  o.pierce = typeof p.pierce === "number" ? p.pierce : DEFAULT_PROJ.pierce;
  o.frames = Array.isArray(p.frames) ? p.frames.map(String) : [];
  o.hitFrames = typeof p.hitFrames === "number" ? p.hitFrames : 0;
  return o;
}

// 创建一个飞行中的弹道实例（纯数据，不含渲染引用）。
//  target 仅用于追踪与命中判定；调用方需保证 attacker/target 有效。
export function makeProjectile(attacker, target, sk, proj, opts) {
  const o = opts || {};
  const p = proj || DEFAULT_PROJ;
  const tx = target ? target.x : (o.x || attacker.x);
  const ty = target ? target.y : (o.y || attacker.y);
  return {
    x: attacker.x, y: attacker.y,
    sx: attacker.x, sy: attacker.y,       // 出手点（直线弹道的终点）
    tx, ty,                                // 当前追踪点
    target: target || null,
    attacker,
    skill: sk,
    params: o.params || {},
    speed: p.speed, radius: p.radius, homing: p.homing,
    frames: p.frames, frame: 0, ft: 0,
    pierce: p.pierce, hits: [],
    life: o.life === undefined ? 4 : o.life,   // 最长存活时间（秒），防呆
    dead: false,
    onHit: o.onHit || null,                     // (ctx, proj, victim) => void，用于穿透时逐个结算
  };
}

// 推进一帧。返回本帧命中的目标数组（可能为空）。
//   ctx.api:
//     - dist(a, b)        计算两点距离
//     - canHit(proj, u)   该单位是否可被此弹道命中（阵营/存活判定，由运行时注入）
//     - units()           需要参与命中判定的单位列表（不含发射者）
//   这样引擎保持“无阵营/无状态”依赖，便于单测。
export function stepProjectile(proj, dt, ctx) {
  if (proj.dead) return [];
  proj.life -= dt;
  if (proj.life <= 0) { proj.dead = true; return []; }
  if (proj.frames && proj.frames.length) { proj.ft += dt * 12; while (proj.ft >= 1) { proj.ft -= 1; proj.frame = (proj.frame + 1) % proj.frames.length; } }

  // 追踪点：homing 时跟随目标当前位置
  if (proj.homing && proj.target && !proj.target.dead) { proj.tx = proj.target.x; proj.ty = proj.target.y; }
  const dx = proj.tx - proj.x, dy = proj.ty - proj.y;
  const d = Math.hypot(dx, dy);
  const step = proj.speed * dt;

  const hits = [];
  // 抵达判定：这一步能覆盖到追踪点（或已非常接近）
  const reach = step >= d;
  const nx = reach ? proj.tx : proj.x + dx / d * step;
  const ny = reach ? proj.ty : proj.y + dy / d * step;
  proj.x = nx; proj.y = ny;

  // 命中检测：路径上任意可命中单位进入 radius 即命中。
  //
  // 注意 **reach 时必须放宽判定**：投射物按 speed*dt 逐帧步进，到达追踪点前
  // 最后一帧的步长可能整段跨过目标；而目标半径（radius）通常只有 ~20px。
  // 若仍用严格 radius 判定，投射物会在距目标 24px 处 reach 结束、判定不中——
  // 表现就是"远程怪一直放技能但永远打不到人"。因此 reach 时把命中容差放宽到
  // max(radius, step + radius)（即这最后一步扫过的整段半径）。
  const units = ctx.units ? ctx.units() : [];
  const reachTol = reach ? Math.max(proj.radius, step + proj.radius) : proj.radius;
  for (const u of units) {
    if (proj.hits.indexOf(u) >= 0) continue;
    if (ctx.canHit && !ctx.canHit(proj, u)) continue;
    const dd = ctx.dist ? ctx.dist(proj, u) : Math.hypot(proj.x - u.x, proj.y - u.y);
    if (dd <= reachTol) {
      hits.push(u); proj.hits.push(u);
      if (proj.pierce <= 0) { proj.dead = true; return hits; }
      proj.pierce--;
    }
  }
  if (reach) proj.dead = true;   // 追到终点（无论是否命中）结束
  return hits;
}

// 判断弹道是否已到期（供运行时清理）。
export function isDone(proj) { return !!proj.dead; }
