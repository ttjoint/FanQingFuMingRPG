// GSP 脚本解释器（generator VM）与对话推进。ctx 由调用方注入。
import { parseGSP, argVal, argStr, argVar, setVar, evalExpr } from "../engine/script/gsp.js";
import { loadMap, setPlayer } from "../world/map.js";
import { spawnByName } from "../world/npc.js";
import { addItem, removeItem, addExp } from "../systems/inventory.js";
import { syncMissions } from "../systems/missions.js";
import { playBGM } from "../systems/audio.js";

// 脚本生成器遇到 end/exit 时抛出的哨兵。
export const EXIT = { exit: true };

export function* execBlock(ctx, nodes) {
  for (const n of nodes) {
    if (n.type === "call") { yield* execCall(ctx, n.name, n.args); if (n.name === "exit") throw EXIT; }
    else if (n.type === "if") {
      if (evalExpr(n.cond, ctx.state.vars)) yield* execBlock(ctx, n.then);
      else if (n.else) yield* execBlock(ctx, n.else);
    }
  }
}

export function* execCall(ctx, name, args) {
  const G = ctx.state, A = ctx.assets;
  const v = i => argVal(args[i], G.vars), s = i => argStr(args[i]);
  switch (name) {
    case "end": case "exit": throw EXIT;

    case "Say":
      yield { type: "say", speaker: s(0), text: s(1), portrait: s(2) }; return;
    case "Ask": {
      const ans = yield { type: "ask", speaker: s(0), text: s(1), portrait: s(2) };
      setVar(args[3], ans, G.vars); return;
    }
    case "ShowTip": G.tip = s(0); G.tipT = 4; return;
    case "SetInt": G.vars[argVar(args[0])] = v(1); return;
    case "GetMoney": setVar(args[0], G.stats.money, G.vars); return;
    case "GetMoral": setVar(args[0], G.stats.moral, G.vars); return;
    case "GetGirlLove": setVar(args[1], G.love[s(0)] || 0, G.vars); return;
    case "GetVIPInfo": setVar(args[1], G.vips[s(0)] || 0, G.vars); return;
    case "SetVIPInfo": G.vips[s(0)] = v(1); return;
    case "AddNote": if (!G.notes.includes(s(0))) G.notes.push(s(0)); return;

    case "AddMoney": G.stats.money += v(0); return;
    case "SubMoney": G.stats.money = Math.max(0, G.stats.money - v(0)); return;
    case "AddHP": G.stats.hp = Math.min(G.stats.hpMax, G.stats.hp + v(0)); return;
    case "SubHP": G.stats.hp = Math.max(0, G.stats.hp - v(0)); return;
    case "AddMP": G.stats.mp = Math.min(G.stats.mpMax, G.stats.mp + v(0)); return;
    case "SubMP": G.stats.mp = Math.max(0, G.stats.mp - v(0)); return;
    case "AddHPLimit": G.stats.hpMax += v(0); G.stats.hp += v(0); return;
    case "SubHPLimit": G.stats.hpMax = Math.max(1, G.stats.hpMax - v(0)); return;
    case "AddMPLimit": G.stats.mpMax += v(0); G.stats.mp += v(0); return;
    case "SubMPLimit": G.stats.mpMax = Math.max(0, G.stats.mpMax - v(0)); return;
    case "AddAttack": G.stats.attack += v(0); return;
    case "SubAttack": G.stats.attack = Math.max(0, G.stats.attack - v(0)); return;
    case "AddDefence": G.stats.defence += v(0); return;
    case "SubDefence": G.stats.defence = Math.max(0, G.stats.defence - v(0)); return;
    case "AddHitRate": G.stats.hit += v(0); return;
    case "SubHitRate": G.stats.hit = Math.max(0, G.stats.hit - v(0)); return;
    case "AddExp": addExp(G, v(0)); return;
    case "SubExp": G.stats.exp = Math.max(0, G.stats.exp - v(0)); return;
    case "AddMoral": G.stats.moral += v(0); return;
    case "SubMoral": G.stats.moral = Math.max(0, G.stats.moral - v(0)); return;
    case "AddHonor": G.stats.honor += v(0); return;

    case "AddPlayerItem": addItem(G, s(0), v(1)); return;
    case "RemovePlayerItem": removeItem(G, s(0), v(1)); return;
    case "AddSkill": if (!G.skills.includes(s(0))) { G.skills.push(s(0)); G.skill = s(0); } return;
    case "RemoveSkill": G.skills = G.skills.filter(k => k !== s(0)); return;
    case "AddFaction": if (!G.factions.includes(s(0))) G.factions.push(s(0)); return;
    case "RemoveFaction": G.factions = G.factions.filter(f => f !== s(0)); return;
    case "AddGirlLove": G.love[s(0)] = (G.love[s(0)] || 0) + v(1); return;
    case "SubGirlLove": G.love[s(0)] = (G.love[s(0)] || 0) - v(1); return;

    case "AddMission": {
      const nm = s(0);
      if (!G.missions[nm]) G.missions[nm] = { name: nm, desc: s(1), type: v(2), target: s(3),
        need: v(4), got: 0, state: 4 };
      // 收集类任务（type=0）：接取时立即结算玩家背包里已有的物品，
      // 否则先有猴皮再接任务时 got 会停在 0，必须再拾取一次才会刷新。
      if (v(2) === 0) syncMissions(G, s(3));
      return;
    }
    case "CheckMission": setVar(args[1], G.missions[s(0)] ? G.missions[s(0)].state : 4, G.vars); return;
    case "GetMissionObjCount": setVar(args[1], G.missions[s(0)] ? G.missions[s(0)].got : 0, G.vars); return;

    case "AddNPC": spawnByName(ctx, s(0), v(1), v(2)); return;
    case "DelNPC": G.npcs = G.npcs.filter(n => n.name !== s(0)); return;
    case "DelAllNPCInMap": G.npcs = []; return;
    case "ShowNPCTalk": { const n = G.npcs.find(x => x.name === s(0)); if (n) n.talkT = 2; return; }
    case "SetNPCAttack": return;

    case "LoadInitialMap": loadMap(ctx, s(0)); setPlayer(ctx, v(1), v(2), v(3)); return;
    case "ChangeMap": loadMap(ctx, s(0)); setPlayer(ctx, v(1), v(2), v(3)); return;
    case "CmpMapName": setVar(args[1], G.currentMap === s(0).replace(/\.map$/, "") ? 1 : 0, G.vars); return;
    case "GameOver": G.gameOver = true; return;
    case "PlaySound": return;    // TODO: 音频
    case "PlayMusic": playBGM(G, s(0)); return;
    case "Rain": G.rain = !G.rain; return;
    case "GetRandomNum": setVar(args[0], Math.floor(Math.random() * (v(2) - v(1) + 1)) + v(1), G.vars); return;
    default: return;             // 未实现的指令静默忽略
  }
}

// ---- 脚本驱动 / 对话 ----
export function startScript(ctx, name) {
  const G = ctx.state, A = ctx.assets;
  if (G.script) return;
  const src = A.scripts[name]; if (!src) { console.warn("no script", name); return; }
  G.tip = null; G.tipT = 0; for (const n of G.npcs) n.talkT = 0;
  G.script = execBlock(ctx, parseGSP(src));
  stepScript(ctx);
}
export function openSay(ctx, speaker, text, portrait) {
  const G = ctx.state;
  G.tip = null; G.tipT = 0;
  for (const n of G.npcs) n.talkT = 0;
  G.dialog = { kind: "say", speaker, text, portrait };
  // 终幕对白（陈近南.gsp 最后一句）带“游戏结束”标记：说完后切到结局场景。
  if (text && text.indexOf("游戏结束") >= 0) G.pendingEnd = true;
}
export function openAsk(ctx, speaker, text, portrait) {
  const G = ctx.state;
  G.tip = null; G.tipT = 0;
  G.dialog = { kind: "ask", speaker, text, portrait };
}
export function stepScript(ctx, val) {
  const G = ctx.state;
  if (!G.script) return;
  let r;
  try { r = G.script.next(val); }
  catch (e) { if (e !== EXIT) console.error(e); G.script = null; G.dialog = null; return; }
  if (r.done) { G.script = null; G.dialog = null; return; }
  const a = r.value;
  if (a.type === "say") openSay(ctx, a.speaker, a.text, a.portrait);
  else if (a.type === "ask") openAsk(ctx, a.speaker, a.text, a.portrait);
  else stepScript(ctx);
}
export function advanceDialog(ctx, ans) {
  const G = ctx.state;
  if (!G.dialog) return;
  if (G.dialog.kind === "ask" && ans === undefined) return;
  const a = G.dialog.kind === "ask" ? ans : undefined;
  G.dialog = null;
  stepScript(ctx, a);
}
