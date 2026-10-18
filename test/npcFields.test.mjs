import { NPC_FIELDS, NPC_FIELD_KEYS, npcFieldsFromTemplate, npcFieldDefaults, newNpcTemplate, NPC_DEFAULT_SPEED, NPC_DEFAULT_RUN_SPEED } from "../src/content/npcFields.js";
import { assert, assertEq } from "./helpers.mjs";

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
