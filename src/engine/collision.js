// 引擎核心：单位椭圆足迹的重叠判定（纯函数，DOM/状态无关）。
// 等距投影下单位足迹为椭圆（横半径 rx、纵半径约 rx/2），重叠即两椭圆相交。

export function ellipsesOverlap(ax, ay, arx, ary, bx, by, brx, bry) {
  const dx = (ax - bx) / (arx + brx);
  const dy = (ay - by) / (ary + bry);
  return dx * dx + dy * dy < 1;
}
