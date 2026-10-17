// 极简 ComfyUI HTTP 客户端（零依赖，Node 18+ 原生 fetch）。
// 只覆盖生图管线需要的两个动作：提交 txt2img 工作流、等待并取回结果图。

export class ComfyClient {
  /**
   * @param {string} base 形如 http://127.0.0.1:8199
   * @param {{pollMs?:number, timeoutMs?:number}} [opts]
   */
  constructor(base, opts) {
    this.base = String(base || "http://127.0.0.1:8199").replace(/\/+$/, "");
    this.pollMs = (opts && opts.pollMs) || 700;
    this.timeoutMs = (opts && opts.timeoutMs) || 300000;
    this.clientId = "aigen-" + Math.random().toString(36).slice(2, 10);
  }

  async _json(path, init) {
    const r = await fetch(this.base + path, init);
    if (!r.ok) throw new Error("ComfyUI " + path + " → HTTP " + r.status + " " + (await r.text()).slice(0, 300));
    return r.json();
  }

  /** 服务是否就绪（用于启动前的探活）。 */
  async ping() {
    try { const s = await this._json("/system_stats"); return !!s && !!s.system; } catch { return false; }
  }

  /** 可用 checkpoint 列表。 */
  async checkpoints() {
    const o = await this._json("/object_info/CheckpointLoaderSimple");
    const node = o && o.CheckpointLoaderSimple;
    const req = node && node.input && node.input.required && node.input.required.ckpt_name;
    return (req && req[0]) || [];
  }

  /** 提交工作流，返回 prompt_id。 */
  async submit(workflow) {
    const j = await this._json("/prompt", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });
    if (j && j.node_errors && Object.keys(j.node_errors).length) {
      throw new Error("工作流节点错误：" + JSON.stringify(j.node_errors).slice(0, 500));
    }
    return j.prompt_id;
  }

  /** 轮询直到该 prompt 完成，返回 history 条目。 */
  async wait(promptId) {
    const t0 = Date.now();
    for (;;) {
      const h = await this._json("/history/" + promptId);
      const entry = h && h[promptId];
      if (entry) {
        const st = entry.status || {};
        if (st.status_str === "error" || st.completed === false && st.status_str === "error") {
          throw new Error("生成失败：" + JSON.stringify(st).slice(0, 500));
        }
        return entry;
      }
      if (Date.now() - t0 > this.timeoutMs) throw new Error("等待生成超时（" + Math.round(this.timeoutMs / 1000) + "s）");
      await sleep(this.pollMs);
    }
  }

  /** 从 history 条目里取出全部输出图（{filename, subfolder, type}）。 */
  static imagesOf(entry) {
    const out = [];
    for (const nodeId in (entry && entry.outputs) || {}) {
      const imgs = entry.outputs[nodeId].images || [];
      for (const im of imgs) out.push(im);
    }
    return out;
  }

  /** 下载一张输出图为 Buffer。 */
  async fetchImage(img) {
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder || "", type: img.type || "output" });
    const r = await fetch(this.base + "/view?" + q.toString());
    if (!r.ok) throw new Error("下载图片失败 HTTP " + r.status);
    return Buffer.from(await r.arrayBuffer());
  }

  /** 一步到位：提交 + 等待 + 取回第一张图的 Buffer。 */
  async runTxt2Img(workflow) {
    const pid = await this.submit(workflow);
    const entry = await this.wait(pid);
    const imgs = ComfyClient.imagesOf(entry);
    if (!imgs.length) throw new Error("生成完成但没有输出图");
    return { buffer: await this.fetchImage(imgs[0]), images: imgs, promptId: pid };
  }
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** 构造一个最小的 SD1.5 txt2img 工作流。 */
export function txt2imgWorkflow(o) {
  const w = o.width || 512, h = o.height || 512;
  return {
    1: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: o.ckpt } },
    2: { class_type: "CLIPTextEncode", inputs: { text: o.positive || "", clip: ["1", 1] } },
    3: { class_type: "CLIPTextEncode", inputs: { text: o.negative || "", clip: ["1", 1] } },
    4: { class_type: "EmptyLatentImage", inputs: { width: w, height: h, batch_size: o.batch || 1 } },
    5: {
      class_type: "KSampler",
      inputs: {
        seed: o.seed == null ? Math.floor(Math.random() * 1e9) : o.seed,
        steps: o.steps || 28, cfg: o.cfg || 6,
        sampler_name: o.sampler || "euler_ancestral", scheduler: o.scheduler || "normal",
        denoise: 1,
        model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0],
      },
    },
    6: { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } },
    7: { class_type: "SaveImage", inputs: { images: ["6", 0], filename_prefix: o.prefix || "aigen" } },
  };
}
