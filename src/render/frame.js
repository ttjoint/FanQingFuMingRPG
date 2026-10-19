// 视图层的「取状态」单点。
//
// 背景：render/ 与 input/ 下的绘制/交互函数原先都直接读全局单例 G。
// P5 之后改成「由调用方注入 rt」，于是每个文件都各自抄了一份 stateOf：
//   function stateOf(x) { if (!x) return G; if (x.state) return x.state; return x; }
// 一共 8 份完全相同的副本（input/slots、render 的 dialog-ui/hud/panels/scene-ui/
// shop-ui/tooltip），外加 floatText.js 里第 9 种略有差异的写法。
//
// 副本的问题不只是重复：
//   - 第 9 种写法 `(rt && rt.state) || null` 不回退全局，不传 rt 时**静默什么都不画**，
//     与其余 8 份的行为不一致；
//   - 「rt 还是 g」的判断规则散布在各处，将来若 rt 的形态变化（例如加一层 view ctx），
//     要改 9 个地方，且必然漏掉几个。
//
// 所以收敛到这里，作为唯一实现。调用约定：
//   stateOf(rt)     rt 为运行时上下文对象（有 .state 属性）→ 返回 rt.state
//   stateOf(g)      直接传游戏状态对象 → 原样返回
//   stateOf()/null  回退到当前全局实例（保持 P5 之前的既有行为，启动早期即可绘制）
//
// 判定用「有 state 且是对象」而不是单纯真值：避免有人把 g 上的某个业务字段
// 也叫 state（例如某天加 G.state = {}）时被误判成运行时容器。

import { G } from "../core/state.js";

/**
 * @param {any} x 运行时上下文（rt）或游戏状态（g），可省略
 * @returns {any} 游戏状态对象
 */
export function stateOf(x) {
  if (!x) return G;
  // 运行时上下文：{ state: G, assets, maps, ... }
  if (typeof x === "object" && x.state && typeof x.state === "object") return x.state;
  // 直接是游戏状态
  return x;
}

/**
 * 同 stateOf，但明确「必须由调用方注入」，不回退全局。
 * 用于那些「拿不到状态就不该画」的场景（例如浮动数字），
 * 让"忘记传 rt"变成一个可发现的空结果，而不是悄悄画到全局状态上。
 *
 * @param {any} rt
 * @returns {any|null}
 */
export function stateOfStrict(rt) {
  if (!rt) return null;
  return stateOf(rt);
}
