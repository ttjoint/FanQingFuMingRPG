// 版本库的「清单同步」与「覆盖请求」两条回归守卫。
//
// 背景（两处都是实机踩出来的，不是推测）：
//
// A) serve.py 建/删/改版本后从不更新 versions/index.json。
//    serve.py 能扫描目录列出所有版本，但静态部署（GitHub Pages）列不出目录，
//    前端只能靠这份显式清单发现磁盘版本。于是：编辑器里新建的版本**本地能玩、部署后消失**。
//    实测：走编辑器「复制 default → 保存为新版本」建出 d2-expansion 后，
//    /__api__/versions 已列出它，而 versions/index.json 仍只有 default。
//
// B) main.js 的 loadVersionData 对 DATA_FILES 无条件发请求探测覆盖。
//    新建的版本目录里一个文件都没有 → 每次启动白打 22 个必然 404 的请求。
//    实测：default 0 个 >=400，d2-expansion 22 个。
//    这违反「只诊断、不兜底」：拿必然失败的请求当"文件存不存在"的探测器。
//
// 做法：A 用 python 直接调 serve.py 的内部函数（不碰真实 versions/，改完立即还原）；
//       B 用静态代码断言 + 真实组合验证请求集合。
import assert from "node:assert/strict";
import { spawnSync, spawn } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const INDEX = path.join(ROOT, "versions", "index.json");
const MAIN = path.join(ROOT, "src", "main.js");

function hasPython() {
  const r = spawnSync("python", ["--version"], { encoding: "utf8" });
  return r.status === 0;
}

// 起一个临时服务器（不占用开发中的 8005）。
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

async function withServer(fn) {
  if (!hasPython()) return;
  const port = await freePort();
  const proc = spawn("python", [path.join(ROOT, "serve.py"), String(port)], { cwd: ROOT, stdio: "ignore" });
  const base = "http://127.0.0.1:" + port;
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

const LOADER = `
import importlib.util, sys, json
sys.argv = ["serve.py", "0"]
spec = importlib.util.spec_from_file_location("srv", "serve.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
`;

// ---- A) index.json 必须反映磁盘真实版本 ----

export function indexListsEveryDiskVersion() {
  // 回归守卫：index.json 里出现的每个 id 都必须有真实目录，且每个真实目录都必须出现在清单里。
  // 历史上 aitest 就是反例：清单里有、目录早已不存在（悬空条目）。
  const idx = JSON.parse(readFileSync(INDEX, "utf8"));
  const listed = new Set((idx.versions || []).map(v => v.id));
  const onDisk = new Set();
  for (const name of readdirSync(path.join(ROOT, "versions"))) {
    if (existsSync(path.join(ROOT, "versions", name, "version.json"))) onDisk.add(name);
  }
  for (const id of listed) {
    assert(onDisk.has(id), "index.json 登记了磁盘上不存在的版本：" + id + "（悬空条目）");
  }
  for (const id of onDisk) {
    assert(listed.has(id),
      "磁盘版本 " + id + " 未登记进 index.json —— 静态部署（GitHub Pages）将看不到它");
  }
}

export function serveRebuildsIndexOnCreate() {
  if (!hasPython()) return;
  // 在临时版本目录里建一个版本，确认 _rebuild_versions_index 把它写进了清单。
  const tmpId = "__tmp_index_probe__";
  const out = spawnSync("python", ["-c", LOADER + `
import os, json
d = m._version_dir("${tmpId}")
listed = False
try:
    os.makedirs(os.path.join(d, "assets"), exist_ok=True)
    m._write_json(os.path.join(d, "version.json"), {
        "format": "gsxy.version", "version": 1, "id": "${tmpId}",
        "name": "索引探针", "builtin": False, "readonly": False, "updatedAt": 1,
    })
    m._rebuild_versions_index()
    idx = m._read_json(os.path.join(m.VERSIONS_DIR, "index.json"))
    ids = [v["id"] for v in idx["versions"]]
    listed = "${tmpId}" in ids
finally:
    import shutil
    shutil.rmtree(d, ignore_errors=True)
    m._rebuild_versions_index()
after_ids = [v["id"] for v in m._read_json(os.path.join(m.VERSIONS_DIR, "index.json"))["versions"]]
print(json.dumps({"listed": listed, "leftover": "${tmpId}" in after_ids}))
`], { cwd: ROOT, encoding: "utf8" });
  assert.equal(out.status, 0, "python 失败: " + (out.stderr || out.stdout));
  const r = JSON.parse(out.stdout.trim().split("\n").pop());
  assert.equal(r.listed, true,
    "_rebuild_versions_index 未把新版本写进 index.json —— 该版本在静态部署下会消失");
  assert.equal(r.leftover, false, "探针版本应已被清理（不影响真实清单）");
}

export function serveRebuildRemovesDeletedFromIndex() {
  if (!hasPython()) return;
  // 删除版本后清单必须同步移除，否则又留下悬空条目（aitest 的老毛病）。
  const tmpId = "__tmp_index_gone__";
  const out = spawnSync("python", ["-c", LOADER + `
import os, json
d = m._version_dir("${tmpId}")
try:
    os.makedirs(os.path.join(d, "assets"), exist_ok=True)
    m._write_json(os.path.join(d, "version.json"), {
        "format": "gsxy.version", "version": 1, "id": "${tmpId}",
        "name": "删除探针", "builtin": False, "readonly": False, "updatedAt": 1,
    })
    m._rebuild_versions_index()
    before = [v["id"] for v in m._read_json(os.path.join(m.VERSIONS_DIR, "index.json"))["versions"]]
    import shutil
    shutil.rmtree(d)
    m._rebuild_versions_index()
    after = [v["id"] for v in m._read_json(os.path.join(m.VERSIONS_DIR, "index.json"))["versions"]]
    print(json.dumps({"before": "${tmpId}" in before, "after": "${tmpId}" in after}))
finally:
    import shutil
    shutil.rmtree(d, ignore_errors=True)
    m._rebuild_versions_index()
`], { cwd: ROOT, encoding: "utf8" });
  assert.equal(out.status, 0, "python 失败: " + (out.stderr || out.stdout));
  const r = JSON.parse(out.stdout.trim().split("\n").pop());
  assert.equal(r.before, true, "建版本后应出现在清单");
  assert.equal(r.after, false, "删版本后仍留在清单 —— 会变成悬空条目");
}

export function serveIndexMatchesNodeGenerator() {
  if (!hasPython()) return;
  // serve.py 与 tools/gen-versions-index.mjs 是同一份清单的两个生成者，
  // 规则必须一致，否则"本地建的版本"和"跑脚本重建的清单"会对不上。
  const tmpId = "__tmp_parity__";
  const out = spawnSync("python", ["-c", LOADER + `
import os, json
d = m._version_dir("${tmpId}")
try:
    os.makedirs(os.path.join(d, "assets"), exist_ok=True)
    m._write_json(os.path.join(d, "version.json"), {
        "format": "gsxy.version", "version": 1, "id": "${tmpId}",
        "name": "对齐探针", "builtin": False, "readonly": False, "updatedAt": 7,
    })
    open(os.path.join(d, "assets", "x.json"), "w", encoding="utf-8").write("{}")
    m._rebuild_versions_index()
    idx = m._read_json(os.path.join(m.VERSIONS_DIR, "index.json"))
    v = [x for x in idx["versions"] if x["id"] == "${tmpId}"][0]
    print(json.dumps(v))
finally:
    import shutil
    shutil.rmtree(d, ignore_errors=True)
    m._rebuild_versions_index()
`], { cwd: ROOT, encoding: "utf8" });
  assert.equal(out.status, 0, "python 失败: " + (out.stderr || out.stdout));
  const v = JSON.parse(out.stdout.trim().split("\n").pop());
  // 字段集合必须与 gen-versions-index.mjs 产出的一致（assets 为逻辑键列表）。
  // 两边字段一旦跑偏，本地建的版本和跑脚本重建的清单就会长得不一样，
  // 于是“本地好好的、部署后坏掉”。
  assert.deepEqual(Object.keys(v).sort(),
    ["assets", "builtin", "hasPatch", "id", "name", "readonly", "updatedAt"],
    "serve.py 与 gen-versions-index.mjs 的清单字段不一致");
  assert.deepEqual(v.assets, ["assets/x.json"], "覆盖文件应以逻辑键形式登记");
  // 探针里写了 patch.json 吗？没有 → hasPatch 必须是 false（不能凭空说 true，否则前端白打 404）。
  assert.equal(v.hasPatch, false, "无 patch.json 时 hasPatch 应为 false");
}

// ---- B) 数据覆盖请求不能盲探测 ----

export function loadVersionDataUsesOverrideList() {
  // 回归守卫：loadVersionData 必须按 overrides 清单过滤，而不是对 DATA_FILES 全量发请求。
  // 一旦有人把它改回「无条件 fetch 探测」，空白版本每次启动就会重打 22 个 404。
  const src = readFileSync(MAIN, "utf8");
  assert(/function loadVersionData\s*\(\s*versionId\s*,\s*overrides\s*\)/.test(src),
    "loadVersionData 必须接收 overrides 参数（该版本真实拥有的覆盖文件清单）");
  assert(/DATA_FILES\.filter\(\s*f\s*=>\s*overrides\s*&&\s*overrides\[/.test(src),
    "必须用 overrides 过滤 DATA_FILES，不能全量盲探测（会产生必然 404）");
  // 旧写法「手拼目录 + 全量请求」不应再出现。
  assert(!/const dir = "versions\/" \+ encodeURIComponent\(versionId\)/.test(src),
    "不应再手拼 versions/<id>/assets/ 后全量请求");
}

export function bootPassesPackImagesAsOverrides() {
  // pack.images 是 loadPack 算好的「该版本实有覆盖文件」，必须传给 loadVersionData，
  // 否则过滤清单为空 → 覆盖永远不生效（或退回全量探测）。
  const src = readFileSync(MAIN, "utf8");
  assert(/loadVersionData\(pack\.id,\s*pack\.images\)/.test(src),
    "boot 应把 pack.images 作为 overrides 传给 loadVersionData");
}

export function emptyVersionRequestsNoOverrides() {
  // 空白版本（assets/ 为空）的覆盖清单必须是空 → 不应请求任何版本级覆盖文件。
  // 这是「22 个 404」的直接成因，用集合运算把结论固定下来。
  const idx = JSON.parse(readFileSync(INDEX, "utf8"));
  const DATA_FILES = [
    "atlas.json", "chars.json", "anchors.json", "npcs.json", "items.json", "skills.json",
    "scripts.json", "factions.json", "ais.json", "buffs.json", "config.json", "game.json",
    "effects.json", "affixes.json", "transitions.json", "maps_index.json", "maps_manifest.json",
    "ui.json", "waypoints.json", "uniques.json", "sets.json", "pages.json",
  ];
  for (const v of idx.versions) {
    if (v.builtin || v.readonly) continue;          // default 是基准，不算覆盖
    const have = new Set(v.assets || []);
    const wouldOverlay = DATA_FILES.filter(f => have.has("assets/" + f));
    // 该版本实际拥有的覆盖文件必须 ⊆ 它 assets/ 里登记的文件（不许凭空产生请求）。
    for (const f of wouldOverlay) {
      assert(have.has("assets/" + f), "不应请求未登记的覆盖文件：" + f);
    }
    // 空版本：overlay 数为 0（旧实现会发 22 个请求 → 全 404）
    if (have.size === 0) {
      assert.equal(wouldOverlay.length, 0,
        "空白版本 " + v.id + " 不应产生任何版本级覆盖请求（旧实现产生 22 个 404）");
    }
  }
}

// ---- 端到端：真正走 HTTP 建版本，确认 index.json 被自动更新 ----
//
// 为什么必须走接口而不能只调 _rebuild_versions_index：
// 真正会漏的是「_create/_delete/_rename/save 忘了调用它」这类接线错误。
// 只测函数本身会漏掉整个接线（实测：手动删掉 _create 里的调用，纯函数测试仍全绿）。

export async function httpCreateVersionUpdatesIndex() {
  await withServer(async base => {
    const id = "__tmp_http_probe__";
    // 测试自己的残留先清掉（上一次断言失败时可能没走到 DELETE）。
    await fetch(base + "/__api__/versions/" + id, { method: "DELETE" }).catch(() => { });
    try {
      const r = await fetch(base + "/__api__/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: "HTTP 探针", base: "default", patch: {} }),
      });
      assert.equal(r.status, 200, "建版本接口应成功");
      // 立刻读静态清单：它必须已包含新版本，否则部署到 GitHub Pages 后就找不到
      const idx = await (await fetch(base + "/versions/index.json", { cache: "no-cache" })).json();
      const ids = (idx.versions || []).map(v => v.id);
      assert(ids.includes(id),
        "POST /__api__/versions 后 versions/index.json 未包含新版本 " + id +
        " —— 该版本在静态部署（GitHub Pages）下会消失");
    } finally {
      // DELETE 也应同步清单；无论前面断言成败都要清干净，不留脏目录。
      const d = await fetch(base + "/__api__/versions/" + id, { method: "DELETE" });
      assert.equal(d.status, 200, "删除探针版本应成功");
      const idx2 = await (await fetch(base + "/versions/index.json", { cache: "no-cache" })).json();
      const ids2 = (idx2.versions || []).map(v => v.id);
      assert(!ids2.includes(id),
        "DELETE 后 versions/index.json 仍含 " + id + " —— 会变成悬空条目（aitest 的老毛病）");
    }
  });
}

export async function httpRenameVersionUpdatesIndex() {
  await withServer(async base => {
    const id = "__tmp_http_rename__";
    await fetch(base + "/__api__/versions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name: "改名前", base: "default", patch: {} }),
    });
    try {
      await fetch(base + "/__api__/versions/" + id + "/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "改名后" }),
      });
      const idx = await (await fetch(base + "/versions/index.json", { cache: "no-cache" })).json();
      const v = (idx.versions || []).find(x => x.id === id);
      assert(v, "改名后版本应仍在清单里");
      assert.equal(v.name, "改名后", "改名后 index.json 里的 name 应同步");
    } finally {
      await fetch(base + "/__api__/versions/" + id, { method: "DELETE" });
    }
  });
}

// ---- C) 发布完整性：能提交、能部署、不 404 ----

export function releaseCheckPasses() {
  // 守门测试：仓库当前状态必须通过发布校验。
  // aitest 事故（index.json 登记了版本，但版本目录被 gitignore、从未提交 → 线上黑屏）
  // 就是这一步能拦住的。若失败，按输出提示修 .gitignore 白名单或重跑 gen-versions-index。
  const r = spawnSync(process.execPath, ["tools/check-release.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, "发布校验未通过：\n" + (r.stdout || "") + (r.stderr || ""));
}

export function releaseVersionsAreGitTrackable() {
  // 回归守卫：index.json 里每个非 builtin 版本，其 version.json 必须不被 .gitignore 忽略。
  // 之前 .gitignore 是 `versions/*/` + 建议用 `git add -f`，靠人记住逐个加文件，
  // 漏一次就是线上缺文件。现在改用白名单，这条测试保证白名单和清单不脱节。
  const idx = JSON.parse(readFileSync(INDEX, "utf8"));
  for (const v of idx.versions) {
    const rel = "versions/" + v.id + "/version.json";
    if (!existsSync(path.join(ROOT, rel))) continue;   // 悬空条目由 releaseCheckPasses 管
    const r = spawnSync("git", ["check-ignore", "-q", rel], { cwd: ROOT });
    if (r.error) return;                                // 无 git 环境，跳过
    assert.notEqual(r.status, 0,
      rel + " 被 .gitignore 忽略 —— 该版本不会被提交，线上会黑屏。" +
      "请在 .gitignore 发布白名单里加 `!versions/" + v.id + "/`");
  }
}

export function indexDeclaresPatchPresence() {
  // hasPatch 必须如实反映磁盘：原版 default 没有 patch.json（它就是基准），
  // 前端据此跳过请求。若这里写 true 而后端没文件，启动就会白打一个 404；
  // 写 false 而文件存在，则补丁永远不生效。
  const idx = JSON.parse(readFileSync(INDEX, "utf8"));
  for (const v of idx.versions) {
    const p = path.join(ROOT, "versions", v.id, "patch.json");
    if (!existsSync(path.join(ROOT, "versions", v.id, "version.json"))) continue;
    assert.equal(v.hasPatch, existsSync(p),
      "版本 " + v.id + " 的 hasPatch=" + v.hasPatch + " 与磁盘实际(" + existsSync(p) + ")不符");
  }
}

export function loadStaticPackRespectsHasPatch() {
  // 回归守卫：loadStaticPack 不能用「无条件 fetch + if(r.ok) 吃掉 404」当存在性探测。
  const src = readFileSync(path.join(ROOT, "src", "content", "store.js"), "utf8");
  assert(/meta\.hasPatch/.test(src),
    "loadStaticPack 应依据 index.json 的 hasPatch 决定是否请求 patch.json");
}

export function defaultVersionHasNoPatchFile() {
  // 原版就是基准，不应有 patch.json；若有人误加了空 patch，会把 hasPatch 变 true，
  // 前端就会多打一个本不必要的请求（且掩盖“default 走继承”的设计）。
  assert.equal(existsSync(path.join(ROOT, "versions", "default", "patch.json")), false,
    "versions/default/patch.json 不应存在（default 是基准版本，无补丁）");
}

export function twoGeneratorsAgreeOnRealDisk() {
  if (!hasPython()) return;
  // 两个生成器（serve.py 建/删/改名时自动重建、tools/gen-versions-index.mjs 手动运行）
  // 必须对同一磁盘状态产出同一份清单。否则会出现
  // 「编辑器里新建的版本」与「跑脚本重建后的清单」不一致 → 部署时行为漂移。
  // 做法：各自输出当前磁盘的清单（不写文件），逐条比对。
  const pyOut = spawnSync("python", ["-c", LOADER + `
import json
res = []
import os
if os.path.isdir(m.VERSIONS_DIR):
    for name in sorted(os.listdir(m.VERSIONS_DIR)):
        d = m._version_dir(name)
        vj = os.path.join(d, "version.json")
        if not os.path.isfile(vj):
            continue
        try:
            meta = m._read_json(vj)
        except Exception:
            continue
        res.append({
            "id": meta.get("id", name), "name": meta.get("name", name),
            "builtin": bool(meta.get("builtin")), "readonly": bool(meta.get("readonly")),
            "updatedAt": meta.get("updatedAt", 0),
            "assets": m._list_asset_keys(d),
            "hasPatch": os.path.isfile(os.path.join(d, "patch.json")),
        })

# 子进程 stdout 在 Windows 下按 GBK 解码会毁掉中文，写到临时文件再读。
import tempfile
f = os.path.join(tempfile.gettempdir(), "__vindex_cmp.json")
open(f, "w", encoding="utf-8").write(json.dumps(res, ensure_ascii=False, sort_keys=True))
print(f)
`], { cwd: ROOT, encoding: "utf8" });
  assert.equal(pyOut.status, 0, "python 失败: " + (pyOut.stderr || pyOut.stdout));
  // python 把结果写到临时文件（Windows 下 stdout 按 GBK 解码会毁掉中文），这里读文件。
  const pyFile = pyOut.stdout.trim().split("\n").pop();
  const fromPy = JSON.parse(readFileSync(pyFile, "utf8"));

  // 用同一规则在 JS 侧重算（不调用 writeVersionsIndex，避免写文件）
  const VDIR = path.join(ROOT, "versions");
  const listKeys = dir => {
    const out = [];
    const walk = (d, rel) => {
      if (!existsSync(d)) return;
      for (const fn of readdirSync(d).sort()) {
        const full = path.join(d, fn);
        const r = rel ? rel + "/" + fn : fn;
        if (statSync(full).isDirectory()) walk(full, r);
        else out.push("assets/" + r);
      }
    };
    walk(path.join(dir, "assets"), "");
    return out;
  };
  const fromJs = [];
  for (const name of readdirSync(VDIR).sort()) {
    const d = path.join(VDIR, name);
    if (!existsSync(path.join(d, "version.json"))) continue;
    const meta = JSON.parse(readFileSync(path.join(d, "version.json"), "utf8"));
    fromJs.push({
      id: meta.id || name, name: meta.name || name,
      builtin: !!meta.builtin, readonly: !!meta.readonly,
      updatedAt: meta.updatedAt || 0,
      assets: listKeys(d),
      hasPatch: existsSync(path.join(d, "patch.json")),
    });
  }
  for (const v of fromPy) v.assets = (v.assets || []).slice().sort();
  for (const v of fromJs) v.assets = (v.assets || []).slice().sort();
  assert.deepEqual(fromPy, JSON.parse(JSON.stringify(fromJs)),
    "serve.py 与 gen-versions-index.mjs 对同一磁盘状态产出的清单不一致");
}

export function indexIsHumanReadableJson() {
  // 两个生成者（serve.py 的 _write_json、tools/gen-versions-index.mjs）必须写出
  // 同一种格式。曾经 serve.py 用单行紧凑 JSON、gen 脚本用 2 空格缩进，
  // 两者交替运行就在 3000 行的 index.json 上产生「删 3000 行又加 1 行」的噪声 diff，
  // 完全没法 review（也就没法发现 aitest 那种悬空条目）。
  const txt = readFileSync(INDEX, "utf8");
  assert(txt.includes("\n  \"versions\""), "index.json 应使用 2 空格缩进（当前像是单行紧凑格式）");
  assert(txt.endsWith("\n"), "index.json 应以换行结尾");
  // 必须能被标准 JSON 解析（缩进不影响语义，这里防的是写出半截文件）。
  JSON.parse(txt);
}
