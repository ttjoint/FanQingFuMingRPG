// 任务进度同步（收集类任务依据背包数量刷新）。状态 g 由调用方注入。
import { countItem } from "./inventory.js";

export function syncMissions(g, name) {
  const have = countItem(g, name);
  for (const k in g.missions) {
    const m = g.missions[k];
    if (m.type !== 0 || m.target !== name) continue;
    if (m.state === 4) { m.got = have; if (have >= m.need) m.state = 1; }
    else if (m.state === 1 && have < m.need) { m.state = 2; }   // 已交付
  }
}
