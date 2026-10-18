// 音频标签页：列出「默认版本 + 当前版本」的全部音乐/音效，可试听、可上传。
//
// 从 editor/index.js 拆出（P5）。这一页整体自洽——只读内容与素材索引、
// 只写 ED.sounds（上传覆盖表），不参与其它页的编辑状态。
import { A } from "../core/state.js";
import { h, clear } from "./dom.js";
import { mkSplitResizer } from "./fields.js";
import { waveBar, decodePeaks, prefetchPeaks, fmtTime, fmtSize } from "./audio-view.js";
import { buildAssetIndexAsync, audioIndex, musicFiles, soundFiles, audioSrc } from "./assets-index.js";
import { readImageFile } from "../content/store.js";
import { edCtx, rhint } from "./ed-ctx.js";

// ---------- 音频（音乐 / 音效）----------
// 之前音乐/音效都是手打文件名的文本框，容易打错且无从确认文件是否存在。
// 这一页把版本里的音频全部列出来，可试听；其它分页的音频字段改成从这里选。
export function tabAudio() {
  const { mainEl, ED, mark } = edCtx();
  mainEl.append(h("h3", null, "音频（音乐 / 音效）"));
  mainEl.append(rhint("列出「默认版本 + 当前版本」的全部音频。上传的新音频以 data URL 存进当前版本。"
    + "其它分页里的音乐/音效字段会直接从这里选，不再手打文件名。"));

  const idx0 = buildAssetIndexAsync({
    versions: null, currentId: ED.id, images: ED.images,
    items: ED.items, skills: ED.skills, npcs: ED.npcs, buffs: ED.buffs || [],
    charsMap: A.chars || {}, maps: Object.values(ED.maps || {}),
  });
  // 编辑器里上传的音频覆盖表（与图片的 ED.images 同机制，独立存放以免混淆）
  if (!ED.sounds) ED.sounds = {};

  const split = h("div", { class: "ed-split" });
  const left = h("div", { class: "ed-split-list" });
  const right = h("div", { class: "ed-split-form" });
  split.append(left, mkSplitResizer("audio", left), right);
  mainEl.append(split);

  let query = "";
  let selPath = null;
  let list = [];

  const searchIn = h("input", { type: "text", placeholder: "搜索音频文件名…" });
  const cntEl = h("span", { class: "ed-count" });
  left.append(h("div", { class: "ed-tools", style: "padding:6px" }, h("div", { class: "ed-search" }, searchIn), cntEl));
  const listWrap = h("div", { class: "ed-tablescroll" });
  left.append(listWrap);

  const rows = new Map();
  const highlight = () => { for (const [k, tr] of rows) tr.classList.toggle("on", k === selPath); };

  const drawList = () => {
    rows.clear();
    clear(listWrap);
    const q = query.trim().toLowerCase();
    const show = q ? list.filter(x => x.toLowerCase().includes(q)) : list;
    cntEl.textContent = "共 " + list.length + " 个文件" + (q ? " / 显示 " + show.length : "");
    const tbl = h("table", { class: "ed-table" });
    tbl.append(h("thead", null, h("tr", null, h("th", null, "文件"), h("th", null, "目录"), h("th", null, "状态"))));
    const tb = h("tbody");
    let lastG = null;
    for (const p2 of show) {
      const g = p2.includes("/sound/") ? "音效 sound/" : "音乐 music/";
      if (g !== lastG) { tb.append(h("tr", { class: "ed-grouprow" }, h("td", { colspan: 3 }, g))); lastG = g; }
      const tr = h("tr", { class: p2 === selPath ? "on" : "" });
      const over = !!ED.sounds[p2];
      tr.append(h("td", { style: "font-size:11px;word-break:break-all" }, p2.split("/").pop()),
        h("td", { style: "font-size:10px;color:#6b737e" }, p2.replace(/^assets\//, "").replace(/\/[^/]+$/, "")),
        h("td", { style: "font-size:10px;color:" + (over ? "#f0d060" : "#6b737e") }, over ? "本版覆盖" : "原版"));
      tr.onclick = () => { selPath = p2; highlight(); drawDetail(); };
      rows.set(p2, tr);
      tb.append(tr);
    }
    if (!show.length) tb.append(h("tr", null, h("td", { colspan: 3 }, h("div", { class: "ed-empty" }, "没有匹配的音频"))));
    tbl.append(tb);
    listWrap.append(tbl);
  };
  let searchT = 0;
  searchIn.oninput = () => { query = searchIn.value; clearTimeout(searchT); searchT = setTimeout(drawList, 150); };

  let au = null;
  const stop = () => { if (au) { au.pause(); au = null; } };
  // 每次重绘详情前先清理上一个详情的副作用（波形窗口监听 / AudioContext）
  let detailCleanup = null;

  const drawDetail = () => {
    stop();
    if (detailCleanup) { try { detailCleanup(); } catch (e) { } detailCleanup = null; }
    clear(right);
    if (!selPath) { right.append(h("div", { class: "ed-empty" }, "左侧选择一个音频文件")); return; }
    const over = !!ED.sounds[selPath];
    right.append(h("h3", { style: "margin-top:0" }, selPath.split("/").pop()));
    right.append(rhint(selPath));

    // 资源根是 versions/<id>/，裸写 assets/... 会 404 → 统一走 audioSrc 解析
    const src = ED.sounds[selPath] || audioSrc(selPath, selPath.includes("/sound/") ? "sound" : "music");

    // ---------- 试听：波形 + 进度条 + 变调 ----------
    const g1 = h("div", { class: "ed-group" });
    g1.append(h("div", { class: "ed-grouptitle" }, "试听预览"));

    const playBtn = h("button", { class: "ed-btn" }, "▶ 播放");
    const timeEl = h("span", { class: "ed-wave-time" }, "0:00.0 / --:--");
    const srcEl = h("span", { class: "ed-hint", style: "margin-left:10px" },
      "来源：" + (over ? "本版本上传" : "默认版本"));

    const wave = waveBar({
      msg: "正在解码波形…（后台进行，可先播放）",
      onSeek: t => {
        if (!au || !isFinite(au.duration)) return;
        au.currentTime = t * au.duration;
        wave.setProgress(t);
        timeEl.textContent = fmtTime(au.currentTime) + " / " + fmtTime(au.duration);
      },
    });
    g1.append(wave.el);
    g1.append(h("div", { class: "ed-row" }, playBtn, timeEl, srcEl));

    // 音高（只影响编辑器预览，不影响游戏内播放）
    const pitch = h("input", { type: "range", min: "-12", max: "12", step: "1", value: "0" });
    pitch.style.flex = "1";
    const pitchVal = h("span", { class: "ed-wave-time", style: "min-width:150px" }, "原调");
    const pitchReset = h("button", { class: "ed-btn ghost", title: "回到原调" }, "↺");
    const pitchRow = h("div", { class: "ed-row wide" },
      h("label", null, "音高"), h("div", { class: "ed-pitch" }, pitch, pitchVal, pitchReset));
    const applyPitch = () => {
      const semi = parseFloat(pitch.value) || 0;
      const rate = Math.pow(2, semi / 12);
      pitchVal.textContent = semi === 0 ? "原调" : (semi > 0 ? "+" : "") + semi + " 半音（×" + rate.toFixed(2) + "）";
      if (au) {
        // 变调而非变速：preservesPitch=false 才会真的改变音高
        au.playbackRate = rate;
        try { au.preservesPitch = false; } catch (e) { /* 旧浏览器忽略 */ }
        try { au.mozPreservesPitch = false; } catch (e) { /* 同上 */ }
        try { au.webkitPreservesPitch = false; } catch (e) { /* 同上 */ }
      }
    };
    pitch.oninput = applyPitch;
    pitchReset.onclick = () => { pitch.value = "0"; applyPitch(); };
    g1.append(pitchRow);

    // 音量：同样只影响编辑器试听（游戏内音量由玩家设置 / 配置页的「音频默认音量」决定）
    const vol = h("input", { type: "range", min: "0", max: "100", step: "1", value: "80" });
    vol.style.flex = "1";
    const volVal = h("span", { class: "ed-wave-time", style: "min-width:150px" }, "80%");
    const applyVol = () => {
      const v = (parseFloat(vol.value) || 0) / 100;
      volVal.textContent = Math.round(v * 100) + "%";
      if (au) au.volume = v;
    };
    vol.oninput = applyVol;
    g1.append(h("div", { class: "ed-row wide" }, h("label", null, "音量"),
      h("div", { class: "ed-pitch" }, vol, volVal)));
    g1.append(h("div", { class: "ed-ghint" },
      "音高 / 音量只作用于编辑器里的试听，不写进数据、也不影响游戏内播放。"
      + "游戏默认音量在「升级数值」页的「音频默认音量」里配。"));
    right.append(g1);

    // ---------- 元数据 ----------
    const g2 = h("div", { class: "ed-group" });
    g2.append(h("div", { class: "ed-grouptitle" }, "文件信息"));
    const info = h("dl", { class: "ed-kv" });
    const kv = (k, v, cls) => {
      info.append(h("dt", null, k), h("dd", { class: cls || "" }, v));
    };
    kv("文件名", selPath.split("/").pop());
    kv("路径", selPath, "mono");
    const sizeDd = h("dd", null, "…"), lenDd = h("dd", null, "…");
    const fmtDd = h("dd", null, "…"), rateDd = h("dd", null, "…"), chDd = h("dd", null, "…");
    const decodeMsEl = h("dd", { class: "mono" }, "…");
    info.append(h("dt", null, "文件大小"), sizeDd,
      h("dt", null, "时长"), lenDd,
      h("dt", null, "格式"), fmtDd,
      h("dt", null, "采样率"), rateDd,
      h("dt", null, "声道"), chDd,
      h("dt", null, "波形解码"), decodeMsEl);
    g2.append(info);
    right.append(g2);

    // ---- 元数据加载：HEAD 取大小/类型，Audio 取时长，WebAudio 解码出波形+采样率 ----
    let dead = false;
    const loadMeta = async () => {
      // 1) 文件大小 / MIME
      try {
        const r = await fetch(src, { method: "HEAD" });
        if (!dead && r.ok) {
          const len = parseInt(r.headers.get("content-length") || "", 10);
          sizeDd.textContent = isFinite(len) ? fmtSize(len) : "未知";
          const ct = r.headers.get("content-type") || "";
          fmtDd.textContent = ct || (selPath.match(/\.[^.]+$/) || [""])[0];
        }
      } catch (e) { if (!dead) { sizeDd.textContent = "未知"; } }
      // 2) 真实采样率 / 声道数：从文件头读，不需要完整解码。
      //    （decodePeaks 在 Worker 里用 8 kHz 上下文解码，
      //      它返回的 sampleRate 是重采样后的值，不能当文件真实值显示。）
      const readHeader = () => new Promise(res => {
        const a = new Audio();
        a.preload = "metadata";
        let done = false;
        const fin = v => { if (!done) { done = true; res(v); } };
        a.onloadedmetadata = () => fin(a);
        a.onerror = () => fin(null);
        a.src = src;
        setTimeout(() => fin(null), 5000);
      });
      readHeader().then(a => {
        if (dead || !a) return;
        if (a.duration) lenDd.textContent = fmtTime(a.duration) + "（" + a.duration.toFixed(2) + " 秒）";
      });

      // 3) 波形 + 时长：解码在 Web Worker 里做（不占主线程），结果按文件缓存
      try {
        const t0 = performance.now();
        const d = await decodePeaks(null, src, 220);
        if (dead || !d) return;
        const ms = Math.round(performance.now() - t0);
        wave.setPeaks(d);
        lenDd.textContent = fmtTime(d.duration) + "（" + d.duration.toFixed(2) + " 秒）";
        // 采样率/声道是解码时上下文的值（原文件采样率浏览器不暴露）
        rateDd.textContent = d.sampleRate.toLocaleString() + " Hz";
        rateDd.title = "解码时的采样率（原始采样率浏览器不提供；解码为画波形已重采样，不影响播放）";
        chDd.textContent = d.channels === 1 ? "单声道" : (d.channels === 2 ? "立体声" : d.channels + " 声道");
        timeEl.textContent = "0:00.0 / " + fmtTime(d.duration);
        decodeMsEl.textContent = d.cached ? "已缓存" : (ms + " ms");
        // 解码完当前文件后，后台预取列表里相邻的 2 个（用户左右切时就是 0 ms）。
        // 解码很贵（~0.6 s/个），所以只预取相邻项，不整表预热。
        if (!dead && !d.cached) {
          const order = list.filter(p2 => p2 !== selPath);
          for (const p2 of order.slice(0, 2)) prefetchPeaks(p2, 220);
        }

      } catch (e) {
        if (!dead) {
          wave.setMsg("无法解码波形（仍可播放）");
          // 退化：只用 <audio> 拿时长
          const a = new Audio(src);
          a.onloadedmetadata = () => {
            if (dead) return;
            lenDd.textContent = fmtTime(a.duration) + "（" + a.duration.toFixed(2) + " 秒）";
            timeEl.textContent = "0:00.0 / " + fmtTime(a.duration);
          };
          a.onerror = () => { if (!dead) lenDd.textContent = "无法读取"; };
        }
      }
    };
    loadMeta();

    // ---- 播放：波形进度同步 ----
    playBtn.onclick = () => {
      if (au) { stop(); playBtn.textContent = "▶ 播放"; wave.setProgress(0); return; }
      au = new Audio(src);
      applyPitch();   // 新建的 Audio 要重新套用当前音高
      applyVol();     // 以及当前音量
      // 注意：这些回调里不能直接用外层 au —— stop() 会把它置 null，
      // 但已排队的事件仍可能触发（切文件/重复点时），必须先判空。
      const self = au;
      au.onloadedmetadata = () => {
        if (dead || !self) return;
        timeEl.textContent = fmtTime(self.currentTime) + " / " + fmtTime(self.duration);
      };
      au.ontimeupdate = () => {
        if (dead || !self || !isFinite(self.duration) || self.duration <= 0) return;
        const t = self.currentTime / self.duration;
        wave.setProgress(t);
        timeEl.textContent = fmtTime(self.currentTime) + " / " + fmtTime(self.duration);
      };
      au.onended = () => { if (au === self) { au = null; playBtn.textContent = "▶ 播放"; wave.setProgress(0); } };
      au.onerror = () => { if (au === self) { au = null; playBtn.textContent = "▶ 播放"; wave.setMsg("无法播放该文件"); } };
      au.play().then(() => { playBtn.textContent = "■ 停止"; }).catch(() => { au = null; });
    };
    // 页面切走时清掉波形窗口的监听与动画帧（解码在 Worker 里，无需手动关闭）
    detailCleanup = () => { dead = true; wave.destroy(); };

    const g3 = h("div", { class: "ed-group" });
    g3.append(h("div", { class: "ed-grouptitle" }, "替换音频"));
    const file = h("input", { type: "file", accept: "audio/*", style: "display:none" });
    file.onchange = async () => {
      const f = file.files[0]; if (!f) return;
      ED.sounds[selPath] = await readImageFile(f);   // 复用：FileReader → data URL
      mark(); drawList(); drawDetail();
    };
    g3.append(h("div", { class: "ed-row" },
      h("button", { class: "ed-btn", onclick: () => file.click() }, "上传替换…"), file,
      over ? h("button", { class: "ed-btn danger", onclick: () => { delete ED.sounds[selPath]; mark(); drawList(); drawDetail(); } }, "还原为原版") : null));
    right.append(g3);

    // 引用情况：这个音频被谁用了（地图音乐 / 标题结局 / 技能音效 …）
    const g4 = h("div", { class: "ed-group" });
    g4.append(h("div", { class: "ed-grouptitle" }, "被引用处"));
    const name = selPath.split("/").pop();
    const refs = [];
    for (const [mid, mp] of Object.entries(ED.maps || {})) {
      if (mp && mp.music === name) refs.push("地图「" + (mp.name || mid) + "」");
    }
    const gm = (ED.content.game && ED.content.game.music) || {};
    if (gm.start === name) refs.push("标题音乐");
    if (gm.end === name) refs.push("结局音乐");
    g4.append(h("div", { class: "ed-ghint" }, refs.length ? refs.join("、") : "（暂无引用）"));
    right.append(g4);
  };

  clear(listWrap);
  listWrap.append(h("div", { class: "ed-empty" }, "正在建立音频索引…"));
  idx0.then(() => {
    list = audioIndex().filter(p2 => /.(mp3|wav|ogg|m4a)$/i.test(p2));
    // 编辑器里上传过、但磁盘清单没有的也列出来
    for (const k of Object.keys(ED.sounds)) if (!list.includes(k)) list.push(k);
    list.sort();
    if (!selPath || !list.includes(selPath)) selPath = list[0] || null;
    drawList();
    drawDetail();
  });
}

