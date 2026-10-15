// 存档 schema 与迁移（纯函数，可单测）。
// 约定：存档结构变更时 SAVE_VERSION +1，并在 MIGRATIONS 里补一个 from→to 的函数。
// 按项目约定，测试期的旧存档无需兼容；此处主要提供版本戳、缺字段补齐与迁移骨架。
export const SAVE_VERSION = 4;

const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const obj = v => (isObj(v) ? { ...v } : {});
const arr = v => (Array.isArray(v) ? v.slice() : []);

const STATS_DEFAULT = { hp: 0, hpMax: 0, mp: 0, mpMax: 0, exp: 0, expNext: 0, level: 1, money: 0, moral: 0, honor: 0, attack: 0, defence: 0, hit: 0 };
const EQUIP_DEFAULT = { Wu: null, Jia: null, Shi1: null, Shi2: null };

// 后续迁移函数：MIGRATIONS[fromVersion] = save => save（升 1 版）
const MIGRATIONS = {};

export function migrateSave(save) {
  let from = num(save.schemaVersion, num(save.v, 1));
  if (from > SAVE_VERSION) throw new Error("存档版本(" + from + ") 高于当前(" + SAVE_VERSION + ")，请升级游戏");
  let s = save;
  while (from < SAVE_VERSION) { const m = MIGRATIONS[from]; s = m ? m(s) : s; from += 1; }
  return s;
}

export function normalizeSave(d) {
  if (!isObj(d)) throw new Error("无效的存档数据");
  const s = migrateSave(d);
  const hotbar = arr(s.hotbar); while (hotbar.length < 9) hotbar.push(null); hotbar.length = 9;
  return {
    schemaVersion: SAVE_VERSION,
    savedAt: num(s.savedAt, 0),
    playTime: num(s.playTime, 0),
    label: typeof s.label === "string" ? s.label : "",
    currentMap: typeof s.currentMap === "string" ? s.currentMap : "",
    player: isObj(s.player) ? { x: num(s.player.x, 0), y: num(s.player.y, 0), dir: num(s.player.dir, 0) } : null,
    stats: Object.assign({}, STATS_DEFAULT, obj(s.stats)),
    hotbar,
    pack: arr(s.pack),
    equip: Object.assign({}, EQUIP_DEFAULT, obj(s.equip)),
    skills: arr(s.skills),
    skill: typeof s.skill === "string" ? s.skill : "",
    missions: obj(s.missions), vars: obj(s.vars),
    notes: arr(s.notes), factions: arr(s.factions), love: obj(s.love), vips: obj(s.vips),
    ground: arr(s.ground), npcs: arr(s.npcs),
  };
}
