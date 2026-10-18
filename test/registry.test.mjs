// P5：数据表查询的上下文归一化。
//
// 这一层容易出错的地方不是"查不到"，而是**静默查错表**：
//   - 传进来的对象形状没认出来 → 回退到全局 A（行为看起来对，但依赖单例）
//   - 认错了形状 → 拿一个不相干的表去查 → 永远返回 undefined
// 后者尤其危险：装备动作会因为 itemByName 返回 undefined 而**静默失败**
// （不报错、不提示，就是装不上）。这里把各种形状都钉住。
import assert from "node:assert/strict";
import { setAssets, itemByName, skillByName } from "../src/core/registry.js";

const ITEMS = [{ name: "凌锋剑", attack: 30 }, { name: "包裹", type: 7 }];
const SKILLS = [{ name: "龙家剑法", power: 12 }];

function withAssets(fn) {
  setAssets({ items: ITEMS, skills: SKILLS });
  try { return fn(); } finally { setAssets({ items: [], skills: [] }); }
}

export function acceptsRuntimeCtx() {
  withAssets(() => {
    const rt = { assets: { items: ITEMS, skills: SKILLS } };
    assert.equal(itemByName(rt, "凌锋剑").attack, 30);
    assert.equal(skillByName(rt, "龙家剑法").power, 12);
  });
}

export function acceptsBareAssets() {
  withAssets(() => {
    const assets = { items: ITEMS, skills: SKILLS };
    assert.equal(itemByName(assets, "包裹").type, 7);
  });
}

export function acceptsContentDb() {
  withAssets(() => {
    const rt = { content: { items: ITEMS, skills: SKILLS } };
    assert.equal(itemByName(rt, "凌锋剑").attack, 30);
  });
}

// 回归：游戏状态 g 有一个 **skills 数组**（玩家已学技能名）。
// 如果 assetsOf 用 `Array.isArray(x.skills)` 判定"这是个资产表"，
// 就会把 g 自己当成资产表去查 g.items（undefined），
// 于是 itemByName(G, "凌锋剑") 永远是 undefined —— 装备静默失败。
export function gameStateIsNotMistakenForAssets() {
  withAssets(() => {
    const g = {
      stats: { attack: 1 }, pack: [{ name: "包裹", count: 1 }], hotbar: [],
      skills: ["龙家剑法"], skill: "龙家剑法",
      // 注意：g 没有 items 字段
    };
    assert.equal(itemByName(g, "凌锋剑").attack, 30, "传游戏状态应按上下文处理，而不是当成资产表");
    assert.equal(skillByName(g, "龙家剑法").power, 12);
  });
}

export function unknownNameReturnsUndefined() {
  withAssets(() => {
    assert.equal(itemByName({ items: ITEMS }, "不存在"), undefined);
    assert.equal(skillByName({ items: ITEMS, skills: SKILLS }, "不存在"), undefined);
  });
}

// 旧单参签名仍可用（回退到全局 A），但新代码由 check-arch 规则 5 拦截。
export function legacySingleArgStillWorks() {
  withAssets(() => {
    assert.equal(itemByName("凌锋剑").attack, 30);
    assert.equal(skillByName("龙家剑法").power, 12);
  });
}

export function emptyNameIsSafe() {
  withAssets(() => {
    assert.equal(itemByName({ items: ITEMS }, ""), undefined);
    assert.equal(itemByName({ items: ITEMS }, null), undefined);
  });
}
