# 数据模型（Data Model）

当前规范模型分三层：**内容定义（ContentDB）**、**地图文档（MapDoc）**、**内容包（Pack v2）**。
原版 `versions/default/assets/*.json`（逻辑键仍为 `assets/...`）通过适配器导入，运行时通过适配器消费。

## 1. 稳定引用 Ref

格式 `kind:id`，用于跨表引用（改名不断链）。

```js
item:金创药   skill:长剑   npc:15   script:陈近南.gsp   map:孙家庄
```

工具：`content/ids.js` 的 `makeRef/parseRef/refKind/refId` 与 `itemRef/npcRef/...`。

> 说明：默认数据里 `item/skill` 的 `id` 就是其原始名称（脚本仍按名称调用），`npc` 的 `id` 为数字。
> 未来可引入独立的 id 字段与脚本级间接层，实现真正的“改名安全”。

## 2. ContentDB（内容定义）

`content/contentdb.js`。用 `Record<id, Def>` 取代数组，配 `*Order` 数组保持稳定顺序。

```ts
ContentDB {
  schemaVersion: 2,
  config: ConfigDoc,                     // player / levelUp / combat / move / iso / inventory / items / fx
  npcs:     Record<string, NpcDef>,      npcOrder:   string[],
  items:    Record<string, ItemDef>,     itemOrder:  string[],
  skills:   Record<string, SkillDef>,    skillOrder: string[],
  scripts:  Record<string, string>,
  factions: FactionDef[], ais: AiDef[], buffs: BuffDef[], effects: EffectDef[],
  affixes: AffixDef[],                   // 词缀表（物品实例随机词缀来源）
  game: GameDoc, transitions, mapsIndex,
  mapsManifest: string[],
  mapDocs: Record<string, MapDoc>,
}
```

`NpcDef`（规整后）：

```ts
{ id, name, model, portrait, script, hp, attack, defence, level, exp,
  hostile, ai, speed, runSpeed, drops: DropDef[], skills: string[], talks: string[],
  inventory?: { stock: Entry[], auto?: string },   // 商人货物背包（通用 Inventory 组件）
  bag?: Entry[] }                                   // NPC 自定义背包（脚本指令拾取/丢弃）
```

- `normalizeNpc` 会补齐速度默认值（45 / 70），并把旧数据里**错位的 `skills` 台词文本过滤为空数组**。
- `contentToLegacy(content)` 把 ContentDB 还原成旧运行时数组视图（`A.npcsData` 等）。

### 补丁（patch）

`diffContent(base, next)` 生成只含差异的补丁；`applyPatch(base, patch)` 应用。

```ts
Patch {
  content?: {
    npcs?: Record<id, Def>, removedNpcs?: id[],
    items?/skills?/scripts? 同理,
    factions?/ais?/buffs?/effects?/affixes?,   // 整表替换
    config?/game?/mapsIndex?/transitions?,
  },
  maps?: Record<mapId, MapDoc>,
  removedMaps?: mapId[],
}
```

## 3. MapDoc（地图图层化文档）

`content/mapDoc.js`。旧 `.map` 的 `cells` 把地形/碰撞/事件混在一条记录里，现拆成图层。

```ts
MapDoc {
  schemaVersion: 2, name, width, music,
  entry: [row, col] | null,
  ground:    [sx, sy][],     // 索引 = row*width+col，仅存图块源坐标
  collision: 0|1[],          // 1=可走, 0=阻挡
  cellLayer: number[],       // 原 cell.layer（可选）
  events:    Record<idx, { trigger, map }>,   // 稀疏
  decorations: { id, sprite:[sx,sy,sw,sh,dx,dy], tiles:[[sx,sy,dx,dy]], layer }[],
  units:       { id, npc, r, c, overrides? }[],
}
```

- 目标像素坐标由 `(row,col)` 推导：`dx=1536+32*(r-c)`，`dy=16*(r+c)`
  （已用全部 9 张原版地图验证）。
- `fromLegacyMap(raw)` / `toLegacyMap(doc)` 双向无损（有单测覆盖），
  所以运行时与旧编辑器都能继续工作。
- `units[].overrides`：**地图上的单位实例覆盖模板**（已启用）。编辑器「单位」层可勾选
  「本实例独立配置」，只保存与模板不同的字段；运行时 `makeNPC` 经 `resolveNpc(def, overrides)` 合并。

## 4. Pack v2（内容包）

`content/pack.js`（纯模型）+ `content/store.js`（localStorage）。

```ts
Pack {
  format: "gsxy.pack", version: 2, id, name, base: "__default__",
  patch: Patch,                 // 只存与默认版本不同的条目
  images: Record<assetPath, dataURL>,
  updatedAt,
}
```

- 默认版本 = 原版数据，只读；编辑器保存生成独立版本。
- `createPackObj/normalizePack` 做校验与规范化；过新版本会拒绝。
- 图片目前仍随包存 dataURL，后续迁移 IndexedDB（`pack.assets` 字段已预留形态）。

## 5. 运行时视图（过渡）

| 规范模型 | 适配函数 | 运行时旧视图 |
|---|---|---|
| ContentDB | `contentToLegacy` | `A.npcsData / A.items / A.skills / A.scripts / A.config / A.game / A.transitions / A.mapsIndex` |
| MapDoc | `toLegacyMap` | `A.rawMaps[name]`、`buildMapData()` 的输入 |

`A.defaults` = 基准 ContentDB（编辑器差异比较的基准）。

## 5b. 物品：模板 + 实例

`engine/item.js`（纯逻辑）。为支持词缀随机化 / 镶嵌 / 强化，物品分两层：

- **模板** `ItemDef`：`items.json` 的条目。字段收敛到 `mods {hp,mp,atk,def,hit,spd}`，
  旧字段（`hp/mp/attack/defence/attrA`）**保留并双向同步**，保证既有读取点不破。
  `kind` 由旧 `type` 推导（`0 consumable / 1 weapon / 2 armor / 3 trinket / 4 scroll / 7 pack / 8 quest`）。
  另有 `rarity / stackable / maxStack / socketCount / maxDurability / equipSlot / affixPool / fx`。
- **实例** `Instance`：挂在「条目」上的随机个体。
  ```ts
  { id: "it_<base36>", affixes: [{id,name,prefix,mods}], sockets: (Entry|null)[], enhance, durability }
  ```
- **条目 `Entry`**（背包/地面/货物共用）：`{ name, count, inst? }`。
  `name` 恒为模板主键（`itemByName(name)` 语义不变）；`inst` 为空即旧的堆叠条目，行为完全兼容。

关键函数：`normalizeItemDef / newInstance / normalizeInstance / instanceStats / displayName /
rarityColor / canStack / equipSlotOf / kindFromType / typeFromKind`。

**镶嵌 / 强化 / 耐久 / 词缀**（同为 `engine/item.js` 纯函数，`systems/inventory.js` 负责扣物与属性重算）：

| 能力 | 引擎函数 | 运行时封装 |
|---|---|---|
| 镶嵌宝石 | `canSocket` / `socketGem` | `socketInto(g, equip, gem, kind, key)` |
| 取下宝石 | `unsocketGem` | `unsocketFrom(g, equip, slot)` |
| 强化 | `canEnhance` / `enhance` / `enhanceCost` | `enhanceEntry(g, entry)`（扣金币） |
| 耐久磨损 | `wearDurability` / `isBroken` | `wearEquip(g, key, amount)` |
| 词缀 roll | `normalizeAffix` / `rollAffix` / `rollAffixes` | 掉落时由 `lootTable` 调用 |

- `inst.sockets` 是与 `socketCount` 等长的数组，空位 `null`，已镶为 `{ name, gem:{mods} }`；
  宝石属性计入 `instanceStats`（与词缀累加）。
- 强化每级按 `config.itemEnhance.enhancePerLevel` 加成（默认 +2 攻/防），上限与价格来自 `config.items`
  的 `maxEnhance / enhancePriceBase / enhancePriceMul`。
- **已损坏（耐久为 0）的装备不再提供属性**（`applyBonus` 内置判断）。
- 词缀条数按稀有度：`common 0 / magic 1 / rare 2 / unique 3`，从 `assets/affixes.json` 按 `weight` 抽取、
  按 `slots`（weapon/armor/trinket）过滤并去重。

**物品类型扩展**：`type 9 = gem（宝石）/ 10 = material（材料）`，宝石可堆叠。

## 5c. 掉落表（lootTable）

`engine/lootTable.js`（纯逻辑）。兼容旧 `{name, chance, count}`，新增：

```ts
DropDef { name, chance, min, max, count?, rarity?, affixes?: AffixDef[] }
```

`rollDrop / rollDrops` 产出条目数组；可堆叠且无实例差异的合并为一条，装备（不可堆叠）
逐件生成实例，避免地面/背包被同类物品占满。

## 5d. 地面掉落物（lightweight entity）

`systems/ground.js`。掉落物是 `G.ground` 中的**轻量记录**（不进 `UNIT_COMPONENTS`）：

```ts
{ name, count, inst?, x, y, t,
  dropTime,        // 掉落时刻（配合拾取保护）
  owner,           // 拾取保护归属（玩家/单位）
  from,            // 来源标记（"player" / NPC 等）
  ttl,             // 存在时长（0 = 永久）
  highlight }      // 高亮标记（渲染层用）
```

- 玩家拾取半径 / 拾取延迟 / 散落范围 / 堆叠半径来自 `config.items`。
- NPC 背包：`npcBag / npcPickup / npcDrop`，由脚本指令 `NPCPickItem / NPCDropItem / NPCDropAt /
  NPCGiveItem / PlayerDropItem` 驱动（AI 自动捡拾暂未实现，Profile 预留 `pickup` 占位）。
- 掉落物当前**不可被攻击**（未进 `UNIT_COMPONENTS`）；预留 `attackable` 字段供将来扩展。

## 5e. 特效（effect）与指示（indicator）

`engine/effect.js`（纯逻辑）+ `systems/effects.js`（推进）+ `render/effects.js`（绘制）。

**层级（layer，叠放次序）**：

| layer | 语义 | 渲染位置 |
|---|---|---|
| `under` | 地面 / 脚底光环 / 落点标记 | 恒在所有单位之下 |
| `over`  | 命中 / 爆点 / 角色层特效 | 与单位一同按「帧图底边最低 y」深度排序 |
| `top`   | 头顶 buff / 称号 | 恒在最上层 |

**锚点（anchor）**：`world`（固定世界坐标）/ `unit`（跟随单位，`follow` 指向单位对象，
每帧实时读取 x/y）/ `item`（跟随掉落物记录）。

**定义 `EffectDef`**（`effects.json`）：`{ id, name, layer, anchor, frames, fps, loop,
holdFirst, holdLast, life, ox, oy, scale, blend, color, shape, texture }`。
`shape` 支持程序化 `ring / glow / marker / sprite`；`texture` 为将来切贴图动画帧预留。

- 技能通过 `fx: { cast, hit, target, ground }` 引用特效 id；Buff 通过
  `fx: { aura, onApply, onExpire }` 引用。引擎只保存引用，播放由 `systems/effects.js` 处理。
- 实例结构见 `makeEffect`；`stepEffect` 负责帧动画 / 首尾停留 / 循环与一次性结束判定。

**指示**（`systems/indicators.js`）：每帧重算、**不堆积**，产出 `G.uiFx`：

```ts
{ target: unit|null,   // 敌对单位 → 红圈
  interact: unit|null, // 可交互 NPC（有脚本/商店）→ 蓝圈
  move: marker|null,   // 点地移动落点 → 光圈动画
  item: groundItem|null }  // 划过/选中的地面物品 → 高亮
```

颜色与开关来自 `config.fx`（`uiRings / moveMarker / itemHighlight / ring.{target,interact,move}`）。

## 6. 存档（规划中）

现有 `systems/save.js` 为整包快照。规划：只存与定义不同的实体差异 + `schemaVersion` 迁移表。

```ts
Save { schemaVersion, seed, playTime,
  location: { map, pos }, actors: Record<entityId,{hp,dead,...}>,
  world: { vars, missions, ground, factions, love, vips, notes },
  inventory: { pack, equip, hotbar }, progress: { skills, skill } }
```
