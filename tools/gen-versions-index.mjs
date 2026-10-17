// 生成 versions/index.json —— 静态可读的版本清单。
//
// 为什么需要它：serve.py 能通过扫描目录列出所有版本，但**静态服务器**
// （如 python -m http.server 8082、nginx、GitHub Pages）列不出目录，
// 因此前端只能靠一个显式清单发现磁盘上的版本。
//
// 由 buildExperiment.mjs 等在创建版本后调用；也可手动运行：
//   node tools/gen-versions-index.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VDIR = path.join(ROOT, "versions");

// 列出某个版本 assets/ 下覆盖的文件（逻辑键，形如 "assets/role/x.png"）。
// 静态部署时前端无法列目录，只能靠这里预先算好，否则图片覆盖拿不到。
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

export function writeVersionsIndex() {
  const out = [];
  if (fs.existsSync(VDIR)) {
    for (const name of fs.readdirSync(VDIR).sort()) {
      const vj = path.join(VDIR, name, "version.json");
      if (!fs.existsSync(vj)) continue;
      let meta;
      try { meta = JSON.parse(fs.readFileSync(vj, "utf8")); } catch (e) { continue; }
      out.push({
        id: meta.id || name,
        name: meta.name || name,
        builtin: !!meta.builtin,
        readonly: !!meta.readonly,
        updatedAt: meta.updatedAt || 0,
        assets: listAssetKeys(path.join(VDIR, name)),
      });
    }
  }
  const dst = path.join(VDIR, "index.json");
  fs.writeFileSync(dst, JSON.stringify({ versions: out }, null, 2) + "\n");
  console.log("已写入", path.relative(ROOT, dst), "（" + out.length + " 个版本）");
  for (const v of out) console.log("  -", v.id, v.name, v.readonly ? "[只读]" : "");
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeVersionsIndex();
