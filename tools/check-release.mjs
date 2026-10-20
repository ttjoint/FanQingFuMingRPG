// 发布前校验：确保静态部署（GitHub Pages）上的版本都能真正打开。
//
// 为什么需要它：
//   aitest 事故 —— versions/index.json 里登记了这个版本，但 versions/aitest/
//   整个目录被 .gitignore 排除、从未提交。线上版本列表能看到它，点开却黑屏：
//   loadStaticPack 拿不到 patch.json，applyDiskImages 拼出的
//   versions/aitest/assets/*.png 全部 404，渲染直接失败。
//   这类问题在本地永远复现不出来（本地目录是真实存在的），只能在提交前查。
//
// 检查三件事：
//   1) 每个被 index.json 登记的版本，磁盘目录必须真实存在（无悬空条目）。
//   2) 每个要发布的版本，其文件必须真的会被 git 跟踪（不是被 ignore 掉）。
//   3) index.json 里的 assets 清单必须与磁盘实际文件一致（不多不少）。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VDIR = path.join(ROOT, "versions");
const INDEX = path.join(VDIR, "index.json");

function fail(msg) {
  console.error("✗ " + msg);
  return 1;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; }
}

function listAssetKeys(dir) {
  const out = [];
  const walk = (d, rel) => {
    if (!fs.existsSync(d)) return;
    for (const fn of fs.readdirSync(d).sort()) {
      const full = path.join(d, fn);
      const r = rel ? rel + "/" + fn : fn;
      if (fs.statSync(full).isDirectory()) walk(full, r);
      else out.push("assets/" + r);
    }
  };
  walk(path.join(dir, "assets"), "");
  return out;
}

// 该路径是否会被 git 跟踪（未被 ignore）。
function isGitTracked(rel) {
  const r = spawnSync("git", ["check-ignore", "-q", rel], { cwd: ROOT });
  if (r.error) return null;           // 没有 git，跳过该项检查
  return r.status !== 0;              // exit 0 = 被忽略 = 不可跟踪
}

// 批量版：一次 git 调用判断一批路径，避免对每个文件起一个进程。
// 单个版本可能匕 2971 个资源，逐个 check-ignore 要跑一分多钟。
// 做法：把路径从 stdin 传给 `git check-ignore --stdin -z`，它只输出被忽略的那些。
function filterIgnored(rels) {
  if (!rels.length) return { ignored: new Set(), ok: true };
  const r = spawnSync("git", ["check-ignore", "--stdin", "-z"], {
    cwd: ROOT, input: Buffer.from(rels.join("\0") + "\0", "utf8"),
  });
  if (r.error) return { ignored: new Set(), ok: false };
  // check-ignore 全都没被忽略时 exit 1（且无输出），这不算错。
  const out = r.stdout ? r.stdout.toString("utf8") : "";
  const ignored = new Set(out.split("\0").filter(Boolean));
  return { ignored, ok: true };
}

export function checkRelease() {
  let problems = 0;
  const idx = readJson(INDEX);
  if (!idx || !Array.isArray(idx.versions)) {
    return fail("versions/index.json 缺失或格式错误（先用 node tools/gen-versions-index.mjs 生成）");
  }

  const diskDirs = fs.existsSync(VDIR)
    ? fs.readdirSync(VDIR).filter(n => fs.existsSync(path.join(VDIR, n, "version.json")))
    : [];

  // 1) 登记了但磁盘没有 → 悬空条目（aitest 就是这种）
  for (const v of idx.versions) {
    if (!diskDirs.includes(v.id)) {
      problems += fail(
        "index.json 登记了版本 " + v.id + "，但 versions/" + v.id + "/ 目录不存在 —— " +
        "线上会出现在列表里、点开黑屏。请重新运行 gen-versions-index.mjs");
    }
  }

  // 2) 磁盘有但没登记 → 静态部署发现不了
  const listed = new Set(idx.versions.map(v => v.id));
  for (const d of diskDirs) {
    if (!listed.has(d)) {
      problems += fail("磁盘版本 " + d + " 未登记进 index.json —— 静态部署看不到它");
    }
  }

  // 3) 对每个已登记版本：文件是否真会被 git 跟踪 + assets 清单是否与磁盘一致
  for (const v of idx.versions) {
    const dir = path.join(VDIR, v.id);
    if (!fs.existsSync(dir)) continue;   // 上面已报

    // 3a) 关键文件必须可被 git 跟踪（否则提交不上去，线上 404）
    for (const rel of ["versions/" + v.id + "/version.json",
    "versions/" + v.id + "/patch.json"]) {
      const tracked = isGitTracked(rel);
      if (tracked === false) {
        problems += fail(
          rel + " 被 .gitignore 忽略 —— 不会被提交，线上会 404。" +
          "若要发布该版本，请在 .gitignore 的发布白名单里加上 `!versions/" + v.id + "/`");
      }
    }

    // 3b) assets 清单必须与磁盘一致（少登记 = 线上缺图；多登记 = 线上 404）
    const real = listAssetKeys(dir);
    const declared = (v.assets || []).slice().sort();
    const realSorted = real.slice().sort();
    if (JSON.stringify(declared) !== JSON.stringify(realSorted)) {
      const missing = realSorted.filter(a => !declared.includes(a));
      const extra = declared.filter(a => !realSorted.includes(a));
      problems += fail(
        "版本 " + v.id + " 的 assets 清单与磁盘不一致" +
        (missing.length ? "\n    未登记(线上会缺): " + missing.slice(0, 8).join(", ") : "") +
        (extra.length ? "\n    登记了但磁盘没有(线上会404): " + extra.slice(0, 8).join(", ") : "") +
        "\n    请重新运行 node tools/gen-versions-index.mjs");
    }

    // 3c) 白名单版本：一次批量检查所有资源是否真会被提交
    const trackedRoot = isGitTracked("versions/" + v.id + "/version.json");
    if (trackedRoot === true) {
      const rels = real.map(rel => "versions/" + v.id + "/" + rel);
      const { ignored, ok } = filterIgnored(rels);
      if (ok && ignored.size) {
        const untracked = [...ignored];
        problems += fail(
          "版本 " + v.id + " 有 " + untracked.length + " 个资源不会被提交：" +
          untracked.slice(0, 8).join(", ") + (untracked.length > 8 ? " …" : ""));
      }
    }
  }

  if (problems) {
    console.error("\n发布校验失败：" + problems + " 个问题");
    return 1;
  }
  console.log("✓ 发布校验通过：" + idx.versions.length + " 个版本，清单与磁盘一致、均可被 git 跟踪");
  for (const v of idx.versions) {
    console.log("  - " + v.id + "  assets=" + (v.assets || []).length + "  " + v.name);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(checkRelease());
}
