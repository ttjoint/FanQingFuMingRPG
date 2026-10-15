# 重构计划与进度（Refactor Plan）

采用**渐进式改造（strangler）**：每阶段都保证原版游戏可运行，逐步把运行时/编辑器迁到新模型。

## ✅ 阶段 0 —— 规范数据模型（已完成）

- `content/schema.js`：内容 schema、规整、校验、版本号。
- `content/ids.js`：稳定引用 `kind:id`。
- `content/registry.js`：按 id 解析 + 引用完整性校验。
- `content/contentdb.js`：`Record<id,def>` 的 ContentDB + 补丁 `diffContent/applyPatch`。
- `content/mapDoc.js`：地图图层化 `MapDoc` + 旧地图双向适配（9 张地图无损往返）。
- `content/pack.js`：内容包纯模型；`content/store.js` 改为 v2 补丁包。
- 测试：`test/*.test.mjs`（`node test/run.mjs`）。

## ✅ 阶段 1 —— 运行时经适配层消费新模型（已完成）

- `main.js` 启动：`assets → buildContentDB → applyPatch(pack) → ContentDB/MapDoc`，
  再经 `contentToLegacy` / `toLegacyMap` 生成 `A.*` 与 `MAPS`。
- `A.defaults` 变为基准 ContentDB。
- 原版游戏行为不变（E2E 冒烟通过）。

## ✅ 阶段 2 —— 编辑器接入 Project + 补丁保存 + 撤销/重做（已完成）

- `editor/index.js` 用 `Project`（ContentDB + MapDoc 视图）替代旧 `ED`；
  `diffContent` 生成补丁，`savePack` 存 v2 包；保存时做内容校验提示。
- `editor/map-editor.js` 增加**撤销/重做**（文档快照 + 350ms 去抖，`Ctrl+Z / Ctrl+Y`，工具栏按钮）。
- E2E：`tools/e2e.mjs` 覆盖「地图补丁保存 / 撤销 / 重做 / NPC 内容补丁 / 游戏可玩」。

## 🔄 阶段 3 —— 显式运行时上下文（进行中）

- ✅ **状态归属已收敛**：`runtime/context.js` 声明并拥有 `G/A/MAPS`；`core/state.js` 退化为
  兼容再导出。建图函数由入口注入（`install(content, base, buildMap)`）以避免循环依赖。
  新增单测 `context.test.mjs` 与架构检查 `tools/check-arch.mjs` 强制约束。
- ✅ **逻辑层（`systems/` `world/` `script/`）已彻底去全局**：全部改为接收 `ctx`/`g`，
  无一再 `import core/state`；由架构检查新增的**规则 4** 强制（防止回退）。已迁移：
  `motion/missions/gameplay/update/combat/audio/inventory/shop`、`world/ground/triggers/npc/map/pathfinding`、
  `script/vm`（含 `EXIT` 内聚、直接用引擎纯 `gsp`）。
- ⏳ **仅剩 view 层**（`input/render/editor`、`content/versions-ui`）与入口 `main.js` 仍读 `core/state`
  的兼容再导出（可接受：视图需要读状态）。后续可按需逐步改为 `getRuntime().state`。

## ✅ 阶段 4 —— 引擎分离 + 系统管道 + ECS（已完成）

- ✅ `engine/`：`iso.js`（等距/方向）、`grid.js`（A*）、`collision.js`（椭圆）、`pipeline.js`（系统管道）、
  `ecs.js`（组件基元）、`script/gsp.js`（GSP 纯解析/求值，`vars` 注入）；`core/utils.js`、
  `world/pathfinding.js` 为其薄封装。
- ✅ 每帧玩法拆为 `systems/gameplay.js` 的独立系统（`ctx` 注入），`update.js` 只留场景级流程。
- ✅ **实体的真正组件对象化**：字段存入 `transform/sprite/stats/motion/behavior/combat/collider/loot`
  组件对象，并定义**同名非枚举别名**保持 `e.x` 等旧写法可用（`engine/ecs.js` 的 `attach`）；
  `UNIT_COMPONENTS` 统一应用于 `makeNPC` / 玩家 / `npcFromSave`。
- ✅ `script/vm.js` 去全局（`ctx` 注入、直接用引擎纯 `gsp`，`EXIT` 内聚）。
- ⏳ 运行时实体改**组件化**（Transform/Sprite/Stats/AI/Collider/Combat/Loot），
  `update.js` 变薄为系统遍历。
- ⏳ 目录按 `engine / game / runtime / content / editor` 拆分。

## ✅ 阶段 5 —— 编辑器命令化 + 图层化直编（已完成）

- ✅ 启用 `UnitPlacement.overrides`：地图单位实例可**独立覆盖模板属性**。
- ✅ 统一的 **`History`（撤销/重做）+ `SelectionModel`**（`editor/history.js`、`editor/selection.js`，有单测），
  替代内联 past/future 与散落的 `sel`；历史条目带**操作标签**（命令名）。
- ✅ **地图编辑器直接编辑图层化 `MapDoc`**：`attachLegacyViews(doc)` 给 MapDoc 挂上非枚举旧接口
  `cells/objects/spawns`（写穿到 ground/collision/events/decorations/units）；保存的补丁即 MapDoc。
- ✅ **多选 / 框选**：Ctrl/Shift+左键增减选择，空白处拖拽框选；批量删除（Delete / 右键 / 面板）。
- 说明：撤销/重做采用**检查点快照（带标签）**而非逐操作逆命令（对本规模地图足够且稳健）；
  若后续需逐操作 delta，可在 `history` 基础上扩展。

## ✅ 阶段 6 —— 持久化与工具链（已完成）

- ✅ 存档：`schemaVersion` + `migrateSave`（`content/saveSchema.js`）+ `normalizeSave`；
  **差异化**：`serializeGame` 只存与 NPC 模板不同的字段（`diffNpc`），`npcFromSave(ctx,s)` 模板+差异还原；
  `SAVE_VERSION`→4，兼容旧完整快照。
- ✅ 内容包**图片已迁 IndexedDB**（`content/idb.js`）；无 IDB 环境自动降级内联；导出内联 dataURL。
- ✅ **项目 zip 导出/导入**（`content/projectZip.js`，零依赖 store 模式）：`project.json` + `images/`；
  版本管理界面加「导出 zip / 导入 zip」。
- ✅ **TypeScript + Vite + Vitest**：`tsconfig.json`（`checkJs`，`tsc --noEmit` 0 错误）；`vitest` 跑现有用例；
  `vite` 可选开发服务器，生产仍零构建静态部署。
- ✅ **Playwright E2E**（`e2e/game.spec.js`）：自动起静态服务器，覆盖引导/玩法/编辑器/补丁/IDB。
- ⏳ 可选深化：UI 组件化（Preact/Lit）、脚本编辑器（Monaco/CodeMirror）。

## 约定

- 原版 `assets/` 永远只读；改动只进“内容包”。
- 数据结构变更需同步：`schema.js` + 迁移 + 单测。
- 每阶段结束跑 `node test/run.mjs` 与 `node tools/e2e.mjs`。
