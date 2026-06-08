import { pool } from "@workspace/db";

/**
 * Posting rate limiter — keeps the swarm from machine-gunning a public feed.
 * Fully automated (no human gate): a daily cap + minimum spacing between posts.
 * Configurable via env; sensible defaults (12/day, 90 min apart).
 */
const MAX_PER_DAY = Number(process.env["SOCIAL_MAX_POSTS_PER_DAY"] ?? 12);
const MIN_SPACING_MIN = Number(process.env["SOCIAL_MIN_SPACING_MINUTES"] ?? 90);

/** Pure decision (testable without a DB): returns a block message, or null if allowed. */
export function decidePostAllowed(opts: {
  countLast24h: number;
  last: Date | null;
  now: Date;
  platform?: string;
  maxPerDay?: number;
  minSpacingMin?: number;
}): string | null {
  const max = opts.maxPerDay ?? MAX_PER_DAY;
  const spacingMin = opts.minSpacingMin ?? MIN_SPACING_MIN;
  const platform = opts.platform ?? "social";
  if (opts.countLast24h >= max) {
    return `🛑 Daily ${platform} post limit reached (${max}/day). Nothing was posted — the cap rolls over 24h after each post. Queue it for later.`;
  }
  if (opts.last) {
    const elapsedMin = (opts.now.getTime() - opts.last.getTime()) / 60000;
    if (elapsedMin < spacingMin) {
      const wait = Math.ceil(spacingMin - elapsedMin);
      return `🛑 Posts are spaced out (min ${spacingMin} min apart to avoid spamming). Last ${platform} post was ${Math.floor(elapsedMin)} min ago — next allowed in ~${wait} min. Nothing was posted.`;
    }
  }
  return null;
}

/** Check the live posting window. Fail-OPEN on DB error (don't break posting on a blip). */
export async function checkPostAllowed(platform: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n, max(created_at) AS last
         FROM social_posts
        WHERE platform = $1 AND created_at > now() - interval '24 hours'`,
      [platform],
    );
    const countLast24h = Number(rows[0]?.n ?? 0);
    const last = rows[0]?.last ? new Date(rows[0].last as string) : null;
    return decidePostAllowed({ countLast24h, last, now: new Date(), platform });
  } catch {
    return null; // never block a legit post because the limiter's DB read hiccuped
  }
}

/** Record a successful publish so it counts toward the cap + spacing. Best-effort. */
export async function recordPost(platform: string, account: string, permalink: string): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO social_posts (platform, account, permalink) VALUES ($1, $2, $3)`,
      [platform, account || null, permalink || null],
    );
  } catch {
    /* best effort — a missed record only means a slightly looser cap */
  }
}
