// 编辑器样式（一次性注入 <style>）。
//
// 设计取向：**桌面端优先**（鼠标 + 键盘 + 大屏信息密度），
// 同时保留移动端响应式（窄屏折叠为抽屉/堆叠）。断点：
//   >= 1280px  宽屏：三栏（导航 / 主区 / 属性栏），属性栏常驻
//   >= 900px   标准：三栏，属性栏可折叠
//   <  900px   窄屏（平板竖屏 / 手机）：导航与属性栏变成抽屉，主区独占
const CSS = `
#editorRoot{position:fixed;inset:0;z-index:100;background:#16181c;color:#d8d8d8;display:flex;flex-direction:column;
  font:13px/1.45 "Microsoft YaHei",SimHei,sans-serif;overflow:hidden;
  --ed-nav-w:168px; --ed-side-w:360px; --ed-gap:0px}
#editorRoot *{box-sizing:border-box}
#editorRoot ::-webkit-scrollbar{width:10px;height:10px}
#editorRoot ::-webkit-scrollbar-track{background:#0c0e11}
#editorRoot ::-webkit-scrollbar-thumb{background:#333a45;border-radius:5px;border:2px solid #0c0e11}
#editorRoot ::-webkit-scrollbar-thumb:hover{background:#46505f}

/* ================= 顶栏 ================= */
.ed-bar{display:flex;align-items:center;gap:8px;padding:6px 12px;background:#0f1114;
  border-bottom:1px solid #2c3038;flex:0 0 auto;min-height:44px;flex-wrap:nowrap;
  overflow-x:auto;overflow-y:hidden;min-width:0}
.ed-title{font-weight:bold;color:#f0d060;margin-right:4px;font-size:14px;white-space:nowrap;flex:0 0 auto}
.ed-verlab{color:#7f8792;font-size:12px;white-space:nowrap}
.ed-sep{width:1px;height:22px;background:#2c3038;flex:0 0 auto;margin:0 2px}
.ed-grp{display:flex;align-items:center;gap:6px;flex:0 0 auto}
.ed-btn{background:#2a2f38;color:#dfe4ea;border:1px solid #3d444f;border-radius:4px;
  padding:5px 11px;cursor:pointer;font-size:12px;white-space:nowrap;
  transition:background .12s,border-color .12s}
.ed-btn:hover{background:#39414d;border-color:#4a5462}
.ed-btn:active{background:#2a3038}
.ed-btn.primary{background:#3f6f3f;border-color:#4f8f4f}
.ed-btn.primary:hover{background:#4c854c}
.ed-btn.danger{background:#6a3030;border-color:#8a4040}
.ed-btn.danger:hover{background:#7d3838}
.ed-btn.ghost{background:transparent;border-color:transparent;color:#9aa2ad;padding:5px 8px}
.ed-btn.ghost:hover{background:#20242b;color:#dfe4ea}
.ed-btnicon{padding:5px 8px;min-width:30px;text-align:center}
.ed-spacer{flex:1;min-width:8px}
.ed-kbd{display:inline-block;background:#0c0e11;border:1px solid #3a414c;border-bottom-width:2px;
  border-radius:3px;padding:0 4px;font:10px/1.5 Consolas,monospace;color:#8b93a0;margin-left:4px}

/* ================= 三栏主体 ================= */
.ed-body{display:flex;flex:1;min-height:0;position:relative;overflow:hidden}

/* ---- 左侧导航 ---- */
.ed-nav{width:var(--ed-nav-w);flex:0 0 auto;background:#111317;border-right:1px solid #2c3038;
  padding:6px 0;overflow-y:auto;overflow-x:hidden}
.ed-nav button{display:flex;align-items:center;gap:7px;width:100%;text-align:left;background:none;
  border:0;color:#c8ccd4;padding:7px 14px;cursor:pointer;font-size:13px;
  border-left:3px solid transparent;transition:background .1s,color .1s}
.ed-nav button:hover{background:#1c2028;color:#e8ecf2}
.ed-nav button.on{background:#2b3a52;color:#fff;border-left-color:#f0d060;padding-left:11px}
.ed-nav .navico{font-size:13px;width:16px;flex:0 0 auto;text-align:center;opacity:.85}
.ed-nav .navlab{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ---- 主区 ---- */
.ed-main{flex:1;min-width:0;overflow:auto;padding:14px 16px}
.ed-side{width:var(--ed-side-w);flex:0 0 auto;background:#111317;border-left:1px solid #2c3038;
  padding:12px 14px;overflow-y:auto;overflow-x:hidden}
.ed-main h3,.ed-side h3{margin:2px 0 12px;color:#f0d060;font-size:14px;
  padding-bottom:6px;border-bottom:1px solid #232830}

/* ---- 可拖拽分栏手柄 ---- */
.ed-resizer{flex:0 0 auto;width:5px;cursor:col-resize;background:transparent;
  position:relative;z-index:5;margin:0 -2px}
.ed-resizer::after{content:"";position:absolute;inset:0 2px;background:#2c3038;transition:background .12s}
.ed-resizer:hover::after,.ed-resizer.dragging::after{background:#f0d060}
body.ed-resizing{cursor:col-resize!important;user-select:none!important}
body.ed-resizing *{cursor:col-resize!important}

/* ================= 表单 ================= */
.ed-row{display:flex;align-items:center;gap:8px;margin:6px 0}
.ed-row label{width:104px;color:#9aa2ad;flex:0 0 auto;font-size:13px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  text-align:right;padding-right:2px;line-height:1.5}
/* 整行字段：大段文本 / 复杂控件独占一行，label 仍在左、控件占满右侧剩余宽度 */
.ed-row.wide{display:block;margin:10px 0}
.ed-row.wide>label{display:block;width:auto;text-align:left;margin-bottom:4px}
.ed-row.wide>textarea{width:100%;box-sizing:border-box;min-height:76px}
.ed-row.wide>input,.ed-row.wide>select{width:100%;box-sizing:border-box}
/* 字段分组：一个语义段一个小标题 */
.ed-group{margin:0 0 14px;padding:8px 10px 4px;border:1px solid #232830;border-radius:5px;background:#14171c;
  display:flex;flex-direction:column;min-width:0}
.ed-grouptitle{color:#f0d060;font-size:12px;font-weight:600;letter-spacing:.4px;
  margin:0 0 6px;padding-bottom:4px;border-bottom:1px solid #232830;opacity:.92}
.ed-ghint{color:#7f8792;font-size:11px;margin:-2px 0 6px}
.ed-row input,.ed-row select,.ed-row textarea{flex:1;min-width:0}
input[type=text],input[type=number],select,textarea{background:#0c0e11;color:#e6e6e6;
  border:1px solid #3a414c;border-radius:4px;padding:4px 7px;
  font:12px/1.4 "Microsoft YaHei",sans-serif;transition:border-color .12s,box-shadow .12s}
input[type=text]:focus,input[type=number]:focus,select:focus,textarea:focus{
  outline:none;border-color:#5a7ab8;box-shadow:0 0 0 2px rgba(90,122,184,.22)}
input[type=checkbox]{width:15px;height:15px;accent-color:#4f8f4f;cursor:pointer;flex:0 0 auto}
textarea{resize:vertical;min-height:60px;font-family:Consolas,"Microsoft YaHei",monospace;line-height:1.5}
/* 代码/JSON/文本编辑器：字号由 .ed-editor 上的 --ed-fs 控制（编辑区内可调） */
.ed-editor{font-size:var(--ed-fs,12px)!important;line-height:1.55;tab-size:2}
.ed-fsbar{display:flex;align-items:center;gap:6px;font-size:11px;color:#7f8792;margin-left:auto}
.ed-fsbar button{background:#22272f;border:1px solid #3a414c;color:#c8ccd4;border-radius:3px;
  width:22px;height:20px;line-height:1;cursor:pointer;font-size:12px;padding:0}
.ed-fsbar button:hover{background:#2c333d;border-color:#5a7ab8}
.ed-fsval{min-width:34px;text-align:center;color:#aeb6c0}
select{cursor:pointer}
.ed-field{display:flex;flex-direction:column;gap:4px;margin:8px 0}
.ed-field>label{color:#9aa2ad;font-size:13px;line-height:1.5}
.ed-field.wide>label{margin-bottom:2px}
.ed-checkrow{display:flex;align-items:center;gap:8px;margin:6px 0}
.ed-checkrow label{color:#c8ccd4;font-size:12px;cursor:pointer;user-select:none}

/* ================= 表格（桌面高密度） ================= */
table.ed-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12px;
  border:1px solid #2c3038;border-radius:4px;overflow:hidden}
table.ed-table th,table.ed-table td{border-bottom:1px solid #232830;padding:5px 9px;
  text-align:left;white-space:nowrap;max-width:180px;overflow:hidden;text-overflow:ellipsis}
table.ed-table th{background:#1c2026;color:#aeb6c0;position:sticky;top:0;z-index:2;
  font-weight:normal;white-space:nowrap;box-shadow:inset 0 -1px 0 #2c3038}
table.ed-table tbody tr{cursor:pointer;transition:background .08s}
table.ed-table tbody tr:nth-child(even) td{background:#15181d}
table.ed-table tbody tr:hover td{background:#1d232b}
table.ed-table tbody tr.on td{background:#2b3a52;color:#fff}
table.ed-table tbody tr.on td:first-child{box-shadow:inset 3px 0 0 #f0d060}
table.ed-table td.num{text-align:right;font-variant-numeric:tabular-nums}

/* ================= 工具栏 / 筛选 ================= */
.ed-tools{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;align-items:center}
.ed-search{position:relative;display:flex;align-items:center}
.ed-search input{padding-left:26px;min-width:180px}
.ed-search::before{content:"🔍";position:absolute;left:8px;font-size:11px;opacity:.6;pointer-events:none}
.ed-chip{background:#232830;border:1px solid #3a414c;border-radius:14px;padding:3px 11px;
  cursor:pointer;font-size:12px;transition:background .1s,border-color .1s;user-select:none}
.ed-chip:hover{background:#2a303a;border-color:#4a5462}
.ed-chip.on{background:#2b3a52;border-color:#f0d060;color:#fff}
.ed-count{margin-left:auto;color:#7f8792;font-size:11px;white-space:nowrap}

/* ================= 列表（左列表 + 右详情，桌面常见布局） ================= */
/* 高度贴合可视区：左侧表格独立滚动，右侧表单独立滚动，两者互不影响。 */
.ed-split{display:flex;gap:12px;align-items:stretch;height:calc(100vh - 138px);min-height:280px}
.ed-split-list{flex:0 0 340px;min-width:0;display:flex;flex-direction:column;
  border:1px solid #2c3038;border-radius:4px;overflow:hidden;background:#111317}
/* 表格滚动容器：sticky 表头需要可滚动的父元素（table 自身不能 overflow） */
.ed-tablescroll{flex:1 1 auto;overflow:auto;min-height:0}
.ed-tablescroll table.ed-table{border:0;border-radius:0}
.ed-split-form{flex:1;min-width:0;overflow:auto;padding-right:4px}
/* 详情面板若是「只放一个整块编辑器」的形态（脚本/AI），让编辑器纵向撑满，
   而不是浮在顶部留一大片空白。 */
.ed-split-form.fill{display:flex;flex-direction:column;overflow:hidden;min-height:0}
/* ================= 行走图（pmg）预览 ================= */
.ed-pmg{margin:4px 0}
.ed-pmg-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.ed-pmg-tabs .ed-btn.on{background:#3a2f10;border-color:#f0d060;color:#f0d060}
.ed-pmg-body{display:flex;flex-direction:column;gap:6px}
.ed-pmg-dir{display:flex;align-items:flex-start;gap:8px}
.ed-pmg-dirlab{flex:0 0 42px;color:#7f8792;font-size:11px;padding-top:6px;text-align:right}
.ed-pmg-strip{display:flex;flex-wrap:wrap;gap:4px;flex:1;min-width:0}
.ed-pmg-cell{position:relative;width:52px;height:64px;border:1px solid #262b33;border-radius:4px;
  background:#0a0b0d;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer}
.ed-pmg-cell:hover{border-color:#4a5260}
.ed-pmg-cell.on{border-color:#f0d060;box-shadow:0 0 0 1px #f0d060 inset}
.ed-pmg-cell img{max-width:100%;max-height:100%;image-rendering:pixelated}
.ed-pmg-idx{position:absolute;right:1px;bottom:0;font-size:9px;color:#5a626d;background:rgba(0,0,0,.6);
  padding:0 2px;border-radius:2px}
/* 表格里的分组分隔行（资源/装饰物列表按目录分组） */
table.ed-table tr.ed-grouprow td{background:#121418;color:#7f8792;font-size:10px;
  letter-spacing:.06em;padding:4px 8px;cursor:default}
.ed-split-form.fill>.ed-group{display:flex;flex-direction:column;min-height:0}
.ed-editorwrap{flex:1 1 auto;min-height:0}
.ed-editorwrap>textarea{flex:1 1 auto;min-height:0;resize:none}
/* 普通多行字段：随内容增高，过高时自身滚动，不无限拉长页面 */
textarea[data-grow]{max-height:420px;overflow:auto}

/* ================= 地图编辑器 ================= */
.ed-main.mapmode{overflow:hidden;display:flex;flex-direction:column;padding:10px;gap:8px}
.ed-map-toolbar{flex:0 0 auto}
.ed-palette{flex:0 0 auto;max-height:180px;overflow:auto;border:1px solid #2c3038;
  border-radius:4px;background:#0c0e11;padding:7px}
.ed-palette-title{color:#9aa2ad;font-size:11px;margin-bottom:5px}
.ed-palette-cv{display:block;cursor:pointer;image-rendering:pixelated}
.ed-map-wrap{position:relative;flex:1 1 auto;min-height:240px;border:1px solid #2c3038;
  border-radius:4px;overflow:hidden;background:#0a0b0d}
.ed-map-wrap canvas.ed-mapcv{position:absolute;inset:0;width:100%;height:100%;
  display:block;cursor:crosshair}

/* ================= 各类拾取器 ================= */
.ed-drops{display:flex;flex-direction:column;gap:5px}
.ed-spawnlist{max-height:200px;overflow:auto;border:1px solid #2c3038;border-radius:4px}
.ed-spawnitem{display:flex;justify-content:space-between;padding:5px 9px;cursor:pointer;
  font-size:12px;border-bottom:1px solid #1c2026;transition:background .08s}
.ed-spawnitem:hover{background:#1d232b}
.ed-spawnitem.on{background:#2b3a52;color:#fff}
.ed-spawnitem.on::before{content:"▸ ";color:#f0d060}
.ed-spawnitem .dim{color:#7f8792}
.ed-sprgrid{overflow-x:auto;border:1px solid #2c3038;border-radius:4px;padding:5px;background:#0c0e11}
.ed-sprrow{display:flex;align-items:center;gap:2px;margin-bottom:2px}
.ed-sprlab{width:36px;flex:0 0 auto;color:#9aa2ad;font-size:11px}
.ed-sprcell{width:32px;height:40px;flex:0 0 auto;display:flex;flex-direction:column;
  align-items:center;justify-content:flex-end;background:#111317;
  border:1px solid #232830;border-radius:3px;transition:border-color .1s}
.ed-sprcell:hover{border-color:#4a5a78}
.ed-sprimg{max-width:30px;max-height:30px;image-rendering:pixelated}
.ed-sprcell .dim{font-size:9px;color:#6b727c;line-height:1}
.ed-faceimg{width:64px;height:64px;object-fit:contain;image-rendering:pixelated;
  background:#0c0e11;border:1px solid #2c3038;border-radius:4px}
.ed-thumbgrid{display:flex;flex-wrap:wrap;gap:5px;max-height:280px;overflow:auto;padding:4px;
  border:1px solid #2c3038;border-radius:4px;background:#0c0e11}
.ed-thumbcell{width:64px;display:flex;flex-direction:column;align-items:center;gap:2px;
  background:#111317;border:1px solid #232830;border-radius:4px;padding:3px;cursor:pointer;
  transition:border-color .1s,background .1s}
.ed-thumbcell:hover{border-color:#4a5a78;background:#181c22}
.ed-thumbcell.on{border-color:#f0d060;background:#2b3a52}
.ed-thumbcell img{max-width:56px;max-height:56px;image-rendering:pixelated}
.ed-thumbcell span{font-size:10px;color:#aeb6c0;text-align:center;word-break:break-all;line-height:1.15}
.ed-thumbcell .dim{color:#6b727c;font-size:9px}
.ed-tilegrid{display:flex;flex-wrap:wrap;gap:1px;max-height:200px;overflow:auto;padding:4px;
  border:1px solid #2c3038;border-radius:4px;background:#0c0e11}
.ed-tileimg{image-rendering:pixelated;cursor:pointer;border:1px solid transparent;flex:0 0 auto}
.ed-tileimg:hover{border-color:#4a5a78}
.ed-tileimg.on{border-color:#f0d060}
.ed-objwrap{max-height:240px;overflow:auto;padding:4px;border:1px solid #2c3038;
  border-radius:4px;background:#0c0e11}
.ed-objcanvas{display:block;cursor:pointer;image-rendering:pixelated}
.ed-imgwrap{display:flex;align-items:center;gap:8px;margin:-2px 0 8px 112px}
.ed-fieldimg{max-width:56px;max-height:56px;image-rendering:pixelated;background:#0c0e11;
  border:1px solid #2c3038;border-radius:4px;object-fit:contain}
.ed-imghint{color:#6b727c;font-size:11px}

/* ================= 其它 ================= */
.ed-hint{color:#7f8792;font-size:11px;margin-top:6px;line-height:1.5}
/* 布局分两层，与 NPC/物品/Buff 列表页保持一致：
   ① .ed-grid 是**分组卡片**的容器 → 卡片本身横向排布（宽了就自动换行）；
   ② .ed-group 卡片内部 → 字段纵向单行排列（label 在左、控件在右）。
   这样「几个语义分组并排成几列、每列里字段竖着排」，不会横向散乱。 */
.ed-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));
  gap:8px 14px;align-items:start}
/* 卡片内部的字段容器也必须单列（本规则要放在 .ed-grid 之后，否则被覆盖） */
.ed-group>.ed-grid{grid-template-columns:1fr;gap:6px}
.ed-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#2b3a52;
  color:#fff;padding:9px 18px;border-radius:5px;border:1px solid #4a5a78;
  opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;z-index:110;
  box-shadow:0 6px 24px rgba(0,0,0,.5);white-space:nowrap}
.ed-toast.show{opacity:1;transform:translateX(-50%) translateY(-3px)}
.ed-empty{color:#6b727c;font-size:12px;padding:24px 12px;text-align:center;font-style:italic}
.ed-section{margin-bottom:18px}
.ed-section>.ed-sechead{display:flex;align-items:center;gap:8px;cursor:pointer;
  user-select:none;padding:6px 0;color:#aeb6c0;font-size:12px;font-weight:bold;
  border-bottom:1px solid #232830;margin-bottom:8px}
.ed-section>.ed-sechead::before{content:"▾";font-size:10px;color:#7f8792;transition:transform .12s}
.ed-section.closed>.ed-sechead::before{transform:rotate(-90deg)}
.ed-section.closed>.ed-secbody{display:none}

/* ================= 抽屉按钮（窄屏显示） ================= */
.ed-drawerbtn{display:none}

/* ================= 响应式：< 900px 抽屉化 ================= */
@media (max-width:900px){
  .ed-nav{position:absolute;left:0;top:0;bottom:0;z-index:20;width:min(78vw,260px);
    transform:translateX(-100%);transition:transform .2s;box-shadow:4px 0 16px rgba(0,0,0,.5)}
  .ed-nav.open{transform:translateX(0)}
  /* 抽屉必须完全移出可视区，否则仍会撑出横向滚动条 */
  .ed-side{position:absolute;right:0;top:0;bottom:0;z-index:20;width:min(88vw,360px);
    transform:translateX(100%);transition:transform .2s;box-shadow:-4px 0 16px rgba(0,0,0,.5);
    visibility:hidden;pointer-events:none}
  .ed-side.open{transform:translateX(0);visibility:visible;pointer-events:auto}
  .ed-resizer{display:none}
  .ed-drawerbtn{display:inline-flex;align-items:center;justify-content:center}
  .ed-main{padding:10px}
  /* 窄屏：双栏变上下堆叠，高度自适应（不再锁视口高） */
  .ed-split{flex-direction:column;height:auto}
  .ed-split-list{flex:0 0 auto;width:100%;max-height:46vh}  .ed-split-form{max-height:none;overflow:visible}
  .ed-bar{overflow-x:auto;scrollbar-width:none}
  .ed-bar::-webkit-scrollbar{display:none}
  .ed-title{display:none}
  .ed-imgwrap{margin-left:0}
  .ed-row{flex-wrap:wrap}
  .ed-row label{width:100%}
}
@media (max-width:600px){
  .ed-grid{grid-template-columns:1fr}
  .ed-bar{padding:6px 8px;gap:6px}
  .ed-btn{padding:6px 9px;font-size:12px}
  .ed-kbd{display:none}
  .ed-verlab{display:none}
}

/* 窄屏抽屉遮罩 */
.ed-scrim{position:absolute;inset:0;background:rgba(0,0,0,.45);z-index:15;display:none}
.ed-scrim.on{display:block}


/* ================= 列表行首缩略图 ================= */
table.ed-table th.ed-thumb,table.ed-table td.ed-thumb{
  width:38px;padding:2px 4px 2px 6px;text-align:center;vertical-align:middle}
table.ed-table td.ed-thumb img{width:30px;height:30px;object-fit:contain;
  background:#0a0b0d;border:1px solid #22262d;border-radius:3px;image-rendering:pixelated;display:block}
table.ed-table tbody tr.on td.ed-thumb img{border-color:#f0d060}

/* ================= 图片字段（预览 + 更换按钮） ================= */
.ed-imgfield{display:flex;flex-direction:column;gap:6px;flex:1;min-width:0}
/* 右侧详情里的预览图：这里是「看清这张图长什么样」的地方，
   要和左侧列表的 32px 小缩略图区分开，所以默认给到 96px
   （素材原始尺寸：物品/技能图标 32px、头像 63x80、UI 图最大 640x480）。
   图标类放大 3 倍仍然锐利（pixelated 不模糊），头像/立绘接近原大。
   帧动画序列张数多，用 72px 免得把表单撑太长。 */
.ed-imgthumbs{display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:40px}
.ed-imgthumbs img{width:96px;height:96px;object-fit:contain;background:#0a0b0d;
  border:1px solid #2c3038;border-radius:4px;image-rendering:pixelated}
/* 帧序列：格子略小、一行放得下多张 */
.ed-imgthumbs.frames img{width:72px;height:72px}

/* 图片占位块：没有图片 / 加载失败时显示的**空图案**。
   尺寸与真实预览图一致，切换时布局不跳；虚线框让它一眼看出是"空位"而非坏图。 */
.ed-imgslot{display:inline-flex;position:relative;vertical-align:middle}
.ed-imgph{width:96px;height:96px;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:4px;background:#0d1014;border:1px dashed #333a45;border-radius:4px;
  color:#5c636e;overflow:hidden}
.ed-imgph.small{width:72px;height:72px}
.ed-imgph-icon{font-size:22px;line-height:1;opacity:.5;filter:grayscale(1)}
.ed-imgph-text{font-size:10px;line-height:1.2;text-align:center;padding:0 4px;
  word-break:break-all;max-width:100%}
/* 左侧列表格子里的占位：跟随单元格大小，只留图标 */
.ed-thumb .ed-imgph,.ed-imgph.cell{width:26px;height:26px;min-width:26px;min-height:26px;
  border-radius:2px;border-style:dashed}
.ed-thumb .ed-imgph-icon,.ed-imgph.cell .ed-imgph-icon{font-size:12px;opacity:.45}
.ed-thumb .ed-imgph-text,.ed-imgph.cell .ed-imgph-text{display:none}
.ed-imgthumbs .ed-imghint{color:#6b737e;font-size:11px}

/* ================= 资源选择弹窗 ================= */
.ed-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.66);z-index:10000;
  display:flex;align-items:center;justify-content:center;padding:18px}
.ed-modal{display:flex;flex-direction:column;width:min(980px,96vw);height:min(720px,92vh);
  background:#171a1f;border:1px solid #3a414c;border-radius:6px;overflow:hidden;
  box-shadow:0 18px 54px rgba(0,0,0,.65)}
.ed-modal-head{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:9px 12px;
  border-bottom:1px solid #2c3038;background:#1c2026}
.ed-modal-title{font-size:13px;font-weight:600;color:#f0d060;flex:1}
.ed-btnicon{width:26px;height:26px;padding:0;line-height:1;display:flex;align-items:center;justify-content:center}
.ed-chk{display:flex;align-items:center;gap:5px;font-size:11px;color:#9aa2ad;cursor:pointer;user-select:none}
.ed-modal-body{flex:1 1 auto;min-height:0;display:flex;gap:0}
.ed-modal-list{flex:0 0 46%;min-width:0;overflow:auto;border-right:1px solid #2c3038;
  padding:4px;display:flex;flex-direction:column;gap:1px}
.ed-modal-group{position:sticky;top:0;z-index:1;background:#121418;color:#7f8792;
  font-size:10px;letter-spacing:.06em;padding:5px 8px;border-bottom:1px solid #232830}
.ed-modal-item{display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:3px;
  cursor:pointer;transition:background .08s}
.ed-modal-item:hover{background:#20262e}
.ed-modal-item.on{background:#2b3a52}
.ed-modal-item.cur{box-shadow:inset 0 0 0 1px #f0d060}
.ed-modal-item img{width:32px;height:32px;object-fit:contain;flex:0 0 auto;
  background:#0a0b0d;border:1px solid #22262d;border-radius:3px;image-rendering:pixelated}
.ed-modal-name{font-size:11px;color:#c3cad3;word-break:break-all;line-height:1.25}
.ed-modal-item.on .ed-modal-name{color:#fff}
.ed-modal-prev{flex:1;min-width:0;overflow:auto;padding:12px;display:flex;
  flex-direction:column;gap:8px;align-items:center}
.ed-modal-big{flex:0 0 auto;display:flex;align-items:center;justify-content:center;
  width:100%;min-height:180px;background:#0a0b0d;border:1px solid #22262d;border-radius:4px;padding:10px}
.ed-modal-big img{max-width:100%;max-height:300px;object-fit:contain;image-rendering:pixelated}
.ed-modal-path{font-size:11px;color:#7f8792;word-break:break-all;text-align:center}
.ed-modal-strip{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;width:100%}
.ed-modal-frame{position:relative;cursor:pointer;border:1px solid #2c3038;border-radius:3px;overflow:hidden}
.ed-modal-frame img{width:40px;height:40px;object-fit:contain;background:#0a0b0d;image-rendering:pixelated;display:block}
.ed-modal-frame span{position:absolute;right:1px;bottom:0;font-size:9px;color:#aeb6c0;
  background:rgba(0,0,0,.6);padding:0 2px}
.ed-modal-frame.on{border-color:#f0d060}
.ed-modal-foot{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:9px 12px;
  border-top:1px solid #2c3038;background:#1c2026}
.ed-modal-foot .ed-btn:last-child{margin-left:auto}
@media (max-width:900px){
  .ed-modal-body{flex-direction:column}
  .ed-modal-list{flex:0 0 42%;border-right:0;border-bottom:1px solid #2c3038}
  .ed-modal-big{min-height:120px}
}
.ed-decor-big{max-width:180px;max-height:180px;object-fit:contain;background:#0a0b0d;
  border:1px solid #2c3038;border-radius:4px;image-rendering:pixelated}
/* ---- 音频详情：波形 + 进度 + 元数据 ---- */
/* 宽度由 JS（audio-view.js 的 resize）按容器实际宽度 + DPR 设定，
   这里不再写 width:100% —— 否则 CSS 拉伸与 canvas 绘制缓冲宽度不一致，
   会导至“播放头/高亮位置与实际播放位置偏离”。 */
.ed-wavewrap{position:relative;margin:4px 0 8px;width:100%}
.ed-wave{display:block;height:88px;border:1px solid #2c3038;border-radius:4px;
  background:#0b0d11;cursor:pointer;max-width:100%}
.ed-wave-msg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  color:#6b727c;font-size:12px;pointer-events:none}
.ed-wave-time{font-size:12px;color:#9aa3b0;font-variant-numeric:tabular-nums;white-space:nowrap}
/* 音高滑块 */
.ed-pitch{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
.ed-pitch input[type=range]{accent-color:#e8be52}
/* 键值表：文件名/路径/大小/时长/采样率… */
.ed-kv{display:grid;grid-template-columns:88px 1fr;gap:4px 10px;margin:2px 0 4px;font-size:12px}
.ed-kv dt{color:#6b737e;text-align:right}
.ed-kv dd{margin:0;color:#c8ced8;word-break:break-all}
.ed-kv dd.mono{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#9aa3b0}

/* ---- 行走图选择弹窗（模型网格） ---- */
.ed-modelgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:6px;padding:8px}
.ed-modelcell{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 4px;
  border:1px solid #2c3038;border-radius:4px;background:#15181d;cursor:pointer;
  transition:background .1s,border-color .1s}
.ed-modelcell:hover{background:#1d232b;border-color:#3a414c}
.ed-modelcell.on{background:#2b3a52;border-color:#f0d060}
.ed-modelcell img{width:40px;height:56px;object-fit:contain}
.ed-modelcell span{font-size:11px;color:#aeb6c0;max-width:100%;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
.ed-modelcell.on span{color:#fff}
/* 行走图字段里显示的模型名 */
.ed-modelname{font-size:12px;color:#aeb6c0;align-self:center}

`;

export function injectStyle() {
  if (document.getElementById("editorStyle")) return;
  const s = document.createElement("style");
  s.id = "editorStyle"; s.textContent = CSS;
  document.head.appendChild(s);
}
