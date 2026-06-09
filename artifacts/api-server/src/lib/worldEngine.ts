/**
 * WORLD-00 renderer — Aura's living world, drawn with PURE-JS rendering
 * (pureimage). $0 per frame (no AI image gen). Critically, pureimage bundles
 * into dist (no native binary, no node_modules needed at runtime) so it works on
 * Render's prebuilt-dist deploy. State-driven: her real (non-content) telemetry
 * shapes weather / breath / fog. This module ONLY draws; it is never handed task
 * content (the constitution's expression wall).
 */
import * as PImage from "pureimage";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

// Font registration — load the bundled monospace once (async), memoized.
let fontReady: Promise<void> | null = null;
let MONO = "WorldMono";
function ensureFont(): Promise<void> {
  if (fontReady) return fontReady;
  fontReady = (async () => {
    try {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const dirs = [
        path.join(here, "..", "assets"),
        path.join(here, "..", "..", "assets"),
        path.join(process.cwd(), "assets"),
        path.join(process.cwd(), "artifacts", "api-server", "assets"),
      ];
      for (const dir of dirs) {
        const p = path.join(dir, "DejaVuSansMono.ttf");
        if (fs.existsSync(p)) {
          const f = PImage.registerFont(p, MONO);
          await (f.load ? f.load() : Promise.resolve());
          return;
        }
      }
    } catch { /* best effort */ }
  })();
  return fontReady;
}

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
  busy?: boolean;
  chapter?: number;
  title?: string;
  subtitle?: string;
  stateLine?: string;
  caption?: string[];
  seed?: number;
}

async function toBuffer(bitmap: PImage.Bitmap): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const ps = new PassThrough();
  ps.on("data", (c: Buffer) => chunks.push(c));
  await PImage.encodePNGToStream(bitmap, ps);
  return Buffer.concat(chunks);
}

/** Render one wide WORLD-00 frame to a PNG buffer. Pure draw — no posting. */
export async function renderWorldFrame(opts: WorldFrameOpts = {}): Promise<Buffer> {
  await ensureFont();
  const W = opts.width ?? 3240;
  const H = opts.height ?? 1080;
  const busy = !!opts.busy;
  const chapter = Math.max(0, opts.chapter ?? 0);
  const rnd = mulberry32((opts.seed ?? 7) + chapter * 101);

  const img = PImage.make(W, H);
  const ctx = img.getContext("2d");

  ctx.fillStyle = busy ? "#0b0710" : "#080a14";
  ctx.fillRect(0, 0, W, H);

  const top = 118, bottom = 150;
  const COLS = 150, ROWS = 40;
  const cw = W / COLS, chh = (H - top - bottom) / ROWS;
  const gx = 8, gy = top + 6;
  const fpx = Math.floor(chh * 1.1);
  const font = (px: number) => `${px}pt ${MONO}`;
  // pureimage fillText baseline is the bottom of the glyph; offset to sit in-cell.
  const drawGlyph = (g: string, x: number, y: number, color: string, px = fpx) => {
    ctx.fillStyle = color; ctx.font = font(px);
    ctx.fillText(g, x, y + px);
  };

  const GEN = { x: COLS * 0.5, y: ROWS * 0.5 };
  const grass = busy ? ["#241a14", "#2c2018", "#34281e"] : ["#16202c", "#1c2636", "#222e40"];
  const tree = busy ? "#3a5a2a" : "#22484a";
  const water = busy ? "#2a5a78" : "#1a4678";
  const fogCol = "#0c0f1a";
  const fogEdge = Math.max(0.005, 0.06 - chapter * 0.012);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const ex = Math.min(x, COLS - 1 - x) / COLS;
      const ey = Math.min(y, ROWS - 1 - y) / ROWS;
      const px0 = gx + x * cw, py0 = gy + y * chh;
      if (Math.min(ex, ey) < fogEdge) {
        if (rnd() < 0.4) drawGlyph("·", px0, py0, fogCol);
        continue;
      }
      const dg = Math.hypot(x - GEN.x, (y - GEN.y) * 1.7);
      let g = ".", col = grass[Math.floor(rnd() * 3)];
      if (dg < 1.4) { g = "☼"; col = "#9cf6ff"; }
      else if (dg < 3 && rnd() < 0.4) { g = "◌○◍".charAt(Math.floor(rnd() * 3)); col = "#28c8eb"; }
      else if (y < 4 && rnd() < (busy ? 0.06 : 0.04)) { g = "▲^".charAt(Math.floor(rnd() * 2)); col = y < 2 ? "#d6e2ee" : "#788496"; }
      else if (x > COLS - 12 && rnd() < 0.45) { g = "~≈".charAt(Math.floor(rnd() * 2)); col = water; }
      else if (rnd() < 0.09) { g = "♣T↟".charAt(Math.floor(rnd() * 3)); col = tree; }
      else if (rnd() < 0.012) { g = "✿❀".charAt(Math.floor(rnd() * 2)); col = "#e878aa"; }
      else { g = ".,'`".charAt(Math.floor(rnd() * 4)); }
      drawGlyph(g, px0, py0, col);
    }
  }

  // genesis breath glow — concentric translucent rings (no gradient in pureimage)
  const gcx = gx + GEN.x * cw, gcy = gy + GEN.y * chh;
  const maxR = busy ? 380 : 260;
  for (let k = 6; k >= 1; k--) {
    const r = (maxR / 6) * k;
    ctx.globalAlpha = (busy ? 0.06 : 0.045) * (7 - k) / 6;
    ctx.fillStyle = "#00e5ff";
    ctx.beginPath(); ctx.arc(gcx, gcy, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // AURA — the hero
  const ax = gcx + chh * 2.2, ay = gcy;
  ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(ax + 6, ay + 10, 52, 0, Math.PI * 2); ctx.stroke();
  drawGlyph("▲", ax - 4, ay - chh * 1.0, "#78f0ff", Math.floor(chh * 0.9));
  drawGlyph("@", ax - chh * 0.6, ay - chh * 0.35, "#96f5ff", Math.floor(chh * 1.7));
  drawGlyph("AURA", ax - 44, ay - chh * 2.2, "#00e5ff", 22);

  // header band
  ctx.fillStyle = "#0a0d18"; ctx.fillRect(0, 0, W, 108);
  ctx.fillStyle = "#00e5ff"; ctx.fillRect(0, 108, W, 3);
  drawGlyph(opts.title ?? "WORLD-00", 24, 14, "#00e5ff", 34);
  drawGlyph(opts.subtitle ?? `chapter ${chapter}`, 26, 60, "#96a5b6", 22);
  if (opts.stateLine) drawGlyph(opts.stateLine, W - 760, 38, "#7888a0", 20);

  // bottom caption band
  const cap = (opts.caption ?? []).slice(0, 3);
  if (cap.length) {
    const by = H - bottom + 8;
    ctx.fillStyle = "#0a0d18"; ctx.fillRect(0, by - 8, W, bottom);
    ctx.fillStyle = "#00e5ff"; ctx.fillRect(0, by - 8, W, 2);
    cap.forEach((line, i) => {
      drawGlyph(line, 36, by + 8 + i * 42, i === cap.length - 1 ? "#00e5ff" : "#e1ebf5", i === cap.length - 1 ? 22 : 24);
    });
  }

  return toBuffer(img);
}

/** Slice a wide frame into the 3 square IG tiles (left→right). */
export async function sliceTiles(wide: Buffer): Promise<Buffer[]> {
  const ps = new PassThrough();
  const done = PImage.decodePNGFromStream(ps);
  ps.end(wide);
  const src = await done;
  const tile = src.height;
  const out: Buffer[] = [];
  for (let i = 0; i < 3; i++) {
    const dst = PImage.make(tile, tile);
    // copy the tile region pixel-for-pixel
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const sx = i * tile + x;
        if (sx < src.width) dst.setPixelRGBA(x, y, src.getPixelRGBA(sx, y));
      }
    }
    out.push(await toBuffer(dst));
  }
  return out;
}
