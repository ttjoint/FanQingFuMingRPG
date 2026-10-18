# 架构（Architecture）

目标：把项目从「全局单例 + 即时模式编辑器」演进为**分层、可测试、编辑器与运行时解耦**的
小型 RPG 引擎 + 模块化内容编辑器。当前处于**渐进式改造（strangler）的第 1 阶段**：规范数据模型
已经建立并被运行时与编辑器使用，运行时/渲染仍通过**适配层**消费旧视图，以保证原版游戏照常运行。

## 分层

```
┌───────────────────────────────────────────────────────────────┐
│ editor/   内容编辑器：Project(ContentDB+MapDoc) + 命令/历史/选择 │
├───────────────────────────────────────────────────────────────┤
│ content/  规范模型：schema · ids · registry · ContentDB · MapDoc │
│           pack（补丁包） + store（localStorage）                 │
├───────────────────────────────────────────────────────────────┤
│ game/     规则与系统：combat/inventory/missions/audio/scene/... │
│ runtime/  运行时上下文：content → 旧视图的唯一装配点；                │
│           拥有 G/A/MAPS（core/state.js 仅兼容再导出）；                │
│           components.js 定义实体字段默认值（ECS 前置）             │
├───────────────────────────────────────────────────────────────┤
│ engine/   （已建）纯函数：iso / grid / collision / pipeline / ecs / script-gsp │
└───────────────────────────────────────────────────────────────┘
```

依赖方向（只允许向下）：

- `editor` → `content`（+ 只读 `A`/`G` 的运行时视图）
- `game` → `content` + 运行时
- `content` → 仅 `content/schema`（无 DOM、无游戏状态）
- `engine` 为**通用纯层**：不依赖 game/editor/上层，也**不得依赖 `content/` 或 `core/`**
  （由 `tools/check-arch.mjs` 强制）。引擎只保留通用能力与内置兵底常量；
  所有与具体游戏有关的数值（移速、索敌半径、近战分界、等距几何、背包道具名…）
  由装配层从 `config.json` 注入（`configureIso` / `configureSerializer` /
  `buildAiTable(list, defaults)` / `resolveRun(stats, want, speeds)` 等）。
  新增/修改游戏字段不需要改动引擎（见 `engine/npcSerialize.js` 的 schema 注入）。

## 关键数据流

```
原版 versions/default/assets/*.json ──fromLegacyMap──▶ MapDoc ┐
原版数据表         ──buildContentDB─▶ ContentDB ┤
                                                ├─applyPatch(pack.patch)─▶ 规范内容
内容包 v2 (patch) ──────────────────────────────┘
                                                │
                        contentToLegacy / toLegacyMap（适配层）
                                                ▼
                                  运行时视图 A.npcsData / A.items / MAPS（旧形状）
```

- **规范存储** = `ContentDB`（内容定义）+ `MapDoc`（图层化地图）+ `Pack v2`（补丁）。
- **运行时** = `G/A/MAPS`，由规范模型派生；systems 继续按旧字段读取，改动最小。
- **编辑器** = `Project`（ContentDB + MapDoc 的编辑视图），保存时用 `diffContent` 生成补丁。

## 过渡层（重要）

- `src/main.js` 启动时构建 `ContentDB` 与 `MapDoc`，再通过
  `contentToLegacy()` / `toLegacyMap()` 生成 `A.*` 与 `MAPS`。因此
  `world/map.js`、`render/renderer.js`、`world/triggers.js` 等**未改**，但数据来源已是新模型。
- `A.defaults` 现在是**基准 ContentDB**（不再是旧 domains 对象），供编辑器做差异。
- 旧的内容包（v1 `domains`）**不兼容**（按约定：测试期存档无需兼容）。

## 已实现

| 能力 | 位置 |
|---|---|
| 内容 schema / 规整 / 校验 | `content/schema.js` |
| 稳定引用 Ref | `content/ids.js` |
| 按 id 解析 + 引用完整性 | `content/registry.js` |
| ContentDB（Record<id,def>）+ 补丁 diff/apply | `content/contentdb.js` |
| MapDoc 图层化 + 旧地图适配 | `content/mapDoc.js` |
| MapDoc 旧视图直编（cells/objects/spawns 写穿） | `content/mapDoc.js` · `attachLegacyViews` |
| 内容包纯模型 / 校验 | `content/pack.js` |
| 内容包存储（v2 补丁 + 图片） | `content/store.js` |
| 内容包图片 IndexedDB 存取 | `content/idb.js` |
| 项目 zip 导出/导入（零依赖） | `content/projectZip.js` |
| Playwright E2E | `e2e/game.spec.js` · `playwright.config.js` |
| 存档版本/迁移骨架（纯函数） | `content/saveSchema.js` |
| 编辑器 Project / 补丁保存 / 内容校验 | `editor/index.js` |
| 地图编辑器撤销/重做（快照去抖） | `editor/map-editor.js` |
| 运行时经适配层消费新模型 | `main.js` |
| 运行时上下文（拥有 G/A/MAPS） | `runtime/context.js` |
| 架构约束检查（分层/无 DOM） | `tools/check-arch.mjs` |
| TypeScript 类型检查 / Vitest / Vite | `tsconfig.json` · `vitest.config.js` · `vite.config.js` |
| 逻辑层去全局（systems/world/script 收 `ctx`/`g`） | `src/systems` · `src/world` · `src/script` |
| 实体组件对象化（+非枚举旧字段别名） | `engine/ecs.js` · `runtime/components.js` |
| 编辑器历史 / 选择模型 / 多选框选 | `editor/history.js` · `editor/selection.js` · `editor/map-editor.js` |
| 引擎纯函数（等距/方向，DOM-free） | `engine/iso.js` |
| 引擎 A*（注入 walkable，DOM-free） | `engine/grid.js` |
| 引擎视线/路径平滑（string pulling） | `engine/grid.js` |
| 引擎流场（多单位共享，Dijkstra） | `engine/flowfield.js` |
| 引擎空间哈希（近邻查询） | `engine/spatialhash.js` |
| 引擎等距深度切块（对象逐块深度 + 屋顶覆盖） | `engine/depth.js` |
| 引擎椭圆碰撞（DOM-free） | `engine/collision.js` |
| 引擎物品模板/实例（词缀·镶嵌·强化·耐久） | `engine/item.js` |
| 引擎词缀表与按稀有度 roll | `engine/item.js` · `assets/affixes.json` |
| 引擎掉落表（兼容旧格式 + 稀有度/词缀） | `engine/lootTable.js` |
| 引擎特效（图层/锚点/帧动画/循环） | `engine/effect.js` |
| 地面掉落物轻量实体 + NPC 背包 | `systems/ground.js` |
| 特效系统（推进/回收）+ Buff 光环 | `systems/effects.js` · `systems/buffs.js` |
| 指示系统（红/蓝圈、落点、物品高亮） | `systems/indicators.js` · `render/effects.js` |
| 引擎脚本解析/求值（vars 注入） | `engine/script/gsp.js` |
| 系统管道（DOM-free，ECS 前置） | `engine/pipeline.js` |
| 引擎 ECS 基元（组件/查询） | `engine/ecs.js` |
| 运行时组件契约（默认值） | `runtime/components.js` |
| 玩法系统（状态注入，拆分 update） | `systems/gameplay.js` |
| 单元测试 / E2E | `test/` · `e2e/game.spec.js` |

## 规划（见 REFACTOR_PLAN.md）

1. `runtime/context.js`（🔄）：**已拥有 `G/A/MAPS`**（`core/state.js` 退为再导出），
   `install(content, base, buildMap)` 为唯一装配点；下一步让 systems 逐个**接收 `ctx`**
   而非 `import` 全局（`inventory/save/scene/shop/audio` 与 view 层待迁移）。
2. `engine/`（🔄 进行中）：已抽 `engine/iso.js`；下一步寻路/脚本 VM 与运行时 **ECS 组件**。
3. 编辑器**图层化 MapDoc 直接编辑**（当前仍以旧视图编辑、保存时转 MapDoc），
   并引入统一的 **Command + History + SelectionModel**（当前地图用快照历史）。
4. 存档差异化 + `schemaVersion` 迁移；内容包图片迁移到 IndexedDB。
5. UI 组件化（Preact/Lit）、脚本编辑器（Monaco）、TypeScript + Vite + Vitest/Playwright。
