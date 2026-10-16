// 编辑器样式（一次性注入 <style>）。
const CSS = `
#editorRoot{position:fixed;inset:0;z-index:100;background:#16181c;color:#d8d8d8;display:flex;flex-direction:column;
  font:13px/1.45 "Microsoft YaHei",SimHei,sans-serif}
#editorRoot *{box-sizing:border-box}
.ed-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#0f1114;border-bottom:1px solid #2c3038;flex:0 0 auto}
.ed-title{font-weight:bold;color:#f0d060;margin-right:8px}
.ed-btn{background:#2a2f38;color:#dfe4ea;border:1px solid #3d444f;border-radius:3px;padding:4px 10px;cursor:pointer;font-size:12px}
.ed-btn:hover{background:#39414d}
.ed-btn.primary{background:#3f6f3f;border-color:#4f8f4f}
.ed-btn.primary:hover{background:#4c854c}
.ed-btn.danger{background:#6a3030;border-color:#8a4040}
.ed-spacer{flex:1}
.ed-body{display:flex;flex:1;min-height:0}
.ed-nav{width:150px;flex:0 0 auto;background:#111317;border-right:1px solid #2c3038;padding:8px 0;overflow:auto}
.ed-nav button{display:block;width:100%;text-align:left;background:none;border:0;color:#c8ccd4;padding:8px 14px;cursor:pointer;font-size:13px}
.ed-nav button:hover{background:#20242b}
.ed-nav button.on{background:#2b3a52;color:#fff;border-left:3px solid #f0d060;padding-left:11px}
.ed-main{flex:1;min-width:0;overflow:auto;padding:12px}
.ed-side{width:340px;flex:0 0 auto;background:#111317;border-left:1px solid #2c3038;padding:12px;overflow:auto}
.ed-main h3,.ed-side h3{margin:2px 0 10px;color:#f0d060;font-size:14px}
.ed-row{display:flex;align-items:center;gap:8px;margin:5px 0}
.ed-row label{width:96px;color:#9aa2ad;flex:0 0 auto;font-size:12px}
.ed-row input,.ed-row select,.ed-row textarea{flex:1;min-width:0}
input[type=text],input[type=number],select,textarea{background:#0c0e11;color:#e6e6e6;border:1px solid #3a414c;border-radius:3px;padding:3px 6px;font:12px/1.4 "Microsoft YaHei",sans-serif}
textarea{resize:vertical}
table.ed-table{width:100%;border-collapse:collapse;font-size:12px}
table.ed-table th,table.ed-table td{border:1px solid #2c3038;padding:4px 8px;text-align:left}
table.ed-table th{background:#1c2026;color:#aeb6c0;position:sticky;top:0}
table.ed-table tr{cursor:pointer}
table.ed-table tr:hover td{background:#1d232b}
table.ed-table tr.on td{background:#2b3a52;color:#fff}
.ed-tools{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;align-items:center}
.ed-chip{background:#232830;border:1px solid #3a414c;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:12px}
.ed-chip.on{background:#2b3a52;border-color:#f0d060;color:#fff}
.ed-mapcv{background:#0a0b0d;border:1px solid #2c3038;border-radius:3px;display:block;cursor:crosshair}
.ed-hint{color:#7f8792;font-size:11px;margin-top:6px}
.ed-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#2b3a52;color:#fff;padding:8px 16px;border-radius:4px;
  border:1px solid #4a5a78;opacity:0;transition:opacity .2s;pointer-events:none;z-index:110}
.ed-toast.show{opacity:1}
.ed-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 14px}
/* ---- 地图编辑器：自适应铺满 ---- */
.ed-main.mapmode{overflow:hidden;display:flex;flex-direction:column;padding:8px;gap:6px}
.ed-map-toolbar{flex:0 0 auto}
.ed-palette{flex:0 0 auto;max-height:172px;overflow:auto;border:1px solid #2c3038;border-radius:3px;background:#0c0e11;padding:6px}
.ed-palette-title{color:#9aa2ad;font-size:11px;margin-bottom:4px}
.ed-palette-cv{display:block;cursor:pointer;image-rendering:pixelated}
.ed-map-wrap{position:relative;flex:1 1 auto;min-height:220px;border:1px solid #2c3038;border-radius:3px;overflow:hidden;background:#0a0b0d}
.ed-map-wrap canvas.ed-mapcv{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair}
.ed-field{display:flex;flex-direction:column;gap:3px;margin:6px 0}
.ed-field>label{color:#9aa2ad;font-size:12px}
.ed-drops{display:flex;flex-direction:column;gap:4px}
.ed-spawnlist{max-height:180px;overflow:auto;border:1px solid #2c3038;border-radius:3px}
.ed-spawnitem{display:flex;justify-content:space-between;padding:4px 8px;cursor:pointer;font-size:12px;border-bottom:1px solid #1c2026}
.ed-spawnitem:hover{background:#1d232b}
.ed-spawnitem.on{background:#2b3a52;color:#fff}
.ed-spawnitem .dim{color:#7f8792}
/* ---- 单位/素材缩略图、行走图预览、地面贴图 ---- */
.ed-sprgrid{overflow-x:auto;border:1px solid #2c3038;border-radius:3px;padding:4px;background:#0c0e11}
.ed-sprrow{display:flex;align-items:center;gap:2px;margin-bottom:2px}
.ed-sprlab{width:34px;flex:0 0 auto;color:#9aa2ad;font-size:11px}
.ed-sprcell{width:30px;height:38px;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;background:#111317;border:1px solid #232830;border-radius:2px}
.ed-sprimg{max-width:28px;max-height:28px;image-rendering:pixelated}
.ed-sprcell .dim{font-size:9px;color:#6b727c;line-height:1}
.ed-faceimg{width:64px;height:64px;object-fit:contain;image-rendering:pixelated;background:#0c0e11;border:1px solid #2c3038;border-radius:3px}
.ed-thumbgrid{display:flex;flex-wrap:wrap;gap:4px;max-height:260px;overflow:auto;padding:3px;border:1px solid #2c3038;border-radius:3px;background:#0c0e11}
.ed-thumbcell{width:58px;display:flex;flex-direction:column;align-items:center;gap:1px;background:#111317;border:1px solid #232830;border-radius:3px;padding:2px;cursor:pointer}
.ed-thumbcell:hover{border-color:#4a5a78}
.ed-thumbcell.on{border-color:#f0d060;background:#2b3a52}
.ed-thumbcell img{max-width:50px;max-height:50px;image-rendering:pixelated}
.ed-thumbcell span{font-size:10px;color:#aeb6c0;text-align:center;word-break:break-all;line-height:1.1}
.ed-thumbcell .dim{color:#6b727c;font-size:9px}
.ed-tilegrid{display:flex;flex-wrap:wrap;gap:1px;max-height:190px;overflow:auto;padding:3px;border:1px solid #2c3038;border-radius:3px;background:#0c0e11}
.ed-tileimg{image-rendering:pixelated;cursor:pointer;border:1px solid transparent;flex:0 0 auto}
.ed-tileimg:hover{border-color:#4a5a78}
.ed-tileimg.on{border-color:#f0d060}
.ed-objwrap{max-height:230px;overflow:auto;padding:3px;border:1px solid #2c3038;border-radius:3px;background:#0c0e11}
.ed-objcanvas{display:block;cursor:pointer;image-rendering:pixelated}
/* ---- 表单图片字段预览 ---- */
.ed-imgwrap{display:flex;align-items:center;gap:8px;margin:-2px 0 6px 104px}
.ed-fieldimg{max-width:56px;max-height:56px;image-rendering:pixelated;background:#0c0e11;border:1px solid #2c3038;border-radius:3px;object-fit:contain}
.ed-imghint{color:#6b727c;font-size:11px}
`;

export function injectStyle() {
  if (document.getElementById("editorStyle")) return;
  const s = document.createElement("style");
  s.id = "editorStyle"; s.textContent = CSS;
  document.head.appendChild(s);
}
