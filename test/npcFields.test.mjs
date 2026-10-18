import { NPC_FIELDS, NPC_FIELD_KEYS, npcFieldsFromTemplate, npcFieldDefaults, newNpcTemplate, NPC_DEFAULT_SPEED, NPC_DEFAULT_RUN_SPEED } from "../src/content/npcFields.js";
import { assert, assertEq } from "./helpers.mjs";
import { resolveDamage } from "../src/engine/damage.js";

// NPC 字段映射单一来源：模板 -> 运行时字段派生，含“模板缺省”的默认值。
// 重点回归：inventory（货物背包）等新增字段必须能从模板派生，不因字段表漏项而丢失。

export function templateDerivesAllFields() {
  const d = {
    id: 8, name: "野猴", model: "猴子.pmg", portrait: "", script: "",
    hp: 30, attack: 2, defence: 0, level: 9, exp: 9, hostile: 0, ai: 4,
    drops: [{ name: "猴皮", count: 1 }], talks: [],
    inventory: { stock: [{ name: "金创药", count: 1 }] },
    faction: "beast",
  };
  const f = npcFieldsFromTemplate(d);
  assertEq(f.name, "野猴", "name");
  assertEq(f.model, "猴子", "model 去掉 .pmg 后缀");
  assertEq(f.hp, 30, "hp");
  assertEq(f.hpMax, 30, "hpMax 派生自 hp");
  assertEq(f.atk, 2, "atk 派生自 attack");
  assertEq(f.def, 0, "def 派生自 defence");
  assertEq(f.attackable, true, "attack>0 -> attackable");
  assertEq(f.aggressive, false, "hostile -> aggressive");
  assertEq(f.exp, 9, "exp");
  assertEq(f.drops.length, 1, "drops 保留");
  assertEq(f.inventory.stock[0].name, "金创药", "inventory（货物背包）必须派生");
  assertEq(f.faction, "beast", "faction 必须派生");
}

export function defaultsWhenTemplateEmpty() {
  const f = npcFieldDefaults();
  assertEq(f.speed, 45, "speed 默认 45");
  assertEq(f.runSpeed, 70, "runSpeed 默认 70");
  assertEq(f.level, 1, "level 默认 1");
  assertEq(f.attackable, false, "空模板不可攻击");
  assertEq(f.inventory, null, "空模板无货物背包");
  assertEq(f.faction, "", "空模板无阵营");
  // 空模板的派生 = 默认值
  assertEq(npcFieldsFromTemplate({}), f, "空模板派生应等于默认值");
}

export function everyFieldHasFromTemplate() {
  for (const k of NPC_FIELD_KEYS) {
    assert(typeof NPC_FIELDS[k].fromTemplate === "function", k + " 必须有 fromTemplate");
    assert("default" in NPC_FIELDS[k], k + " 必须有 default");
  }
}

export function merchantInventorySurvives() {
  // 商人模板必须带出 inventory（否则存档往返会丢货物，导致商店消失）
  const f = npcFieldsFromTemplate({ name: "郎中", attack: 0, inventory: { auto: "potion" } });
  assertEq(f.inventory.auto, "potion", "自动分类应保留");
  assertEq(f.attackable, false, "商人不因有 inventory 而变成敌人");
}

// 具名默认值与「新建 NPC」模板：单一事实来源，避免编辑器散落魔法数字。
export function namedDefaultsMatchFields() {
  assertEq(NPC_DEFAULT_SPEED, NPC_FIELDS.speed.default, "speed 具名默认与字段一致");
  assertEq(NPC_DEFAULT_RUN_SPEED, NPC_FIELDS.runSpeed.default, "runSpeed 具名默认与字段一致");
}

export function newNpcTemplateIsConsistent() {
  const t = newNpcTemplate();
  assertEq(t.speed, NPC_DEFAULT_SPEED, "新 NPC speed 用统一默认");
  assertEq(t.runSpeed, NPC_DEFAULT_RUN_SPEED, "新 NPC runSpeed 用统一默认");
  assert(t.name && t.model, "新 NPC 有名称与模型");
  assertEq(t.id, 0, "新 NPC 编号 0");
  assertEq(t.faction, "", "新 NPC 无阵营");
}

// ---- P0 抗性/伤害类型的运行时搬运（回归） ----
//
// 真实 bug：engine/damage.js 的 resistOf 只看 target.resist，
// schema 能定义、编辑器能改、引擎能算，但 NPC_FIELDS 里**没有** resist，
// 于是 makeNPC 造出来的单位永远没有抗性 → 所有抗性静默失效（伤害恒按 0 抗算）。
// 这个测试专门钉住“模板里的抗性必须真的进到单位对象上”。
export function resistReachesUnitObject() {
  const tpl = { name: "火抗怪", hp: 100, resist: [{ type: "fire", value: 50 }] };
  const f = npcFieldsFromTemplate(tpl);
  assert(Array.isArray(f.resist), "resist 应搬到单位对象上");
  assertEq(f.resist.length, 1);
  assertEq(f.resist[0].type, "fire");
  assertEq(f.resist[0].value, 50);
}

// 抗性搬过去之后，必须真的影响伤害结算（端到端语义）。
export function resistActuallyReducesDamage() {
  const withRes = npcFieldsFromTemplate({ name: "x", resist: [{ type: "fire", value: 50 }] });
  const without = npcFieldsFromTemplate({ name: "x" });
  const hit = u => resolveDamage([{ type: "fire", amount: 100 }], u, {}).total;
  assertEq(hit(withRes), 50, "50% 火抗应把 100 点火焰伤害减到 50");
  assertEq(hit(without), 100, "无抗性时全额受伤");
}

// 没有配置抗性时保持 undefined（不能让空数组进存档 diff）
export function noResistStaysUndefined() {
  assertEq(npcFieldsFromTemplate({ name: "x" }).resist, undefined);
  assertEq(npcFieldsFromTemplate({ name: "x", resist: [] }).resist, undefined);
}

// 伤害类型同样必须搬过去，否则怪物打出的元素伤害永远是物理。
export function damageTypeReachesUnitObject() {
  assertEq(npcFieldsFromTemplate({ name: "x", damageType: "fire" }).damageType, "fire");
  assertEq(npcFieldsFromTemplate({ name: "x" }).damageType, "", "缺省应为空串（= 物理）");
}

// 抗性的另一种写法（单值 / 映射）也应原样搬运，resistOf 两种都认。
export function resistOtherShapesPassThrough() {
  assertEq(npcFieldsFromTemplate({ name: "x", resist: 30 }).resist, 30);
  const m = npcFieldsFromTemplate({ name: "x", resist: { fire: 20, cold: 10 } }).resist;
  assertEq(m.fire, 20);
  assertEq(m.cold, 10);
}

// 原版数据里的 -1 被按无符号读出，变成 4294967295。
// 现有 21 个 NPC 的 level/defence/exp 都是这个值。一旦在编辑器里
// 给它们配上攻击，这个数就会直接进伤害/奖励公式。
export function u32SentinelFallsBackToDefault() {
  const f = npcFieldsFromTemplate({ name: "校尉", level: 4294967295, defence: 4294967295, exp: 4294967295 });
  assertEq(f.level, 1, "哨兵等级应回落到 1");
  assertEq(f.def, 0, "哨兵防御应回落到 0");
  assertEq(f.exp, 0, "哨兵经验应回落到 0");
}

// 正常数值不能被误伤（尤其别把 0 当成缺省值）。
export function normalNumbersSurviveSane() {
  const f = npcFieldsFromTemplate({ name: "x", level: 0, defence: 0, exp: 0 });
  assertEq(f.level, 0, "0 是合法等级，不能回落到 1");
  assertEq(f.def, 0);
  assertEq(f.exp, 0);
  const g = npcFieldsFromTemplate({ name: "x", level: 42, defence: 7, exp: 99 });
  assertEq(g.level, 42);
  assertEq(g.def, 7);
  assertEq(g.exp, 99);
}
