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

/** 播放速率 → 音程名（1.0 = 原调，每 +6% ≈ 一个半音） */
export function rateToSemi(rate) {
  return 12 * Math.log2(Math.max(1e-6, rate));
}
export function rateLabel(rate) {
  const s = rateToSemi(rate);
  const r = Math.round(s);
  if (Math.abs(s) < 0.08) return "原调";
  const sign = r > 0 ? "+" : "";
  return sign + r + " 半音（×" + rate.toFixed(2) + "）";
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

/** 清空波形缓存（测试 / 内存告急时可用）。 */
export function clearPeaksCache() { peakCache.clear(); peakInflight.clear(); prefetchQueue.length = 0; }

/**
 * 预取：列表里的其它音频可以提前解码，用户点过去时就是 0 ms。
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
  // 画布按 devicePixelRatio 放大后仍保持一致的外观尺寸；
  // 柱子宽度按「每根柱子占几个设备像素」反推，保证在任意屏幕上疏密一致。
  const H = 88;
  const BAR = 3;        // 单根柱子宽（CSS px）
  const GAP = 2;        // 柱间距（CSS px）
  const PITCH = BAR + GAP;
  const CSSW = (opts && opts.width) || 560;
  const N = Math.max(24, Math.floor(CSSW / PITCH));   // 柱子根数 = 宽度 / 间距
  const W = N * PITCH;
  const canvas = h("canvas", { class: "ed-wave", width: W, height: H });
  canvas.style.width = W + "px";
  canvas.style.maxWidth = "100%";
  canvas.style.height = H + "px";
  const msg = h("div", { class: "ed-wave-msg" }, opts && opts.msg || "加载中…");
  const wrap = h("div", { class: "ed-wavewrap" }, canvas, msg);
  const g = /** @type {CanvasRenderingContext2D|null} */ (canvas.getContext("2d"));

  /** @type {Float32Array|null} */
  let peaks = null;
  let progress = 0;
  let drag = false;
  const onSeek = (opts && opts.onSeek) || null;

  // 底图（背景 + 中线 + 未播放部分的柱子）只画一次，缓存成 ImageBitmap/离屏 canvas。
  // 播放时每帧只需「贴底图 + 重画已播放的那一小段 + 播放头」，
  // 而不是每次 timeupdate 都重画 200 多根柱子。
  const baseCv = document.createElement("canvas");
  baseCv.width = W; baseCv.height = H;
  const bg = /** @type {CanvasRenderingContext2D|null} */ (baseCv.getContext("2d"));
  let baseDirty = true;

  const barX = i => i * PITCH + GAP / 2;
  const barH = v => Math.max(1, v * (H / 2 - 4));

  /** 画柱子（x 从 from 到 to，颜色 c） */
  const bars = (ctx2, from, to, color, clearFirst) => {
    if (!peaks || !peaks.length) return;
    ctx2.fillStyle = color;
    const n = peaks.length;
    for (let i = from; i < to && i < n; i++) {
      const bh = barH(peaks[i]);
      if (clearFirst) {
        // 整列清掉再画：避免"已播放/未播放"两种柱高不同时残留旧像素
        ctx2.clearRect(barX(i) - 1, 0, BAR + 2, H);
        ctx2.fillStyle = color;
      }
      ctx2.fillRect(barX(i), H / 2 - bh, BAR, bh * 2);
    }
  };

  const paintBase = () => {
    if (!bg) return;
    bg.clearRect(0, 0, W, H);
    bg.fillStyle = "#0b0d11"; bg.fillRect(0, 0, W, H);
    bg.strokeStyle = "#1d222b"; bg.lineWidth = 1;
    bg.beginPath(); bg.moveTo(0, H / 2); bg.lineTo(W, H / 2); bg.stroke();
    bars(bg, 0, peaks ? peaks.length : 0, "#3b4557");
    baseDirty = false;
  };

  // 上一帧画过的进度（柱数），用于只重画变化的那一段
  let lastCut = 0, lastPx = -1;

  const paintFull = () => {
    if (!g) return;
    if (baseDirty) paintBase();
    g.clearRect(0, 0, W, H);
    g.drawImage(baseCv, 0, 0);
    if (!peaks || !peaks.length) { lastCut = 0; lastPx = -1; return; }
    const cut = Math.floor(peaks.length * progress);
    bars(g, 0, cut, "#e8be52");
    lastCut = cut; lastPx = progress * W;
    drawHead();
  };

  const drawHead = () => {
    if (!g) return;
    const px = progress * W;
    g.strokeStyle = "#ffd85e"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke();
  };

  // 播放中的每帧重绘：不整张重画，只处理"上次已播放段"和"本次新增段"。
  // 进度前进时增量画金色柱；回退（拖动 seek）时才退回整张重画。
  const paintIncremental = () => {
    if (!g || !peaks || !peaks.length) { paintFull(); return; }
    if (baseDirty) { paintFull(); return; }
    const cut = Math.floor(peaks.length * progress);
    const px = progress * W;
    if (cut < lastCut) { paintFull(); return; }        // 回退：整张重画
    if (cut > lastCut) {
      bars(g, lastCut, cut, "#e8be52", true);
      lastCut = cut;
    }
    // 播放头：只擦掉旧位置的细条，再画新的
    if (lastPx >= 0 && Math.abs(px - lastPx) > 0.01) {
      const x0 = Math.max(0, Math.floor(Math.min(px, lastPx)) - 2);
      const x1 = Math.min(W, Math.ceil(Math.max(px, lastPx)) + 2);
      g.drawImage(baseCv, x0, 0, x1 - x0, H, x0, 0, x1 - x0, H);   // 贴回底图 = 擦掉旧头
      bars(g, Math.max(0, Math.floor(x0 / PITCH)), Math.min(peaks.length, Math.ceil(x1 / PITCH)),
        "#e8be52", true);                                          // 补回这段的金色柱
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

  const seekTo = (clientX) => {
    const r = canvas.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    progress = t; draw();
    if (onSeek) onSeek(t);
  };
  canvas.onmousedown = e => { drag = true; seekTo(e.clientX); };
  canvas.onmousemove = e => { if (drag) seekTo(e.clientX); };
  // 事件挂 window，拖到画布外也能跟随；mouseup 时解除
  const up = () => { drag = false; };
  window.addEventListener("mouseup", up);

  draw();
  return {
    el: wrap,
    canvas,
    get progress() { return progress; },
    // 播放中的高频 progress：走 rAF + 增量重绘（一帧最多一次）
    setProgress(t) {
      const v = Math.min(1, Math.max(0, t));
      if (v < progress) { progress = v; draw(); return; }   // 回退（seek）时立即整张重画
      progress = v;
      scheduleDraw();
    },
    setPeaks(data) { peaks = data && data.peaks; msg.style.display = peaks ? "none" : ""; baseDirty = true; draw(); },
    setMsg(t) { msg.textContent = t; msg.style.display = ""; },
    destroy() {
      window.removeEventListener("mouseup", up);
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    },
  };
}
