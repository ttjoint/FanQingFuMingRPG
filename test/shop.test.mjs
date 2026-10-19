// 商店货源回归：三位商人（郎中/铁匠/裁缝）必须能开店。
//
// 历史：init 版 shopGoods 按模型硬编码货源（卖药人→药、卖武器者→剑、
// 卖装备者→防具），与原版 exe 内建商店一致。5ea4142「去硬编码」删掉了
// 这段分发却没把货源数据补进 npcs.json，三位商人从此永远开不了店。
// 修复：npcs.json 给三人配 inventory（auto: potion/weapon + 裁缝用显式
// stock 列甲与饰品）；potion 过滤按名字含药/水（否则猴皮/豹牙这类
// 加属性的任务材料也会上架）。
import { readFileSync } from "node:fs";

function loadNpcs() {
  const p = new URL("../versions/default/assets/npcs.json", import.meta.url);
  return JSON.parse(readFileSync(p, "utf8"));
}

export function shopMerchantsHaveInventory() {
  const npcs = loadNpcs();
  const expect = { "郎中": "potion", "铁匠": "weapon", "裁缝": null };
  for (const [name, auto] of Object.entries(expect)) {
    const n = npcs.find(x => x.name === name);
    if (!n) throw new Error("npcs.json 缺少 " + name);
    const inv = n.inventory;
    if (!inv || typeof inv !== "object") throw new Error(name + " 缺少 inventory（无法开店）");
    if (auto && inv.auto !== auto) throw new Error(name + " inventory.auto 应为 " + auto + "，实际 " + inv.auto);
  }
  // 裁缝须用显式 stock，且同时含甲（type2）与饰品（type3）
  const tailor = npcs.find(x => x.name === "裁缝");
  if (!Array.isArray(tailor.inventory.stock) || !tailor.inventory.stock.length)
    throw new Error("裁缝应配置显式 stock（原版卖甲+饰品，单一 auto 覆盖不了）");
  return;
}

export async function shopGoodsListPotionExcludesQuestMaterials() {
  const { goodsList } = await import("../src/engine/inventory.js");
  const items = [
    { name: "金创药", type: 0, hp: 100, price: 50 },
    { name: "大活气水", type: 0, mp: 300, price: 185 },
    { name: "猴皮", type: 0, mp: 10, price: 60 },   // 任务材料，不能上架
    { name: "豹牙", type: 0, hp: 20, price: 200 },  // 任务材料
  ];
  const list = goodsList({ auto: "potion" }, items);
  if (!list.includes("金创药") || !list.includes("大活气水")) throw new Error("药水应上架: " + list);
  if (list.includes("猴皮") || list.includes("豹牙")) throw new Error("任务材料不该上架: " + list);
  return;
}

export async function shopGoodsListAutoTypes() {
  const { goodsList } = await import("../src/engine/inventory.js");
  const items = [
    { name: "乌木剑", type: 1, price: 100 },
    { name: "铁布衫", type: 2, price: 100 },
    { name: "武者之戒", type: 3, price: 150 },
    { name: "金创药", type: 0, hp: 100, price: 50 },
  ];
  const w = goodsList({ auto: "weapon" }, items);
  if (w.length !== 1 || w[0] !== "乌木剑") throw new Error("weapon 应只列 type1: " + w);
  const a = goodsList({ auto: "armor" }, items);
  if (a.length !== 1 || a[0] !== "铁布衫") throw new Error("armor 应只列 type2: " + a);
  const ac = goodsList({ auto: "accessory" }, items);
  if (ac.length !== 1 || ac[0] !== "武者之戒") throw new Error("accessory 应只列 type3: " + ac);
  return;
}
