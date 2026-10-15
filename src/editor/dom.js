// 极简 DOM 构造助手，供编辑器使用。
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") e[k.toLowerCase()] = v;
    else if (k === "value") e.value = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
export function deep(o) { return JSON.parse(JSON.stringify(o)); }
export function mergeDeep(base, over) {
  const out = deep(base);
  if (!over) return out;
  for (const k in over) {
    const v = over[k];
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = mergeDeep(out[k], v);
    else out[k] = deep(v);
  }
  return out;
}
