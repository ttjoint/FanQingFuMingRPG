#!/usr/bin/env node
// AI 素材生成 CLI（ComfyUI 后端）。
//
// 常用：
//   node tools/aigen/cli.mjs serve                 # 后台启动本地 ComfyUI 并等待就绪
//   node tools/aigen/cli.mjs status                # 探活 + 列出 checkpoint
//   node tools/aigen/cli.mjs gen item "rusty iron sword" --out _aigen/剑.png
//   node tools/aigen/cli.mjs batch tools/aigen/jobs.example.json
//   node tools/aigen/cli.mjs sheet --dir _aigen/cand  # 把候选拼成一张预览长图
import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, openSync } from "node:fs";
import { dirname, resolve, join, basename, extname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { ComfyClient, txt2imgWorkflow } from "./comfy.mjs";
import { decodePNG, encodePNG, toIcon, resize, fitCentered } from "./png.mjs";
import { buildPrompt, KINDS, sizeOf } from "./prompts.mjs";
import { analyze } from "./analyze.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = process.env.COMFY_URL || "http://127.0.0.1:8199";
const CKPT = process.env.COMFY_CKPT || "aziibpixelmix_v10.safetensors";
const PORTABLE = process.env.COMFY_PORTABLE || "D:/Projects/ComfyUI_windows_portable";

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
function has(name) { return process.argv.includes("--" + name); }

async function cmdStatus() {
  const c = new ComfyClient(BASE);
  const ok = await c.ping();
  console.log("ComfyUI " + BASE + " → " + (ok ? "在线" : "离线"));
  if (!ok) { console.log("提示：先运行 node tools/aigen/cli.mjs serve"); process.exitCode = 1; return; }
  const cks = await c.checkpoints();
  console.log("可用 checkpoint：" + (cks.length ? cks.join(", ") : "（无）"));
}

async function cmdServe() {
  const c = new ComfyClient(BASE);
  if (await c.ping()) { console.log("ComfyUI 已在运行：" + BASE); return; }
  const port = new URL(BASE).port || "8199";
  const py = join(PORTABLE, "python_embeded", "python.exe");
  if (!existsSync(py)) { console.error("找不到便携版 python：" + py); process.exitCode = 1; return; }
  const log = join(ROOT, "_aigen", "comfy.log");
  mkdirSync(dirname(log), { recursive: true });
  const out = openSync(log, "a");
  const child = spawn(py, ["-s", "ComfyUI/main.py", "--windows-standalone-build", "--port", port, "--listen", "127.0.0.1"],
    { cwd: PORTABLE, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  console.log("已启动 ComfyUI（pid " + child.pid + "），日志：" + log);
  process.stdout.write("等待就绪");
  for (let i = 0; i < 180; i++) {
    await new Promise(r => setTimeout(r, 1000));
    if (await c.ping()) { console.log("\n就绪：" + BASE); return; }
    if (i % 5 === 0) process.stdout.write(".");
  }
  console.error("\n启动超时，请看日志：" + log);
  process.exitCode = 1;
}

/**
 * 生成一张素材。
 * @param {string} kind item|skill|face|unit|prop
 * @param {string} subject
 * @param {any} opts
 * @returns {Promise<{png:Buffer, raw:Buffer, meta:any}>}
 */
export async function generateOne(kind, subject, opts) {
  const o = opts || {};
  const p = buildPrompt(kind, subject, { extra: o.extra, negative: o.negative });
  const client = new ComfyClient(o.base || BASE, { timeoutMs: o.timeoutMs || 300000 });
  const gen = o.gen || p.gen;
  const wf = txt2imgWorkflow({
    ckpt: o.ckpt || CKPT,
    positive: p.positive, negative: p.negative,
    width: gen, height: gen, seed: o.seed,
    steps: o.steps || p.steps || 26, cfg: o.cfg || p.cfg || 7, prefix: o.prefix || "aigen",
  });
  const r = await client.runTxt2Img(wf);
  const raw = r.buffer;
  const img = decodePNG(raw);
  const [W, H] = sizeOf(p.size);
  let done, keyInfo = null;
  if (o.raw) done = img;
  else {
    const icon = toIcon({ img, size: [W, H], key: o.key, tol: o.tol, ratio: p.ratio, padding: o.padding, keepBg: o.keepBg, quantize: o.quantize !== false, levels: o.levels || p.levels || 8 });
    done = icon; keyInfo = icon.keyInfo;
  }
  return { png: encodePNG(done), raw, meta: { kind, subject, prompt: p.positive, negative: p.negative, seed: wf[5].inputs.seed, size: [W, H], gen, steps: wf[5].inputs.steps, cfg: wf[5].inputs.cfg, promptId: r.promptId, keyInfo } };
}

async function cmdGen() {
  const kind = process.argv[3];
  const subject = process.argv[4];
  if (!kind || !subject) { console.error("用法：cli.mjs gen <kind> \"<subject>\" [--out 文件] [--seed N] [--raw] [--retry N]"); process.exitCode = 1; return; }
  const out = arg("out");
  const seed = arg("seed");
  const retry = Number(arg("retry", 0)) || 0;
  const baseSeed = seed == null ? Math.floor(Math.random() * 1e9) : Number(seed);
  const t0 = Date.now();
  let last = null, lastQa = null, usedSeed = baseSeed;
  for (let attempt = 0; attempt <= retry; attempt++) {
    usedSeed = baseSeed + attempt;
    const r = await generateOne(kind, subject, {
      seed: usedSeed,
      raw: has("raw"), extra: arg("extra"), negative: arg("negative"),
      steps: arg("steps") && Number(arg("steps")), ckpt: arg("ckpt"),
    });
    last = r;
    let qa = null;
    try { qa = analyze(decodePNG(r.raw)); } catch { qa = null; }
    lastQa = qa;
    const bad = qa && (
      qa.palette.at32 > 300 || qa.blobs > 2 || qa.largestRatio < 0.08 ||
      // 稀疏碎点：bbox 内填充率过低，缩小后就是一堆散点（铁剑类典型失败）
      qa.bboxFill < 0.45
    );
    if (!bad || attempt === retry) break;
    console.log("seed " + usedSeed + " 质检不合格（@32=" + qa.palette.at32 + "，blobs=" + qa.blobs + "，主体=" + (qa.largestRatio * 100).toFixed(0) + "%，bbox填充=" + (qa.bboxFill * 100).toFixed(0) + "%）→ 重试");
  }
  const { png, raw, meta } = last;
  console.log("生成完成 " + ((Date.now() - t0) / 1000).toFixed(1) + "s  seed=" + meta.seed + "  尺寸=" + meta.size.join("x") + "  出图=" + meta.gen + " steps=" + meta.steps + " cfg=" + meta.cfg);
  console.log("prompt: " + meta.prompt);
  if (meta.keyInfo) console.log("抠底：移除背景像素 " + meta.keyInfo.removed + "，保留内部近背景色像素 " + meta.keyInfo.keptInnerNear + "（后者是被保护住的白发/白衣类区域）");
  if (lastQa) {
    const qa = lastQa;
    console.log("质检：原图@32色数=" + qa.palette.at32 + "，连通域=" + qa.blobs + "，主体占画面=" + (qa.largestRatio * 100).toFixed(0) + "%，bbox填充=" + (qa.bboxFill * 100).toFixed(0) + "%");
    if (qa.palette.at32 > 300) console.log("⚠ 细节过多（@32 色数 > 300），缩小后可能糊成一团；建议换 seed 或简化 subject");
    if (qa.blobs > 2) console.log("⚠ 主体不唯一（连通域 " + qa.blobs + "），负向词可能未生效");
    if (qa.largestRatio < 0.08) console.log("⚠ 主体过小（占画面 " + (qa.largestRatio * 100).toFixed(0) + "%），建议重新生成（或加 --retry 3 自动重试）");
    if (qa.bboxFill < 0.45) console.log("⚠ 主体稀疏（bbox 内填充率仅 " + (qa.bboxFill * 100).toFixed(0) + "%），缩到目标尺寸会散成碎点；建议换 seed");
  }
  const dir = join(ROOT, "_aigen", "out");
  mkdirSync(dir, { recursive: true });
  const base = out ? resolve(ROOT, String(out)) : join(dir, kind + "_" + meta.seed + ".png");
  mkdirSync(dirname(base), { recursive: true });
  writeFileSync(base, png);
  writeFileSync(base.replace(/\.png$/, ".raw.png"), raw);
  writeFileSync(base.replace(/\.png$/, ".json"), JSON.stringify(meta, null, 2));
  console.log("已写入 " + base + "（原图 " + base.replace(/\.png$/, ".raw.png") + "）");
}

async function cmdBatch() {
  const file = process.argv[3];
  if (!file) { console.error("用法：cli.mjs batch <jobs.json>"); process.exitCode = 1; return; }
  const jobs = JSON.parse(readFileSync(resolve(ROOT, file), "utf8"));
  const outDir = resolve(ROOT, jobs.outDir || "_aigen/out");
  mkdirSync(outDir, { recursive: true });
  const list = jobs.jobs || [];
  console.log("批量任务 " + list.length + " 个 → " + outDir);
  let ok = 0, fail = 0;
  for (const j of list) {
    const name = j.name || (j.kind + "_" + j.subject.replace(/\W+/g, "_").slice(0, 24));
    try {
      const t0 = Date.now();
      const { png, raw, meta } = await generateOne(j.kind, j.subject, j);
      writeFileSync(join(outDir, name + ".png"), png);
      writeFileSync(join(outDir, name + ".raw.png"), raw);
      writeFileSync(join(outDir, name + ".json"), JSON.stringify(meta, null, 2));
      ok++;
      console.log("  ✓ " + name + " (" + ((Date.now() - t0) / 1000).toFixed(0) + "s)");
    } catch (e) {
      fail++;
      console.log("  ✗ " + name + " — " + e.message);
    }
  }
  console.log("完成：成功 " + ok + "，失败 " + fail);
  if (fail) process.exitCode = 1;
}

/** 把若干 png 拼成一张预览长图（每格放大 3 倍，便于肉眼检查像素效果）。 */
async function cmdSheet() {
  const dir = resolve(ROOT, String(arg("dir", "_aigen/out")));
  const scale = Number(arg("scale", 3));
  const files = readdirSync(dir).filter(f => f.endsWith(".png") && !f.endsWith(".raw.png")).sort();
  if (!files.length) { console.error("目录里没有 png：" + dir); process.exitCode = 1; return; }
  const imgs = files.map(f => ({ f, img: decodePNG(readFileSync(join(dir, f))) }));
  const cell = Math.max(...imgs.map(i => Math.max(i.img.width, i.img.height))) * scale + 8;
  const cols = Math.min(8, imgs.length);
  const rows = Math.ceil(imgs.length / cols);
  const W = cols * cell, H = rows * cell;
  const data = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 40; data[i * 4 + 1] = 40; data[i * 4 + 2] = 46; data[i * 4 + 3] = 255; }
  const sheet = { width: W, height: H, data };
  imgs.forEach((it, i) => {
    const big = resize(it.img, it.img.width * scale, it.img.height * scale);
    const cx = (i % cols) * cell, cy = Math.floor(i / cols) * cell;
    const ox = cx + Math.floor((cell - big.width) / 2), oy = cy + Math.floor((cell - big.height) / 2);
    for (let y = 0; y < big.height; y++) {
      for (let x = 0; x < big.width; x++) {
        const si = (y * big.width + x) * 4, di = ((oy + y) * W + ox + x) * 4;
        const a = big.data[si + 3] / 255;
        if (a <= 0) continue;
        for (let k = 0; k < 3; k++) sheet.data[di + k] = Math.round(big.data[si + k] * a + sheet.data[di + k] * (1 - a));
        sheet.data[di + 3] = 255;
      }
    }
  });
  const out = join(dir, "_sheet.png");
  writeFileSync(out, encodePNG(sheet));
  console.log("预览图 " + files.length + " 张 → " + out);
}

export async function main() {
  const cmd = process.argv[2];
  const table = { serve: cmdServe, status: cmdStatus, gen: cmdGen, batch: cmdBatch, sheet: cmdSheet, kinds: () => console.log(Object.entries(KINDS).map(([k, v]) => k + " — " + v.label + " 尺寸 " + JSON.stringify(v.size)).join("\n")) };
  if (!table[cmd]) { console.error("命令：serve | status | gen | batch | sheet | kinds"); process.exitCode = 1; return; }
  await table[cmd]();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(e => { console.error("错误：" + e.message); process.exit(1); });
}
