# 路线图 / ROADMAP（按优先级推进）

> 本文取代零散的待办，作为**唯一优先级来源**。每完成一项就把状态改成 ✅ 并注明提交。
> 状态：⬜ 未开始 · 🔄 进行中 · ✅ 完成

## 排序原则

1. **先补“不做会堵死后续内容设计”的地基**（伤害类型），再补“玩法广度”。
2. **可编辑性优先于内容量**：仓库的价值在于“别人能改”；不能编辑的内容只是死数据。
3. **每项都必须带单测**（`test/*.test.mjs`），纯逻辑尽量落在 `engine/`（DOM-free）。

---

## P0 · 伤害类型与抗性体系（地基）

现状：伤害是一个无类型的数字，`applyDamage` 直接 `hp -= amount`。
全项目搜 `resist/fire/cold/poison` 零命中。

为什么是 P0：没有抗性，**词缀池设计不出来**（“+30% 火焰伤害”无意义），
怪物差异化只能堆血量数字，装备追求塌缩成“攻击力更高”。
D2 的 build 多样性全部建立在这套正交体系上。

- [ ] `engine/damage.js`：伤害类型枚举、抗性表、减免曲线（纯函数 + 单测）
- [ ] `content/schema.js`：定义 `damageType`、`resist`、`immune` 字段
- [ ] `systems/combat.js`：`applyDamage` 走减免管线
- [ ] 词缀池接入（`affixes.json` 支持元素伤害/抗性词条）
- [ ] 编辑器表单暴露新字段
- [ ] UI：伤害数字按类型着色

## P1 · 可编辑 UI 层（用户明确要求）

现状：全部 UI 坐标硬编码在 `core/layout.js`（单个 117 行文件里约 10 组常量），
`render/*` 另有一批写死的坐标。**任何界面都无法增删或移动**。

目标：把“界面由谁画、画在哪、显示什么”变成**内容数据**，可在编辑器里可视化拖拽。

- [ ] `content/schema.js`：新增 `ui` 内容域（`normalizeUi` / 校验）
      组件模型：`{ id, kind, anchor, x, y, w, h, img?, visibleWhen?, bind?, z }`
      - `kind`：`bar`(血/精/经) / `slotgrid`(快捷栏/背包/商店) / `button` / `label` / `panel` / `image`
      - `anchor`：`topLeft` / `bottomLeft` / `topRight` / `bottomRight` / `center`（决定随窗口锚定）
      - `bind`：绑定运行时数据（`stats.hp`、`inventory.pack`…）
- [ ] `core/layout.js` 改为**消费 UI 配置**，保留硬编码值作为 `defaultUi()`
      —— 这样“默认版”的行为与今天逐像素一致（回归可验证）
- [ ] `render/hud.js`、`panels.js`、`shop-ui.js` 改为按配置遍历绘制
- [ ] `input`：命中测试同样走配置（画与点共用同一份坐标，避免对不上）
- [ ] 编辑器新增「界面」标签页：
      - 画布预览（复用 iso 地图编辑器的缩放/拖拽骨架）
      - 组件列表（增/删/重命名/显隐）
      - 属性面板（kind / anchor / 坐标 / 尺寸 / 图片 / 绑定 / z 序）
      - 拖拽移动 + 手柄缩放
      - 撤销/重做接入 `editor/history.js`
- [ ] 单测：`defaultUi()` 与原硬编码常量逐项相等；配置往返无损

## P2 · 战利品经济旋钮

现状：`engine/lootTable.js` + 词缀 roll 已不错，但缺缩放。

- [ ] `monsterLevel` / `dropRate` / `players`（人数加成）字段
- [ ] `engine/lootTable.js`：掉落按等级重映射 + 品质权重曲线
- [ ] 编辑器：NPC 掉落表 + 全局掉落旋钮

## P3 · 技能资源与冷却建模

现状：`engine/skill.js` 只有 `mp` 与 `mode(melee/ranged)`，更像“攻击方式表”。

- [ ] `cooldown` / `charges` / `passive` 字段
- [ ] 技能协同（synergy：某技能为另一技能加成）
- [ ] 编辑器技能表单扩展

## P4 · 子系统补齐（广度）

按“对刷图循环的价值”排序：

- [ ] **传送点 / 小站**（没有它 9 张图只能靠脚本硬跳，做不出刷图循环）
- [ ] **箱子 / 共享仓库**（16 格背包无处沉淀物品经济）
- [ ] **赌博 / 鉴定 / 修理**（装备循环闭环缺三环）
- [ ] **套装 / 暗金物品**（有稀有度，缺独特命名层级）
- [ ] **难度分级**（依赖 P2 的 monsterLevel）
- [ ] **雇佣兵 / 随从**（敌人 AI 已有协防/仇恨基础）

## P5 · 技术债与解耦

- [ ] **渲染层/输入层去全局单例**：18 个文件仍 `import { G, A } from core/state`。
      `systems/` 已全部收 `ctx`，视图层应对齐（函数签名收 `ctx`，`main.js` 注入）。
- [ ] **`core/registry.js` 后门**：`itemByName(name)` 内读 `A.items`，31 处调用点
      （含 `systems/`）。目标 `itemByName(ctx, name)`，分批迁移。
- [ ] **拆分 `editor/index.js`（1696 行）**：按标签页拆成 `editor/pages/*.js`。
- [ ] **快照式撤销 → Command 模式**：当前每次编辑深拷贝整份 MapDoc（100 条上限），
      大地图内存与 GC 压力大。
- [ ] **测试运行器二选一**：`test/run.mjs` 与 Vitest 适配层跑同一批用例，长期维护两份。

---

## 已完成（归档）

- ✅ 2026-10-18 `2f05224` 修复 `.gitignore` 误排除整个 `test/`（228 个单测当时 0 个入库）
- ✅ 2026-10-18 `07c07b6` 删除废弃 `tools/e2e.mjs`、接通 GSP `PlaySound`、修正文档失效路径
- ✅ 2026-10-18 `616ffb4` 音频波形：容器自适应宽度 + 修复拖动高亮脱节
- ✅ 2026-10-18 `07ca027` 修复怪物无限逃跑 / 逃跑动画抽搐
