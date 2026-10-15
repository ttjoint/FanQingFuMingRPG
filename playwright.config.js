import { defineConfig } from "@playwright/test";

// Playwright E2E：自动起本地静态服务器（零构建部署方式）。
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:8131", headless: true, viewport: { width: 1400, height: 900 } },
  webServer: {
    command: "python serve.py 8131",
    url: "http://127.0.0.1:8131/index.html",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
