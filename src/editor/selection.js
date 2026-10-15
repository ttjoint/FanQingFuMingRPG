// 选择模型：单一主选 + 已选集合（为多选/框选预留）。纯逻辑，便于单测。
// 选择项形状：{ type:"cell", row, col } | { type:"spawn"|"object", index } | { type:"entry" }。
export function selKey(s) {
  if (!s) return null;
  if (s.type === "cell") return "cell:" + s.row + "," + s.col;
  if (s.type === "entry") return "entry";
  return s.type + ":" + s.index;
}

export function createSelection() {
  let primary = null;
  const refs = new Set();
  const sel = {
    get: () => primary,
    set(s) { primary = s || null; refs.clear(); if (primary) refs.add(selKey(primary)); return primary; },
    setMany(list) {
      refs.clear(); primary = null;
      for (const s of (list || [])) { if (!s) continue; refs.add(selKey(s)); primary = s; }
      return primary;
    },
    toggle(s) {
      const k = selKey(s); if (!k) return primary;
      if (refs.has(k)) { refs.delete(k); if (selKey(primary) === k) primary = null; }
      else { refs.add(k); primary = s; }
      return primary;
    },
    has(s) { return refs.has(selKey(s)); },
    is(type, index) { return !!primary && primary.type === type && (index === undefined || primary.index === index); },
    all: () => [...refs],
    clear() { primary = null; refs.clear(); },
  };
  return sel;
}
