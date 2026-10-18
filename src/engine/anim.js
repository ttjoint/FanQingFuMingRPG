// 逐帧动画的原语（纯逻辑，无 DOM / 无全局状态）。
//
// 为什么单独抽出来：这两个函数是「动画看起来对不对」的全部依据，
// 而它们原本住在 systems/motion.js 里——那个模块经 core/utils.js 间接依赖
// core/constants.js（会在模块顶层去取画布元素），在 Node 里根本 import 不了。
// 结果就是：动画 bug 只能靠肉眼看，或者跑到浏览器里手测。
//
// 这里的语义区别很容易搞混，而且搞混了就会出真 bug：
//   setAnim     —— 「切到某动作」，**只在动作变化时**才从头播。
//                  适合每帧调用（setAnim(p,"walk") 每帧调，不能每帧重置帧）。
//   restartAnim —— 「强制从头播该动作」，即使当前已经是它。
//                  用在必须重新起手的场合：再砍一刀、读档、传送、复活。

/**
 * 切到 action a；仅当动作变化时从头播。
 * @param {any} e 实体（需有 action/frame/ft）
 * @param {string} a 动作名
 * @returns {boolean} 是否发生了动作切换
 */
export function setAnim(e, a) {
  if (!e || e.action === a) return false;
  e.action = a; e.frame = 0; e.ft = 0;
  return true;
}

/**
 * 强制从头播 action a（即使当前已经是该动作）。
 * @param {any} e 实体
 * @param {string} a 动作名
 */
export function restartAnim(e, a) {
  if (!e) return;
  e.action = a; e.frame = 0; e.ft = 0;
}

/**
 * 每个动作的播放帧率。
 * @param {string} action
 * @returns {number}
 */
export function animFps(action) {
  return action === "walk" ? 9 : action === "run" ? 14 : action === "fight" ? 12 : action === "die" ? 12 : 5;
}

/**
 * 推进一帧动画。
 *
 * 注意循环语义：die 是**停在最后一帧**（倒地不能循环播放），
 * 其他动作取模循环。
 *
 * @param {any} e 实体
 * @param {number} dt 秒
 * @param {number} blockLen 当前方向该动作的帧数
 */
export function tickFrame(e, dt, blockLen) {
  if (!e || !blockLen || blockLen <= 0) return;
  e.ft += dt * (e.animSpeed || 1);
  const fps = animFps(e.action);
  if (e.ft > 1 / fps) {
    e.ft = 0;
    if (e.action === "die") e.frame = Math.min(e.frame + 1, blockLen - 1);
    else e.frame = (e.frame + 1) % blockLen;
  }
}
