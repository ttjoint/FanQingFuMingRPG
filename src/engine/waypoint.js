// 引擎核心：传送点（waypoint）纯逻辑。无 DOM / 无世界坐标依赖。
//
// 为什么需要这个：此前 9 张图之间切换**只能靠 GSP 脚本里写死 gotoMap**，
// 玩家自己无法在已去过的地点之间往返。这意味着"刷图循环"根本不成立——
// 打完一张图只能顺着剧情往下走，回不去，也无法选目标刷。
//
// 传送点模型（assets/waypoints.json）：
//   [{ id, name, map, row, col, act, desc }]
//   - id   ：稳定标识，存档里记录"已解锁"用 id，不要用下标
//   - map  ：maps_index.json 里的地图名
//   - row/col：传送落点（格子坐标）
//   - act  ：章节分组，仅用于 UI 分栏
//
// 解锁状态存在 G.waypoints = { [id]: true }。不存"当前站在哪个传送点"，
// 因为解锁是永久进度、站位是瞬时的。

// 规整传送点定义表。非法项被丢弃而不是抛错（内容文件由编辑器产出）。
export function normalizeWaypoints(list) {
  const out = [];
  const seen = new Set();
  for (const w of Array.isArray(list) ? list : []) {
    if (!w || typeof w !== "object") continue;
    const id = String(w.id == null ? "" : w.id).trim();
    const map = String(w.map == null ? "" : w.map).trim();
    // 没有 id 或地图的传送点无法使用；重复 id 会导致解锁状态串台。
    if (!id || !map || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(w.name == null ? "" : w.name).trim() || id,
      map,
      row: Math.max(0, Math.floor(Number(w.row) || 0)),
      col: Math.max(0, Math.floor(Number(w.col) || 0)),
      act: Math.max(0, Math.floor(Number(w.act) || 0)),
      desc: String(w.desc == null ? "" : w.desc),
    });
  }
  return out;
}

// 按 id 查表，返回 Map 便于 O(1) 访问（编辑器与运行时共用）。
export function waypointTable(list) {
  const m = new Map();
  for (const w of normalizeWaypoints(list)) m.set(w.id, w);
  return m;
}

// 该传送点是否已解锁。unlocked 为 G.waypoints 那种 {id:true} 映射。
export function isUnlocked(unlocked, id) {
  return !!(unlocked && unlocked[id]);
}

// 解锁一个传送点。返回是否发生了状态变化（用于"首次发现"提示与存档标脏）。
// 就地修改 unlocked，因为它在 G 上是长期存活的对象。
export function unlock(unlocked, id) {
  if (!unlocked || !id) return false;
  if (unlocked[id]) return false;
  unlocked[id] = true;
  return true;
}

// 按章节分组，供 UI 分栏渲染。结果按 act 升序、act 内保持定义顺序。
// locked 项也会返回（灰色显示），这样玩家知道"还有地方没去过"。
export function groupByAct(list, unlocked) {
  const acts = new Map();
  for (const w of normalizeWaypoints(list)) {
    const key = w.act;
    if (!acts.has(key)) acts.set(key, []);
    acts.get(key).push({ ...w, unlocked: isUnlocked(unlocked, w.id) });
  }
  return [...acts.keys()].sort((a, b) => a - b).map(act => ({ act, items: acts.get(act) }));
}

// 当前可以传送到的目标（已解锁的）。未解锁的不能选。
export function travelTargets(list, unlocked) {
  return normalizeWaypoints(list).filter(w => isUnlocked(unlocked, w.id));
}

// 能否从 fromId 传到 toId：目标必须已解锁且不能原地传送。
export function canTravel(list, unlocked, toId) {
  const w = waypointTable(list).get(toId);
  if (!w) return false;
  return isUnlocked(unlocked, toId);
}

// 在两格之间找最近的传送点（玩家踩上去即解锁）。
// 返回命中的传送点或 null。用「格」而非像素坐标准入，避免像素化传参。
export function waypointAtCell(list, mapName, row, col) {
  for (const w of normalizeWaypoints(list)) {
    if (w.map !== mapName) continue;
    if (w.row === row && w.col === col) return w;
  }
  return null;
}

// 玩家进入某张图时，判断踩到了哪个传送点并解锁。返回被新解锁的传送点或 null。
export function touchWaypoint(list, unlocked, mapName, row, col) {
  const w = waypointAtCell(list, mapName, row, col);
  if (!w) return null;
  return unlock(unlocked, w.id) ? w : null;
}
