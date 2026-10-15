// 兼容层：运行时状态（G / A / MAPS）现由 runtime/context.js 拥有，这里仅再导出，
// 让既有 `import { G } from ".../core/state.js"` 保持不变，同时状态归属已收敛到上下文。
export { G, A, MAPS } from "../runtime/context.js";
