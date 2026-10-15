// 引擎核心：极简 ECS（纯函数）。
//
// 组件 = 命名的字段集合。`attach` 会把实体上已存在的**扁平字段迁移进组件对象**
// （`e.transform.x` 等），并定义**同名非枚举别名**（`e.x`）保持旧写法可用。
// 因此实体拥有真正的组件分组，同时既有系统无需改动。
export function defineComponent(name, defaults) {
  const fields = Object.keys(defaults || {});
  if (fields.includes(name)) throw new Error("组件名与字段名冲突：" + name);
  return { name, defaults: defaults || {}, fields };
}

export function attach(entity, comp) {
  const defs = comp.defaults;
  let c = entity[comp.name];
  if (!c || typeof c !== "object") {
    c = {};
    for (const k in defs) if (entity[k] !== undefined) c[k] = entity[k];   // 迁移已有扁平字段
    Object.defineProperty(entity, comp.name, { value: c, enumerable: true, configurable: true, writable: true });
  }
  for (const k in defs) {
    if (c[k] === undefined) c[k] = defs[k];
    const d = Object.getOwnPropertyDescriptor(entity, k);
    if (!d || !d.get) {
      if (d) delete entity[k];
      Object.defineProperty(entity, k, {
        get() { return c[k]; }, set(v) { c[k] = v; },
        enumerable: false, configurable: true,
      });
    }
  }
  return entity;
}

export function attachAll(entity, comps) { for (const c of comps || []) attach(entity, c); return entity; }

export function has(entity, comp) {
  if (!entity || !comp) return false;
  const c = entity[comp.name];
  const src = (c && typeof c === "object") ? c : entity;   // 兼容未组件化的扁平实体
  for (const k of comp.fields) if (src[k] === undefined) return false;
  return true;
}

export function query(list, comp) { return (list || []).filter(e => has(e, comp)); }
