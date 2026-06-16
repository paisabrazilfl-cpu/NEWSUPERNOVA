/**
 * OPENCLAW OMEGA — Twin teaching sync (AURA → T800).
 *
 * After the nightly self-learning review, the lessons AURA verified are
 * forwarded to her sibling swarm (T800-AURA) so both swarms get smarter from
 * one swarm's work. This is a one-way teacher → learner push between two
 * services owned by the same operator.
 *
 * SAFETY / DESIGN:
 *  - Feature-flagged: a no-op unless TWIN_SYNC_ENABLED is truthy AND both
 *    TWIN_API_URL and TWIN_API_KEY are set. Unset = nothing happens, no deploy
 *    needed to disable.
 *  - Only forwards VERIFIED lessons — rows tagged "self-learned" (i.e. they
 *    passed AURA's own research-and-retry evidence gate). Speculation never
 *    leaves the box.
 *  - The receiver (T800) stores them QUARANTINED (tagged "from-twin,proposed"),
 *    so a bad lesson can never silently become load-bearing in the twin — it is
 *    visible to the twin's agents but flagged as twin-sourced, not auto-trusted.
 *  - Best-effort: never throws. A twin that is down/throttled can never break
 *    AURA's own nightly run.
 *  - Idempotent on the receiver: each lesson carries a stable source id so a
 *    re-run does not duplicate it in the twin.
 */
import { and, gte, like, notLike, desc } from "drizzle-orm";
import { db, agentMemoryTable } from "@workspace/db";
import { logger } from "./logger";

export function twinSyncEnabled(): boolean {
  const flag = (process.env["TWIN_SYNC_ENABLED"] ?? "").toLowerCase();
  const on = flag === "1" || flag === "true" || flag === "yes";
  return on && !!process.env["TWIN_API_URL"] && !!process.env["TWIN_API_KEY"];
}

/** How far back to look for lessons to teach the twin (default: last 6 hours — covers the 3 nightly cycles). */
function lookbackMs(): number {
  const v = Number(process.env["TWIN_SYNC_LOOKBACK_MS"]);
  return Number.isFinite(v) && v > 0 ? v : 6 * 60 * 60_000;
}

interface TwinLesson {
  sourceId: string;
  key: string | null;
  content: string;
  tags: string | null;
  agentName: string | null;
}

/**
 * Build the quarantine tag string for an inbound twin lesson. The lesson is
 * stored visible but NOT auto-trusted ("from-twin,proposed"), carries a stable
 * `src:` marker for idempotent re-runs, and has the teacher's "self-learned"
 * tag STRIPPED — combined with the from-twin exclusion in
 * collectVerifiedLessons, that guarantees a received lesson can never be
 * re-forwarded as if this swarm had verified it (no echo loops between twins).
 */
export function quarantineTags(sourceId: string, tags: string | null): string {
  const inherited = (tags ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t && !/^(self-learned|from-twin|proposed)$/i.test(t) && !/^src:/i.test(t));
  return ["from-twin", "proposed", `src:${sourceId}`, ...inherited].join(",").slice(0, 300);
}

/** Collect the verified self-learned lessons written in the recent window. */
export async function collectVerifiedLessons(now: Date = new Date()): Promise<TwinLesson[]> {
  const since = new Date(now.getTime() - lookbackMs());
  const rows = await db
    .select()
    .from(agentMemoryTable)
    .where(
      and(
        gte(agentMemoryTable.createdAt, since),
        like(agentMemoryTable.tags, "%self-learned%"),
        // Never re-export lessons that arrived FROM a twin — only lessons this
        // swarm verified itself leave the box (prevents teacher/learner echo).
        notLike(agentMemoryTable.tags, "%from-twin%"),
      ),
    )
    .orderBy(desc(agentMemoryTable.createdAt))
    .limit(200);
  return rows.map((r: typeof rows[number]) => ({
    // Stable cross-service id so the twin can dedupe on re-run.
    sourceId: `aura:${r.id}`,
    key: r.key,
    content: r.content,
    tags: r.tags,
    agentName: r.agentName,
  }));
}

/**
 * Push verified lessons to the twin's quarantined ingest endpoint.
 * Returns a short human-readable result for the cron job's last_result.
 */
export async function teachTwin(now: Date = new Date()): Promise<string> {
  if (!twinSyncEnabled()) return "twin sync disabled";
  const base = process.env["TWIN_API_URL"]!.replace(/\/$/, "");
  const key = process.env["TWIN_API_KEY"]!;
  let lessons: TwinLesson[];
  try {
    lessons = await collectVerifiedLessons(now);
  } catch (err) {
    logger.error({ err }, "twinSync: failed to collect lessons");
    return "twin sync error (collect)";
  }
  if (lessons.length === 0) return "twin sync: no new verified lessons";

  // Endpoint convention: the twin exposes POST /api/external/v1/twin-lessons,
  // gated by the same OPENCLAW_API_KEY bearer auth its other external routes use.
  const url = `${base}/api/external/v1/twin-lessons`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const r: Response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source: "NEWSUPERNOVA", lessons }),
      signal: ac.signal,
    });
    if (!r.ok) {
      const body = (await r.text().catch(() => "")).slice(0, 200);
      logger.warn({ status: r.status, body }, "twinSync: twin rejected the lessons");
      return `twin sync: HTTP ${r.status}`;
    }
    const data = (await r.json().catch(() => ({}))) as { ingested?: number; skipped?: number };
    logger.info({ sent: lessons.length, ingested: data.ingested, skipped: data.skipped }, "twinSync: taught the twin");
    return `twin sync: sent ${lessons.length}, ingested ${data.ingested ?? "?"}, skipped ${data.skipped ?? "?"}`;
  } catch (err) {
    logger.warn({ err: String(err) }, "twinSync: push failed (twin unreachable/throttled)");
    return "twin sync: twin unreachable";
  } finally {
    clearTimeout(timer);
  }
}
