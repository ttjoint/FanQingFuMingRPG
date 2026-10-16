// 音效 / 背景音乐 / 音量设置。运行时状态 g 由调用方注入。
import { assetPath } from "../core/assets.js";

export function playSound(g, name) {
  try { const a = new Audio(assetPath("assets/sound/" + name)); a.volume = g.settings.sfx; a.play().catch(() => { }); } catch (e) { }
}

export function loadSettings(g) {
  try { const s = JSON.parse(localStorage.getItem("gsxy_settings") || "{}"); if (typeof s.bgm === "number") g.settings.bgm = s.bgm; if (typeof s.sfx === "number") g.settings.sfx = s.sfx; } catch (e) { }
}

export function saveSettings(g) { try { localStorage.setItem("gsxy_settings", JSON.stringify(g.settings)); } catch (e) { } }

export function playBGM(g, name) {
  const key = name ? "assets/music/" + name.replace(/\.[^.]+$/, ".mp3") : null;
  if (!key) return;
  if (g.bgmSrc === key && g.bgm && !g.bgm.paused) return;
  g.bgmSrc = key;
  const path = assetPath(key);
  try {
    if (g.bgm) g.bgm.pause();
    g.bgm = new Audio(path); g.bgm.loop = true; g.bgm.volume = g.settings.bgm;
    g.bgm.play().catch(() => { });
  } catch (e) { }
}

export function applyVolumes(g) { if (g.bgm) g.bgm.volume = g.settings.bgm; saveSettings(g); }
