// 运行时「组件」契约：集中定义实体字段的默认值与分组（Transform/Sprite/Stats/…）。
// 实体仍是扁平对象，`attachAll` 只补齐缺失字段——见 engine/ecs.js。
import { defineComponent } from "../engine/ecs.js";

export const Transform = defineComponent("transform", { x: 0, y: 0, dir: 4, vx: 0, vy: 0, row: 0, col: 0 });
export const Sprite = defineComponent("sprite", { model: "role", action: "stand", frame: 0, ft: 0 });
export const Stats = defineComponent("stats", { hp: 0, hpMax: 0, atk: 0, def: 0, level: 1, exp: 0 });
export const Motion = defineComponent("motion", { path: null, speed: 45, runSpeed: 70, running: false, target: null, moveGoal: null, stuckT: 0, pickup: null });
export const AI = defineComponent("behavior", { ai: 0, aggro: false, aggressive: false, attackCD: 0, wanderT: 0, dieT: 0, dmgT: 0, talkT: 0 });
export const Combat = defineComponent("combat", { attackable: false, atkT: 0, dead: false });
export const Collider = defineComponent("collider", { radiusX: 0 });   // 0 = 用 UNIT_RX 默认（不要在这里写死，否则会覆盖默认半径）
export const Loot = defineComponent("loot", { drops: [] });

// 单位（玩家 / NPC）共用的组件集合。
export const UNIT_COMPONENTS = [Transform, Sprite, Stats, Motion, AI, Combat, Collider, Loot];
