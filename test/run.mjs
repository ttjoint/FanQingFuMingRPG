// 测试入口：用 Node 内置的 node:test 跑 test/*.test.mjs。
//
// 为什么不再自建 runner、也不用 Vitest：
//   - 用例本来就是"每个导出函数即一个用例"，node:test 直接吃这个形状，用例体零改动；
//   - node:test 自带 `--experimental-test-coverage`，覆盖率（含未覆盖行号）开箱即得；
//   - 零依赖、零配置，不用为了测试对着 vite 转换 94MB 的 node_modules；
//   - 只剩一套运行器，不再有"两份要同步维护"的问题。
//
// 用法：
//   node test/run.mjs                全部
//   node test/run.mjs patch          只跑文件名或用例名含 patch 的
//   node test/run.mjs --coverage     带覆盖率
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const DIR_URL = "file://" + DIR.replace(/\\/g, "/") + "/";

// ---- 收集用例：文件名 + 导出函数名 ----
async function collect() {
  const filter = process.env.FQFM_TEST_FILTER || "";
  // 排除适配文件（不含用例）。
  // 自检探针会再跑一次本运行器——那时用环境变量把 runner.test.mjs 也排除，
  // 否则"自检 → 跑运行器 → 又跑自检"会无限递归。
  const EXCLUDE = new Set(["all.test.mjs"]);
  if (process.env.FQFM_NO_SELF_CHECK === "1") EXCLUDE.add("runner.test.mjs");
  const files = readdirSync(DIR).filter(f => f.endsWith(".test.mjs") && !EXCLUDE.has(f)).sort();
  const cases = [];
  for (const f of files) {
    const mod = await import(new URL(f, DIR_URL));
    for (const [name, fn] of Object.entries(mod)) {
      if (typeof fn !== "function") continue;
      if (filter && !(f.includes(filter) || name.includes(filter))) continue;
      cases.push({ file: f, name, fn });
    }
  }
  return cases;
}

if (process.env.FQFM_PROBE_ONLY === "1") {
  // ---- 探针模式：只报收集到多少例，不执行（供 test/runner.test.mjs 校验） ----
  console.log("REGISTERED=" + (await collect()).length);
} else if (process.env.FQFM_TEST_REGISTER === "1") {
  // ---- 被 node --test 加载：把用例注册给 node:test ----
  const { test } = await import("node:test");
  for (const c of await collect()) {
    test(c.file.replace(/\.test\.mjs$/, "") + " › " + c.name, c.fn);
  }
} else {
  // ---- 入口：spawn 一次 node --test 来执行本文件 ----
  const args = [];
  if (process.argv.includes("--coverage")) args.push("--experimental-test-coverage");
  args.push("--test", SELF);
  const filter = process.argv.slice(2).find(a => !a.startsWith("--")) || "";
  const r = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: { ...process.env, FQFM_TEST_REGISTER: "1", FQFM_TEST_FILTER: filter },
  });
  process.exit(r.status == null ? 1 : r.status);
}
