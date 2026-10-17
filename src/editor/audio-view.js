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
 * mp3/wav 体积不大（几百 KB ~ 3 MB），解码一次后缓存，拖进度/重绘都不用再解。
 * @param {AudioContext} ctx
 * @param {string} src
 * @param {number} buckets 采样桶数（= 画布像素列数）
 * @returns {Promise<{peaks:Float32Array, duration:number, sampleRate:number, channels:number} | null>}
 */
export async function decodePeaks(ctx, src, buckets) {
  const buf = await fetch(src).then(r => {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.arrayBuffer();
  });
  const audio = await ctx.decodeAudioData(buf);
  // 多声道取绝对值最大，视觉上更"实"
  const chs = [];
  for (let c = 0; c < audio.numberOfChannels; c++) chs.push(audio.getChannelData(c));
  const n = buckets || 200;
  const step = Math.max(1, Math.floor(audio.length / n));
  const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const start = i * step, end = Math.min(audio.length, start + step);
    let peak = 0;
    for (let j = start; j < end; j++) {
      for (const d of chs) { const v = d[j] < 0 ? -d[j] : d[j]; if (v > peak) peak = v; }
    }
    peaks[i] = peak;
  }
  // 归一化，避免安静文件看起来是一条平线
  let mx = 0;
  for (let i = 0; i < n; i++) if (peaks[i] > mx) mx = peaks[i];
  if (mx > 0.001) for (let i = 0; i < n; i++) peaks[i] /= mx;
  return { peaks, duration: audio.duration, sampleRate: audio.sampleRate, channels: audio.numberOfChannels };
}

/**
 * 波形 + 进度条 组件。
 * - 波形用 canvas 画（峰值柱），已播放部分高亮
 * - 点击/拖动波形或进度条可 seek
 * 返回 { el, setProgress(0..1), setPeaks(data), setMsg(text) }
 */
export function waveBar(opts) {
  const W = 560, H = 88;
  const canvas = h("canvas", { class: "ed-wave", width: W, height: H });
  canvas.style.width = "100%";
  canvas.style.height = H + "px";
  const msg = h("div", { class: "ed-wave-msg" }, opts && opts.msg || "加载中…");
  const wrap = h("div", { class: "ed-wavewrap" }, canvas, msg);
  const g = /** @type {CanvasRenderingContext2D|null} */ (canvas.getContext("2d"));

  /** @type {Float32Array|null} */
  let peaks = null;
  let progress = 0;
  let drag = false;
  const onSeek = (opts && opts.onSeek) || null;

  const draw = () => {
    if (!g) return;
    const w = canvas.width, hh = canvas.height;
    g.clearRect(0, 0, w, hh);
    // 背景
    g.fillStyle = "#0b0d11"; g.fillRect(0, 0, w, hh);
    // 中线
    g.strokeStyle = "#1d222b"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, hh / 2); g.lineTo(w, hh / 2); g.stroke();
    if (!peaks || !peaks.length) return;
    const n = peaks.length;
    const bw = Math.max(1, w / n);
    const cut = Math.floor(n * progress);
    for (let i = 0; i < n; i++) {
      const v = peaks[i];
      const bh = Math.max(1, v * (hh / 2 - 4));
      const x = i * bw;
      // 已播放：金色；未播放：暗灰蓝
      g.fillStyle = i <= cut ? "#e8be52" : "#3b4557";
      g.fillRect(x, hh / 2 - bh, Math.max(1, bw - 0.6), bh * 2);
    }
    // 播放头
    const px = progress * w;
    g.strokeStyle = "#ffd85e"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(px, 0); g.lineTo(px, hh); g.stroke();
  };

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
    setProgress(t) { progress = Math.min(1, Math.max(0, t)); draw(); },
    setPeaks(data) { peaks = data && data.peaks; msg.style.display = peaks ? "none" : ""; draw(); },
    setMsg(t) { msg.textContent = t; msg.style.display = ""; },
    destroy() { window.removeEventListener("mouseup", up); },
  };
}
