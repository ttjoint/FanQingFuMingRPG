// GSP 脚本解释器（generator VM）与对话推进。ctx 由调用方注入。
import { parseGSP, argVal, argStr, argVar, setVar, evalExpr } from "../engine/script/gsp.js";
import { loadMap, setPlayer } from "../world/map.js";
import { spawnByName } from "../world/npc.js";
import { addItem, removeItem, addExp, countItem } from "../systems/inventory.js";
import { syncMissions } from "../systems/missions.js";
import { playBGM, playSound } from "../systems/audio.js";
import { applyBuff } from "../engine/buff.js";
import { npcPickup, npcDrop, dropGround, groundAt } from "../systems/ground.js";
import { warnScript, findNpcByName, warnMissingNpcTemplate } from "./diagnostics.js";
import { openSurface, closeSurface } from "../systems/surfaces.js";

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
    case "CheckMission": {
      // 击杀类任务（type=1）的交付钩子。
      //
      // 为什么需要：任务状态机里 type=0（收集）靠 syncMissions 推进——
      //   4→1（物品够）→2（脚本 RemovePlayerItem 扣掉后自动刷新）。
      // 但 type=1（击杀）没有物品可扣，combat.js 只做 4→1，
      // 之后**没有任何代码能把它推到 2**（实测：构造 state=1 的击杀任务
      // 再杀一只同类怪，state 仍是 1）。后果是脚本 CheckMission 永远读到
      // i==1，走"已交差"分支却不变状态，凡是「前置任务完成才解锁」的
      // 链条全部卡死 —— 学艺2 交不掉 → 学艺3 永不出现 → 主线断在第一章。
      //
      // 原版 GSP 里根本没有 SetMissionDone 之类的命令，所有交付都写在
      // i==1 分支里（Say 对话 + AddPlayerItem 奖励 + exit）。所以"脚本读到
      // i==1 并进入交付分支"本身就是交付完成的信号。这里在读到的这一刻
      // 记下 2，下一次对话就能看到 i==2，与收集类交付后的表现一致。
      const m = G.missions[s(0)];
      if (m) {
        setVar(args[1], m.state, G.vars);
        if (m.type === 1 && m.state === 1) m.state = 2;
      } else {
        setVar(args[1], 4, G.vars);
      }
      return;
    }
    case "GetMissionObjCount": setVar(args[1], G.missions[s(0)] ? G.missions[s(0)].got : 0, G.vars); return;

    case "AddNPC": {
      // 模板不存在时 spawnByName 返回 null（旧行为：静默什么都没发生）。
      // 这是最常见的一类数据错误（名字空白/拼写），必须报出来。
      // 注意：这里直接查 ctx.assets.npcsData，不 import world/npc 的 npcDataByName
      // —— 那会通过 world/map.js → core/constants.js 把 DOM 依赖带进纯逻辑层。
      const nm = s(0);
      const exists = !!(ctx.assets.npcsData || []).find(d => d.name === nm);
      warnMissingNpcTemplate(G, nm, "AddNPC", exists);
      spawnByName(ctx, nm, v(1), v(2));
      return;
    }
    case "DelNPC": {
      // 旧行为：filter 不命中就静默保留，于是漏删的单位会一直留在场上
      // （典型场景：AddNPC 用了带空格的名字，DelNPC 用不带空格的）。
      const nm = s(0);
      const { warn } = findNpcByName(G, nm, "DelNPC");
      if (warn) warnScript(G, warn);
      G.npcs = G.npcs.filter(n => n.name !== nm);
      return;
    }
    case "DelAllNPCInMap": G.npcs = []; return;
    case "ShowNPCTalk": {
      const { npc, warn } = findNpcByName(G, s(0), "ShowNPCTalk");
      if (warn) { warnScript(G, warn); return; }
      npc.talkT = 2; return;
    }
    // SetNPCAttack(name, on?)：设置单位是否会主动攻击（对应实例字段 aggressive）。
    //
    // 原版文档只写了「设置 NPC 是否攻击」，参数个数/含义均未确认，且**全库 0 处调用**。
    // 旧实现是 `case "SetNPCAttack": return;`——假装成功。现在两种情况都明确区分：
    //   - 参数至少两个：按文档最自然的解释实现（on 非 0 即主动攻击）
    //   - 参数不足：报诊断而不是装作没事
    case "SetNPCAttack": {
      const nm = s(0);
      if (args.length < 2) {
        warnScript(G, "SetNPCAttack 需要 2 个参数（单位名, 是否主动攻击），实际 " + args.length + " 个；已忽略");
        return;
      }
      const { npc, warn } = findNpcByName(G, nm, "SetNPCAttack");
      if (warn) { warnScript(G, warn); return; }
      npc.aggressive = !!v(1);
      return;
    }
    // 动态修改某个实例的阵营（实例阵营可变；关系表内置不可改）。
    // SetFaction(name, factionId)：按名称找 NPC（兼容脚本旧习惯），改其 faction。
    case "SetFaction": {
      const { npc, warn } = findNpcByName(G, s(0), "SetFaction");
      if (warn) { warnScript(G, warn); return; }
      npc.faction = s(1); return;
    }

    // ---- NPC 背包：拾取 / 丢弃（供剧本驱动，AI 自动拾取暂不实现）----
    // NPCPickItem(npcName, itemName?)：不传物品名则拾取脚下最近的掉落物。
    case "NPCPickItem": {
      const { npc: n, warn } = findNpcByName(G, s(0), "NPCPickItem");
      if (warn) { warnScript(G, warn); return; }
      const nm = s(1);
      let gr = null;
      for (let i = G.ground.length - 1; i >= 0; i--) {
        const c = G.ground[i];
        if (nm && c.name !== nm) continue;
        if (Math.hypot(c.x - n.x, c.y - n.y) > 48) continue;
        gr = c; break;
      }
      if (!gr) {
        warnScript(G, "NPCPickItem：「" + n.name + "」脚下 48px 内没有" + (nm ? "物品「" + nm + "」" : "掉落物"));
        return;
      }
      npcPickup(ctx, n, gr);
      return;
    }
    // NPCDropItem(npcName, bagIndex?)：不传序号则丢弃背包中最后一格物品。
    case "NPCDropItem": {
      const { npc: n, warn } = findNpcByName(G, s(0), "NPCDropItem");
      if (warn) { warnScript(G, warn); return; }
      const bag = n.bag || [];
      let idx = v(1);
      if (idx == null || idx < 0 || !bag[idx]) { idx = -1; for (let i = bag.length - 1; i >= 0; i--) if (bag[i]) { idx = i; break; } }
      if (idx >= 0) npcDrop(ctx, n, idx);
      else warnScript(G, "NPCDropItem：「" + n.name + "」背包是空的，没有东西可丢");
      return;
    }
    // NPCDropAt(npcName, itemName, count?)：直接把物品丢到 NPC 脚下（不经背包）。
    case "NPCDropAt": {
      const { npc: n, warn } = findNpcByName(G, s(0), "NPCDropAt");
      if (warn) { warnScript(G, warn); return; }
      dropGround(G, { name: s(1), count: v(2) || 1 }, n.x, n.y, { owner: n, from: "npc" });
      return;
    }
    // NPCGiveItem(npcName, itemName, count?)：NPC 交给玩家（进玩家背包）。
    case "NPCGiveItem": {
      addItem(G, s(1), v(2) || 1);
      return;
    }
    // PlayerDropItem(itemName, count?)：玩家丢弃物品到脚下。
    case "PlayerDropItem": {
      const p = G.player; if (!p) return;
      const nm = s(0), ct = v(1) || 1;
      if (countItem(G, nm) < ct) return;
      removeItem(G, nm, ct);
      dropGround(G, { name: nm, count: ct }, p.x, p.y, { owner: p, from: "player" });
      return;
    }
    // 给单位施加 Buff。SetBuff(target, buffId, [stacks])；target="player" 或 NPC 名称。
    case "SetBuff": {
      const id = s(1);
      const def = ctx.assets.buffTable && ctx.assets.buffTable.byId.get(id);
      if (!def) { warnScript(G, "SetBuff 找不到 Buff「" + id + "」"); return; }
      if (s(0) === "player") {
        if (G.player) applyBuff(G.player, def, { stacks: v(2) || 1 });
        else warnScript(G, "SetBuff：玩家尚未就位，无法施加「" + id + "」");
        return;
      }
      const { npc, warn } = findNpcByName(G, s(0), "SetBuff");
      if (warn) { warnScript(G, warn); return; }
      applyBuff(npc, def, { stacks: v(2) || 1 });
      return;
    }

    case "LoadInitialMap": loadMap(ctx, s(0)); setPlayer(ctx, v(1), v(2), v(3)); return;
    case "ChangeMap": {
      // 标记「本次 loadMap 是脚本内部发起的」：loadMap 默认会清 G.script，
      // 但用在这里会把当前 generator 后续的剧情/任务发放全部丢掉。
      const prev = G._inScriptChangeMap;
      G._inScriptChangeMap = true;
      try { loadMap(ctx, s(0)); } finally { G._inScriptChangeMap = prev; }
      setPlayer(ctx, v(1), v(2), v(3)); return;
    }
    case "CmpMapName": setVar(args[1], G.currentMap === s(0).replace(/\.map$/, "") ? 1 : 0, G.vars); return;
    case "GameOver": G.gameOver = true; return;
    case "ShowEnding": G.pendingEnd = true; return;   // 剧本显式结束：切到结局场景（数据驱动，不靠文本关键字）
    case "PlaySound": playSound(G, s(0)); return;   // 音效（失败静默：缺文件不打断剧情）
    case "PlayMusic": playBGM(G, s(0)); return;
    // 下雨。旧实现是 `G.rain = !G.rain;`（**翻转**而非设置），而且全库没有任何
    // 读取 G.rain 的地方——等于一条空指令。脚本里 Rain() 的意图显然是「开始下雨」
    // （战场到扬州.gsp / 龙家庄.gsp 都在「敌军已进城/清兵杀来」的紧张气氛处调用），
    // 所以改成幂等的「设为开」，可带可选参数控制开关。渲染见 render/weather.js。
    case "Rain": G.rain = args.length ? !!v(0) : true; return;
    case "GetRandomNum": setVar(args[0], Math.floor(Math.random() * (v(2) - v(1) + 1)) + v(1), G.vars); return;
    // 未知指令：旧行为是静默 return，于是「脚本写了但引擎没实现」永远没声音。
    // 现在报诊断（原版 25 个脚本里的指令都已覆盖，正常游玩不会触发）。
    default: warnScript(G, "未实现的指令「" + name + "」，已忽略"); return;
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
  openSurface(G, "dialog", { kind: "say", speaker, text, portrait });
  // 结局触发改为剧本显式命令 ShowEnding（数据驱动），不再扫描文本。
}
export function openAsk(ctx, speaker, text, portrait) {
  const G = ctx.state;
  G.tip = null; G.tipT = 0;
  openSurface(G, "dialog", { kind: "ask", speaker, text, portrait });
}
export function stepScript(ctx, val) {
  const G = ctx.state;
  if (!G.script) return;
  let r;
  try { r = G.script.next(val); }
  catch (e) { if (e !== EXIT) console.error(e); G.script = null; closeSurface(G, "dialog"); return; }
  if (r.done) { G.script = null; closeSurface(G, "dialog"); return; }
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
  closeSurface(G, "dialog");
  stepScript(ctx, a);
}
