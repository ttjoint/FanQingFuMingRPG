// 格子脚本触发器 / 地图直传（由 update() 每帧调用）。运行时上下文 ctx 由调用方注入。
import { worldToCell } from "../core/utils.js";
import { loadMap, setPlayer } from "./map.js";
import { startScript } from "../script/vm.js";

export function checkTriggers(ctx, dt) {
  const G = ctx.state, A = ctx.assets, MAPS = ctx.maps;
  if (G.triggerCD > 0) { G.triggerCD -= dt; return; }
  const p = G.player; if (!p || p.dead || G.script || G.dialog) return;
  const c = worldToCell(p.x, p.y);
  const cell = G.map.cellOf[c.row * G.map.width + c.col];
  if (!cell) return;
  if (!cell.trigger && !cell.map) { G.lastCell = null; return; }
  const key = c.row + "," + c.col;
  if (key === G.lastCell) return;
  G.lastCell = key;
  if (cell.trigger) {
    const s = A.transitions && A.transitions[cell.trigger];
    if (s) { startScript(ctx, s); return; }
  }
  if (cell.map) {
    const tgt = A.mapsIndex && A.mapsIndex[cell.map];
    if (tgt && MAPS[tgt]) {
      loadMap(ctx, tgt);
      const e = MAPS[tgt].entry || [0, 0];
      setPlayer(ctx, e[0], e[1], 0);   // entry = [row, col]
      G.tip = "进入 " + tgt; G.tipT = 2;
    }
  }
}
