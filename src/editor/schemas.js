// 编辑器内各标签页的**纯数据**定义：schema 表、AI 预设、伤害类型选项。
//
// 从 editor/index.js 拆出（P5）。这些只有常量，不碰 DOM、不碰 ED，
// 所以可以安全独立；字段渲染仍由 fields.js 负责。
// 加字段改这里，不要再去 index.js 里翻。

// 音效候选列表（特效的 sound 字段用）。assets-index 只做索引，不碰 DOM 状态。
import { soundFiles } from "./assets-index.js";

export const DMG_TYPE_OPTIONS = [
  ["physical", "物理"], ["fire", "火焰"], ["cold", "冰霜"],
  ["lightning", "闪电"], ["poison", "毒素"], ["all", "全部(+抗性)"],
];

export const AI_COND_HINT = "条件(when)可用：always, hpBelow, hpAbove, mpBelow, mpAbove, hasTarget, noTarget, targetDead, targetInRange(melee/aggro/数字), targetDistBelow, aggroOver, lostOver, allyBeingAttacked, nearbyEnemyCount, nearbyAllyCount, random, cooldownReady, leashExceeded（可组合 all/any/not）";

export const AI_ACT_HINT = "动作(do.action)可用：idle, wander(radius,interval,speed), chase(stopRange,maxTime,speed), attack(cooldown,rage), flee(range,speed), assist(radius), guard(leash)";

// 伤害类型选项。引擎把类型当作不透明 key（engine/damage.js），
// 这里只是给编辑器一个常用集合；抗性表里手写的自定义类型会原样保留。
// "all" = 对所有类型生效（等价于 schema 把单数值规整成的形式）。
// 形如 [值, 显示名]，与编辑器其它 select 字段的 options 约定一致。

export const AI_TEMPLATES = {
  "站桩": { idle: { action: "idle" }, rules: [] },
  "原地游荡": { idle: { action: "wander", radius: 160, interval: [2, 6] }, rules: [] },
  "守卫(警戒+回防)": { idle: { action: "idle" }, targeting: { aggroRange: 260, retaliate: true, giveUpT: 8, leash: 480 }, rules: [
    { when: { targetInRange: "melee" }, do: { action: "attack" } },
    { when: { hasTarget: true }, do: { action: "guard", leash: 260 } },
  ] },
  "主动野兽(游荡+扑咬+低血逃)": { idle: { action: "wander", radius: 200, interval: [2, 5] }, targeting: { aggroRange: 200, retaliate: true, giveUpT: 6, leash: 420 }, rules: [
    { when: { hpBelow: 0.25 }, do: { action: "flee", range: 420, speed: 1.5 } },
    { when: { targetInRange: "melee" }, do: { action: "attack", cooldown: 1.1 } },
    { when: { hasTarget: true }, do: { action: "chase", stopRange: "melee" } },
  ] },
  "强盗(呼朋引伴+低血逃)": { idle: { action: "wander", radius: 180, interval: [2, 6] }, targeting: { aggroRange: 260, retaliate: true, giveUpT: 8, leash: 520 }, rules: [
    { when: { hpBelow: 0.2 }, do: { action: "flee", range: 480, speed: 1.5 } },
    { when: { targetInRange: "melee" }, do: { action: "attack", cooldown: 1.1 } },
    { when: { allyBeingAttacked: true }, do: { action: "assist", radius: 300 } },
    { when: { hasTarget: true }, do: { action: "chase", stopRange: "melee" } },
  ] },
  "首领(分阶段)": { idle: { action: "idle" }, targeting: { aggroRange: 320, retaliate: true, giveUpT: 12, leash: 640 }, rules: [
    { when: { hpBelow: 0.3 }, do: { action: "attack", cooldown: 0.7, rage: 1.5 } },
    { when: { hpBelow: 0.6 }, do: { action: "attack", cooldown: 1.0 } },
    { when: { targetInRange: "melee" }, do: { action: "attack", cooldown: 1.2 } },
    { when: { hasTarget: true }, do: { action: "chase", stopRange: "melee" } },
  ] },
};

export const NPC_SCHEMA_FIELDS = [
  { group: "身份" },
  { k: "id", label: "编号", type: "number" }, { k: "name", label: "名称", type: "text" },
  { k: "model", label: "行走图", type: "model" }, { k: "portrait", label: "头像", type: "image", dir: "face" },

  { group: "数值" },
  { k: "level", label: "等级", type: "number" }, { k: "exp", label: "经验", type: "number" },
  { k: "hp", label: "生命", type: "number" }, { k: "attack", label: "攻击", type: "number" },
  { k: "defence", label: "防御", type: "number" },
  { k: "resist", label: "抗性(%)", type: "resist", options: DMG_TYPE_OPTIONS, hint: "按伤害类型减免：正值减伤、负值受伤加重、>=100 免疫。" },
  { k: "speed", label: "移动速度", type: "number", def: 45 }, { k: "runSpeed", label: "追击速度", type: "number", def: 70 },

  { group: "行为" },
  { k: "hostile", label: "主动敌对", type: "checkbox" },
  { k: "ai", label: "AI 配置", type: "select" },
  { k: "script", label: "对话脚本", type: "select" },
  { k: "skills", label: "技能", type: "strlist" },

  { group: "掉落与交易" },
  { k: "drops", label: "掉落物品", type: "drops" },
  { k: "inventory", label: "货物背包(商人)", type: "inventory" },

  { group: "台词" },
  { k: "talks", label: "闲话", hint: "每行一句，随机抽取", type: "lines", rows: 5 },
];

export const ITEM_SCHEMA = [
  { group: "基本" },
  { k: "name", label: "名称", type: "text" },
  { k: "type", label: "类型", type: "select", numeric: true, options: [[0, "消耗品"], [1, "武器"], [2, "防具"], [3, "饰品"], [4, "技能书"], [7, "包裹"], [8, "剧情物品"], [9, "宝石"], [10, "材料"]] },
  { k: "subtype", label: "子类", type: "number" },
  { k: "rarity", label: "稀有度", type: "select", options: [["common", "普通"], ["magic", "精良"], ["rare", "稀有"], ["unique", "传说"], ["quest", "任务"]] },
  { k: "price", label: "价格", type: "number" }, { k: "reqLevel", label: "需求等级", type: "number" },
  { k: "icon", label: "图标", type: "image", dir: "items_icons" },

  { group: "属性加成" },
  { k: "hp", label: "生命+", type: "number" }, { k: "mp", label: "精力+", type: "number" },
  { k: "attack", label: "攻击+", type: "number" }, { k: "defence", label: "防御+", type: "number" },
  { k: "attrA", label: "攻速+", type: "number" },
  { k: "attrB", label: "属性B", type: "number" }, { k: "attrC", label: "属性C", type: "number" },

  { group: "堆叠与耐久" },
  { k: "stackable", label: "可堆叠", type: "checkbox" },
  { k: "maxStack", label: "最大堆叠", type: "number", def: 0 },
  { k: "socketCount", label: "镶嵌孔数", type: "number", def: 0 },
  { k: "maxDurability", label: "最大耐久", type: "number", def: 0 },

  { group: "宝石词条", hint: "仅 type=宝石 时生效" },
  { k: "gem.mods.atk", label: "攻击+", type: "number" },
  { k: "gem.mods.def", label: "防御+", type: "number" },
  { k: "gem.mods.hp", label: "生命+", type: "number" },
  { k: "gem.mods.hit", label: "攻速+", type: "number" },

  { group: "特效" },
  { k: "fx.aura", label: "装备光环", type: "select" },
  { k: "fx.use", label: "使用时", type: "select" },

  { group: "说明" },
  { k: "desc", label: "物品说明", type: "textarea", rows: 4 },
];

export const SKILL_SCHEMA = [
  { group: "基本" },
  { k: "name", label: "名称", type: "text" },
  { k: "type", label: "类型", type: "select", numeric: true, options: [[0, "治疗(自身)"], [1, "攻击"]] },
  { k: "mode", label: "攻击方式", type: "select", options: [["melee", "近战（瞬间命中）"], ["ranged", "远程（预留弹道）"]] },
  { k: "passive", label: "被动技能", type: "checkbox",
    hint: "被动技能不能主动施放、不进技能栏，只通过「协同」给其它技能加成。" },
  { group: "数值" },
  { k: "range", label: "射程", type: "number" },
  { k: "resource", label: "消耗资源", type: "select", options: [["mp", "精力"], ["hp", "生命"], ["none", "无"]] },
  { k: "mp", label: "消耗量", type: "number" },
  { k: "power", label: "威力", type: "number" }, { k: "reqLevel", label: "需求等级", type: "number" },
  { k: "damageType", label: "伤害类型", type: "select", options: DMG_TYPE_OPTIONS },
  { group: "冷却与充能", hint: "充能技能（冲刺/闪避）：有 N 发可用，每 N 秒回 1 发；不填则走普通冷却。" },
  { k: "cooldown", label: "冷却(秒)", type: "number", step: 0.1 },
  { k: "maxCharges", label: "充能数", type: "number", hint: "0 = 不是充能技能" },
  { k: "recharge", label: "每发回复(秒)", type: "number", step: 0.1, hint: "留 0 则沿用冷却时间" },
  { group: "协同", hint: "「技能」每 1 级给本技能 +per 的加成，最多 max。作用于「作用数值」。" },
  { k: "synergy", label: "协同加成", type: "synergy" },
  { group: "表现" },
  { k: "icon", label: "图标", type: "image", dir: "skill_icons" },
  { k: "frames", label: "特效帧", type: "frames", dir: "skill" },
  { k: "sound", label: "音效", type: "audio", filesFn: soundFiles },
  { group: "弹道", hint: "仅「远程」方式使用" },
  { k: "projectile.homing", label: "追踪目标", type: "checkbox" },
  { k: "projectile.speed", label: "速度(像素/秒)", type: "number", def: 320 },
  { k: "projectile.radius", label: "命中半径", type: "number", def: 18 },
  { k: "projectile.pierce", label: "穿透次数", type: "number", def: 0 },
  { k: "projectile.frames", label: "飞行帧", type: "frames", dir: "projectile" },
  { group: "说明" },
  { k: "desc", label: "说明", type: "textarea", rows: 2 },
];

// 技能表单按需构建（buff 候选随 ED.buffs 变化，避免模块加载时崩溃）。

export const BUFF_SCHEMA = [
  { group: "基本" },
  { k: "id", label: "id", type: "text" },
  { k: "name", label: "名称", type: "text" },
  { k: "icon", label: "图标", type: "image", dir: "buff_icons" },

  { group: "时长与叠层" },
  { k: "duration", label: "持续(秒)", type: "number", def: 10 },
  { k: "maxStacks", label: "最大层数", type: "number", min: 1, def: 1 },
  { k: "stackMode", label: "叠层方式", type: "select", options: [["refresh", "刷新时长"], ["stack", "叠加层数"]] },

  { group: "每层属性修正" },
  { k: "mods.atk", label: "攻击", type: "number", def: 0 },
  { k: "mods.def", label: "防御", type: "number", def: 0 },
  { k: "mods.hpMax", label: "生命上限", type: "number", def: 0 },
  { k: "mods.mpMax", label: "精力上限", type: "number", def: 0 },
  { k: "mods.speed", label: "速度", type: "number", def: 0 },
  { k: "mods.hit", label: "攻速", type: "number", def: 0 },

  { group: "持续效果" },
  { k: "dot.dps", label: "每秒伤害", type: "number", def: 0 },
  { k: "hot.hps", label: "每秒治疗", type: "number", def: 0 },

  { group: "表现" },
  { k: "fx.aura", label: "光环(循环)", type: "select" },
  { k: "fx.onApply", label: "施加时", type: "select" },
  { k: "fx.onExpire", label: "到期时", type: "select" },

  { group: "说明与标签" },
  { k: "tags", label: "标签", hint: "每行一个", type: "lines", rows: 3 },
  { k: "desc", label: "说明", type: "textarea", rows: 4 },
];

export const EFFECT_SCHEMA = [
  { k: "id", label: "id", type: "text" },
  { k: "name", label: "名称", type: "text" },
  { k: "layer", label: "层级(叠放次序)", type: "select", options: [["under", "地面（恒低于单位）"], ["over", "角色层（按 y 排序）"], ["top", "顶层（头顶，恒在上）"]] },
  { k: "anchor", label: "锚点", type: "select", options: [["world", "世界坐标"], ["unit", "单位"], ["item", "物品"]] },
  { k: "frames", label: "帧图", type: "frames", dir: "fx" },
  { k: "fps", label: "帧率(帧/秒)", type: "number", def: 12 },
  { k: "loop", label: "循环播放", type: "checkbox" },
  { k: "holdFirst", label: "首帧停留(秒)", type: "number", def: 0 },
  { k: "holdLast", label: "尾帧停留(秒)", type: "number", def: 0 },
  { k: "life", label: "存在时长(秒,0=不限)", type: "number", def: 0 },
  { k: "ox", label: "横向偏移", type: "number", def: 0 },
  { k: "oy", label: "纵向偏移", type: "number", def: 0 },
  { k: "scale", label: "缩放", type: "number", step: 0.1, def: 1 },
  { k: "texture", label: "贴图(预留,留空=程序化)", type: "text" },
  { k: "color", label: "颜色(程序化)", type: "text" },
  { k: "radius", label: "半径(程序化)", type: "number", def: 18 },
];

export const AFFIX_SCHEMA = [
  { k: "id", label: "id", type: "text" },
  { k: "name", label: "名称", type: "text" },
  { k: "prefix", label: "名称前缀", type: "text" },
  { k: "rarity", label: "稀有度", type: "select", options: [["magic", "精良"], ["rare", "稀有"], ["unique", "传说"]] },
  { k: "weight", label: "抽取权重", type: "number", def: 10 },
  { k: "slots", label: "适用槽(每行一个)", type: "lines", rows: 3 },
  { k: "mods.atk", label: "攻击+", type: "number" },
  { k: "mods.def", label: "防御+", type: "number" },
  { k: "mods.hp", label: "生命+", type: "number" },
  { k: "mods.mp", label: "精力+", type: "number" },
  { k: "mods.hit", label: "攻速+", type: "number" },
  { k: "mods.spd", label: "速度+", type: "number" },
];
// ---------- 界面（HUD / 背包 / 商店等元件的可视化布局） ----------

export const WAYPOINT_SCHEMA = [
  { group: "基本" },
  { k: "id", label: "id", hint: "稳定标识，存档记录解锁用它；改名会丢解锁进度" },
  { k: "name", label: "显示名", type: "text" },
  { k: "map", label: "所在地图", type: "text", hint: "必须与地图页的地图名一致" },
  { group: "位置" },
  { k: "row", label: "行", type: "number" }, { k: "col", label: "列", type: "number" },
  { k: "act", label: "章节", type: "number", hint: "面板按章节分组，数字小的排前面" },
  { group: "说明" },
  { k: "desc", label: "描述", type: "textarea", rows: 2 },
];

export const UNIQUE_SCHEMA = [
  { group: "基本" },
  { k: "id", label: "id", hint: "稳定标识；改名会让已有实例失去绑定" },
  { k: "name", label: "物品模板名", hint: "必须是物品页里已有的名字，否则永远掉不出来" },
  { k: "uname", label: "暗金名", hint: "玩家看到的独特名（如「破军·凌锋」）" },
  { group: "固定属性" },
  { k: "atk", label: "攻击", type: "number", hint: "会替换随机词缀，不是叠加" },
  { k: "def", label: "防御", type: "number" },
  { k: "hp", label: "气血", type: "number" },
  { k: "mp", label: "内力", type: "number" },
  { k: "spd", label: "攻速", type: "number" },
  { group: "说明" },
  { k: "desc", label: "描述", type: "textarea", rows: 2 },
];

// 把扁平的 atk/def/... 字段收成 mods 对象（engine 里存的是 mods）。
