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

- [x] `content/ui.js`：新增 `ui` 内容域（`normalizeUi` / `normalizeUiComponent` / 校验）
      组件模型：`{ id, kind, anchor, x, y, w, h, img?, bind?, z, visible }`
      组件模型：`{ id, kind, anchor, x, y, w, h, img?, visibleWhen?, bind?, z }`
      - `kind`：`bar`(血/精/经) / `slotgrid`(快捷栏/背包/商店) / `button` / `label` / `panel` / `image`
      - `anchor`：`topLeft` / `bottomLeft` / `topRight` / `bottomRight` / `center`（决定随窗口锚定）
      - `bind`：绑定运行时数据（`stats.hp`、`inventory.pack`…）
- [x] `content/uiDefault.js`：`defaultUi()` 逐像素复刻旧硬编码（15 个元件）
      —— “默认版”的行为与改造前逐像素一致（单测逐项比对 core/layout.js 的常量）
- [x] `render/hud.js`、`render/shop-ui.js` 改为按配置遍历绘制
- [x] `input`：`core/layout.js` 的 `slotAt`/`insideShop`/`insideShopClose` 走注入的配置
      （`installUiLayout`，由 `drawHUD` 每帧喂同一份），画与点同源
- [x] `render/panels.js`：任务/记事/属性/荣辱（`info.panel`）与存档（`save.panel`）
      收进配置，默认几何与旧硬编码逐像素一致（420×300@110,40 / 460×340@90,40）
- [x] 编辑器新增「界面」标签页（`editor/ui-tab.js`）：
      - 画布预览（复用 iso 地图编辑器的缩放/拖拽骨架）
      - 组件列表（增/删/重命名/显隐）
      - 属性面板（kind / anchor / 坐标 / 尺寸 / 图片 / 绑定 / z 序）
      - 拖拽移动 + 手柄缩放
      - [x] 撤销/重做接入 `editor/history.js`（快照栈：一次操作一条，拖拽只在 mouseup 记账）
      - [x] Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y（输入框内不抢浏览器自带撤销）
      - [x] 撤销后按 id 链找回原选中项（否则下标错位会拖到别的元件）
- [x] 单测：`defaultUi()` 与原硬编码常量逐项相等；配置往返无损（`test/ui.test.mjs` 18 例）
- [x] E2E：HUD 像素回归 + 界面页拖拽/增删/保存进补丁（`e2e/game.spec.js`）

## P2 · 战利品经济旋钮

现状：`engine/lootTable.js` + 词缀 roll 已不错，但缺缩放。

- [x] `engine/lootScale.js`（新增）：`monsterLevel` / `dropRate` / `players` 归一化与缩放
      - `scaleChance`：几率 × dropRate × √players，夹到 [0,100]
      - `rarityWeights`：等级每 N 级把权重往上挪一档（总量守恒）
      - `rollRarity` / `pickWeighted` / `rollScaled`
- [x] `engine/lootTable.js`：`rollDrop/rollDrops/makeDropInstance` 接受可选 `scale`
      - 不传 scale 时行为与改造前完全一致（向后兼容硬约束，有单测钉住）
      - 稀有度优先级：掉落项 > 模板 > 按等级 roll > common
- [x] `config.js` economy 加 `dropRate` / `players` / `rarityLevelStep` / `rarityStrength`
- [x] `systems/combat.js` 击杀时按 NPC level + config.economy 组装 scale
- [x] 编辑器：NPC 掉落表扩展（几率% / 数量区间 min~max / 品质下拉）
- [x] 编辑器：「升级数值」页经济段加 4 个全局掉落旋钮（带说明）
- [x] 真内容补齐：野猴/山贼/山贼头目 配了 drops（此前**没有任何 NPC 有 drops**，
      整条掉落管线在正式内容里从未被触发过）
- [x] 单测 `test/lootScale.test.mjs` 17 例；E2E 验证 dropRate/players/0 三个旋钮实际生效

## P3 · 技能资源与冷却建模

现状：`engine/skill.js` 只有 `mp` 与 `mode(melee/ranged)`，更像“攻击方式表”。

- [x] `cooldown`（沿用已有 `engine/targeting.js` 技能级冷却）
      - **修 bug**：`castSelf`（治疗/自身技能）原先完全没接冷却，带冷却的自愈技
        可以无限连放；攻击路径有 `isReady`，自身施法这条漏了。
- [x] `resource` 字段：`mp` / `hp` / `none`（血祭类技能用 hp，且不能把自己扣死，
      最低保留 1 点）。旧数据缺省即 `mp`，行为不变。
- [x] `charges` / `maxCharges` / `recharge`：充能型技能（连击/冲刺）
      - `engine/targeting.js` 新增 `chargesOf` / `hasCharge` / `spendCharge` / `tickCharges`
      - 与普通冷却用两套槽（`skillCDs` vs `skillCharges`），互不干扰
      - `recharge` 缺省回落 `cooldown`，避免"充能永远不回"
      - 施放失败（资源不足/冷却中）不扣充能，只在真正出手时消耗
- [x] `passive` 字段：被动技能不主动施放、不进技能栏，只通过协同加成
- [x] 技能协同（synergy）：`engine/skill.js` 的 `synergyBonus` / `applySynergy`
      - 形如 `[{skill, per, max, stat}]`：指定技能每 1 级给 +per 加成，累加封顶 max
      - 单项与总和双封顶，避免多个协同叠满突破上限
      - 只按"已学等级"算，被动加成常驻
- [x] 编辑器技能表单扩展：被动勾选 / 消耗资源下拉 / 冷却 / 充能数 / 每发回复 /
      协同列表（技能下拉 + 每级加成 + 上限 + 作用数值，可增删）
- [x] 单测 `test/skillResources.test.mjs` 14 例；E2E 钉住治疗冷却修复、充能回复、
      hp 资源下限、协同封顶
- [x] 真内容接入：御心术补 12 秒冷却（原本无冷却却能无限自愈）、
      烈焰斩←龙家剑法协同、龙家剑法←长剑协同、清军剑法改 3 充能每 6 秒回一发

## P4 · 子系统补齐（广度）

按“对刷图循环的价值”排序：

- [x] **传送点 / 小站**（做出来了刷图循环才成立）
      - `engine/waypoint.js`（纯逻辑）：`normalizeWaypoints` / `waypointTable` /
        `isUnlocked` / `unlock` / `groupByAct` / `travelTargets` / `canTravel` /
        `waypointAtCell` / `touchWaypoint`
      - 归一化会丢弃缺 id/缺地图的项，并**按 id 去重**——重复 id 会让解锁状态串台
        （解锁一个等于解锁两个）
      - `systems/waypoint.js`：`waypointSystem`（每帧踩点判定）/ `availableTargets` /
        `travelTo`（复用 loadMap+setPlayer，与 GSP 的 gotoMap 同一条路径）/ `togglePanel`
      - 管道位置紧跟 `playerSystem`：踩点必须看到本帧最新坐标，否则切图后要等一帧
      - `render/panels.js`：`drawWaypointPanel` / `waypointAt`（绘制与命中共用
        `waypointRows()`，避免两处顺序漂移）
      - 输入：游戏内 **M** 开面板、Esc 关、点击地名传送（模态，点面板外也关闭）
      - `assets/waypoints.json`：7 个传送点（第 1 章 4 个 / 第 2 章 3 个），
        坐标都取在各图**实际可走格**上（从地图 JSON 里查的），不是拍脑袋写的
      - `G.waypoints = {id:true}` 随存档走；`resetNewGame` 清空
      - 编辑器新增「传送点」标签页（id/显示名/地图/行列/章节/描述，可增删）
      - `diffContent`/`applyPatch` 支持整表 `waypoints`
      - 单测 `test/waypoint.test.mjs` 10 例；E2E 钉住解锁、未解锁拦截、真换图、
        编辑器改名进补丁
      - **注意**：E2E 里传送会真的换图，必须传回原图，否则后续编辑器用例
        的 `currentMap` 断言全部错位
- [x] **箱子 / 共享仓库**
      - `engine/stash.js`（纯逻辑）：`normalizeStash` / `freeCount` / `isFull` /
        `addToStash` / `takeFromStash` / `removeFromStash` / `countInStash` / `canFit`
      - 仓库是**账号级**的（单独一个浏览器存储 key），不在存档里——
        否则就退化成"更大的背包"，失去跨周目沉淀的意义
      - 堆叠规则：同名词缀实例**不叠**（count 恒 1），普通物品先叠进已有格再占新格
      - `canFit` 按格模拟而不是只比空格数：满格但能叠进已有格时仍然放得下
      - `systems/stash.js`：`stashOf`（懒加载 + 内存缓存）/ `storeFromPack` /
        `takeToPack` / `toggleStashPanel`；整格转移，不做部分拆分（避免半个物品的歧义态）
      - `render/panels.js`：`drawStash` / `stashRect` / `stashSlotRect` / `stashSlotAt`
        （绘制与命中共用同一套矩形）
      - 输入：游戏内 **B** 开关；仓库面板打开时**右键背包物品 = 存入**，
        左键仓库格 = 取出。仓库关闭时右键仍是原来的"使用/装备"，不改手感
      - `config.stash.size`（默认 100）+ 编辑器「升级数值」加旋钮
      - 切图时关闭面板但**不清数据**（数据在 G.stash / 持久化里，不属场景瞬时状态）
      - 单测 `test/stash.test.mjs` 15 例；E2E 钉住存/取双向 + 清内存缓存后仍能读回
      - 注：`engine/` 里不能出现 `localStorage` 字样（架构检查用正则扫全文，
        注释也算），所以纯逻辑层的注释改为"浏览器持久化"
- [x] **赌博 / 鉴定 / 修理**
      - `engine/smith.js`（纯逻辑）：`repairCost` / `repairEntry` / `repairAllCost` /
        `isUnidentified` / `identifyCost` / `identifyEntry` / `gamblePrice` / `gamblePool`
      - **修理**：此前耐久会随受击掉（`items.durabilityLossOnHit`），
        归零后装备加成被拒（`inventory.js:145`），而**没有任何修回来的途径**
        —— 等于装备会慢慢自己死掉。现在按「缺失耐久占比 × 物品价 × repairRate」计价，
        至少收 1 金币（否则缺一点耐久可以免费无限修）。
      - **鉴定**：赌博产物带 `inst.unid`，tooltip 层隐藏词缀（只显示【未鉴定】），
        否则鉴定就只是个收费按钮，玩家开赌前已经知道结果。费用按稀有度乘倍率。
      - **赌博**：金币此前只有买卖两个出口，中期就溢出。赌价随角色等级上涨，
        防止前期刷出终局装备；产物必带 `unid`，所以金币有两级去处（赌 → 鉴）。
      - `systems/smith.js`：`wearables` / `repairAll` / `repairSlot` / `identifyAll` /
        `identifySlot` / `gamble` / `toggleSmith`
      - UI：游戏内 **N** 开铁匠面板（三个按钮：赌一把 / 鉴定全部 / 修理全部），
        Esc 关闭，与商店/存档/仓库/传送点互斥
      - ⚠️ **踩过的坑**：`num(Infinity)` 会退化成 0（`Number.isFinite(Infinity)` 为 false），
        所以批量修理/鉴定**不能传 `Infinity` 表示"余额无限"**——
        那会导致钱扣了但一件都没修。单测 `moneyInfinityMeansNoMoney` 钉住。
      - 单测 `test/smith.test.mjs` 12 例；E2E 钉住"钱扣了就必须真修好"、
        鉴定清标记、赌博只扣一次钱、没钱不能赌
- [x] **套装 / 暗金物品**
      - 现状问题是"有稀有度、缺独特命名层级"：稀有度只体现在**词缀条数**上，
        所以"暗金"和"三条稀有词缀的金装"在玩家眼里没有区别。
      - `engine/uniqueItem.js`（纯逻辑）：`normalizeMods` / `normalizeUnique` /
        `normalizeUniques` / `uniqueFor` / `normalizeSet` / `normalizeSets` /
        `setCounts` / `activeBonuses` / `setBonusTotal` / `tagInstance` / `setOfInstance`
      - **暗金用固定词缀替换随机词缀**，不是叠加。暗金的价值在于"确定的强"，
        叠随机词缀会让强度不可预期，也失去"这件就是那件"的辨识度。
      - 套装加成**逐档累加**（3 件 = 2 件档 + 3 件档），这是玩家对套装的既有预期
      - `rollDrop`/`rollDrops`/`makeDropInstance` 加**可选** `uniques`/`sets` 参数，
        不传时行为与改动前完全一致（向后兼容是硬约束，356 个旧测试全绿）
      - 暗金/套装物品**必须走实例**（`needsInstance` 里加了 `isSpecial`），
        否则标记会丢，还会被合并成堆叠条目
      - 套装加成用"减旧值 + 加新值"的**差额**方式并入 stats，不做全量重算：
        stats 里混着升级/药水/任务的永久值，重算会把它们抹掉
      - ⚠️ **踩过的坑**：`mods` 的键名是 `atk`/`def`，而 `stats` 的字段名是
        `attack`/`defence`。直接把 `stats[key]` 写进去会得到 `stats.atk`
        ——一个没人读的字段，表现为"加成计算对了、但面板和战斗都没变"。
        必须显式映射（`MAP = { atk:"attack", def:"defence" }`），E2E 钉住 68→78。
      - ⚠️ **踩过的坑**：内容表在运行时挂在 `rt.content.sets`，不是 `rt.sets`
      - ⚠️ **踩过的坑**：暗金/套装引用的"物品模板名"必须真实存在于 items.json
        （曾把 `牛革甲` 写成 `牛皮甲`，该暗金永远掉不出来，且**不报错**）
      - 编辑器新增「暗金」「套装」两个标签页
        （`listTab` 加 `opts.sync`：表单编辑的是摊平后的视图，每次改动同步回真实数据）
      - 真内容：5 件暗金（破军·凌锋 / 诛仙·弑神 / 铁壁·牛革 / 霸王·不归 / 圣者·遗志）、
        2 套套装（狼烟旧部 4 件 / 清风剑意 2 件）
      - 单测 `test/uniqueItem.test.mjs` 13 例；E2E 钉住独特名、词缀替换、
        2 件档 +10、拆散后退回 0、普通物品不受影响
- [x] **难度分级**
      - `engine/difficulty.js`（纯逻辑）：`DIFFICULTIES`（普通/噩梦/地狱）/
        `normalizeDifficulty` / `normalizeDifficulties` / `difficultyById` /
        `scaleBy` / `monsterMults` / `difficultyIndex` / `cycleDifficulty`
      - 只放大怪物侧（血量/伤害/经验/掉落），**不削弱玩家**——
        削弱会让同一套装备在不同难度下手感割裂
      - 掉落倍率**故意小于**强度倍率（地狱 hp×4 但 drop 只有 ×1.5），
        否则最优解永远是无脑开最高难度；单测 `builtinsAreMonotonic` 钉住
      - 倍率在 `spawnNPC` 时**烘进单位实例**（`applyDifficulty`），
        战斗/经验/掉落各处不必再查难度，也保证同一场战斗内倍率一致
      - `G.difficulty` 存**难度 id 字符串**（存档也存 id，不存下标——改顺序不串档）；
        未知 id 退回第一档而不是报错（旧存档删过难度也能进游戏）
      - UI：游戏内 **F2** 开难度面板，点一行切换，Esc 关闭
      - 编辑器可覆盖难度表（`config.difficulties`，null = 用内置三档）
      - ⚠️ **踩过的坑**：`scaleBy(x, null)` 曾按 0 处理（`Number(null) === 0`），
        会让"没配倍率"变成"血量归零"。现在显式排除 null，单测钉住。
      - ⚠️ **读档顺序**：`G.difficulty` 必须在 `loadMap` **之前**恢复，
        否则读档后场上是一批普通难度数值的怪
      - 单测 `test/difficulty.test.mjs` 9 例；E2E 钉住逐档变强 + 未知 id 退回普通
- [x] **雇佣兵 / 随从**
      - `engine/merc.js`（纯逻辑）：`MERCENARIES`（护卫/弓手）/ `normalizeMerc` /
        `normalizeMercs` / `mercById` / `feesDue` / `nextFeeIn` / `reviveCost` /
        `reviveState` / `followStep` / `canHire`
      - **随从不是新的实体类型**：就是一个 `faction: "player"` 的 NPC 实例，
        挂在 `G.mercenary` 并塞进 `G.npcs`，直接复用现有 AI/寻路/动画/伤害结算。
        为它另写一套战斗逻辑只会产生两份要同步维护的伤害公式。
      - 跟随用**滞回带**（`FOLLOW_LEAD` 140 / `FOLLOW_STOP` 84）：
        越过 lead 才追、追到 stop 才停，否则会在边界每帧反复启停（抽搐）。
        目标点保持 stop 距离，不叠在玩家身上。
      - 薪水每 60 秒扣一次，**钱不够自动离开**（不留"欠薪的随从"）；
        这给了金币一个持续去处（铁匠的三个出口都是一次性的）。
      - 死亡不永久消失：20 秒后可花 30% 招募价归队。
        永久死亡会让玩家因为一次失误丢掉几百金币而直接读档读档。
      - 正在战斗时不跟（`busy` 判定）——追着玩家跑会打断正在打的架
      - 切图时把 `G.mercenary.unit` 置空，由 `mercSystem` 下一帧补建
        （旧实体随 `G.npcs` 清空了，留着就是野指针）
      - UI：游戏内 **P** 开随从面板，未招募列出可招项、已招募显示状态 + 遣散
      - 单测 `test/merc.test.mjs` 11 例；E2E 钉住招募扣钱/进场景/同阵营、
        没钱与重复招募被拒、薪水、跟随、死亡摘除、10s 未复活、到点付费归队、遣散

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
