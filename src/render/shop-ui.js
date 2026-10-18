// 商店面板绘制：与背包共用 packpanel.png 布局，位于屏幕左侧，底部正中为关闭按钮。
import { G } from "../core/state.js";
import { ctx } from "../core/constants.js";
import { getImg } from "../core/assets.js";
import { itemByName } from "../core/registry.js";
import { SHOP_BOX, SHOP_COLS, SHOP_ROWS, shopSlotPos, shopCloseBtn, uiRect, uiSlotRect, uiComp } from "../core/layout.js";
import { drawItemSlot } from "./hud.js";

export function drawShop() {
  if (!G.shop) return;
  // 面板矩形优先取可编辑 UI 配置（在编辑器里挪动商店 → 这里跟着走）；缺失才回退旧常量。
  const B = uiRect("shop.panel") || SHOP_BOX;
  const gridC = uiComp("shop.grid");
  const cols = gridC ? gridC.cols : SHOP_COLS;
  const rows = gridC ? gridC.rows : SHOP_ROWS;
  const P = getImg("assets/ui/packpanel.png");
  if (P) ctx.drawImage(P, B.x, B.y, B.w, B.h);
  else {
    ctx.fillStyle = "#d8c48c"; ctx.fillRect(B.x, B.y, B.w, B.h);
    ctx.strokeStyle = "#7a5a2a"; ctx.lineWidth = 2; ctx.strokeRect(B.x + .5, B.y + .5, B.w - 1, B.h - 1); ctx.lineWidth = 1;
  }
  // 标题 + 银两（顶部木框内）
  ctx.fillStyle = "#4a3410"; ctx.font = "bold 13px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.fillText("商店", B.x + 12, B.y + 22);
  ctx.fillStyle = "#7a3a10"; ctx.font = "bold 12px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.textAlign = "right"; ctx.fillText("银两 " + G.stats.money, B.x + B.w - 12, B.y + 22); ctx.textAlign = "left";

  // 商品格（与 packpanel 画的格子对齐；图标走与背包同一个 drawItemSlot，保证尺寸/内边距一致）
  const total = cols * rows;
  for (let i = 0; i < total; i++) {
    const p = uiSlotRect("shop.grid", i) || shopSlotPos(i);
    if (i >= G.shop.goods.length) continue;
    const name = G.shop.goods[i];
    const it = itemByName(name);
    drawItemSlot({ name }, p.x, p.y, 38, 38);
    if (it && it.price > 0) {
      ctx.fillStyle = "#5a3a10"; ctx.font = "9px 'Microsoft YaHei',SimHei,sans-serif";
      // 价格靠右下角，带描边保证叠在图标上仍可读
      ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
      ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,248,220,0.9)"; ctx.strokeText(String(it.price), p.x + 36, p.y + 36);
      ctx.fillText(String(it.price), p.x + 36, p.y + 36); ctx.textAlign = "left";
    }
  }

  // 底部正中牌匾 = 关闭按钮
  const c = uiRect("shop.close") || shopCloseBtn();
  const cb = getImg("assets/ui/closebtn.png");
  if (cb) ctx.drawImage(cb, c.x, c.y, c.w, c.h);
  else {
    ctx.fillStyle = "#2a2f38"; ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = "#b8a468"; ctx.strokeRect(c.x + .5, c.y + .5, c.w - 1, c.h - 1);
    ctx.fillStyle = "#ffe9a8"; ctx.font = "12px 'Microsoft YaHei',SimHei,sans-serif";
    ctx.textAlign = "center"; ctx.fillText("关闭", c.x + c.w / 2, c.y + 14); ctx.textAlign = "left";
  }
  // 两侧操作提示
  ctx.fillStyle = "#6a4a20"; ctx.font = "10px 'Microsoft YaHei',SimHei,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("左键买卖", B.x + 42, B.y + 292);
  ctx.fillText("右键快买", B.x + 160, B.y + 292);
  ctx.textAlign = "left";
}
