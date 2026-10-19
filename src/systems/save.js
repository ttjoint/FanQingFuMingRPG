// 存读档（localStorage）。ctx 由调用方注入。
import { VW, VH } from "../core/constants.js";
import { loadMap, setPlayer } from "../world/map.js";
import { placeFree } from "../world/npc.js";
import { preloadChar } from "../core/assets.js";
import { worldToCell } from "../core/utils.js";
import { nearestWalkable } from "../world/pathfinding.js";
import { reindex } from "./inventory.js";
import { closeShop } from "./shop.js";
import { playSound } from "./audio.js";
import { normalizeSave, SAVE_VERSION } from "../content/saveSchema.js";
import { CFG } from "../core/config.js";
import { restartAnim } from "./motion.js";
import { diffNpcAgainst, npcFieldsFromSave, configureSerializer } from "../engine/npcSerialize.js";
import { NPC_SCHEMA } from "../content/npcFields.js";
import { attachAll } from "../engine/ecs.js";
import { UNIT_COMPONENTS } from "../runtime/components.js";
import { openSurface, closeSurface, closeAll } from "./surfaces.js";

// 把游戏具体的 NPC 字段方案注入通用序列化引擎（引擎本身不认识这些字段）。
configureSerializer(NPC_SCHEMA);

export const SAVE_SLOTS = 6;
export const saveKey = i => "gsxy_save_" + i;

// localStorage 在隐私模式 / file:// / 无 DOM 环境下可能抛错，统一包一层。
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
};

export function saveSlotInfo(i) {
  const raw = store.get(saveKey(i));
  if (!raw) return null;
  try { const d = JSON.parse(raw); return { savedAt: d.savedAt, map: d.currentMap, level: d.stats && d.stats.level, money: d.stats && d.stats.money, playTime: d.playTime || 0, name: d.label }; } catch (e) { return null; }
}

export function serializeGame(ctx) {
  const G = ctx.state;
  return {
    schemaVersion: SAVE_VERSION, savedAt: Date.now(), playTime: G.time, label: (G.currentMap || "") + " Lv" + G.stats.level,
    currentMap: G.currentMap,
    player: G.player ? { x: G.player.x, y: G.player.y, dir: G.player.dir } : null,
    stats: { ...G.stats },
    hotbar: JSON.parse(JSON.stringify(G.hotbar)), pack: JSON.parse(JSON.stringify(G.pack)),
    equip: JSON.parse(JSON.stringify(G.equip)),
    skills: G.skills.slice(), skill: G.skill,
    missions: JSON.parse(JSON.stringify(G.missions)), vars: { ...G.vars },
    notes: G.notes.slice(), factions: G.factions.slice(), love: { ...G.love }, vips: { ...G.vips },
    ground: JSON.parse(JSON.stringify(G.ground)),
    difficulty: G.difficulty || "normal",
    npcs: G.npcs.map(n => diffNpc(ctx, n)),
  };
}

// 存档中 NPC 的字段差异 / 还原均为纯逻辑（可单测）：见 engine/npcSerialize.js。
// 字段表集中于 content/npcFields.js，与 makeNPC 共用，避免平行维护。
function diffNpc(ctx, n) {
  const t = (ctx.assets.npcsData || []).find(x => x.id === n.id);
  return diffNpcAgainst(n, t);
}

// 从存档恢复：模板（按 id）+ 存档里覆盖的字段 + 运行时默认。兼容旧的完整快照。
export function npcFromSave(ctx, s) {
  const t = (ctx.assets.npcsData || []).find(x => x.id === s.id) || {};
  const fields = npcFieldsFromSave(t, s);
  return attachAll({
    id: s.id, ...fields,
    x: s.x, y: s.y, dir: s.dir, dead: !!s.dead, action: s.dead ? "die" : "stand", frame: 0, ft: 0,
    target: null, path: null, attackCD: 0, aggro: false, dieT: 0, dmgT: 0, wanderT: 1 + Math.random() * 3, talkT: 0, vx: 0, vy: 0,
  }, UNIT_COMPONENTS);
}

export function deserializeGame(ctx, d) {
  const G = ctx.state;
  d = normalizeSave(d);
  closeShop(ctx);
  closeAll(G); G.script = null; G.cursor = null; G.effects = []; G.fx = []; G.uiFx = null; G.moveMarker = null; G.hold = null;
  G.stats = { ...d.stats };
  G.hotbar = JSON.parse(JSON.stringify(d.hotbar || new Array(9).fill(null)));
  G.hotbar.length = 9; while (G.hotbar.length < 9) G.hotbar.push(null);
  G.pack = JSON.parse(JSON.stringify(d.pack || []));
  G.equip = JSON.parse(JSON.stringify(d.equip || { Wu: null, Jia: null, Shi1: null, Shi2: null }));
  G.skills = (d.skills || (CFG.player.startSkills || [])).slice(); G.skill = d.skill || G.skills[0] || CFG.player.startSkill;
  G.missions = d.missions || {}; G.vars = d.vars || {}; G.notes = d.notes || [];
  G.factions = d.factions || []; G.love = d.love || {}; G.vips = d.vips || {}; G.cursor = null;
  // 难度必须在 loadMap **之前**恢复：loadMap 会按 spawns 重建 NPC，
  // 而 spawnNPC 用的就是此刻 G.difficulty 的倍率。
  // 顺序反了的话，读档后场上会是一批"普通难度数值"的怪。
  G.difficulty = d.difficulty || "normal";
  reindex(G);
  loadMap(ctx, d.currentMap);
  if (!G.map) throw new Error("地图「" + d.currentMap + "」不存在（可能已被编辑器删除/改名）");   // 避免读档后黑屏
  const snaps = d.npcs || [];
  G.npcs = snaps.map(s => npcFromSave(ctx, s));
  G.ground = d.ground ? JSON.parse(JSON.stringify(d.ground)) : [];
  for (const n of G.npcs) preloadChar(n.model, { level: 1 });   // 读档后马上就会看到这些单位
  // 从标题菜单读档时主角对象还不存在（本次会话未开局）：按存档坐标创建主角。
  // 否则没有玩家 → cameraSystem 不运行 → 相机停在 (0,0)，地图被画到屏幕外 → 画面全黑。
  if (d.player && !G.player) {
    const c = worldToCell(d.player.x, d.player.y);
    const t = nearestWalkable(ctx, c.row, c.col) || c;
    setPlayer(ctx, t.row, t.col, d.player.dir || 0);
  }
  if (d.player && G.player) {
    G.player.x = d.player.x; G.player.y = d.player.y; G.player.dir = d.player.dir || 0;
    G.player.path = null; G.player.target = null; G.player.pickup = null; G.player.dead = false;
    // 读档是“从新开始”，必须从头播站立（只设 action 不会重置帧）。
    restartAnim(G.player, "stand");
    G.player.animSpeed = 1; G.player.atkT = 0; G.player.swingT = 0;
    G.player.hitPending = false; G.player.swingTarget = null;
  }
  // 读档后若玩家与某个 NPC 重叠，把 NPC 挤开（兼容旧存档）
  for (const n of G.npcs) if (!n.dead) placeFree(n);
  G.time = d.playTime || 0;
  G.triggerCD = 1.5; G.lastCell = null;
  if (G.player && G.map) {
    G.cam.x = Math.max(G.map.minX, Math.min(G.map.maxX - VW, G.player.x - VW / 2));
    G.cam.y = Math.max(G.map.minY, Math.min(G.map.maxY - VH, G.player.y - VH / 2));
  }
  // 从标题菜单读档后直接进入游戏
  G.scene = "game"; G.savePanel = false; G.pendingEnd = false;
}

export function saveSlot(ctx, i) {
  const G = ctx.state;
  if (!G.player || !G.map) { G.tip = "进入游戏后才能存档"; G.tipT = 2; return false; }
  if (!store.set(saveKey(i), JSON.stringify(serializeGame(ctx)))) { G.tip = "保存失败：存储不可用"; G.tipT = 3; return false; }
  G.tip = "已保存到存档 " + (i + 1); G.tipT = 2; playSound(G, "button_click.wav"); return true;
}

export function loadSlot(ctx, i) {
  const G = ctx.state;
  const raw = store.get(saveKey(i));
  if (!raw) { G.tip = "存档 " + (i + 1) + " 为空"; G.tipT = 2; return false; }
  try { deserializeGame(ctx, JSON.parse(raw)); G.tip = "已读取存档 " + (i + 1); G.tipT = 2; playSound(G, "level_up.wav"); return true; }
  catch (e) { G.tip = "读档失败：" + e; G.tipT = 3; console.error(e); return false; }
}

// 存读档面板“存/读”按钮命中测试
export function saveBtnAt(ctx, x, y) {
  if (!ctx.state.savePanel) return null;
  const w = 460, h = 340, px = (VW - w) / 2, py = 40;
  for (let i = 0; i < SAVE_SLOTS; i++) {
    const sy = py + 52 + i * 44;
    if (y >= sy && y < sy + 30) {
      if (x >= px + 300 && x < px + 348) return { i, act: "save" };
      if (x >= px + 356 && x < px + 404) return { i, act: "load" };
    }
  }
  return null;
}
