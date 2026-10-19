// serve.py 的缓存策略（④）。
//
// 背景：serve.py 曾经对所有响应无条件发 `no-store`。
// 于是浏览器每次刷新都要把 476 个请求、约 12MB 正文全部重传一遍
// （实测改造前首次与刷新都是 11.87MB，304 命中 0 次）。
//
// 这一层的两个关键点，都必须有测试守着：
//   1) 分级正确：源码/接口不能被长期缓存，指纹化素材才能 immutable。
//      一旦有人把策略改回"一刀切 no-store"，刷新就退回到 12MB。
//   2) ETag/304 真的能走通：这是"缓存但不重传"的实际生效条件。
//      光有 Cache-Control 不够——没有 ETag，no-cache 就等于每次都重传全文。
//
// 做法：Node 调 python 载入 serve.py 拿策略 + 起真实服务器验证 HTTP 行为。
// 没有 python 时跳过（不让纯 JS 环境挂掉）。
import assert from "node:assert/strict";
import { assertEq } from "./helpers.mjs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const SERVE = path.join(ROOT, "serve.py");

// 找一个空闲端口，避免与开发中的 8005 撞车
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function hasPython() {
  const r = spawnSync("python", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

// 用 python 直接载入 serve.py 的纯函数（不起服务器）
// 跨平台的换行归一（Windows 子进程输出是 CRLF，Linux 是 LF）
function normalizeNL(s) {
  return s.split(String.fromCharCode(13)).join("").split(String.fromCharCode(10)).join(String.fromCharCode(10));
}
function pyEval(code) {
  const r = spawnSync("python", ["-c", code], { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error("python 失败: " + (r.stderr || r.stdout));
  // Windows 下子进程 stdout 是 CRLF，统一成 LF 后再按行断言
  return normalizeNL(r.stdout).trim();
}

const LOADER = `
import importlib.util, sys
sys.argv = ["serve.py", "0"]
spec = importlib.util.spec_from_file_location("srv", "serve.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
`;

// ---- 1) 策略分级（纯函数层，快且稳）----

export function cachePolicySourceFilesRevalidate() {
  if (!hasPython()) return;
  const out = pyEval(LOADER + `
for p in ["/src/main.js", "/src/core/assets.js", "/index.html", "/"]:
    print(m._cache_policy(p))
`);
  const lines = out.split("\n");
  assertEq(lines, ["no-cache", "no-cache", "no-cache", "no-cache"],
    "源码与入口必须是 no-cache（可缓存但每次校验），不能 no-store 也不能长时间缓存");
}

export function cachePolicyFingerprintedAssetsImmutable() {
  if (!hasPython()) return;
  const out = pyEval(LOADER + `
for p in ["/versions/default/assets/a.png?v=abc", "/versions/default/assets/a.json?x=1&v=2"]:
    print(m._cache_policy(p))
`);
  for (const line of out.split("\n")) {
    assert(line.includes("immutable"), "带 ?v= 指纹的素材应返回 immutable，实际: " + line);
    assert(/max-age=31536000/.test(line), "immutable 应配一年 max-age，实际: " + line);
  }
}

export function cachePolicyUnfingerprintedAssetsRevalidate() {
  if (!hasPython()) return;
  const out = pyEval(LOADER + `
for p in ["/versions/default/assets/a.png", "/versions/default/assets/a.json?x=1"]:
    print(m._cache_policy(p))
`);
  for (const line of out.split("\n")) {
    assertEq(line, "no-cache",
      "没有指纹就无法保证内容不变，只能每次校验（不能冒充 immutable）");
  }
}

export function cachePolicyApiNeverCached() {
  if (!hasPython()) return;
  const out = pyEval(LOADER + `
for p in ["/__api__/versions/", "/__api__/versions/default"]:
    print(m._cache_policy(p))
`);
  for (const line of out.split("\n")) {
    assert(line.includes("no-store"), "接口响应必须 no-store，实际: " + line);
  }
}

export function cachePolicyIsNotBlanketNoStore() {
  if (!hasPython()) return;
  // 回归守卫：曾经"所有路径都 no-store"。至少要有路径不是 no-store，
  // 否则这一层等于没做（刷新会退回 12MB）。
  const out = pyEval(LOADER + `
ps = ["/src/main.js", "/versions/default/assets/a.png?v=1", "/__api__/versions/"]
print(sum(1 for p in ps if m._cache_policy(p) != m.CACHE_NONE))
`);
  assertEq(out, "2", "三条路径里应有 2 条不是 no-store（源码 + 指纹素材）");
}

// ---- 2) 真实 HTTP 行为（起一个临时服务器）----

async function withServer(fn) {
  if (!hasPython()) return;
  const port = await freePort();
  const proc = spawn("python", [SERVE, String(port)], { cwd: ROOT, stdio: "ignore" });
  const base = "http://127.0.0.1:" + port;
  // 等端口就绪
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base + "/index.html", { method: "HEAD" });
      if (r.ok) break;
    } catch (e) { /* 还没起来 */ }
    await new Promise(r => setTimeout(r, 100));
  }
  try { return await fn(base); }
  finally { try { proc.kill(); } catch (e) { } }
}

export async function staticResponseHasEtag() {
  await withServer(async base => {
    const r = await fetch(base + "/src/main.js");
    const etag = r.headers.get("etag");
    assert(etag, "静态响应必须带 ETag，否则 no-cache 就等于每次重传全文");
    assertEq(r.headers.get("cache-control"), "no-cache", "源码应为 no-cache");
    // 再次请求带 If-None-Match，应 304 且无正文
    const r2 = await fetch(base + "/src/main.js", { headers: { "If-None-Match": etag } });
    assertEq(r2.status, 304, "带 If-None-Match 时应返回 304");
    const body = await r2.text();
    assertEq(body, "", "304 不应带正文");
  });
}

export async function fingerprintedAssetIsImmutableOverHttp() {
  await withServer(async base => {
    const u = base + "/versions/default/assets/npcs.json?v=testtoken";
    const r = await fetch(u);
    assertEq(r.status, 200, "指纹化素材应可正常取到");
    const cc = r.headers.get("cache-control");
    assert(cc && cc.includes("immutable"), "指纹化素材应 immutable，实际: " + cc);
    // 即便带条件请求，也应 304（说明 ETag 生效）
    const etag = r.headers.get("etag");
    assert(etag, "素材也应有 ETag");
    const r2 = await fetch(u, { headers: { "If-None-Match": etag } });
    assertEq(r2.status, 304, "素材带 If-None-Match 时应 304");
  });
}

export async function apiResponseIsNoStore() {
  await withServer(async base => {
    const r = await fetch(base + "/__api__/versions/");
    const cc = r.headers.get("cache-control") || "";
    assert(cc.includes("no-store"), "接口响应必须 no-store，实际: " + cc);
  });
}

export async function headApiReturns200() {
  await withServer(async base => {
    // 旧实现没拦 HEAD，/__api__/versions 会掉进静态文件分支返回 404，
    // 浏览器/监控探活会误判接口挂了。
    const r = await fetch(base + "/__api__/versions", { method: "HEAD" });
    assertEq(r.status, 200, "HEAD /__api__/versions 应返回 200（原先是 404）");
  });
}

export async function etagChangesWhenFileChanges() {
  await withServer(async base => {
    const r = await fetch(base + "/index.html");
    const etag1 = r.headers.get("etag");
    assert(etag1, "应有 ETag");
    // ETag 由 (mtime, size) 构造：至少格式要对，且不同文件的 ETag 不应相同
    const r2 = await fetch(base + "/src/main.js");
    const etag2 = r2.headers.get("etag");
    assert(etag1 !== etag2, "不同文件的 ETag 不应相同（否则改 A 会误命中 B 的缓存）");
  });
}

export async function http11InUse() {
  await withServer(async base => {
    // 服务端用 HTTP/1.1：连接可复用。Node fetch 不直接暴露协议版本，
    // 用原始 socket 读状态行来验证（HTTP/1.0 会让缓存语义退化，实测刷新仍重传 11MB）。
    const port = Number(new URL(base).port);
    const status = await new Promise((resolve, reject) => {
      const s = net.connect(port, "127.0.0.1", () => {
        s.write("HEAD /index.html HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      });
      let buf = "";
      s.on("data", d => { buf += d.toString(); });
      s.on("end", () => resolve(buf.split("\r\n")[0]));
      s.on("error", reject);
      setTimeout(() => { s.destroy(); resolve(buf.split("\r\n")[0] || ""); }, 3000);
    });
    assert(/HTTP\/1\.1/.test(status), "服务端应使用 HTTP/1.1，实际: " + status);
  });
}

// ---- 3) 前端 assetURL 指纹（④ 的另一半）----
//
// 服务端只有在 URL 带 ?v= 时才允许 immutable。
// 所以前端必须真的把指纹拼上去，否则上面那些策略永远不会生效
// （这个 bug 就发生过一次：loadPack 里用了虚拟 id "__default__" 而非 "default"，
//  导致首屏 377 个素材请求全都不带指纹，全部退回 no-cache）。
import * as A from "../src/core/assets.js";

export function assetTokenEmptyByDefault() {
  assertEq(A.getAssetToken(), null, "默认不应有指纹（保守：每次校验）");
  assertEq(A.assetURL("assets/a.png"), "versions/default/assets/a.png",
    "无指纹时 URL 应保持原样");
}

export function assetTokenAppendsVersionParam() {
  A.setAssetToken("abc123");
  try {
    assertEq(A.assetURL("assets/a.png"), "versions/default/assets/a.png?v=abc123",
      "指纹应拼到素材 URL 上");
    assertEq(A.assetURL("assets/a.png?v=old"), "versions/default/assets/a.png?v=old&v=abc123",
      "已有 query 时应用 & 连接（不能产生两个 ?）");
    // 绝对 URL / data: / blob: 不能加参数
    assertEq(A.assetURL("https://x.test/a.png"), "https://x.test/a.png",
      "跨源绝对 URL 不应附加指纹");
    assertEq(A.assetURL("data:image/png;base64,AA"), "data:image/png;base64,AA",
      "data: URL 不应附加指纹");
    assertEq(A.assetURL("/abs/path.png"), "/abs/path.png", "根路径开头的 URL 不应附加指纹");
  } finally { A.setAssetToken(null); }
}

export function assetTokenCanBeCleared() {
  A.setAssetToken("tok");
  assert(A.getAssetToken() === "tok");
  A.setAssetToken(null);
  assertEq(A.getAssetToken(), null, "传 null 应清除指纹");
  assertEq(A.assetURL("assets/a.png"), "versions/default/assets/a.png",
    "清除后应回到不带参数的 URL");
  A.setAssetToken("");
  assertEq(A.getAssetToken(), null, "空字符串等同于清除");
}

export function fetchOptsUsesForceCacheOnlyWhenFingerprinted() {
  assertEq(A.fetchOpts("versions/default/assets/a.json?v=1").cache, "force-cache",
    "带指纹的 URL 内容不变，应 force-cache（否则刷新仍重传全文）");
  assertEq(A.fetchOpts("versions/default/assets/a.json").cache, "default",
    "无指纹时必须每次验证，不能 force-cache（否则改了看不到）");
}
