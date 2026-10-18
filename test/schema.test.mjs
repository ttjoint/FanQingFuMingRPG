import { normalizeNpc, normalizeConfig, validateContent, CONTENT_VERSION } from "../src/content/schema.js";
import { assert, assertEq } from "./helpers.mjs";

export function npcDefaults() {
  const n = normalizeNpc({ id: 5, name: "x" });
  assertEq(n.speed, 45);
  assertEq(n.runSpeed, 70);
  assert(Array.isArray(n.drops) && n.drops.length === 0, "drops 应为空数组");
  assert(Array.isArray(n.skills), "skills 应为数组");
}

export function npcSkillsPollution() {
  // 旧数据里 skills 是错位的台词文本，规整后应被过滤为空
  const n = normalizeNpc({ id: 1, skills: "原来是之望啊！\n你娘跟我" });
  assertEq(n.skills, []);
}

export function configMerge() {
  const c = normalizeConfig({ player: { hpMax: 999 } });
  assertEq(c.player.hpMax, 999);
  assertEq(c.levelUp.expMul, 1.5);
  assertEq(c.combat.rangeMin, 40);
}

export function validateClean() {
  const issues = validateContent({ schemaVersion: CONTENT_VERSION, npcs: {}, items: {}, skills: {}, scripts: {} });
  assertEq(issues, []);
}

export function dropsNormalized() {
  const n = normalizeNpc({ id: 2, drops: [{ name: "猴皮" }, { name: "", count: 3 }] });
  assertEq(n.drops.length, 1);
  assertEq(n.drops[0].count, 1);
}
