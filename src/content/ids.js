// 稳定引用（Ref）：`kind:id`。用于跨表引用（掉落物品、技能、脚本、地图、NPC…）。
// 目的：显示名（label/name）可以随便改，引用用稳定 id，改名不断链。
// 现有默认数据里，item/skill 的 id 就是其原始名称（脚本仍按名称调用），npc 的 id 为数字。

export const KIND = { NPC: "npc", ITEM: "item", SKILL: "skill", SCRIPT: "script", MAP: "map", TILE: "tile", OBJECT: "object" };

export function makeRef(kind, id) { return kind + ":" + id; }
export function parseRef(s) {
  const str = String(s == null ? "" : s);
  const i = str.indexOf(":");
  return i < 0 ? { kind: "", id: str } : { kind: str.slice(0, i), id: str.slice(i + 1) };
}
export const refKind = s => parseRef(s).kind;
export const refId = s => parseRef(s).id;
export const isRef = s => typeof s === "string" && /^[a-z]+:/.test(s);

export const npcRef = id => makeRef(KIND.NPC, id);
export const itemRef = id => makeRef(KIND.ITEM, id);
