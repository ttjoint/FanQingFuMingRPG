// 编辑器历史（撤销/重做）。纯逻辑，便于单测；map-editor 用它替代内联的 past/future 数组。
// 条目形如 { map, before, after, label }：撤销恢复 before，重做恢复 after。
export function createHistory(limit = 100) {
  const past = [], future = [];
  return {
    push(entry) { past.push(entry); if (past.length > limit) past.shift(); future.length = 0; return entry; },
    undo() { const e = past.pop(); if (!e) return null; future.push(e); return e; },
    redo() { const e = future.pop(); if (!e) return null; past.push(e); return e; },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    size: () => past.length,
    clear() { past.length = 0; future.length = 0; },
  };
}
