// 音频详情：波形图 + 进度条 + 元数据 + 变调试听。
//
// 只在**编辑器预览**里改音高（Audio.playbackRate + preservesPitch=false 真正变调），
// 不写回任何数据、不影响游戏内播放。
import { h, clear } from "./dom.js";

/** 秒 → m:ss.s */
export function fmtTime(s) {
  if (!isFinite(s) || s < 0) return "--:--";
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ":" + (r < 10 ? "0" : "") + r.toFixed(1);
}

/** 字节 → 人类可读 */
export function fmtSize(n) {
  if (!isFinite(n) || n < 0) return "--";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

/**
 * 把音频解码成波形峰值数组。
 *
 * 性能要点（实测 city.mp3 = 3.2 MB / 241 秒，Chrome 无头）：
 *   - MP3 解码本身 ≈ 600 ms，是**唯一**的大头；峰值扫描只要 15 ms。
 *   - 解码采样率几乎不影响耗时（8 kHz 与 44.1 kHz 都是 ~600 ms），
 *     所以**不要**为了"加速"去反复试不同采样率。
 *   - 真正的卡顿是这 600 ms 把主线程占住。因此解码与扫描都放进 Web Worker，
 *     主线程只拿回一个 Float32Array。
 *
 * 结果按 src 缓存：同一文件再次进入详情页不再解码（0 ms）。
 *
 * @param {AudioContext|null} ctx 保留参数以兼容旧调用；Worker 路径不需要它
 * @param {string} src
 * @param {number} buckets 采样桶数（= 画布像素列数）
 * @returns {Promise<PeaksResult>}
 */
export async function decodePeaks(ctx, src, buckets) {
  const n = Math.max(2, buckets || 200);
  const key = src + "#" + n;
  const hit = peakCache.get(key);
  if (hit) { touch(key); return { ...hit, cached: true }; }
  // 同一文件正在解码：复用同一个 Promise，避免快速切换时重复解码
  const inflight = peakInflight.get(key);
  if (inflight) return inflight;

  const job = (async () => {
    const resp = await fetch(src);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const buf = await resp.arrayBuffer();
    // 解码后立刻释放 AudioBuffer（几十 ~ 上百 MB 的 float32），只留 200 个峰值。
    // 归一化让安静文件不至于看起来是一条平线。
    const raw = await decodeBufOffThread(buf, n, src);
    /** @type {PeaksResult} */
    const out = {
      peaks: raw.peaks, duration: raw.duration, sampleRate: raw.sampleRate,
      channels: raw.channels, resampled: raw.sampleRate <= 12000, cached: false,
    };
    peakCache.set(key, out);
    trimCache();
    return out;
  })();

  peakInflight.set(key, job);
  try {
    return await job;
  } finally {
    peakInflight.delete(key);
  }}

/** @typedef {{peaks:Float32Array, duration:number, sampleRate:number, channels:number, resampled:boolean, cached:boolean}} PeaksResult */

// ---- 缓存 ----
// 只缓存峰值（220 个 float ≈ 0.9 KB），上限按条数控制，避免长时间编辑积累。
const PEAK_CACHE_MAX = 24;
/** @type {Map<string, PeaksResult>} */
const peakCache = new Map();
/** @type {Map<string, Promise<PeaksResult>>} */
const peakInflight = new Map();

function touch(key) {
  const v = peakCache.get(key);
  if (!v) return;
  peakCache.delete(key);        // 重新插入到末尾 = LRU 的"最近使用"
  peakCache.set(key, v);
}

function trimCache() {
  while (peakCache.size > PEAK_CACHE_MAX) {
    const k = peakCache.keys().next().value;
    peakCache.delete(k);
  }
}

/** 预取：列表里的其它音频可以提前解码，用户点过去时就是 0 ms。
 * 一次只跑一个（解码是 CPU 密集的，并行只会互相抢核心）。
 * 不推荐一口气预取整张表：一个文件就 ~600 ms。
 */
const prefetchQueue = [];
export function prefetchPeaks(src, buckets) {
  const n = Math.max(2, buckets || 200);
  const key = src + "#" + n;
  if (peakCache.has(key) || peakInflight.has(key) || prefetchQueue.includes(src)) return;
  prefetchQueue.push(src);
  pumpPrefetch(n);
}

let prefetching = false;
async function pumpPrefetch(n) {
  if (prefetching) return;
  prefetching = true;
  try {
    while (prefetchQueue.length) {
      const src = prefetchQueue.shift();
      try { await decodePeaks(null, src, n); } catch (e) { /* 预取失败无所谓，点过去时会再试 */ }
    }
  } finally {
    prefetching = false;
  }
}

// ---- 解码执行 ----
// 优先丢给 Worker（完全不占用主线程）；Worker 不可用或在 Worker 里解码失败时
// 回退到主线程的 OfflineAudioContext（慢，但功能等价）。
let worker = null;
let workerBroken = false;

function getWorker() {
  if (workerBroken || typeof Worker !== "function") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./peaks-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ev => {
      const m = ev.data || {};
      const job = workerJobs.get(m.id);
      if (!job) return;
      workerJobs.delete(m.id);
      if (m.error) job.reject(new Error(m.error));
      else job.resolve(m);
    };
    worker.onerror = () => {
      // Worker 整体崩了（少见的 CSP / 模块加载问题）：失败所有在途请求并永久回退
      workerBroken = true;
      for (const [, job] of workerJobs) job.reject(new Error("worker failed"));
      workerJobs.clear();
      try { worker.terminate(); } catch (e) { }
      worker = null;
    };
  } catch (e) {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

let jobSeq = 0;
/** @type {Map<number, {resolve:Function, reject:Function}>} */
const workerJobs = new Map();

async function decodeBufOffThread(buf, buckets, src) {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise((resolve, reject) => {
        const id = ++jobSeq;
        workerJobs.set(id, { resolve, reject });
        // 转移 ArrayBuffer 所有权：主线程不保留这份 3 MB 拷贝。
        // 代价是 buf 会变成 detached，所以回退时必须重新下载（不能复用 buf）。
        w.postMessage({ id, buf, buckets }, [buf]);
      });
    } catch (e) {
      // 单次失败（非 mp3 / 旧浏览器无 AudioDecoder）→ 走下面的主线程回退
    }
  }
  // 回退：buf 可能已 detached（byteLength === 0），需要重新取一份原始数据。
  const data = buf.byteLength > 0 ? buf : await fetch(src).then(r => r.arrayBuffer());
  return decodePeaksLocal(data, buckets);
}

/** 主线程路径（也供 Worker 复用同一套峰值算法）。 */
export async function decodePeaksLocal(buf, buckets) {
  const n = Math.max(2, buckets || 200);
  let audio = null;
  // 在低采样率上下文里解码：AudioBuffer 体积降到 1/5 左右，扫描更快；
  // 注意解码耗时主要由 MP3 解码决定，采样率高低影响很小。
  try {
    const off = new OfflineAudioContext(1, 1, 8000);
    audio = await off.decodeAudioData(buf);
  } catch (e) {
    const AC = (typeof window !== "undefined" && (window.AudioContext || /** @type {any} */ (window).webkitAudioContext)) || null;
    if (!AC) throw e;
    const c = new AC();
    try { audio = await c.decodeAudioData(buf); } finally { try { c.close(); } catch (e2) { } }
  }
  return peaksFromAudioBuffer(audio, n);
}

/**
 * 归一化峰值并补齐元信息（与 peaksFromAudioBuffer 的输出形状一致）。
 * Worker 里直接扫 EncodedAudioChunk 得到未归一化的 peaks，用这个收尾。
 * @returns {{peaks:Float32Array, duration:number, sampleRate:number, channels:number}}
 */
export function peaksFromChunks(peaks, totalSamples, sampleRate, channels, buckets) {
  const n = Math.max(2, buckets || 200);
  const out = peaks.length === n ? peaks : peaks.slice(0, n);
  let mx = 0;
  for (let i = 0; i < out.length; i++) if (out[i] > mx) mx = out[i];
  if (mx > 0.001) { const k = 1 / mx; for (let i = 0; i < out.length; i++) out[i] *= k; }
  return { peaks: out, duration: totalSamples / (sampleRate || 1), sampleRate, channels };
}

/**
 * AudioBuffer → 归一化峰值数组。纯计算，Worker 与主线程共用。
 * @returns {{peaks:Float32Array, duration:number, sampleRate:number, channels:number}}
 */
export function peaksFromAudioBuffer(audio, n) {
  const len = audio.length, chs = audio.numberOfChannels;
  const step = Math.max(1, Math.floor(len / n));
  const peaks = new Float32Array(n);
  // 通道数组只取一次（getChannelData 在严格实现里每次调用都会做边界检查）
  const chans = [];
  for (let c = 0; c < chs; c++) chans.push(audio.getChannelData(c));
  for (let i = 0; i < n; i++) {
    const start = i * step;
    const end = i === n - 1 ? len : Math.min(len, start + step);
    let peak = 0;
    for (let c = 0; c < chs; c++) {
      const d = chans[c];
      for (let j = start; j < end; j++) {
        const v = d[j];
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
    }
    peaks[i] = peak;
  }
  // 归一化，避免安静文件看起来是一条平线
  let mx = 0;
  for (let i = 0; i < n; i++) if (peaks[i] > mx) mx = peaks[i];
  if (mx > 0.001) { const k = 1 / mx; for (let i = 0; i < n; i++) peaks[i] *= k; }
  return { peaks, duration: audio.duration, sampleRate: audio.sampleRate, channels: chs };
}

/**
 * 波形 + 进度条 组件。
 * - 波形用 canvas 画（峰值柱），已播放部分高亮
 * - 点击/拖动波形或进度条可 seek
 * 返回 { el, setProgress(0..1), setPeaks(data), setMsg(text) }
 */
export function waveBar(opts) {
  // 波形按容器实际宽度自适应（原来固定 560px，右侧留一大片空白）。
  // 同时按 devicePixelRatio 放大绘制缓冲，保证高分屏上不糊、且
  // **缓冲宽度与显示宽度严格一致** —— 否则 seek 换算（用 getBoundingClientRect）
  // 与绘制（用缓冲宽度 W）会按不同比例缩放，点得越靠右、播放头与金色柱
  // 偏离真实位置越远（拖动时"高亮与播放位置脱节"就是这么来的）。
  const H = 88;
  const BAR = 3;        // 单根柱子宽（CSS px）
  const GAP = 2;        // 柱间距（CSS px）
  const PITCH = BAR + GAP;
  const canvas = h("canvas", { class: "ed-wave" });
  const msg = h("div", { class: "ed-wave-msg" }, opts && opts.msg || "加载中…");
  const wrap = h("div", { class: "ed-wavewrap" }, canvas, msg);
  const g = /** @type {CanvasRenderingContext2D|null} */ (canvas.getContext("2d"));

  /** @type {Float32Array|null} */
  let peaks = null;      // 原始桶数据（按解码时的固定桶数，如 220）
  let shown = null;      // 按当前柱数重采样后的可视数据（长度 = N）
  let progress = 0;
  let drag = false;
  const onSeek = (opts && opts.onSeek) || null;

  // 当前逻辑尺寸（CSS px）与 DPR。用 CSSW 做所有"进度→像素"换算，
  // 绘制时统一 ctx.scale(dpr)，于是逻辑坐标 == CSS 坐标，与鼠标换算完全一致。
  let CSSW = (opts && opts.width) || 560;
  let dpr = 1;
  // N = 柱子根数；STEP = 实际柱距（可能略大于 PITCH，把余数摊到每根柱上）。
  // 必须满足 N * STEP === CSSW，否则“最后一根柱的右边界”与“progress=1 的播放头”
  // 对不上，越靠右偏得越多。
  let N = 24, STEP = PITCH;
  const layout = (cssw) => {
    N = Math.max(24, Math.floor(cssw / PITCH));
    STEP = cssw / N;
  };

  // 底图（背景 + 中线 + 未播放部分的柱子）只画一次，缓存成离屏 canvas。
  // 播放时每帧只需「贴底图 + 重画已播放的那一小段 + 播放头」。
  const baseCv = document.createElement("canvas");
  const bg = /** @type {CanvasRenderingContext2D|null} */ (baseCv.getContext("2d"));
  let baseDirty = true;
  let lastCut = 0, lastPx = -1;

  // 把解码得到的峰值桶（固定条数，如 220）重采样成“当前画布能画的柱数 N”。
  // **这一步是修“高亮与播放位置脱节”的关键**：绘制 x 用 barX(i)=i*PITCH，
  // 而播放头 x 用 progress*CSSW。若柱数与 N 不匹配，金色高亮会按
  // peaks.length*PITCH 的尺度延伸，而播放头按 CSSW 走，两者越到后面偏得越多。
  const rebin = () => {
    if (!peaks || !peaks.length || !N) { shown = null; return; }
    const src = peaks, sn = src.length;
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      // 每个输出柱覆盖源数据的一段，取最大值（峰值包络不会因缩放而变矮）
      const a = Math.floor(i * sn / N), b = Math.max(a + 1, Math.ceil((i + 1) * sn / N));
      let m = 0;
      for (let k = a; k < b && k < sn; k++) if (src[k] > m) m = src[k];
      out[i] = m;
    }
    shown = out;
  };

  const barX = i => i * STEP;
  const barH = v => Math.max(1, v * (H / 2 - 4));

  /** 画柱子（逻辑坐标；from/to 为柱索引） */
  const bars = (ctx2, from, to, color, clearFirst) => {
    if (!shown || !shown.length) return;
    const n = shown.length;
    for (let i = from; i < to && i < n; i++) {
      const bh = barH(shown[i]);
      const bw = Math.max(1, STEP - GAP);   // 柱宽随柱距自适应，保证不重叠且填满
      if (clearFirst) {
        // 整列清掉再画：避免"已播放/未播放"两种柱高不同时残留旧像素
        ctx2.clearRect(barX(i) - 1, 0, STEP + 1, H);
      }
      ctx2.fillStyle = color;
      ctx2.fillRect(barX(i), H / 2 - bh, bw, bh * 2);
    }
  };

  const paintBase = () => {
    if (!bg) return;
    bg.setTransform(dpr, 0, 0, dpr, 0, 0);
    bg.clearRect(0, 0, CSSW, H);
    bg.fillStyle = "#0b0d11"; bg.fillRect(0, 0, CSSW, H);
    bg.strokeStyle = "#1d222b"; bg.lineWidth = 1;
    bg.beginPath(); bg.moveTo(0, H / 2); bg.lineTo(CSSW, H / 2); bg.stroke();
    bars(bg, 0, shown ? shown.length : 0, "#3b4557");
    baseDirty = false;
  };

  const paintFull = () => {
    if (!g) return;
    if (baseDirty) paintBase();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, CSSW, H);
    g.drawImage(baseCv, 0, 0, CSSW, H);
    if (!shown || !shown.length) { lastCut = 0; lastPx = -1; return; }
    const cut = Math.floor(shown.length * progress);
    bars(g, 0, cut, "#e8be52");
    lastCut = cut; lastPx = progress * CSSW;
    drawHead();
  };

  const drawHead = () => {
    if (!g) return;
    const px = progress * CSSW;
    g.strokeStyle = "#ffd85e"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
  };

  // 播放中的每帧重绘：只处理"上次已播放段"和"本次新增段"。
  // 进度前进时增量画金色柱；回退（拖动 seek）时才退回整张重画。
  const paintIncremental = () => {
    if (!g || !shown || !shown.length) { paintFull(); return; }
    if (baseDirty) { paintFull(); return; }
    const cut = Math.floor(shown.length * progress);
    const px = progress * CSSW;
    if (cut < lastCut) { paintFull(); return; }        // 回退：整张重画
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (cut > lastCut) {
      bars(g, lastCut, cut, "#e8be52", true);
      lastCut = cut;
    }
    if (lastPx >= 0 && Math.abs(px - lastPx) > 0.01) {
      // 播放头：只擦掉旧位置的细条（贴回底图），再补回该段的金色柱
      const x0 = Math.max(0, Math.floor(Math.min(px, lastPx)) - 2);
      const x1 = Math.min(CSSW, Math.ceil(Math.max(px, lastPx)) + 2);
      if (x1 > x0) {
        g.drawImage(baseCv, x0 * dpr, 0, (x1 - x0) * dpr, H * dpr, x0, 0, x1 - x0, H);
        bars(g, Math.max(0, Math.floor(x0 / STEP)), Math.min(shown.length, Math.ceil(x1 / STEP)),
          "#e8be52", true);
      }
      drawHead();
      lastPx = px;
    }
  };

  // timeupdate 最高也只 4~60 Hz，但拖动进度/变调播放时可能更密。
  // 统一收进 rAF，一帧最多重画一次。
  let rafId = 0;
  const scheduleDraw = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; paintIncremental(); });
  };

  const draw = () => { paintFull(); };

  /** 按容器宽度重建绘制缓冲（DPR 变化 / 侧栏拖宽都会走这里） */
  const resize = (cssw) => {
    const w = Math.max(120, Math.round(cssw || CSSW));
    if (w === CSSW && canvas.width === Math.round(CSSW * dpr)) return;
    CSSW = w;
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    layout(CSSW);
    canvas.width = Math.round(CSSW * dpr);
    canvas.height = Math.round(H * dpr);
    // canvas 的 width/height 属性是“设备像素”，显示尺寸必须显式写 CSS 宽度，
    // 否则高分屏下会按属性值渲染成 dpr 倍大。
    canvas.style.width = CSSW + "px";
    canvas.style.height = H + "px";
    baseCv.width = Math.round(CSSW * dpr);
    baseCv.height = Math.round(H * dpr);
    rebin();            // 柱数变了，峰值要重新采样到 N 根
    baseDirty = true;   // 尺寸变了，底图必须重画
    lastCut = 0; lastPx = -1;
    draw();
  };

  // 跟随容器宽度：编辑器侧栏可拖宽、窗口可缩放、音频页首次挂载时
  // 容器宽度也还没有最终确定，所以用 ResizeObserver 而不是一次性测量。
  let ro = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        const cw = en.contentRect ? en.contentRect.width : en.target.clientWidth;
        if (cw > 0) resize(cw);
      }
    });
    ro.observe(wrap);
  }

  const seekTo = (clientX) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    // 一律用"显示宽度"换算 → 与绘制用的 CSSW 一致（二者已保证相同）
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    progress = t; draw();
    if (onSeek) onSeek(t);
  };
  canvas.onmousedown = e => { drag = true; seekTo(e.clientX); };
  canvas.onmousemove = e => { if (drag) seekTo(e.clientX); };
  // 事件挂 window，拖到画布外也能跟随；mouseup 时解除
  const up = () => { drag = false; };
  window.addEventListener("mouseup", up);

  layout(CSSW);
  resize(CSSW);

  return {
    el: wrap,
    canvas,
    get progress() { return progress; },
    get width() { return CSSW; },
    // 播放中的高频 progress：走 rAF + 增量重绘（一帧最多一次）
    setProgress(t) {
      const v = Math.min(1, Math.max(0, t));
      if (v < progress) { progress = v; draw(); return; }   // 回退（seek）时立即整张重画
      progress = v;
      scheduleDraw();
    },
    setPeaks(data) {
      peaks = data && data.peaks;
      msg.style.display = peaks ? "none" : "";
      rebin(); baseDirty = true; lastCut = 0; lastPx = -1; draw();
    },
    setMsg(t) { msg.textContent = t; msg.style.display = ""; },
    resize,
    destroy() {
      window.removeEventListener("mouseup", up);
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (ro) { ro.disconnect(); ro = null; }
    },
  };
}
