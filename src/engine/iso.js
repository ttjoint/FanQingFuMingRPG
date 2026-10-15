// 引擎核心：等距坐标换算与方向（纯函数，不依赖 DOM / 全局状态，可在 Node 中测试）。
// 运行时通过 core/utils.js 再导出，保持既有 import 不变（过渡层）。

export function cellCenter(row, col) { return { x: 1568 + 32 * (row - col), y: 16 * (row + col) + 16 }; }

export function worldToCell(x, y) {
  const sum = (y - 16) / 16, diff = (x - 1568) / 32;
  return { row: Math.round((sum + diff) / 2), col: Math.round((sum - diff) / 2) };
}

// 在一个格子的菱形范围内取一个随机点（用于 NPC 走到格内任意位置）。
export function randomPointInCell(row, col, rnd = Math.random) {
  const c = cellCenter(row, col);
  let dx, dy;
  do { dx = (rnd() * 2 - 1) * 30; dy = (rnd() * 2 - 1) * 14; }
  while (Math.abs(dx) / 32 + Math.abs(dy) / 16 > 0.85);   // 限制在菱形内部，避免贴边
  return { x: c.x + dx, y: c.y + dy };
}

// 方向：引擎方向 0=南(面向镜头)，顺时针到 7；pmg 的帧块从“背向”开始，所以要 +4。
export function dirFromVec(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  let a = Math.atan2(dx, dy);              // 0=下(南)，顺时针
  let d = Math.round(a / (Math.PI / 4));
  d = ((d % 8) + 8) % 8;                   // 0=南,2=东,4=北,6=西
  return ((4 - d) % 8 + 8) % 8;            // 帧块下标：0=北,2=东,4=南,6=西
}
