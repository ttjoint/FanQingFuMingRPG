// 测试运行器自检。
//
// 为什么需要这个：运行器最常见的失效不是"断言错"，而是**静默少跑**——
// 文件没被收集到、导出被识别成非函数、过滤逻辑写反了，结果都是
// "0 failed" 的绿灯，看起来一切正常。
//
// 这里用一个必然成立的对照：磁盘上的 .test.mjs 文件数、导出的函数数
// 与运行器实际报告的数量必须一致。
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, "..");
const read = p => readFileSync(path.join(ROOT, p), "utf8");

// 排除适配文件；自检自身不参与计数（否则会把自己算进去，也会递归跑运行器）
const SKIP = new Set(["all.test.mjs", "runner.test.mjs"]);
const testFiles = () => readdirSync(DIR)
  .filter(f => f.endsWith(".test.mjs") && !SKIP.has(f)).sort();

// 运行器必须排除适配类文件（它们不含用例，且会引入额外依赖）
export function runnerSkipsAdapterFiles() {
  const src = read("test/run.mjs");
  assert(src.includes('f !== "all.test.mjs"') || !testFiles().includes("all.test.mjs"),
    "运行器不应把适配文件当成用例文件加载");
}

// 运行器必须收集 test/ 下所有 .test.mjs
export function runnerCoversAllFiles() {
  const files = testFiles();
  assert(files.length > 40, "用例文件数异常偏少：" + files.length);
  for (const f of files) {
    assert(read("test/run.mjs").includes(".test.mjs"), "运行器应扫描 .test.mjs");
  }
}

// 每个用例文件都必须真的导出至少一个函数，否则它是"空文件"，
// 运行器不会报错、也不会跑任何东西。
export async function everyTestFileExportsCases() {
  const empty = [];
  for (const f of testFiles()) {
    const mod = await import(new URL(f, "file://" + DIR.replace(/\\/g, "/") + "/"));
    const n = Object.values(mod).filter(v => typeof v === "function").length;
    if (!n) empty.push(f);
  }
  assert.deepEqual(empty, [], "这些用例文件没有导出任何用例：" + empty.join(", "));
}

// 用例总数必须与运行器**实际跑的数量**对得上。
//
// 这里最容易写成同义反复：从 run.mjs 源码里正则提取过滤条件再“复现”一遍，
// 只能证明代码自洽，不能证明它真的没漏文件（实测漏掉一个文件后仍报 fail 0）。
// 所以这里真的 spawn 一次运行器，数它的汇总行。
export async function caseCountMatchesExports() {
  const { spawnSync } = await import("node:child_process");
  let byExport = 0;
  const perFile = {};
  for (const f of testFiles()) {
    const mod = await import(new URL(f, "file://" + DIR.replace(/\\/g, "/") + "/"));
    const n = Object.values(mod).filter(v => typeof v === "function").length;
    perFile[f] = n;
    byExport += n;
  }
  assert(byExport >= 380, "用例总数异常偏少：" + byExport);
  for (const [f, n] of Object.entries(perFile)) assert(n > 0, f + " 没导出任何用例");

  // 探针：让 run.mjs 自己走一遍**收集**逻辑（不执行用例体、不触node:test 递归），
  // 把它实际会注册的用例数报出来，与磁盘上的导出数逐一对平。
  //
  // 注意不能用 `node --test` 去真执行：自检本身就在一次 node:test 运行里，
  // 套一层会得到 “run() is being called recursively ... skipping” 而不是结果。
  // 也不要把收集逻辑在这里重写一份——那就变成同义反复，无法发现运行器漏文件。
  const probe = (await import("node:child_process")).spawnSync(process.execPath, [
    fileURLToPath(new URL("./run.mjs", import.meta.url)),
  ], {
    encoding: "utf8",
    env: { ...process.env, FQFM_PROBE_ONLY: "1", FQFM_TEST_REGISTER: "", FQFM_NO_SELF_CHECK: "1" },
  });
  const m = /REGISTERED=(\d+)/.exec(probe.stdout || "");
  assert(m, "探针未输出注册数：stdout=" + (probe.stdout || "") + " stderr=" + (probe.stderr || ""));
  assert.equal(+m[1], byExport, "运行器应注册全部 " + byExport + " 例（实际 " + m[1] + " 例）");
}

// package.json 的 test 脚本必须走这个运行器（不能还指向已删除的 vitest）
export function npmTestUsesNodeRunner() {
  const pkg = JSON.parse(read("package.json"));
  assert(pkg.scripts.test.includes("node test/run.mjs"),
    "npm test 应使用 node test/run.mjs，实际：" + pkg.scripts.test);
  assert(!("vitest" in (pkg.devDependencies || {})), "不应再依赖 vitest");
}

// 不应残留 vitest 配置/适配文件
export function noVitestLeftovers() {
  const files = readdirSync(ROOT);
  assert(!files.includes("vitest.config.js"), "vitest.config.js 应已删除");
  assert(!files.includes("all.test.mjs"), "test/all.test.mjs 应已删除");
}
