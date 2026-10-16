// 引擎核心：奔跑（精力）门控（纯函数，DOM/状态无关，可在 Node 中测试）。
// 规则：① 精力降到 0 时禁止奔跑，强制走路（左右键都只能用走路速度）；
//       ② 精力仅在实际奔跑移动时消耗，停下即不再消耗；
//       ③ 精力不自动回复——只能靠药水（useEntry）或 NPC/脚本（AddMP）。

// 引擎内置默认移速（像素/秒）；实际取值可由游戏配置 move.walkSpeed / move.runSpeed 提供。
export const WALK_SPEED = 90, RUN_SPEED = 150;

// 精力是否足以奔跑。
export function canRun(stats) { return !!stats && stats.mp > 0; }

// 依据“想要奔跑”与当前精力，返回实际生效的速度与奔跑状态。
// speeds 可选：{ walkSpeed, runSpeed }，缺省时用引擎内置默认。
export function resolveRun(stats, wantRun, speeds) {
  const running = !!wantRun && canRun(stats);
  const walk = (speeds && speeds.walkSpeed != null) ? speeds.walkSpeed : WALK_SPEED;
  const run = (speeds && speeds.runSpeed != null) ? speeds.runSpeed : RUN_SPEED;
  return { running, speed: running ? run : walk };
}

// 一帧奔跑的精力消耗（不越界）。
// 注意：本游戏精力**不自动回复**，只能靠药水（useEntry）或 NPC/脚本（AddMP）。
// 停止奔跑时不应调用本函数（即不掉精力）。
export function tickMp(mp, mpMax, running, drain, dt) {
  if (!running) return mp;
  return Math.max(0, Math.min(mpMax, mp - drain * dt));
}
