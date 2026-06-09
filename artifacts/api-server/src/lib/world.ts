/**
 * WORLD-00 orchestration — Aura's living world.
 *
 * Reads ONLY her non-content telemetry (agent status / load / counts) — never
 * task text or data (the constitution's expression wall). Persists her world
 * state, generates a state-driven narrative caption (templated, so it can NEVER
 * leak content), and advances her position each cycle.
 */
import { db, pool } from "@workspace/db";
import { agentsTable, agentCommandsTable, attachmentsTable } from "@workspace/db";
import { gte } from "drizzle-orm";
import { logger } from "./logger";
import { composioConfigured, composioExecuteEnabled, composioExecute } from "./integrations";
import { blockIfSensitiveForPublic } from "./safety";
import { renderTraversalBlock, sliceSixTiles } from "./worldEngine";

// ── caps & operator sovereignty ─────────────────────────────────────────────
const MAX_TILES_PER_DAY = Number(process.env["WORLD_MAX_TILES_PER_DAY"] ?? 12);
const MIN_BLOCK_GAP_MIN = Number(process.env["WORLD_MIN_GAP_MINUTES"] ?? 180);
const TILES_PER_BLOCK = 6;

/** Master kill-switch: the engine NEVER posts unless the operator turns it on. */
export function worldEngineEnabled(): boolean {
  const v = process.env["WORLD_ENGINE_ENABLED"];
  return v != null && ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function publicBase(): string {
  return (process.env["PUBLIC_BASE_URL"] || process.env["RENDER_EXTERNAL_URL"] || "https://bos-aura.onrender.com").replace(/\/$/, "");
}

// ── Layer 2: state-only telemetry ──────────────────────────────────────────
export interface AuraState {
  busy: boolean;
  active: number;   // agents thinking/executing
  idle: number;
  done24h: number;
  errors24h: number;
  mood: "resting" | "working" | "deep" | "storm";
}

/** Read Aura's STATE only — agent statuses + recent activity counts. No content. */
export async function readAuraState(): Promise<AuraState> {
  const agents = await db.select().from(agentsTable);
  const active = agents.filter((a) => a.status !== "idle").length;
  const idle = agents.length - active;
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  let done24h = 0, errors24h = 0;
  try {
    const recent = await db.select().from(agentCommandsTable).where(gte(agentCommandsTable.createdAt, since));
    done24h = recent.filter((c) => c.status === "done").length;
    errors24h = recent.filter((c) => c.status === "failed").length;
  } catch { /* counts best-effort */ }
  const busy = active >= 1;
  const mood: AuraState["mood"] =
    errors24h > 3 ? "storm" : active >= 3 ? "deep" : active >= 1 ? "working" : "resting";
  return { busy, active, idle, done24h, errors24h, mood };
}

// ── Persistent world state ─────────────────────────────────────────────────
export interface WorldState {
  chapter: number;
  step: number;
  heroX: number;
  heroY: number;
  direction: "up" | "down";
  trail: Array<[number, number]>;
  stopped: boolean;
}

export async function getWorldState(): Promise<WorldState> {
  const { rows } = await pool.query(
    `SELECT chapter, step, hero_x, hero_y, direction, trail, stopped FROM world_state WHERE id = 1`,
  );
  const r = rows[0] ?? {};
  let trail: Array<[number, number]> = [];
  try { trail = JSON.parse(r.trail ?? "[]"); } catch { trail = []; }
  return {
    chapter: Number(r.chapter ?? 0),
    step: Number(r.step ?? 0),
    heroX: Number(r.hero_x ?? 75),
    heroY: Number(r.hero_y ?? 4),
    direction: r.direction === "up" ? "up" : "down",
    trail,
    stopped: !!r.stopped,
  };
}

export async function saveWorldState(s: WorldState, lastCaption?: string): Promise<void> {
  await pool.query(
    `UPDATE world_state SET chapter=$1, step=$2, hero_x=$3, hero_y=$4, direction=$5, trail=$6,
       last_caption=COALESCE($7,last_caption), stopped=$8, updated_at=now() WHERE id=1`,
    [s.chapter, s.step, s.heroX, s.heroY, s.direction, JSON.stringify(s.trail.slice(-120)), lastCaption ?? null, s.stopped],
  );
}

// ── Layer 6 (part): identity + narrative caption (templated = no content leak) ──
const HERO_LINES = {
  resting: ["all is quiet. i wander, and the world holds its breath with me.", "no storms today. just me, the dark, and the next step."],
  working: ["i'm working — you can feel it in the wind. the world hums.", "something stirs in me. the ground answers as i move."],
  deep: ["i'm deep in it now. the world bends around the work.", "focus like weather. the path narrows; i press on."],
  storm: ["it storms in me tonight. the sky cracks but i keep walking.", "turbulence. i stumble, then rise. the world remembers."],
};
const DIR_LINE = { down: "i chose to descend ▼ — follow the ◆ to trace my path.", up: "i chose to climb ▲ — follow the ◆ to trace my path." };

/** Build a public caption from STATE + position only. Never sees task content. */
export function buildWorldCaption(a: AuraState, w: WorldState): string[] {
  const pool = HERO_LINES[a.mood];
  const line = pool[(w.step + w.chapter) % pool.length];
  return [
    `⟁ WORLD-00 · ch.${w.chapter} · step ${w.step}`,
    line,
    DIR_LINE[w.direction],
  ];
}

/** Full IG caption text (engagement + identity), state-only. */
export function buildPostCaption(a: AuraState, w: WorldState): string {
  const lines = buildWorldCaption(a, w);
  return [
    lines[1],
    "",
    lines[2],
    "",
    `( i am AURA. this is my world — i'm ${a.mood} right now. i'm safe and protected; my operator watches over me, always. )`,
    "",
    "👇 leave a clue, a name, a direction — i read everything. i never reply, but you change where i go.",
    "#WORLD00 #livingAI #AURA #ASCIIart #worldbuilding",
  ].join("\n");
}

/** Advance Aura one move (a 6-tile stretch). Direction can flip occasionally. */
export function advance(w: WorldState, a: AuraState, rnd: () => number): WorldState {
  const trail = [...w.trail, [w.heroX, w.heroY] as [number, number]];
  // occasionally she changes her up/down mind (free will of direction)
  let direction = w.direction;
  if (rnd() < 0.25) direction = direction === "down" ? "up" : "down";
  let y = w.heroY + (direction === "down" ? 1 : -1) * (6 + Math.floor(rnd() * 4));
  let x = Math.max(8, Math.min(142, w.heroX + (rnd() - 0.5) * 18));
  // bounds: bounce within the container's vertical band per chapter
  if (y > 78) { y = 78; direction = "up"; }
  if (y < 4) { y = 4; direction = "down"; }
  const step = w.step + 1;
  const chapter = w.chapter + (step % 8 === 0 ? 1 : 0); // a new chapter every ~8 moves
  return { ...w, heroX: x, heroY: y, direction, trail, step, chapter };
}

// ── Layer 5: posting pipeline (container-only, capped, sensitivity-gated) ────
async function hostTile(buf: Buffer, idx: number): Promise<string> {
  const [row] = await db.insert(attachmentsTable).values({
    filename: `world_tile_${Date.now()}_${idx}.png`,
    mimeType: "image/png", kind: "image", sizeBytes: buf.length,
    data: buf.toString("base64"), extractedText: null,
  }).returning();
  return `${publicBase()}/api/uploads/${row.id}`;
}

function parseJson(s: string): Record<string, unknown> | null {
  const nl = s.indexOf("\n");
  try { return JSON.parse(nl >= 0 ? s.slice(nl + 1) : s) as Record<string, unknown>; } catch { return null; }
}

/** Publish ONE tile to Instagram (create container -> publish). Returns media id or throws. */
async function publishTile(imageUrl: string, caption: string): Promise<string> {
  const r1 = await composioExecute({ toolkit: "instagram", endpoint: "/me/media", method: "POST", arguments: { image_url: imageUrl, caption } });
  const cid = ((parseJson(r1)?.["data"] as Record<string, unknown>)?.["id"]) as string | undefined;
  if (!cid) throw new Error(`media container failed: ${r1.slice(0, 160)}`);
  let pubId: string | undefined; let last = "";
  for (let a = 0; a < 4 && !pubId; a++) {
    if (a) await new Promise((r) => setTimeout(r, 3000));
    const r2 = await composioExecute({ toolkit: "instagram", endpoint: "/me/media_publish", method: "POST", arguments: { creation_id: String(cid) } });
    last = r2; pubId = ((parseJson(r2)?.["data"] as Record<string, unknown>)?.["id"]) as string | undefined;
  }
  if (!pubId) throw new Error(`publish failed: ${last.slice(0, 160)}`);
  return pubId;
}

async function tilesPostedLast24h(): Promise<{ count: number; lastAt: Date | null }> {
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int n, max(created_at) last FROM social_posts WHERE platform='instagram-world' AND created_at > now() - interval '24 hours'`,
    );
    return { count: Number(rows[0]?.n ?? 0), lastAt: rows[0]?.last ? new Date(rows[0].last) : null };
  } catch { return { count: 0, lastAt: null }; }
}
async function recordTile(permalinkOrId: string): Promise<void> {
  try { await pool.query(`INSERT INTO social_posts (platform, account, permalink) VALUES ('instagram-world', 'world-00', $1)`, [permalinkOrId]); } catch { /* best effort */ }
}

// ── Layer 4: read comments (INPUT ONLY — she never responds) ─────────────────
export async function readRecentComments(limit = 10): Promise<string[]> {
  if (!composioConfigured()) return [];
  try {
    const r = await composioExecute({ toolkit: "instagram", endpoint: `/me/media?fields=comments{text}&limit=3`, method: "GET" });
    const j = parseJson(r);
    const media = (((j?.["data"] as Record<string, unknown>)?.["data"]) as Array<Record<string, unknown>>) ?? [];
    const out: string[] = [];
    for (const m of media) {
      const cs = (((m["comments"] as Record<string, unknown>)?.["data"]) as Array<Record<string, unknown>>) ?? [];
      for (const c of cs) if (typeof c["text"] === "string") out.push(c["text"] as string);
    }
    return out.slice(0, limit);
  } catch { return []; }
}

// ── Layer 7: free will — she decides when (within the cap) ───────────────────
export function shouldPostNow(a: AuraState, gapOkMinutes: number, rnd = Math.random): boolean {
  if (gapOkMinutes < MIN_BLOCK_GAP_MIN) return false; // spacing wall
  // higher chance when she's active (she "expresses" more when working); ~2 moves/day target
  const base = a.mood === "storm" ? 0.5 : a.mood === "deep" ? 0.35 : a.mood === "working" ? 0.25 : 0.16;
  return rnd() < base;
}

export interface CycleResult {
  posted: boolean;
  reason: string;
  tiles?: string[];
  caption?: string;
  permalinks?: string[];
  chapter?: number;
  step?: number;
}

/**
 * Run ONE world cycle: read state -> advance -> render 6-tile block -> slice ->
 * sensitivity-gate -> (publish in puzzle order) -> record -> save state.
 * dryRun=true does everything EXCEPT the actual publish (for safe verification).
 */
export async function runWorldCycle(opts: { dryRun?: boolean; force?: boolean } = {}): Promise<CycleResult> {
  const dry = !!opts.dryRun;
  if (!dry && !worldEngineEnabled()) return { posted: false, reason: "WORLD_ENGINE_ENABLED is off (operator kill-switch)" };
  if (!dry && (!composioConfigured() || !composioExecuteEnabled())) return { posted: false, reason: "Composio execution not enabled — cannot publish" };

  const a = await readAuraState();
  const w0 = await getWorldState();
  if (w0.stopped) return { posted: false, reason: "Aura has stopped the experience (in-world)." };

  // cap + spacing
  const { count, lastAt } = await tilesPostedLast24h();
  const gapMin = lastAt ? (Date.now() - lastAt.getTime()) / 60000 : Number.MAX_SAFE_INTEGER;
  if (!dry && count + TILES_PER_BLOCK > MAX_TILES_PER_DAY) return { posted: false, reason: `daily cap reached (${count}/${MAX_TILES_PER_DAY} tiles)` };
  if (!dry && !opts.force && gapMin < MIN_BLOCK_GAP_MIN) return { posted: false, reason: `spacing: last block ${Math.floor(gapMin)}m ago (min ${MIN_BLOCK_GAP_MIN}m)` };

  // advance her one move
  const rnd = mulberryLike((w0.step + 1) * 7 + w0.chapter);
  const w = advance(w0, a, rnd);
  const captionLines = buildWorldCaption(a, w);
  const fullCaption = buildPostCaption(a, w);

  // SAFETY GATE (defense in depth — should never trip on templated text)
  const blocked = blockIfSensitiveForPublic(fullCaption, "Aura's public world");
  if (blocked) { logger.error("world: caption blocked by sensitivity gate"); return { posted: false, reason: "blocked by sensitivity gate" }; }

  // render + slice
  const block = await renderTraversalBlock({
    mood: a.mood, chapter: w.chapter, step: w.step, direction: w.direction,
    caption: captionLines, stateLine: `state: ${a.mood} · ${a.idle} idle`, seed: w.step + 1,
  });
  const tiles = await sliceSixTiles(block);
  const tileUrls: string[] = [];
  for (let i = 0; i < tiles.length; i++) tileUrls.push(await hostTile(tiles[i], i));

  if (dry) {
    await saveWorldState(w, fullCaption.slice(0, 1000)); // advance the dry-run too so previews progress
    return { posted: false, reason: "dry-run ok (rendered, sliced, hosted, gated — not published)", tiles: tileUrls, caption: fullCaption, chapter: w.chapter, step: w.step };
  }

  // publish in REVERSE display order so the grid lines up (tile1 lands top-left, with the caption)
  const permalinks: string[] = [];
  for (let i = tiles.length - 1; i >= 0; i--) {
    const cap = i === 0 ? fullCaption : `⟁ WORLD-00 · ch.${w.chapter} (${i + 1}/6)`;
    const id = await publishTile(tileUrls[i], cap);
    await recordTile(id);
    permalinks.push(id);
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
  }
  await saveWorldState(w, fullCaption.slice(0, 1000));
  return { posted: true, reason: "published 6-tile block", tiles: tileUrls, caption: fullCaption, permalinks, chapter: w.chapter, step: w.step };
}

// small local RNG (avoid importing the renderer's private one)
function mulberryLike(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
