// 波形解码 Worker：把音频解码（约 550~600 ms / 3 MB 文件）挪出主线程。
//
// 主线程只发 { id, buf, buckets }，拿回 { id, peaks, duration, sampleRate, channels }。
// 这样切换音频条目时编辑器 UI 不再被解码卡住（拖动列表 / 点播放都不掉帧）。
//
// ⚠ DedicatedWorker 里**没有** Web Audio API（AudioContext / OfflineAudioContext
//   都是 undefined，见 e2e 实测），所以这里走 WebCodecs 的 AudioDecoder：
//   - 先自己解析 MP3 帧头，得到采样率 / 每帧样本数；
//   - 再把每帧作为 EncodedAudioChunk 喂给 AudioDecoder；
//   - 在 output 回调里累加每桶的峰值（不解码成整段 PCM，内存 O(1)）。
// 时长 = Σ每帧样本数 / 采样率，与 WebAudio 解出的 duration 一致（实测 241.27 vs 241.21 s）。
//
// 非 mp3（wav/ogg/m4a）或环境不支持 AudioDecoder 时回传 error，
// 由主线程 audio-view.js 回退到主线程的 OfflineAudioContext 解码。
import { peaksFromChunks } from "./audio-view.js";

self.onmessage = async ev => {
  const { id, buf, buckets } = ev.data || {};
  try {
    const n = Math.max(2, buckets || 200);
    const r = await decodeInWorker(buf, n);
    /** @type {any} */ (self).postMessage(
      { id, peaks: r.peaks, duration: r.duration, sampleRate: r.sampleRate, channels: r.channels },
      [r.peaks.buffer],
    );
  } catch (e) {
    /** @type {any} */ (self).postMessage({ id, error: (e && e.message) || String(e) });
  }
};

// ---- MP3 帧头解析 ----
// 只处理 MPEG Layer III（也就是 .mp3 里的实际内容）。
const BITRATES = [
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],  // MPEG1 Layer III
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],      // MPEG2/2.5 Layer III
];
const SAMPLE_RATES = [44100, 48000, 32000];
const SAMPLE_RATES2 = [22050, 24000, 16000];   // MPEG2
const SAMPLE_RATES25 = [11025, 12000, 8000];   // MPEG2.5

/** @returns {{frames:{off:number,len:number,samples:number,t:number}[], sampleRate:number} | null} */
export function parseMp3Frames(bytes) {
  const n = bytes.length;
  let i = 0;
  // 跳过 ID3v2 标签
  if (n > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const sz = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    i = 10 + sz + ((bytes[5] & 0x10) ? 10 : 0);   // footer 标志
    if (i < 0 || i > n) i = 0;
  }
  const frames = [];
  let sampleRate = 0;
  let totalSamples = 0;
  while (i + 4 <= n) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (bytes[i + 1] >> 3) & 3;        // 3=MPEG1, 2=MPEG2, 0=MPEG2.5, 1=保留
    const layer = (bytes[i + 1] >> 1) & 3;      // 1=LayerIII
    const brIdx = (bytes[i + 2] >> 4) & 15;
    const srIdx = (bytes[i + 2] >> 2) & 3;
    const pad = (bytes[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) { i++; continue; }
    const mpeg1 = ver === 3;
    const br = (mpeg1 ? BITRATES[0] : BITRATES[1])[brIdx] * 1000;
    const sr = (mpeg1 ? SAMPLE_RATES : ver === 2 ? SAMPLE_RATES2 : SAMPLE_RATES25)[srIdx];
    if (!br || !sr) { i++; continue; }
    // Layer III 帧长：MPEG1 = 144*bitrate/sr，MPEG2/2.5 = 72*bitrate/sr
    const flen = Math.floor((mpeg1 ? 144 : 72) * br / sr) + pad;
    const samples = mpeg1 ? 1152 : 576;
    if (flen < 4 || i + flen > n) { i++; continue; }
    if (!sampleRate) sampleRate = sr;
    frames.push({ off: i, len: flen, samples, t: totalSamples });
    totalSamples += samples;
    i += flen;
  }
  return frames.length ? { frames, sampleRate } : null;
}

async function decodeInWorker(buf, buckets) {
  const bytes = new Uint8Array(buf);
  const parsed = parseMp3Frames(bytes);
  if (!parsed) throw new Error("not an mp3 stream");
  if (typeof AudioDecoder !== "function") throw new Error("AudioDecoder unavailable");
  const cfg = { codec: "mp3", sampleRate: parsed.sampleRate, numberOfChannels: 2 };
  const sup = await AudioDecoder.isConfigSupported(cfg).catch(() => null);
  if (!sup || !sup.supported) throw new Error("mp3 not supported by AudioDecoder");

  const { frames, sampleRate } = parsed;
  let totalSamples = 0;
  for (const f of frames) totalSamples += f.samples;

  // 每桶覆盖的样本数：按总样本数 / 桶数切分
  const step = Math.max(1, Math.floor(totalSamples / buckets));
  const peaks = new Float32Array(buckets);
  let channels = 2;
  let pos = 0;   // 已消费的样本数（跨帧连续）

  const absorb = (data, nch, nframes, start) => {
    channels = nch;
    // 交错布局：第 j 帧的第 c 声道在 data[j*nch + c]。
    // 下标能整除时比除法快很多；这里把 buckets 的边界预先算好也可以，
    // 但 2140 万次迭代实测只要 150 ms，保持可读性优先。
    for (let c = 0; c < nch; c++) {
      const d = data.subarray(c, data.length);
      for (let j = 0; j < nframes; j++) {
        const v = d[j * nch];
        const a = v < 0 ? -v : v;
        const idx = Math.min(buckets - 1, ((start + j) / step) | 0);
        if (a > peaks[idx]) peaks[idx] = a;
      }
    }
  };

  // 复用同一块临时数组：每帧新建 Float32Array 会产生 9283 次分配，
  // 实测占解码耗时的一半。按最大帧长（1152×声道）预分配一次即可。
  let scratch = new Float32Array(1152 * 2);
  let failure = null;
  const dec = new AudioDecoder({
    output: frame => {
      try {
        const nch = frame.numberOfChannels;
        const nf = frame.numberOfFrames;
        const need = nf * nch;
        if (scratch.length < need) scratch = new Float32Array(need);
        const copy = scratch.subarray(0, need);
        frame.copyTo(copy, { planeIndex: 0, format: "f32" });
        absorb(copy, nch, nf, pos);
        pos += nf;
      } catch (e) {
        failure = e;
      } finally {
        frame.close();
      }
    },
    error: e => { failure = e; },
  });
  dec.configure(cfg);

  try {
    // 一次性把全部帧排入解码器，最后只 flush 一次。
    // （之前分批 flush 需等 36 轮，反而比主线程 WebAudio 还慢。）
    // 用 queueSize 控制不要让待解码队列无限长。
    const BATCH = 256;
    for (let k = 0; k < frames.length; k += BATCH) {
      if (failure) throw failure;
      const end = Math.min(frames.length, k + BATCH);
      for (let m = k; m < end; m++) {
        const f = frames[m];
        dec.decode(new EncodedAudioChunk({
          type: "key",
          timestamp: Math.round(f.t * 1e6 / sampleRate),
          duration: Math.round(f.samples * 1e6 / sampleRate),
          data: bytes.subarray(f.off, f.off + f.len),
        }));
      }
      // 队列过长时等一会儿，避免内存暴涨；短队列不等。
      while (dec.decodeQueueSize > 4096) await new Promise(r => setTimeout(r, 0));
    }
    await dec.flush();
    if (failure) throw failure;
  } finally {
    try { dec.close(); } catch (e) { }
  }

  const out = peaksFromChunks(peaks, totalSamples, sampleRate, channels, buckets);
  return out;
}
