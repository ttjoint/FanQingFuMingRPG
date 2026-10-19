// 每帧更新：场景级流程（片头/结局/阵亡返回）+ 玩法系统管道（见 systems/gameplay.js）。
import { createPipeline } from "../engine/pipeline.js";
import { gameplaySystems } from "./gameplay.js";
import { updateAnim } from "./motion.js";
import { getRuntime } from "../runtime/context.js";
import { enterMenu, showEnding, flashPics, flashDurations, pageIdOf } from "./scene.js";

// 主角倒下后停留多久（秒）再回到主菜单，留出倒地动画与提示的显示时间。
const DEATH_RETURN_DELAY = 1.8;

// 玩法系统管道（顺序见 gameplaySystems）；ctx 为运行时上下文。
const gameplay = createPipeline(gameplaySystems);
const runtime = getRuntime();
const G = runtime.state;   // 场景级流程仍读状态；经上下文获取（非直接全局单例）

export function update(dt) {
  G.time += dt;
  if (G.tipT > 0) G.tipT -= dt;
  // 片头闪屏：逐张推进，时长来自页面文档（缺省回退 game.json，再缺省 2 秒）。
  if (pageIdOf(G.scene) === "flash") {
    G.flashT += dt;
    const n = flashPics(runtime).length;
    if (!n) { enterMenu(runtime); return; }   // 没有任何图片：直接进标题，不卡在黑屏
    const durs = flashDurations(runtime);
    const dur = durs[Math.min(G.flashStep, durs.length - 1)] || 2;
    if (G.flashT > dur) { if (G.flashStep < n - 1) { G.flashStep++; G.flashT = 0; } else enterMenu(runtime); }
    return;
  }
  if (G.scene !== "game") return;
  // 结局对白说完了：切到结局场景（end.png + 评价称号）
  if (G.pendingEnd && !G.dialog && !G.script) { G.pendingEnd = false; showEnding(runtime); return; }
  if (G.gameOver) return;

  const p = G.player;
  // 主角死亡：先播完倒地动画，随后自动回到标题主菜单。
  if (p && p.dead) {
    G.deathT += dt;
    updateAnim(p, dt, runtime.assets.chars);
    for (const n of G.npcs) updateAnim(n, dt, runtime.assets.chars);
    if (G.deathT >= DEATH_RETURN_DELAY) enterMenu(runtime, { music: true });
    return;
  }

  gameplay.run(runtime, dt);
}
