// 引擎核心：GSP 脚本的词法/语法解析与表达式求值（纯函数，vars 由调用方注入）。
// script/gsp.js 是它的薄封装，把 G.vars 传进来。

export function parseArgs(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    while (i < s.length && (s[i] === "," || s[i] === " ")) i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      let j = i + 1, buf = "";
      while (j < s.length && s[j] !== '"') {
        if (s[j] === "\\" && s[j + 1] === "n") { buf += "\n"; j += 2; }
        else if (s[j] === "\\" && s[j + 1] === '"') { buf += '"'; j += 2; }
        else buf += s[j++];
      }
      out.push({ t: "str", v: buf }); i = j + 1;
    } else {
      let m = /^-?\d+/.exec(s.slice(i));
      if (m) { out.push({ t: "num", v: parseInt(m[0], 10) }); i += m[0].length; }
      else {
        m = /^[A-Za-z_]\w*/.exec(s.slice(i));
        if (m) { out.push({ t: "var", v: m[0] }); i += m[0].length; }
        else { out.push({ t: "num", v: 0 }); i++; }
      }
    }
  }
  return out;
}

export function cleanLine(raw) {
  let s = raw.replace(/\r/g, "");
  const ci = s.indexOf("//");
  if (ci >= 0) s = s.slice(0, ci);
  return s.trim();
}

export function parseGSP(text) {
  const lines = text.split("\n").map(cleanLine);
  const st = { i: 0 };
  function block(stop) {
    const body = [];
    while (st.i < lines.length) {
      const line = lines[st.i++]; if (!line) continue;
      if (line === "else" || line === "endif" || line === "end" || line === "exit") {
        if (stop.has(line)) return { body, stop: line };
        body.push({ type: "call", name: line, args: [] });
        continue;
      }
      const m = /^([A-Za-z_]\w*)\s*\((.*)\)\s*$/.exec(line);
      if (!m) continue;
      const name = m[1];
      if (name !== "if") { body.push({ type: "call", name, args: parseArgs(m[2]) }); continue; }
      const cond = m[2];
      const thenR = block(new Set(["else", "endif"]));
      let elseBody = null;
      if (thenR.stop === "else") { const eR = block(new Set(["endif"])); elseBody = eR.body; }
      body.push({ type: "if", cond, then: thenR.body, else: elseBody });
    }
    return { body, stop: null };
  }
  return block(new Set()).body;
}

export function evalExpr(expr, vars) {
  vars = vars || {};
  let s = expr.replace(/<>/g, "!=").replace(/\s+/g, "");
  let i = 0;
  const peek = () => s[i];
  function primary() {
    if (peek() === "(") { i++; const v = or(); if (peek() === ")") i++; return v; }
    if (peek() === "-") { i++; return -primary(); }
    let m = /^\d+/.exec(s.slice(i));
    if (m) { i += m[0].length; return parseInt(m[0], 10); }
    if (peek() === '"') { i++; let b = ""; while (s[i] !== '"' && i < s.length) b += s[i++]; i++; return b; }
    m = /^[A-Za-z_]\w*/.exec(s.slice(i));
    if (m) { i += m[0].length; return vars[m[0]] !== undefined ? vars[m[0]] : 0; }
    i++; return 0;
  }
  function mul() { let v = primary(); for (;;) { const c = peek(); if (c === "*" || c === "/" || c === "%") { i++; const r = primary(); v = c === "*" ? v * r : c === "/" ? (r ? Math.floor(v / r) : 0) : (r ? v % r : 0); } else break; } return v; }
  function add() { let v = mul(); for (;;) { const c = peek(); if (c === "+" || c === "-") { i++; const r = mul(); v = c === "+" ? v + r : v - r; } else break; } return v; }
  function cmp() { let v = add(); for (;;) {
    let op = null;
    if (s.startsWith("==", i)) op = "=="; else if (s.startsWith("!=", i)) op = "!=";
    else if (s.startsWith("<=", i)) op = "<="; else if (s.startsWith(">=", i)) op = ">=";
    else if (peek() === "<") op = "<"; else if (peek() === ">") op = ">";
    if (!op) break; i += op.length; const r = add();
    v = op === "==" ? (v == r ? 1 : 0) : op === "!=" ? (v != r ? 1 : 0) : op === "<=" ? (v <= r ? 1 : 0) :
        op === ">=" ? (v >= r ? 1 : 0) : op === "<" ? (v < r ? 1 : 0) : (v > r ? 1 : 0);
  } return v; }
  function and() { let v = cmp(); while (s.startsWith("&&", i)) { i += 2; const r = cmp(); v = (v && r) ? 1 : 0; } return v; }
  function or() { let v = and(); while (s.startsWith("||", i)) { i += 2; const r = and(); v = (v || r) ? 1 : 0; } return v; }
  return or();
}

export function argVal(a, vars) { if (!a) return 0; return a.t === "var" ? ((vars && vars[a.v] !== undefined) ? vars[a.v] : 0) : a.v; }
export function argStr(a) { if (!a) return ""; return String(a.v); }
export function argVar(a) { if (!a) return null; return a.t === "var" ? a.v : (a.t === "str" ? a.v : null); }
export function setVar(a, v, vars) { const n = argVar(a); if (n && vars) vars[n] = v; }
