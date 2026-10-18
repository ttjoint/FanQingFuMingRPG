// Vitest 适配：把现有 test/*.test.mjs 导出的用例函数注册为 Vitest 测试。
// 这样同一批测试既能用 `node test/run.mjs`（无依赖）跑，也能用 `vitest` 跑。
import { test } from "vitest";
import { readdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(dir).filter(f => f.endsWith(".test.mjs") && f !== "all.test.mjs").sort();
for (const f of files) {
  const mod = await import(new URL(f, import.meta.url));
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn === "function") test(f.replace(/\.test\.mjs$/, "") + " › " + name, fn);
  }
}
