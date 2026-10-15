import { defineConfig } from "vitest/config";

// 测试用现有 test/*.test.mjs（导出函数）；test/all.test.mjs 负责把它们注册为 Vitest 用例。
export default defineConfig({
  test: {
    include: ["test/all.test.mjs"],
    environment: "node",
    reporters: "default",
  },
});
