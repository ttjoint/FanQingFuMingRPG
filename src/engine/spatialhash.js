// 均匀网格空间哈希：把单位近邻查询从 O(n²) 降到 O(n·k)，用于大量单位的分离/避让。
// 纯数据结构，可单测。
export function createSpatialHash(cellSize) {
  const buckets = new Map();
  const key = (cx, cy) => cx + "," + cy;
  return {
    clear() { buckets.clear(); },
    insert(e) {
      const k = key(Math.floor(e.x / cellSize), Math.floor(e.y / cellSize));
      let a = buckets.get(k); if (!a) { a = []; buckets.set(k, a); }
      a.push(e);
    },
    // 返回 (x,y) 半径 r 内所有格子里的对象（可能重复，调用方按需去重）
    query(x, y, r) {
      const out = [];
      const x0 = Math.floor((x - r) / cellSize), x1 = Math.floor((x + r) / cellSize);
      const y0 = Math.floor((y - r) / cellSize), y1 = Math.floor((y + r) / cellSize);
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
        const a = buckets.get(key(cx, cy)); if (a) for (const e of a) out.push(e);
      }
      return out;
    },
    size() { return buckets.size; },
  };
}
