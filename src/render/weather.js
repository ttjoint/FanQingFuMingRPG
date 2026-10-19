// 天气效果：雨。由脚本指令 Rain() 打开（vm.js），只影响渲染。
//
// 实现要点：
//   - 雨滴位置**不存进 G**。G 是要存档的运行时状态，几百个雨滴既不需要存、
//     也不该存（读档后雨滴位置毫无意义）。所以这里用模块内闭包持有一份粒子池，
//     切图/重置时调用 resetWeather() 清掉。
//   - 粒子只算一次随机种子，之后每帧按 dt 前推并环绕（mod 高度），
//     因此没有分配、没有数组增长，开销稳定。
//   - 用 requestAnimationFrame 无关的纯函数推进（stepRain(dt)），
//     便于单测直接给定 dt 断言行为，不依赖真实时间。
//   - 画在「所有单位之上、HUD 之下」：雨在镜头里，但不应遮住血条/技能栏。

const DROPS = 220;
// 每滴：x/y 为**屏幕坐标**（雨是镜头效果，不跟世界走），len 长度、v 下落速度、a 透明度。
let pool = null;
let tint = 0;   // 暗化程度（0..1），下雨时略微压暗画面

function makePool(w, h) {
  const p = new Array(DROPS);
  for (let i = 0; i < DROPS; i++) {
    p[i] = {
      x: Math.random() * w,
      y: Math.random() * h,
      len: 8 + Math.random() * 10,       // 8..18px 雨丝
      v: 320 + Math.random() * 240,      // 320..560 px/s
      a: 0.18 + Math.random() * 0.24,    // 透明雨丝，不糊住画面
    };
  }
  return p;
}

export function resetWeather() {
  pool = null;
  tint = 0;
}

// 推进雨滴。dt 秒。返回是否处于下雨状态（供渲染决定要不要画）。
export function stepRain(dt, g, w, h) {
  if (!g || !g.rain) {
    // 淡出：雨停后 0.4s 内把暗化退回 0，避免画面亮度突变
    if (tint > 0) tint = Math.max(0, tint - dt / 0.4);
    return false;
  }
  if (!pool) pool = makePool(w, h);
  // 暗化淡入（0.4s），与淡出对称
  tint = Math.min(1, tint + dt / 0.4);
  const d = Math.min(dt, 0.1);   // 卡帧保护：单帧最多推 0.1s，避免雨丝瞬移
  for (const r of pool) {
    r.y += r.v * d;
    r.x -= r.v * d * 0.16;        // 略微斜向（风）
    if (r.y > h + r.len) {        // 到底部：回到顶部并重新随机 x（避免同一竖线循环）
      r.y = -r.len;
      r.x = Math.random() * (w + 80) - 80;
    }
    if (r.x < -80) r.x += w + 80;
  }
  return true;
}

// 绘制雨。camX/camY 不参与（雨是屏幕空间效果）。
// ctx 由调用方给（已 setTransform 到屏幕坐标系）。
export function drawRain(ctx, g, w, h) {
  if (!g || !g.rain || !pool || tint <= 0) return;
  ctx.save();
  // 1) 整体压暗 + 偏冷的色调：让"下雨"与"晴天"一眼能分辨
  if (tint > 0) {
    ctx.fillStyle = "rgba(24,38,58," + (0.22 * tint).toFixed(3) + ")";
    ctx.fillRect(0, 0, w, h);
  }
  // 2) 雨丝。统一描边样式，逐段画短线（不用 beginPath per drop 的额外开销可忽略：
  //    220 段在一个 path 里批量描边）
  ctx.strokeStyle = "rgba(200,225,255,1)";
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  const alpha = 0.55 * tint;
  // 按透明度分两批（不同 alpha 只能分开 strokeStyle），减少状态切换
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    for (const r of pool) {
      const bright = r.a > 0.3;
      if (bright !== (pass === 0)) continue;
      const dy = r.len;
      const dx = -r.len * 0.16;
      ctx.moveTo(r.x, r.y);
      ctx.lineTo(r.x + dx, r.y + dy);
    }
    ctx.strokeStyle = "rgba(205,228,255," + (alpha * (pass === 0 ? 1 : 0.6)).toFixed(3) + ")";
    ctx.stroke();
  }
  ctx.restore();
}

// 测试/调试用：当前粒子数
export function rainDropCount() { return pool ? pool.length : 0; }
