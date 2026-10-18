// 结构化差分（纯逻辑，无 DOM）。
//
// 用途：编辑器撤销栈原先对整份地图做 JSON 深拷贝。
// 一张大地图约 280KB 文本，100 条历史 ≈ 28MB 常驻内存，每次编辑还要
// 两次 JSON.stringify 做比较。这里改成**只记录变更路径**：
//   { path: ["cells", 12, "flag"], v: 1 }        // 旧值 1（撤销时写回）
//
// 为什么不用 JSON Patch：我们的数据是纯 JSON（cells/objects/spawns），
// 但路径里既有数组下标也有对象键，而且需要"旧值"而非"操作序列"——
// 记录旧值让撤销/重做都只需逐条写回旧值，不必维护正反两份操作。
//
// 契约：
//   diff(before, after) → patches（只含变化的最小集合）
//   getPath / setPath / delPath → 按路径读写（撤销时逐条写回旧值）
//
// 性能：cells 是 900 项的对象数组，逐项比较比整份 JSON.stringify 快得多，
// 而且只在**被改动的那些格**上产生记录。

const isObj = v => v !== null && typeof v === "object";
const isArr = Array.isArray;
// 补丁里存的旧值必须是**拷备**：若直接存引用，"撤销后的文档"与"补丁里的旧值"
// 会指向同一个对象/数组，之后任何一边被改就静默污染另一边（很难查）。
const cloneJson = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// 取路径处的值（路径不存在时返回 undefined）
export function getPath(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

// 写路径处的值。路径的父级必须已存在（我们的数据是原地编辑，父级一定在）。
export function setPath(obj, path, val) {
  if (!path.length) return val;
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (cur[k] == null) cur[k] = (typeof path[i + 1] === "number") ? [] : {};
    cur = cur[k];
  }
  cur[path[path.length - 1]] = val;
  return obj;
}

// 删除路径（数组用 splice 保持下标语义；对象用 delete）
export function delPath(obj, path) {
  if (!path.length) return obj;
  const parent = getPath(obj, path.slice(0, -1));
  if (parent == null) return obj;
  const k = path[path.length - 1];
  if (isArr(parent)) parent.splice(k, 1);
  else delete parent[k];
  return obj;
}

// 深度相等（只处理 JSON 值）。比 JSON.stringify 快，且不产生临时字符串。
export function deepEqual(a, b) {
  if (a === b) return true;
  if (!isObj(a) || !isObj(b)) return Number.isNaN(a) && Number.isNaN(b);
  if (isArr(a) !== isArr(b)) return false;
  if (isArr(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

// 差分：返回 [{ path, v }]，v 是 **before 里的旧值**（撤销时写回）。
// 新增/删除都表达成"整个值的替换"，因为我们的编辑粒度是格子/条目级，
// 不需要在条目内部做更细的合并。
export function diff(before, after, path = [], out = []) {
  if (deepEqual(before, after)) return out;

  // 类型不同 / 非容器：直接记一条替换
  if (!isObj(before) || !isObj(after) || isArr(before) !== isArr(after)) {
    out.push({ path: path.slice(), v: before });
    return out;
  }

  if (isArr(before)) {
    // 长度不同：直接整段替换，**不再展开逐项**。
    //
    // 先展开逐项再补一条 tail 是错的：逐项补丁的下标基于“原来那个长度”，
    // 而撤销/重做时数组长度已经变了，下标全错位。
    // 典型症状：删了第一项，撤销正常，重做却把**最后一项**删了。
    // 数组长度变化在编辑器里就是“增/删一整条”，整段替换是最小且正确的粒度。
    //
    // 注意必须拷一份：直接存 before 的引用会让“撤销后的文档”与“补丁里的旧值”
    // 指向同一个数组，后续任何一边的修改都会静默污染另一边。
    if (before.length !== after.length) {
      out.push({ path: path.slice(), v: cloneJson(before), tail: true });
      return out;
    }
    for (let i = 0; i < before.length; i++) diff(before[i], after[i], path.concat(i), out);
    return out;
  }

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const hasB = Object.prototype.hasOwnProperty.call(before, k);
    const hasA = Object.prototype.hasOwnProperty.call(after, k);
    if (hasB && !hasA) { out.push({ path: path.concat(k), v: cloneJson(before[k]), removed: true }); continue; }
    if (!hasB && hasA) { out.push({ path: path.concat(k), v: undefined, added: true }); continue; }
    diff(before[k], after[k], path.concat(k), out);
  }
  return out;
}
