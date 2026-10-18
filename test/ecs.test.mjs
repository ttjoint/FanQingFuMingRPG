import { defineComponent, attach, attachAll, has, query } from "../src/engine/ecs.js";
import { assert, assertEq } from "./helpers.mjs";

export function attachFillsMissingOnly() {
  const T = defineComponent("transform", { x: 0, y: 0, dir: 4 });
  const e = attach({ y: 9 }, T);
  assertEq([e.x, e.y, e.dir], [0, 9, 4]);            // 缺字段补默认
  const e2 = attach({ x: 1, y: 2, dir: 3 }, T);
  assertEq([e2.x, e2.y, e2.dir], [1, 2, 3]);          // 不覆盖已有
}

export function fieldsLiveInComponent() {
  const T = defineComponent("transform", { x: 0, y: 0, dir: 4 });
  const e = attach({ x: 5, y: 6 }, T);
  // 真正存储在组件对象里
  assertEq(e.transform.x, 5);
  assertEq(e.transform.y, 6);
  assertEq(e.transform.dir, 4);
  // 别名读写双向同步
  e.x = 11;
  assertEq(e.transform.x, 11);
  e.transform.y = 22;
  assertEq(e.y, 22);
  // 别名非枚举（不会污染序列化）
  assertEq(Object.keys(e).includes("x"), false);
  assertEq(JSON.parse(JSON.stringify(e)), { transform: { x: 11, y: 22, dir: 4 } });
}

export function attachAllAndHas() {
  const A = defineComponent("ca", { a: 1 });
  const B = defineComponent("cb", { b: 2 });
  const e = attachAll({}, [A, B]);
  assertEq([e.a, e.b], [1, 2]);
  assert(has(e, A) && has(e, B));
  assert(!has({ a: 1 }, B));
}

export function queryFilters() {
  const A = defineComponent("ca", { a: 1 });
  const list = [{ a: 1 }, { a: 2, b: 3 }, {}];
  assertEq(query(list, A).length, 2);                 // 扁平对象也视作“有该组件”
  assertEq(query(null, A).length, 0);
  const e = attachAll({}, [A]);
  assertEq(query([e, {}], A).length, 1);
}
