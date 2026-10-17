import { defineConfig } from "@playwright/test";

// Playwright E2E：自动起本地静态服务器（零构建部署方式）。
//
// 端口用 8131 而不是 serve.py 的默认 8005：
//   8005 上常常已有别的东西在监听（例如手工起的 `python -m http.server`），
//   而 `reuseExistingServer: true` 会**直接复用**那个进程 —— 它没有
//   `/__api__/versions` 后端，编辑器拿不到磁盘版本，测试会以莫名其妙的方式失败。
//   用独立端口 + 独立 user-data 语义，保证跑测试时用的永远是本项目的 serve.py。
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
