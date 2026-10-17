import { defineConfig } from "vite";

// Vite 仅用于**开发服务器**（可选）：`npm run dev`。
// 运行时通过字符串路径访问 assets/（fetch / new Audio / new Image），Vite dev 会按项目根目录
// 静态提供这些文件；生产部署仍走零构建静态方式（任意静态服务器，如 `python serve.py`）。
//
// 版本库后端（/__api__/versions）只有 serve.py 提供——它需要访问文件系统写版本文件夹。
// 这里把该前缀代理到 serve.py，避免 `npm run dev` 下版本列表为空、编辑器也存不了版本。
// 用法：先 `python serve.py`（默认 8005），再 `npm run dev`。
const BACKEND = process.env.GSXY_BACKEND || "http://127.0.0.1:8005";

export default defineConfig({
  root: ".",
  server: {
    port: 5173,
    open: false,
    proxy: {
      "/__api__": { target: BACKEND, changeOrigin: true },
      // 磁盘版本的素材也由 serve.py 提供（versions/<id>/assets/...）。
      // Vite 本身也能静态服务，但走同一后端可保证行为一致。
      "^/versions/": { target: BACKEND, changeOrigin: true },
    },
  },
  build: {
    // 不用于生产构建（运行时资源为字符串路径）；如需打包请另行配置 publicDir。
    outDir: "dist",
  },
});
