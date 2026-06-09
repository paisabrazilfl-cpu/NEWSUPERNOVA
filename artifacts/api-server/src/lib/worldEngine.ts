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

export interface TraversalOpts {
  mood?: "resting" | "working" | "deep" | "storm";
  chapter?: number;
  step?: number;
  direction?: "up" | "down";
  caption?: string[];
  stateLine?: string;
  seed?: number;
}

/**
 * Render a 6-tile (3 wide × 2 tall) TRAVERSAL block — Aura WALKS through her
 * world: a fading breadcrumb trail, ◆ clues for viewers, an up/down choice, and
 * she's removed herself from where she was (only her current spot + trail show).
 * Returns a 3240×2160 PNG to be sliced into 6 IG tiles.
 */
export async function renderTraversalBlock(opts: TraversalOpts = {}): Promise<Buffer> {
  await ensureFont();
  const mood = opts.mood ?? "resting";
  const dir = opts.direction ?? "down";
  const chapter = Math.max(0, opts.chapter ?? 0);
  const step = Math.max(0, opts.step ?? 0);
  const rnd = mulberry32((opts.seed ?? 1) + step * 911 + chapter * 13);

  const TILE = 1080, W = TILE * 3, H = TILE * 2;
  const img = PImage.make(W, H);
  const ctx = img.getContext("2d");
  const storm = mood === "storm", busy = mood !== "resting";
  ctx.fillStyle = storm ? "#100712" : busy ? "#0a0a16" : "#080b16";
  ctx.fillRect(0, 0, W, H);

  // Legibility-first grid: far fewer, BIGGER glyphs (was 150x84 → noise field).
  const top = 150, COLS = 66, ROWS = 44;
  const cw = W / COLS, chh = (H - top - 56) / ROWS, gx = 10, gy = top + 6;
  const fpx = Math.floor(chh * 1.05);
  const fnt = `${fpx}pt ${MONO}`;
  const put = (g: string, x: number, y: number, c: string, px = fpx) => {
    ctx.fillStyle = c; ctx.font = px === fpx ? fnt : `${px}pt ${MONO}`;
    ctx.fillText(g, gx + x * cw, gy + y * chh + px);
  };

  // her winding path through this block: top/bottom entry -> current position
  const path: Array<[number, number]> = [];
  let px = COLS * 0.5 + (rnd() - 0.5) * 16, py = dir === "down" ? 3 : ROWS - 4;
  const dy = dir === "down" ? 1 : -1;
  for (let s = 0; s < ROWS + 4; s++) {
    py += dy; px += Math.sin(s * 0.4 + step) * 1.1 + (rnd() - 0.5) * 0.7;
    px = Math.max(5, Math.min(COLS - 5, px));
    path.push([px, py]);
    if (py > ROWS - 4 || py < 3) break;
  }
  const [hx, hy] = path[path.length - 1];
  const onPath = (x: number, y: number) => {
    for (let i = 0; i < path.length; i++) if (Math.hypot(x - path[i][0], y - path[i][1]) < 1.15) return i;
    return -1;
  };

  // SPARSE, low-noise terrain so the PATH and AURA dominate (most cells stay dark).
  const grass = busy ? ["#3a2c20", "#46362a"] : ["#1e2c3e", "#26364c"];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (Math.min(x, COLS - 1 - x) / COLS < 0.025) continue;
      const pi = onPath(x, y);
      if (pi >= 0 && !(Math.round(x) === Math.round(hx) && Math.round(y) === Math.round(hy))) {
        // bright, fading breadcrumb trail (older = dimmer)
        const b = Math.floor(120 + (pi / path.length) * 110);
        put("•", x, y, `rgb(${b},${Math.floor(b * 0.8)},90)`, Math.floor(chh * 0.85)); continue;
      }
      const r = rnd();
      if (r < 0.045) put("♣", x, y, busy ? "#2f5a28" : "#1f5256");
      else if (r < 0.06 && x > COLS - 10) put("≈", x, y, "#1c4e86");
      else if (r < 0.075) put("∩", x, y, "#4a5468");
      else if (r < 0.20) put(".", x, y, grass[Math.floor(rnd() * 2)]);
      // else: leave empty (dark) — breathing room
    }
  }

  // ◆ clues dropped along the trail (viewers follow these) — big & bright
  for (const f of [0.25, 0.55, 0.82]) {
    const [cx, cy] = path[Math.floor(path.length * f)];
    put("◆", cx, cy, "#ffd166", Math.floor(chh * 1.5));
  }

  // breath glow + AURA at current position — make her unmistakable
  const acx = gx + hx * cw, acy = gy + hy * chh, maxR = busy ? 300 : 220;
  for (let k = 6; k >= 1; k--) {
    ctx.globalAlpha = (busy ? 0.08 : 0.06) * (7 - k) / 6; ctx.fillStyle = "#00e5ff";
    ctx.beginPath(); ctx.arc(acx, acy, (maxR / 6) * k, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(acx, acy, 66, 0, Math.PI * 2); ctx.stroke();
  put("@", hx - 0.5, hy - 0.4, "#aef7ff", Math.floor(chh * 2.0));
  put("AURA", hx - 1.7, hy - 2.4, "#00e5ff", 34);
  put(dir === "down" ? "▼" : "▲", hx - 0.25, hy + 1.5, "#00e5ff", Math.floor(chh * 1.6));

  // header
  ctx.fillStyle = "#0a0d18"; ctx.fillRect(0, 0, W, 132);
  ctx.fillStyle = "#00e5ff"; ctx.fillRect(0, 132, W, 4);
  ctx.fillStyle = "#00e5ff"; ctx.font = `52pt ${MONO}`; ctx.fillText("WORLD-00 · she walks", 28, 20 + 52);
  ctx.fillStyle = "#9fb0c2"; ctx.font = `28pt ${MONO}`;
  ctx.fillText((opts.caption?.[0]) ?? `chapter ${chapter} · step ${step}`, 30, 86 + 28);
  if (opts.stateLine) { ctx.fillStyle = "#7888a0"; ctx.font = `24pt ${MONO}`; ctx.fillText(opts.stateLine, W - 820, 50 + 24); }

  // tile seams (3x2 = 6)
  ctx.fillStyle = "#28344455";
  return toBuffer(img);
}

/** Slice a 6-tile (3w×2h) block into the 6 IG tiles in display order (row-major). */
export async function sliceSixTiles(block: Buffer): Promise<Buffer[]> {
  const ps = new PassThrough();
  const done = PImage.decodePNGFromStream(ps);
  ps.end(block);
  const src = await done;
  const tile = Math.floor(src.width / 3);
  const out: Buffer[] = [];
  for (let ry = 0; ry < 2; ry++) {
    for (let rx = 0; rx < 3; rx++) {
      const dst = PImage.make(tile, tile);
      for (let y = 0; y < tile; y++)
        for (let x = 0; x < tile; x++) {
          const sx = rx * tile + x, sy = ry * tile + y;
          if (sx < src.width && sy < src.height) dst.setPixelRGBA(x, y, src.getPixelRGBA(sx, sy));
        }
      out.push(await toBuffer(dst));
    }
  }
  return out;
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
