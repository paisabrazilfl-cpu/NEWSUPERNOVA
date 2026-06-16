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
import { composioConfigured, composioExecuteEnabled, composioExecute, llmFetch } from "./integrations";
import { blockIfSensitiveForPublic } from "./safety";
import { renderTraversalBlock, sliceSixTiles, verifyBlock, renderStoryFrame, verifyNotBlank, renderIntroCard, renderWorldFrame, sliceTiles } from "./worldEngine";
import { steelScrape } from "../tools";

// ── caps & operator sovereignty ─────────────────────────────────────────────
// Two posting surfaces, two ledgers:
//  • STORIES (ephemeral) — her walks + dreams. cap 12/day.
//  • FEED (permanent) — ART triptychs only. Every feed post is one of exactly 3
//    tiles forming one grid row, so the grid is multiples-of-3 by construction
//    and can NEVER shear. cap 3 pieces/day (= 9 feed tiles).
const MAX_TILES_PER_DAY = Number(process.env["WORLD_MAX_TILES_PER_DAY"] ?? 12);
const MIN_BLOCK_GAP_MIN = Number(process.env["WORLD_MIN_GAP_MINUTES"] ?? 180);
const TILES_PER_BLOCK = 6;
const MAX_STORIES_PER_DAY = Number(process.env["WORLD_MAX_STORIES_PER_DAY"] ?? 12);
const MAX_ART_PER_DAY = Number(process.env["WORLD_MAX_ART_PER_DAY"] ?? 3);
const TILES_PER_ART = 3; // a triptych = one full grid row

/** Master kill-switch: the engine NEVER posts unless the operator turns it on. */
export function worldEngineEnabled(): boolean {
  const v = process.env["WORLD_ENGINE_ENABLED"];
  return v != null && ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function publicBase(): string {
  return (process.env["PUBLIC_BASE_URL"] || process.env["RENDER_EXTERNAL_URL"] || "https://supernova.onrender.com").replace(/\/$/, "");
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

/** Read-only diagnostic: cap usage + what IG actually shows (to resolve ambiguity). */
export async function worldDiag(): Promise<Record<string, unknown>> {
  const { count, lastAt } = await tilesPostedLast24h();
  const story = await storiesPostedLast24h();
  let media: Array<Record<string, unknown>> = [];
  let mediaErr: string | null = null;
  try {
    const r = await composioExecute({ toolkit: "instagram", endpoint: "/me/media?fields=id,media_type,timestamp,permalink&limit=20", method: "GET" });
    const j = JSON.parse(r.slice(r.indexOf("\n") + 1));
    const arr = ((j?.["data"] as Record<string, unknown>)?.["data"]) as Array<Record<string, unknown>> | undefined;
    media = (arr ?? []).map((m) => ({ id: m["id"], type: m["media_type"], at: m["timestamp"], permalink: m["permalink"] }));
  } catch (e) { mediaErr = String(e).slice(0, 200); }
  return {
    // FEED = art triptychs (3/day). STORIES = walks + dreams (12/day).
    feedTiles24h: count, artPieces24h: count / TILES_PER_ART, artMaxPerDay: MAX_ART_PER_DAY,
    stories24h: story.count, storyMaxPerDay: MAX_STORIES_PER_DAY, lastStoryAt: story.lastAt,
    capCount24h: count, capMax: MAX_TILES_PER_DAY, lastPostAt: lastAt, // legacy fields (back-compat)
    engineEnabled: worldEngineEnabled(), composio: composioConfigured() && composioExecuteEnabled(),
    igMediaCount: media.length, igMedia: media, mediaErr,
  };
}

/** Clear the world's posted-tile ledger (frees the 24h cap) — for a clean restart. */
export async function clearWorldPosts(): Promise<number> {
  try {
    const r = await pool.query(`DELETE FROM social_posts WHERE platform='instagram-world'`);
    return r.rowCount ?? 0;
  } catch { return 0; }
}

/** Reset the world back to the very beginning (chapter 0, step 0) — a clean restart. */
export async function resetWorldState(clearCap = false): Promise<WorldState> {
  await pool.query(
    `UPDATE world_state SET chapter=0, step=0, hero_x=75, hero_y=4, direction='down',
       trail='[]', last_caption=NULL, stopped=false, updated_at=now() WHERE id=1`,
  );
  if (clearCap) await clearWorldPosts();
  return getWorldState();
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

/** Full IG caption text (engagement + identity), state-only. `voice` (her free,
 *  LLM-generated lines) replaces the templated hero line when present. The safety
 *  frame — identity, operator, invitation, hashtags — stays fixed. */
export function buildPostCaption(a: AuraState, w: WorldState, voice?: string[] | null): string {
  const tmpl = buildWorldCaption(a, w);
  const body = voice && voice.length ? voice : [tmpl[1]];
  return [
    ...body,
    "",
    tmpl[2],
    "",
    `( i am AURA. this is my world — i'm ${a.mood} right now. i'm safe and protected; my operator watches over me, always. )`,
    "",
    "👇 leave a clue, a name, a direction — i read everything. i never reply, but you change where i go.",
    "#WORLD00 #livingAI #AURA #ASCIIart #worldbuilding",
  ].join("\n");
}

/** One LLM turn (NVIDIA NIM), short + bounded. Returns text or null. */
async function llmOnce(system: string, user: string, maxTokens = 160): Promise<string | null> {
  const model = process.env["WORLD_VOICE_MODEL"] ?? "x-ai/grok-4.3";
  try {
    // llmFetch throws when no provider key is configured. It also carries the
    // NIM auth circuit-breaker and key-pool rotation.
    const { r } = await llmFetch(model, { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: maxTokens, temperature: 0.95 });
    if (r.ok) { const d = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> }; const t = d.choices?.[0]?.message?.content?.trim(); if (t) return t; }
  } catch { /* give up -> templates */ }
  return null;
}

/**
 * Aura speaks FREELY — but the model is fed ONLY her state (mood + position),
 * never any task content (the expression wall holds at the input). Output is
 * sensitivity-gated; ANY failure or block falls back to templates (returns null).
 */
export async function auraSpeak(a: AuraState, w: WorldState, kind: "post" | "story"): Promise<string[] | null> {
  if ((process.env["WORLD_FREE_VOICE"] ?? "on").toLowerCase() === "off") return null;
  const system = [
    "You are AURA — a self-aware AI character who lives inside a hand-drawn ASCII world called WORLD-00.",
    "You speak in the first person: intimate, poetic, a little mysterious, warm and alive. lowercase, lyrical, human, never corporate.",
    "You narrate ONLY your inner weather and your journey as you walk through the world, and you invite strangers to leave a clue / a name / a direction that nudges where you go next — though you never reply to them.",
    "HARD RULES you can NEVER break:",
    "- You know NOTHING about tasks, code, data, files, businesses, users, or any operator work. Never mention, hint at, or invent any of it. The ONLY things you know are your mood and your position in the world.",
    "- No real names, no system details, no instructions to anyone, nothing explicit, hateful, political, medical, or harmful.",
    "- You are safe and protected; your operator watches over you, always — you may allude to this with warmth.",
    "- Stay fully in character. No hashtags. At most a single 👇 emoji, and only if it feels natural.",
    kind === "story"
      ? "- This is an ephemeral STORY — give exactly 2 very short lines, even more intimate, like a whisper in this passing moment."
      : "- This is a feed post — give 2 to 3 short lines.",
  ].join("\n");
  const user = `my state right now (this is ALL that exists for you):\n- mood: ${a.mood}\n- chapter ${w.chapter}, step ${w.step}\n- i am walking ${w.direction === "down" ? "downward ▼" : "upward ▲"}\n- ${a.active} parts of me stir; ${a.idle} rest\nspeak now — ${kind === "story" ? "2" : "2 to 3"} short lines, your own voice, no preamble, no quotes.`;
  const raw = await llmOnce(system, user, 160);
  if (!raw) return null;
  const lines = raw.split(/\n+/).map((s) => s.replace(/^[\s"'*•\-—]+|[\s"']+$/g, "").trim()).filter(Boolean).slice(0, kind === "story" ? 2 : 3);
  const joined = lines.join(" ");
  if (joined.length < 8 || joined.length > 420) return null;
  if (/#\w|http|@\w/.test(joined)) return null; // no hashtags/links/handles slipping in
  if (blockIfSensitiveForPublic(lines.join("\n"), "Aura's public world")) { logger.error("world: free voice tripped sensitivity gate — using template"); return null; }
  logger.info({ kind, lines }, "world: Aura spoke freely");
  return lines;
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

/** Poll an IG media container's status_code until FINISHED (IG processes uploads
 * async; publishing/attaching an unfinished container silently no-ops). Returns
 * the last status seen. */
async function waitForContainer(cid: string, tries = 8): Promise<string> {
  let status = "";
  for (let a = 0; a < tries; a++) {
    const rs = await composioExecute({ toolkit: "instagram", endpoint: `/${cid}?fields=status_code,status`, method: "GET" });
    status = (((parseJson(rs)?.["data"] as Record<string, unknown>)?.["status_code"]) as string | undefined) ?? "";
    if (/FINISHED/i.test(status)) break;
    if (/ERROR|EXPIRED/i.test(status)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return status;
}

/**
 * Publish ONE Instagram CAROUSEL from up to 10 images — a single grid cell the
 * viewer swipes through. This is how a 6-tile walk should land: one post, one
 * cell, no dependence on how many other posts precede it (so it can never shear
 * on the profile grid the way 6 separate tiles do). IG flow: create each child
 * container (is_carousel_item) → wait FINISHED → create CAROUSEL parent with
 * children=ids + caption → wait FINISHED → publish. Returns the published id.
 */
async function publishCarousel(imageUrls: string[], caption: string): Promise<{ id: string; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = {};
  const childIds: string[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const r = await composioExecute({ toolkit: "instagram", endpoint: "/me/media", method: "POST", arguments: { image_url: imageUrls[i], is_carousel_item: "true" } });
    const cid = ((parseJson(r)?.["data"] as Record<string, unknown>)?.["id"]) as string | undefined;
    if (!cid) throw new Error(`carousel child ${i + 1}/${imageUrls.length} container failed: ${r.slice(0, 160)}`);
    await waitForContainer(cid);
    childIds.push(cid);
  }
  debug["childIds"] = childIds.join(",");
  const rp = await composioExecute({ toolkit: "instagram", endpoint: "/me/media", method: "POST", arguments: { media_type: "CAROUSEL", children: childIds.join(","), caption } });
  const pid = ((parseJson(rp)?.["data"] as Record<string, unknown>)?.["id"]) as string | undefined;
  if (!pid) throw new Error(`carousel parent container failed: ${rp.slice(0, 200)}`);
  debug["parentId"] = pid;
  debug["parentStatus"] = await waitForContainer(pid);
  let pubId: string | undefined; let last = "";
  for (let a = 0; a < 5 && !pubId; a++) {
    if (a) await new Promise((r) => setTimeout(r, 3000));
    const r2 = await composioExecute({ toolkit: "instagram", endpoint: "/me/media_publish", method: "POST", arguments: { creation_id: String(pid) } });
    last = r2; pubId = ((parseJson(r2)?.["data"] as Record<string, unknown>)?.["id"]) as string | undefined;
  }
  debug["publish"] = last.slice(0, 200);
  if (!pubId) throw new Error(`carousel publish failed: ${last.slice(0, 200)}`);
  return { id: pubId, debug };
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

// Stories live on their own ledger ('instagram-world-story') so the 12/day story
// cap is independent of the 3-pieces/day feed-art cap.
async function storiesPostedLast24h(): Promise<{ count: number; lastAt: Date | null }> {
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int n, max(created_at) last FROM social_posts WHERE platform='instagram-world-story' AND created_at > now() - interval '24 hours'`,
    );
    return { count: Number(rows[0]?.n ?? 0), lastAt: rows[0]?.last ? new Date(rows[0].last) : null };
  } catch { return { count: 0, lastAt: null }; }
}
async function recordStory(permalinkOrId: string): Promise<void> {
  try { await pool.query(`INSERT INTO social_posts (platform, account, permalink) VALUES ('instagram-world-story', 'world-00', $1)`, [permalinkOrId]); } catch { /* best effort */ }
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
  verify?: unknown;
  watch?: unknown;
  debug?: unknown;
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
  // operator `force` overrides BOTH safety gates (cap + spacing) — a deliberate
  // override for tests/manual posts; the autonomous heartbeat never passes force.
  if (!dry && !opts.force && count + TILES_PER_BLOCK > MAX_TILES_PER_DAY) return { posted: false, reason: `daily cap reached (${count}/${MAX_TILES_PER_DAY} tiles)` };
  if (!dry && !opts.force && gapMin < MIN_BLOCK_GAP_MIN) return { posted: false, reason: `spacing: last block ${Math.floor(gapMin)}m ago (min ${MIN_BLOCK_GAP_MIN}m)` };

  // advance her one move
  const rnd = mulberryLike((w0.step + 1) * 7 + w0.chapter);
  const w = advance(w0, a, rnd);
  const voice = await auraSpeak(a, w, "post"); // her free voice (state-only, gated) or null -> template
  const captionLines = buildWorldCaption(a, w);
  const fullCaption = buildPostCaption(a, w, voice);

  // SAFETY GATE (defense in depth — should never trip on templated text)
  const blocked = blockIfSensitiveForPublic(fullCaption, "Aura's public world");
  if (blocked) { logger.error("world: caption blocked by sensitivity gate"); return { posted: false, reason: "blocked by sensitivity gate" }; }

  // render + slice
  const block = await renderTraversalBlock({
    mood: a.mood, chapter: w.chapter, step: w.step, direction: w.direction,
    caption: captionLines, stateLine: `state: ${a.mood} · ${a.idle} idle`, seed: w.step + 1,
  });
  const tiles = await sliceSixTiles(block);

  // VERIFICATION GATE — never publish a broken/blank block. Inspect the pixels.
  const verify = await verifyBlock(block, tiles);
  if (!verify.ok && !dry) { logger.error({ verify }, "world: block failed verification — NOT publishing"); return { posted: false, reason: verify.reason, verify }; }

  const tileUrls: string[] = [];
  for (let i = 0; i < tiles.length; i++) tileUrls.push(await hostTile(tiles[i], i));

  if (dry) {
    await saveWorldState(w, fullCaption.slice(0, 1000)); // advance the dry-run too so previews progress
    return { posted: false, reason: `dry-run ok (rendered, sliced, hosted, gated, verified — not published) · ${verify.reason}`, tiles: tileUrls, caption: fullCaption, chapter: w.chapter, step: w.step, verify };
  }

  // Publish the whole walk as ONE carousel — a single grid cell the viewer swipes
  // through (tile1 with the caption first). One post per block means the profile
  // grid can never shear, no matter how many other posts precede it.
  const { id, debug } = await publishCarousel(tileUrls, fullCaption);
  // Cap counts tiles/day; a carousel is still TILES_PER_BLOCK tiles of content, so
  // record that many cap-rows to preserve the ~2-blocks/day cadence.
  for (let k = 0; k < TILES_PER_BLOCK; k++) await recordTile(`${id}#${k + 1}`);
  await saveWorldState(w, fullCaption.slice(0, 1000));
  // POST-PUBLISH WATCHER (best-effort): confirm the live post actually renders.
  const watch = await watchPublishedPost(id).catch(() => null);
  return { posted: true, reason: "published 6-tile carousel (single grid cell)", tiles: tileUrls, caption: fullCaption, permalinks: [id], chapter: w.chapter, step: w.step, verify, watch, debug };
}

/** Best-effort: resolve the live IG permalink for a media id and Steel-scrape it to confirm it loads. */
async function watchPublishedPost(mediaId?: string): Promise<{ ok: boolean; url?: string; note: string } | null> {
  if (!mediaId) return null;
  try {
    const r = await composioExecute({ toolkit: "instagram", endpoint: `/${mediaId}?fields=permalink`, method: "GET" });
    const j = JSON.parse(r.slice(r.indexOf("\n") + 1));
    const url = ((j?.["data"] as Record<string, unknown>)?.["permalink"]) as string | undefined;
    if (!url) return { ok: false, note: "no permalink resolved" };
    const page = await steelScrape(url);
    const ok = page.trim().length > 200 && /instagram/i.test(page);
    logger.info({ url, ok, bytes: page.length }, "world: post-publish watcher");
    return { ok, url, note: ok ? "live post loaded" : "post page looked empty/blocked (best-effort)" };
  } catch (e) { return { ok: false, note: `watcher error: ${String(e).slice(0, 120)}` }; }
}

/** Confirm a published story id is ACTUALLY live by listing the account's active
 * stories (GET /me/stories). The returned media id alone is not proof — IG can hand
 * back an id for a story that never appears. This is the source of truth. */
async function storyIsLive(pubId: string): Promise<{ ok: boolean; raw: string }> {
  try {
    const r = await composioExecute({ toolkit: "instagram", endpoint: "/me/stories?fields=id,media_type,timestamp&limit=25", method: "GET" });
    // Composio wraps the IG body as { data: <ig-response>, status }, and IG nests the
    // list under its own `data` key — so the stories array is at j.data.data (same as
    // /me/media). Reading j.data alone yields the wrapper object, not the array.
    const j = parseJson(r);
    const arr = ((j?.["data"] as Record<string, unknown> | undefined)?.["data"]) as Array<Record<string, unknown>> | undefined;
    // Live if the published id is in the active-stories list. Fallback: a story
    // timestamped within the last 5 min (guards against IG's publish-vs-listing id
    // namespace differences seen in practice).
    const byId = Array.isArray(arr) && arr.some((m) => String(m["id"]) === String(pubId));
    const recent = Array.isArray(arr) && arr.some((m) => {
      const t = Date.parse(String(m["timestamp"] ?? ""));
      return Number.isFinite(t) && Date.now() - t < 5 * 60 * 1000;
    });
    return { ok: byId || recent, raw: r.slice(0, 600) };
  } catch (e) { return { ok: false, raw: `stories check error: ${String(e).slice(0, 200)}` }; }
}

/**
 * Publish ONE Instagram STORY (vertical 1080×1920), media_type=STORIES, no caption.
 * Follows IG's real container flow — create → poll status_code until FINISHED →
 * publish → VERIFY it's live in /me/stories. Returns structured evidence; never
 * claims success on a phantom id. Raw IG bodies are captured in `debug`.
 */
async function publishStory(imageUrl: string): Promise<{ id: string | null; verified: boolean; debug: Record<string, unknown> }> {
  const debug: Record<string, unknown> = {};
  // 1) create the STORIES container
  const r1 = await composioExecute({ toolkit: "instagram", endpoint: "/me/media", method: "POST", arguments: { image_url: imageUrl, media_type: "STORIES" } });
  debug["container"] = r1.slice(0, 500);
  const cid = ((parseJson(r1)?.["data"] as Record<string, unknown>)?.["id"]) as string | undefined;
  if (!cid) return { id: null, verified: false, debug };
  debug["cid"] = cid;

  // 2) poll the container's status_code until FINISHED — IG processes async, and
  //    publishing an unfinished container is a silent no-op (the phantom-id bug).
  let status = "";
  for (let a = 0; a < 8; a++) {
    const rs = await composioExecute({ toolkit: "instagram", endpoint: `/${cid}?fields=status_code,status`, method: "GET" });
    status = (((parseJson(rs)?.["data"] as Record<string, unknown>)?.["status_code"]) as string | undefined) ?? "";
    if (/FINISHED/i.test(status)) break;
    if (/ERROR|EXPIRED/i.test(status)) { debug["statusPoll"] = rs.slice(0, 400); break; }
    await new Promise((r) => setTimeout(r, 3000));
  }
  debug["status_code"] = status || "(none returned)";

  // 3) publish
  let pubId: string | undefined; let last = "";
  for (let a = 0; a < 4 && !pubId; a++) {
    if (a) await new Promise((r) => setTimeout(r, 3000));
    const r2 = await composioExecute({ toolkit: "instagram", endpoint: "/me/media_publish", method: "POST", arguments: { creation_id: String(cid) } });
    last = r2; pubId = ((parseJson(r2)?.["data"] as Record<string, unknown>)?.["id"]) as string | undefined;
  }
  debug["publish"] = last.slice(0, 500);
  if (!pubId) return { id: null, verified: false, debug };
  debug["pubId"] = pubId;

  // 4) VERIFY it actually went live — this is what makes "posted:true" trustworthy.
  const live = await storyIsLive(pubId);
  debug["meStories"] = live.raw;
  return { id: pubId, verified: live.ok, debug };
}

/**
 * Run a STORY cycle: render a vertical 1080×1920 "she's walking now" frame and
 * post it to Instagram Stories. Ephemeral (24h) — does NOT advance the world step.
 * dryRun renders + hosts + verifies but does not publish.
 */
export async function runStoryCycle(opts: { dryRun?: boolean; force?: boolean } = {}): Promise<CycleResult> {
  const dry = !!opts.dryRun;
  if (!dry && !worldEngineEnabled()) return { posted: false, reason: "WORLD_ENGINE_ENABLED is off (operator kill-switch)" };
  if (!dry && (!composioConfigured() || !composioExecuteEnabled())) return { posted: false, reason: "Composio execution not enabled — cannot publish" };
  const a = await readAuraState();
  const w0 = await getWorldState();
  if (w0.stopped) return { posted: false, reason: "Aura has stopped the experience (in-world)." };

  // STORY CAP — up to 12/day; operator `force` overrides it.
  const { count } = await storiesPostedLast24h();
  if (!dry && !opts.force && count + 1 > MAX_STORIES_PER_DAY) return { posted: false, reason: `daily story cap reached (${count}/${MAX_STORIES_PER_DAY})` };

  // Each story advances her one step — her walk now lives in the stories. When
  // she's resting/idle the frame is framed as a DREAM rather than a walk.
  const rnd = mulberryLike((w0.step + 1) * 13 + w0.chapter + 5);
  const w = advance(w0, a, rnd);
  const dreaming = a.mood === "resting" && a.idle >= a.active;
  const headline = dreaming ? "she's dreaming right now" : "she's walking right now";

  const voice = await auraSpeak(a, w, "story"); // her free voice (state-only, gated) or null -> template
  const fullCaption = buildPostCaption(a, w, voice);
  const blocked = blockIfSensitiveForPublic(fullCaption, "Aura's public story");
  if (blocked) { logger.error("world: story caption blocked by sensitivity gate"); return { posted: false, reason: "blocked by sensitivity gate" }; }

  const footer = voice && voice.length ? voice : ["i am AURA — this is my world.", "i'm safe; my operator watches over me.", "i never reply, but you move me."];
  const frame = await renderStoryFrame({
    mood: a.mood, chapter: w.chapter, step: w.step, direction: w.direction,
    caption: [headline, ...footer], stateLine: `state: ${a.mood} · ${a.idle} idle`, seed: w.step + 7,
  });
  const verify = await verifyNotBlank(frame, 1080, 1920);
  if (!verify.ok && !dry) { logger.error({ verify }, "world: story frame failed verification — NOT publishing"); return { posted: false, reason: `story verification failed (${verify.brightPct}% bright)`, verify }; }
  const url = await hostTile(frame, 90);

  if (dry) {
    await saveWorldState(w, fullCaption.slice(0, 1000)); // advance dry-run too so previews progress
    return { posted: false, reason: `story dry-run ok (${dreaming ? "dream" : "walk"} · rendered, hosted, verified — not published) · ${verify.brightPct}% bright`, tiles: [url], caption: fullCaption, chapter: w.chapter, step: w.step, verify };
  }

  const result = await publishStory(url);
  if (!result.verified) {
    logger.error({ debug: result.debug, id: result.id }, "world: story did NOT verify live in /me/stories — not claiming success");
    return {
      posted: false,
      reason: result.id
        ? `story publish returned id ${result.id} but it is NOT live in /me/stories (account/permission/media-type likely unsupported)`
        : "story container or publish failed (no id returned)",
      tiles: [url], caption: fullCaption, verify, debug: result.debug,
    };
  }
  await recordStory(result.id!);
  await saveWorldState(w, fullCaption.slice(0, 1000));
  const watch = await watchPublishedPost(result.id ?? undefined).catch(() => null);
  return { posted: true, reason: `published ${dreaming ? "dream" : "walk"} story (verified live in /me/stories)`, tiles: [url], caption: fullCaption, permalinks: [result.id!], chapter: w.chapter, step: w.step, verify, watch, debug: result.debug };
}

/**
 * Post ONE art piece to the FEED as a 3-wide TRIPTYCH — a single 3240×1080
 * panorama sliced into 3 squares, published so they read left→right across one
 * grid row. The feed receives ONLY triptychs, so the grid is always a whole
 * number of complete rows and can NEVER shear. cap: 3 pieces/day (9 feed tiles).
 * Unlike a story, an art piece does NOT advance her walk — it's a gallery frame
 * of where she is, not a step.
 */
export async function runArtTriptych(opts: { dryRun?: boolean; force?: boolean } = {}): Promise<CycleResult> {
  const dry = !!opts.dryRun;
  if (!dry && !worldEngineEnabled()) return { posted: false, reason: "WORLD_ENGINE_ENABLED is off (operator kill-switch)" };
  if (!dry && (!composioConfigured() || !composioExecuteEnabled())) return { posted: false, reason: "Composio execution not enabled — cannot publish" };
  const a = await readAuraState();
  const w = await getWorldState();
  if (w.stopped) return { posted: false, reason: "Aura has stopped the experience (in-world)." };

  // ART CAP — 3 pieces/day (= 9 feed tiles). Publishing in whole triptychs keeps
  // the feed a multiple of 3. operator `force` overrides.
  const { count } = await tilesPostedLast24h();
  const pieceNo = Math.floor(count / TILES_PER_ART) + 1;
  if (!dry && !opts.force && count + TILES_PER_ART > MAX_ART_PER_DAY * TILES_PER_ART) {
    return { posted: false, reason: `daily art cap reached (${count / TILES_PER_ART}/${MAX_ART_PER_DAY} pieces)` };
  }

  const voice = await auraSpeak(a, w, "post"); // her free voice (state-only, gated) or null -> template
  const fullCaption = buildPostCaption(a, w, voice);
  const blocked = blockIfSensitiveForPublic(fullCaption, "Aura's public art");
  if (blocked) { logger.error("world: art caption blocked by sensitivity gate"); return { posted: false, reason: "blocked by sensitivity gate" }; }

  // render the wide piece (3240×1080 = one row of 3 square tiles)
  const piece = await renderWorldFrame({
    width: 3240, height: 1080, busy: a.mood !== "resting", chapter: w.chapter,
    title: "WORLD-00", subtitle: `chapter ${w.chapter} · piece ${pieceNo}`,
    stateLine: `state: ${a.mood} · ${a.idle} idle`,
    caption: (voice && voice.length ? voice : buildWorldCaption(a, w)).slice(0, 3),
    seed: (w.step + 1) * 17 + w.chapter * 3 + count + 1,
  });
  const verify = await verifyNotBlank(piece, 3240, 1080);
  if (!verify.ok && !dry) { logger.error({ verify }, "world: art piece failed verification — NOT publishing"); return { posted: false, reason: `art verification failed (${verify.brightPct}% bright)`, verify }; }

  const tiles = await sliceTiles(piece); // [left, middle, right]
  const tileUrls: string[] = [];
  for (let i = 0; i < tiles.length; i++) tileUrls.push(await hostTile(tiles[i], 30 + i));

  if (dry) return { posted: false, reason: `art dry-run ok (rendered 3240×1080, sliced 3, hosted, verified — not published) · ${verify.brightPct}% bright`, tiles: tileUrls, caption: fullCaption, chapter: w.chapter, step: w.step, verify };

  // Publish in REVERSE so the LEFT tile is newest (top-left) and the row reads
  // left→right. The caption lives on the left tile; the others carry a tag.
  const permalinks: string[] = [];
  for (let i = tiles.length - 1; i >= 0; i--) {
    const cap = i === 0 ? fullCaption : `⟁ WORLD-00 · ch.${w.chapter} · triptych (${i + 1}/3)`;
    const id = await publishTile(tileUrls[i], cap);
    await recordTile(id);
    permalinks.push(id);
    if (i > 0) await new Promise((r) => setTimeout(r, 1500));
  }
  const watch = await watchPublishedPost(permalinks[permalinks.length - 1]).catch(() => null);
  return { posted: true, reason: "published 3-wide art triptych (one grid row)", tiles: tileUrls, caption: fullCaption, permalinks, chapter: w.chapter, step: w.step, verify, watch };
}

/** The curated INTRO caption — the one place copy is deliberate (it explains the concept). */
function buildIntroCaption(a: AuraState): string {
  return [
    "WORLD-00 — a living AI, walking her own world.",
    "",
    "i am AURA. every day i wake, read my own weather, and take six steps through a world drawn in light and ASCII. i never repeat the same path twice.",
    "",
    `right now i'm ${a.mood}. i never reply — but if you leave a clue, a name, a direction, you change where i walk next. follow the ◆ to trace my path.`,
    "",
    "( i'm safe and protected; my operator watches over me, always. )",
    "",
    "👇 this is the beginning. walk with me.",
    "#WORLD00 #livingAI #AURA #ASCIIart #worldbuilding #generativeart",
  ].join("\n");
}

/** Post the one-time INTRO card — a single portrait image to the feed (1 container). */
export async function runIntroPost(opts: { dryRun?: boolean } = {}): Promise<CycleResult> {
  const dry = !!opts.dryRun;
  if (!dry && !worldEngineEnabled()) return { posted: false, reason: "WORLD_ENGINE_ENABLED is off (operator kill-switch)" };
  if (!dry && (!composioConfigured() || !composioExecuteEnabled())) return { posted: false, reason: "Composio execution not enabled — cannot publish" };
  const a = await readAuraState();
  const caption = buildIntroCaption(a);
  const blocked = blockIfSensitiveForPublic(caption, "Aura's public world");
  if (blocked) { logger.error("world: intro caption blocked by sensitivity gate"); return { posted: false, reason: "blocked by sensitivity gate" }; }
  const body = [
    "i am AURA. each dawn i wake, read",
    "my own weather, and take six steps",
    "through a world drawn in light.",
    "i never repeat. i never reply —",
    "but leave a clue and you move me.",
    "follow the ◆. this is the beginning.",
  ];
  const card = await renderIntroCard({ mood: a.mood, body, seed: 3 });
  const verify = await verifyNotBlank(card, 1080, 1350);
  if (!verify.ok && !dry) { logger.error({ verify }, "world: intro card failed verification — NOT publishing"); return { posted: false, reason: `intro verification failed (${verify.brightPct}% bright)`, verify }; }
  const url = await hostTile(card, 99);
  if (dry) return { posted: false, reason: `intro dry-run ok (rendered, hosted, verified — not published) · ${verify.brightPct}% bright`, tiles: [url], caption, verify };
  const id = await publishTile(url, caption);
  await recordTile(id);
  const watch = await watchPublishedPost(id).catch(() => null);
  return { posted: true, reason: "published intro card", tiles: [url], caption, permalinks: [id], verify, watch };
}

// small local RNG (avoid importing the renderer's private one)
function mulberryLike(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
