// 引擎核心：系统管道。按顺序执行 `system(ctx, dt)`；某个系统返回 false 可中断后续。
// 这是 ECS 的前置：把「每帧要做什么」变成可组合、可测试的系统列表。
export function createPipeline(systems = []) {
  const list = systems.slice();
  return {
    add(s) { list.push(s); return this; },
    run(ctx, dt) { for (const s of list) if (s(ctx, dt) === false) return false; return true; },
    systems: () => list.slice(),
  };
}
