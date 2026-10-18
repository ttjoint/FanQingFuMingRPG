// 内容包（版本）的纯模型：新建 / 校验 / 规范化。与存储（localStorage / IndexedDB）解耦，
// 便于在 Node 里做单元测试。
import { PACK_FORMAT, PACK_VERSION } from "./schema.js";

export function newPackId() { return "p" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

export function createPackObj(name, patch, images) {
  return {
    format: PACK_FORMAT, version: PACK_VERSION, id: newPackId(),
    name: name || "新版本", base: "__default__",
    patch: patch || {}, images: images || {}, updatedAt: Date.now(),
  };
}

// 校验并规范化（向后兼容：缺失字段补齐，过新版本拒绝）。
export function normalizePack(o) {
  if (!o || typeof o !== "object") throw new Error("不是有效的版本文件");
  if (o.format && o.format !== PACK_FORMAT) throw new Error("不是有效的版本文件（format 不符）");
  const v = o.version || (o.domains ? 1 : PACK_VERSION);
  if (v > PACK_VERSION) throw new Error("版本文件过新（v" + v + "），请升级本编辑器");
  const pack = {
    format: PACK_FORMAT, version: PACK_VERSION,
    id: o.id || newPackId(), name: o.name || "导入版本", base: o.base || "__default__",
    patch: o.patch || {}, images: o.images || {}, updatedAt: o.updatedAt || Date.now(),
  };
  // 旧的 domains 格式不再兼容（按约定：测试期存档无需兼容）。
  if (o.domains && !o.patch) pack.patch = { legacyDomains: o.domains };
  return pack;
}
