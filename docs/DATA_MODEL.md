# 数据模型（Data Model）

当前规范模型分三层：**内容定义（ContentDB）**、**地图文档（MapDoc）**、**内容包（Pack v2）**。
原版 `assets/*.json` 通过适配器导入，运行时通过适配器消费。

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
  config: ConfigDoc,                     // player / levelUp / combat
  npcs:     Record<string, NpcDef>,      npcOrder:   string[],
  items:    Record<string, ItemDef>,     itemOrder:  string[],
  skills:   Record<string, SkillDef>,    skillOrder: string[],
  scripts:  Record<string, string>,
  game: GameDoc, transitions, mapsIndex,
  mapsManifest: string[],
  mapDocs: Record<string, MapDoc>,
}
```

`NpcDef`（规整后）：

```ts
{ id, name, model, portrait, script, hp, attack, defence, level, exp,
  hostile, ai, speed, runSpeed, drops: {name,count}[], skills: string[], talks: string[] }
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

## 6. 存档（规划中）

现有 `systems/save.js` 为整包快照。规划：只存与定义不同的实体差异 + `schemaVersion` 迁移表。

```ts
Save { schemaVersion, seed, playTime,
  location: { map, pos }, actors: Record<entityId,{hp,dead,...}>,
  world: { vars, missions, ground, factions, love, vips, notes },
  inventory: { pack, equip, hotbar }, progress: { skills, skill } }
```
