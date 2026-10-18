// 极简测试运行器：收集 test/*.test.mjs 导出的函数（每个函数即一个用例）。
// 用法：node test/run.mjs
import { readdirSync } from "fs";
import { fileURLToPath } from "url";

const dir = new URL("./", import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith(".test.mjs") && f !== "all.test.mjs").sort();
let pass = 0, fail = 0;
const only = process.argv[2];
for (const f of files) {
  const mod = await import(new URL(f, import.meta.url));
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== "function") continue;
    if (only && !(f.includes(only) || name.includes(only))) continue;
    try { await fn(); pass++; console.log("  ok   " + f + " › " + name); }
    catch (e) { fail++; console.log("  FAIL " + f + " › " + name + "\n       " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n       ") : e)); }
  }
}
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
