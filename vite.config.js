import { defineConfig } from "vite";

// Vite 仅用于**开发服务器**（可选）：`npm run dev`。
// 运行时通过字符串路径访问 assets/（fetch / new Audio / new Image），Vite dev 会按项目根目录
// 静态提供这些文件；生产部署仍走零构建静态方式（任意静态服务器，如 `python serve.py`）。
export default defineConfig({
  root: ".",
  server: { port: 5173, open: false },
  build: {
    // 不用于生产构建（运行时资源为字符串路径）；如需打包请另行配置 publicDir。
    outDir: "dist",
  },
});
