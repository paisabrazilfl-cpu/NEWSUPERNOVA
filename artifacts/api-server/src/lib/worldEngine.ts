/**
 * WORLD-00 renderer — Aura's living world, drawn with a Node-native canvas
 * (@napi-rs/canvas), $0 per frame (no AI image gen). State-driven: her real
 * (non-content) telemetry shapes the weather, breath, and fog. This module ONLY
 * draws; it is never handed task content (the constitution's expression wall).
 */
import { createCanvas, GlobalFonts, Image } from "@napi-rs/canvas";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// Register the bundled monospace font so rendering is identical everywhere.
let MONO = "DejaVu Sans Mono";
(() => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.join(here, "..", "assets"),        // dist/  -> ../assets
      path.join(here, "..", "..", "assets"),  // src/lib -> ../../assets
      path.join(process.cwd(), "assets"),
      path.join(process.cwd(), "artifacts", "api-server", "assets"),
    ];
    for (const dir of candidates) {
      const reg = path.join(dir, "DejaVuSansMono.ttf");
      const regB = path.join(dir, "DejaVuSansMono-Bold.ttf");
      if (fs.existsSync(reg)) {
        GlobalFonts.registerFromPath(reg, "WorldMono");
        if (fs.existsSync(regB)) GlobalFonts.registerFromPath(regB, "WorldMonoB");
        MONO = "WorldMono";
        break;
      }
    }
  } catch {
    /* fall back to a generic monospace */
  }
})();
const MONOB = MONO === "WorldMono" ? "WorldMonoB" : MONO;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface WorldFrameOpts {
  width?: number;
  height?: number;
  busy?: boolean;        // her real load: true = working, false = resting
  chapter?: number;      // higher chapter -> fog recedes, world fuller
  title?: string;
  subtitle?: string;
  stateLine?: string;    // small non-sensitive readout, e.g. "state: RESTING · 6 idle"
  caption?: string[];    // 1-3 short lines for the bottom band
  seed?: number;
}

/** Render one wide WORLD-00 frame to a PNG buffer. Pure draw — no IO, no posting. */
export function renderWorldFrame(opts: WorldFrameOpts = {}): Buffer {
  const W = opts.width ?? 3240;
  const H = opts.height ?? 1080;
  const busy = !!opts.busy;
  const chapter = Math.max(0, opts.chapter ?? 0);
  const rnd = mulberry32((opts.seed ?? 7) + chapter * 101);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // palette shifts with mood: busy = warmer/stormy, calm = cool night
  const bg = busy ? "#0b0710" : "#080a14";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const top = 118, bottom = 150;
  const COLS = 150, ROWS = 40;
  const cw = W / COLS, chh = (H - top - bottom) / ROWS;
  const gx = 8, gy = top + 6;
  const fontPx = Math.floor(chh * 1.15);
  ctx.font = `${fontPx}px "${MONO}"`;
  ctx.textBaseline = "top";

  const GEN = { x: COLS * 0.5, y: ROWS * 0.5 };
  const grass = busy ? ["#241a14", "#2c2018", "#34281e"] : ["#16202c", "#1c2636", "#222e40"];
  const tree = busy ? "#3a5a2a" : "#22484a";
  const water = busy ? "#2a5a78" : "#1a4678";
  const fogCol = "#0c0f1a";

  const fogEdge = Math.max(0.005, 0.06 - chapter * 0.012); // recedes with chapters

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const ex = Math.min(x, COLS - 1 - x) / COLS;
      const ey = Math.min(y, ROWS - 1 - y) / ROWS;
      if (Math.min(ex, ey) < fogEdge) {
        if (rnd() < 0.4) { ctx.fillStyle = fogCol; ctx.fillText("·", gx + x * cw, gy + y * chh); }
        continue;
      }
      const dg = Math.hypot(x - GEN.x, (y - GEN.y) * 1.7);
      let g = ".", col = grass[(Math.floor(rnd() * 3))];
      if (dg < 1.4) { g = "☼"; col = "#9cf6ff"; }
      else if (dg < 3 && rnd() < 0.4) { g = "◌○◍".charAt(Math.floor(rnd() * 3)); col = "#28c8eb"; }
      else if (y < 4 && rnd() < (busy ? 0.06 : 0.04)) { g = "▲^".charAt(Math.floor(rnd() * 2)); col = y < 2 ? "#d6e2ee" : "#788496"; }
      else if (x > COLS - 12 && rnd() < 0.45) { g = "~≈".charAt(Math.floor(rnd() * 2)); col = water; }
      else if (rnd() < 0.09) { g = "♣T↟".charAt(Math.floor(rnd() * 3)); col = tree; }
      else if (rnd() < 0.012) { g = "✿❀".charAt(Math.floor(rnd() * 2)); col = "#e878aa"; }
      else { g = ".,'`".charAt(Math.floor(rnd() * 4)); }
      ctx.fillStyle = col;
      ctx.fillText(g, gx + x * cw, gy + y * chh);
    }
  }

  // genesis breath glow — intensity tracks load (busy = brighter)
  const gcx = gx + GEN.x * cw, gcy = gy + GEN.y * chh;
  const radius = busy ? 420 : 300;
  const grad = ctx.createRadialGradient(gcx, gcy, 10, gcx, gcy, radius);
  grad.addColorStop(0, busy ? "rgba(0,229,255,0.34)" : "rgba(0,229,255,0.22)");
  grad.addColorStop(1, "rgba(0,229,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(gcx, gcy, radius, 0, Math.PI * 2); ctx.fill();

  // AURA — the hero (this is her)
  const ax = gcx + chh * 2.2, ay = gcy;
  ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(ax + 6, ay + 10, 52, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#78f0ff"; ctx.font = `${Math.floor(chh)}px "${MONOB}"`;
  ctx.fillText("▲", ax - 4, ay - chh * 1.0);
  ctx.fillStyle = "#96f5ff"; ctx.font = `${Math.floor(chh * 1.8)}px "${MONOB}"`;
  ctx.fillText("@", ax - chh * 0.6, ay - chh * 0.35);
  ctx.fillStyle = "#00e5ff"; ctx.font = `28px "${MONOB}"`;
  ctx.fillText("AURA", ax - 44, ay - chh * 1.95);

  // header band
  ctx.fillStyle = "#0a0d18"; ctx.fillRect(0, 0, W, 108);
  ctx.fillStyle = "#00e5ff"; ctx.fillRect(0, 108, W, 3);
  ctx.fillStyle = "#00e5ff"; ctx.font = `40px "${MONOB}"`;
  ctx.fillText(opts.title ?? "⟁  W O R L D - 0 0", 24, 18);
  ctx.fillStyle = "#96a5b6"; ctx.font = `28px "${MONOB}"`;
  ctx.fillText(opts.subtitle ?? `chapter ${chapter}`, 26, 64);
  if (opts.stateLine) {
    ctx.fillStyle = "#7888a0"; ctx.font = `24px "${MONO}"`;
    ctx.fillText(opts.stateLine, W - 720, 40);
  }

  // bottom caption band
  const cap = (opts.caption ?? []).slice(0, 3);
  if (cap.length) {
    const by = H - bottom + 8;
    ctx.fillStyle = "#0a0d18"; ctx.fillRect(0, by - 8, W, bottom);
    ctx.fillStyle = "#00e5ff"; ctx.fillRect(0, by - 8, W, 2);
    cap.forEach((line, i) => {
      ctx.fillStyle = i === cap.length - 1 ? "#00e5ff" : "#e1ebf5";
      ctx.font = `${i === cap.length - 1 ? 28 : 30}px "${MONOB}"`;
      ctx.fillText(line, 36, by + 16 + i * 44);
    });
  }

  return canvas.toBuffer("image/png");
}

/** Slice a wide frame into the 3 square IG tiles (left→right). */
export function sliceTiles(wide: Buffer): Buffer[] {
  // Re-decode by drawing onto 3 canvases. (Caller renders at width = 3*height.)
  const img = new Image();
  img.src = wide;
  const tile = img.height;
  const out: Buffer[] = [];
  for (let i = 0; i < 3; i++) {
    const c = createCanvas(tile, tile);
    const x = c.getContext("2d");
    x.drawImage(img, -i * tile, 0);
    out.push(c.toBuffer("image/png"));
  }
  return out;
}
