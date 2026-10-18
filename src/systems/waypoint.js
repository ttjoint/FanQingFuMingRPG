// 传送点系统（P4）：踩点解锁 + 传送。
//
// 引擎侧的纯逻辑在 engine/waypoint.js（可 Node 单测），这里只负责：
//   - 玩家落点判定（当前站在哪一格 → 是否踩到传送点）
//   - 真正执行传送（复用 loadMap/setPlayer，与 GSP 的 gotoMap 同一条路径）
//
// 为什么不把解锁塞进 world/map.js 的 loadMap：切图是"进入场景"，玩家坐标要等
// setPlayer 之后才确定；放在这里由 playerTick 每帧判定更准确，也不影响
// 编辑器预览等不经过玩家流程的路径。
import { touchWaypoint, travelTargets, waypointTable, canTravel } from "../engine/waypoint.js";
import { loadMap, setPlayer } from "../world/map.js";
import { worldToCell } from "../engine/iso.js";

// 取当前玩家所在格的传送点定义列表（ctx.assets.waypoints）。
function listOf(ctx) {
  return (ctx.assets && ctx.assets.waypoints) || [];
}

// 每帧调用：玩家站上传送点即解锁。只在新解锁时提示，避免每帧刷屏。
// 返回本次新解锁的传送点（无则 null）。
export function waypointTick(ctx) {
  const G = ctx.state, p = G.player;
  if (!p || p.dead || !G.map || !G.currentMap) return null;
  // 像素 → 格。用与寻路/点击同一套换算，保证"脚下这格"前后一致。
  const c = worldToCell(p.x, p.y);
  if (!c) return null;
  // 同一格不重复判定（省掉每帧查表）。
  const key = G.currentMap + ":" + c.row + "," + c.col;
  if (G._wpCell === key) return null;
  G._wpCell = key;
  // 切图后缓存键自带新地图名，所以不需要额外重置；
  // 但传送到同一格时 key 不变，需在 travelTo 里主动清一次（见下）。
  if (!G.waypoints) G.waypoints = {};
  const w = touchWaypoint(listOf(ctx), G.waypoints, G.currentMap, c.row, c.col);
  if (w) { G.tip = "发现传送点：" + w.name; G.tipT = 2.5; }
  return w;
}

// 管道系统入口：每帧检查踩点。与 gameplaySystems 里其它 system 同签名。
export function waypointSystem(ctx) {
  const G = ctx.state;
  if (G.scene !== "game" || !G.player || G.player.dead) return;
  waypointTick(ctx);
}

// 可传送的目标列表（已解锁）。
export function availableTargets(ctx) {
  const G = ctx.state;
  return travelTargets(listOf(ctx), G.waypoints);
}

// 执行传送。成功返回 true。
// 传送会重载地图（怪物复位、地面物品清空），这是"回城再刷"的语义。
export function travelTo(ctx, id) {
  const G = ctx.state;
  if (!canTravel(listOf(ctx), G.waypoints, id)) return false;
  const w = waypointTable(listOf(ctx)).get(id);
  if (!w) return false;
  // 清掉传送界面自身的状态；场景级状态由 loadMap 统一重置。
  G.waypointPanel = false;
  G._wpCell = null;         // 传送到与当前相同的格时也能重新判定（如原地刷新）
  loadMap(ctx, w.map);
  setPlayer(ctx, w.row, w.col, 4);
  if (G.player) G.player.action = "stand";
  G.tip = "传送至：" + w.name; G.tipT = 2;
  return true;
}

// 打开/关闭传送界面。未解锁任何传送点时不允许打开。
export function togglePanel(ctx, force) {
  const G = ctx.state;
  const want = force == null ? !G.waypointPanel : !!force;
  if (want && !availableTargets(ctx).length) {
    G.tip = "尚未发现任何传送点"; G.tipT = 2;
    return false;
  }
  G.waypointPanel = want;
  G.shop = null;          // 与商店面板互斥，避免两层遮罩叠在一起
  G.savePanel = false;
  return want;
}
