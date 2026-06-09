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

  const top = 118, COLS = 150, ROWS = 84;
  const cw = W / COLS, chh = (H - top - 40) / ROWS, gx = 8, gy = top + 4;
  const fpx = Math.floor(chh * 1.1);
  const fnt = `${fpx}pt ${MONO}`;
  const put = (g: string, x: number, y: number, c: string, px = fpx) => {
    ctx.fillStyle = c; ctx.font = px === fpx ? fnt : `${px}pt ${MONO}`;
    ctx.fillText(g, gx + x * cw, gy + y * chh + px);
  };

  // her winding path through this block: top entry -> current position
  const path: Array<[number, number]> = [];
  let px = 75 + (rnd() - 0.5) * 40, py = dir === "down" ? 5 : ROWS - 6;
  const dy = dir === "down" ? 1 : -1;
  for (let s = 0; s < 74; s++) {
    py += dy; px += Math.sin(s * 0.34 + step) * 1.4 + (rnd() - 0.5) * 0.8;
    px = Math.max(6, Math.min(COLS - 6, px));
    path.push([px, py]);
    if (py > ROWS - 6 || py < 5) break;
  }
  const [hx, hy] = path[path.length - 1];
  const onPath = (x: number, y: number) => {
    for (let i = 0; i < path.length; i++) if (Math.hypot(x - path[i][0], y - path[i][1]) < 0.8) return i;
    return -1;
  };

  const grass = busy ? ["#241a16", "#2c2018", "#342820"] : ["#16202c", "#1c2636", "#222e40"];
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (Math.min(x, COLS - 1 - x) / COLS < 0.02) { if (rnd() < 0.4) put("·", x, y, "#0c0f1a"); continue; }
      const pi = onPath(x, y);
      if (pi >= 0 && !(Math.round(x) === Math.round(hx) && Math.round(y) === Math.round(hy))) {
        const b = Math.floor(60 + (pi / path.length) * 120);
        put(rnd() < 0.5 ? "·" : "˙", x, y, `rgb(${b},${b - 20},90)`); continue;
      }
      const r = rnd();
      if (r < 0.09) put("♣T↟".charAt(Math.floor(rnd() * 3)), x, y, busy ? "#3a5a2a" : "#22484a");
      else if (r < 0.11) put("~≈".charAt(Math.floor(rnd() * 2)), x, y, "#1a4678");
      else if (r < 0.122) put("∩", x, y, "#5a6478");
      else put(".,'`".charAt(Math.floor(rnd() * 4)), x, y, grass[Math.floor(rnd() * 3)]);
    }
  }

  // ◆ clues dropped along the trail (viewers follow these)
  for (const f of [0.22, 0.5, 0.78]) {
    const [cx, cy] = path[Math.floor(path.length * f)];
    put("◆", cx, cy, "#ffc766", Math.floor(chh * 1.3));
  }

  // breath glow + AURA at current position
  const acx = gx + hx * cw, acy = gy + hy * chh, maxR = busy ? 220 : 160;
  for (let k = 5; k >= 1; k--) {
    ctx.globalAlpha = (busy ? 0.07 : 0.05) * (6 - k) / 5; ctx.fillStyle = "#00e5ff";
    ctx.beginPath(); ctx.arc(acx, acy, (maxR / 5) * k, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(acx, acy, 42, 0, Math.PI * 2); ctx.stroke();
  put("▲", hx - 0.3, hy - 1.0, "#78f0ff", Math.floor(chh * 0.9));
  put("@", hx - 0.5, hy - 0.3, "#96f5ff", Math.floor(chh * 1.7));
  put("AURA", hx - 1.6, hy - 2.1, "#00e5ff", 24);
  put(dir === "down" ? "▼" : "▲", hx - 0.2, hy + 1.6, "#00e5ff", Math.floor(chh * 1.5));

  // header
  ctx.fillStyle = "#0a0d18"; ctx.fillRect(0, 0, W, 108);
  ctx.fillStyle = "#00e5ff"; ctx.fillRect(0, 108, W, 3);
  ctx.fillStyle = "#00e5ff"; ctx.font = `40pt ${MONO}`; ctx.fillText("WORLD-00 · she walks", 24, 14 + 40);
  ctx.fillStyle = "#96a5b6"; ctx.font = `24pt ${MONO}`;
  ctx.fillText((opts.caption?.[0]) ?? `chapter ${chapter} · step ${step}`, 26, 60 + 24);
  if (opts.stateLine) { ctx.fillStyle = "#7888a0"; ctx.font = `20pt ${MONO}`; ctx.fillText(opts.stateLine, W - 760, 40 + 20); }

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
