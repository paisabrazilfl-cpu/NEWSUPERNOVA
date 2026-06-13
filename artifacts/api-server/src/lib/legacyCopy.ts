/**
 * One-time legacy data copy.
 *
 * When `LEGACY_DATABASE_URL` is set, copy every data table from that old
 * database into the CURRENT database (the one `pool` points at). Used to carry
 * the vault, agent memory, chat history, tasks, cron jobs, world state, etc.
 * across a database move (e.g. paid Render Postgres → free Supabase).
 *
 * Safety properties (this runs at boot on the live service):
 *  - NON-FATAL: never throws. A copy failure logs and the server still starts.
 *  - FK-SAFE: the schema declares no foreign-key constraints, so table order
 *    does not matter; a bad row is skipped, not aborted.
 *  - IDEMPOTENT-ish: rows are upserted by primary key (ON CONFLICT (id) DO
 *    UPDATE), so re-running re-syncs rather than duplicating. Serial sequences
 *    are advanced past the copied ids so new inserts don't collide.
 *  - Remove `LEGACY_DATABASE_URL` after the copy so it doesn't run every boot.
 */
import { pg, pool } from "@workspace/db";
import { logger } from "./logger";

// Every data table (agents/channels/world_state are pre-seeded — upsert keeps
// any operator customizations like a changed model or Aura's world position).
const TABLES = [
  "agents",
  "channels",
  "messages",
  "tasks",
  "monologue_lines",
  "tool_calls",
  "agent_commands",
  "cron_jobs",
  "agent_memory",
  "vault_secrets",
  "attachments",
  "social_posts",
  "world_state",
] as const;

export async function copyLegacyData(): Promise<void> {
  const url = process.env["LEGACY_DATABASE_URL"];
  if (!url) return; // no-op unless explicitly migrating

  logger.info("LEGACY_DATABASE_URL is set — running one-time data copy into the current database.");
  const src = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000 });
  try {
    await src.connect();
  } catch (e) {
    logger.error({ err: String(e) }, "legacy copy: cannot connect to LEGACY_DATABASE_URL — skipping (server still starts).");
    return;
  }

  const summary: Record<string, { copied: number; skipped: number }> = {};
  try {
    for (const table of TABLES) {
      try {
        const { rows } = await src.query(`SELECT * FROM "${table}"`);
        if (!rows.length) { summary[table] = { copied: 0, skipped: 0 }; continue; }

        const cols = Object.keys(rows[0] as Record<string, unknown>);
        const colList = cols.map((c) => `"${c}"`).join(",");
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
        const updates = cols.filter((c) => c !== "id").map((c) => `"${c}"=EXCLUDED."${c}"`).join(",");
        const conflict = updates ? `ON CONFLICT ("id") DO UPDATE SET ${updates}` : `ON CONFLICT ("id") DO NOTHING`;
        const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ${conflict}`;

        let copied = 0, skipped = 0;
        for (const row of rows as Array<Record<string, unknown>>) {
          try {
            await pool.query(sql, cols.map((c) => row[c]));
            copied++;
          } catch (rowErr) {
            skipped++;
            if (skipped <= 3) logger.warn({ table, err: String(rowErr) }, "legacy copy: row skipped");
          }
        }

        // Advance the serial sequence past the copied ids (no-op for non-serial PKs).
        try {
          const seqRes = await pool.query<{ seq: string | null }>(`SELECT pg_get_serial_sequence($1,'id') AS seq`, [table]);
          const seq = seqRes.rows[0]?.seq;
          if (seq) await pool.query(`SELECT setval($1, (SELECT COALESCE(MAX("id"),1) FROM "${table}"))`, [seq]);
        } catch { /* sequence reset is best-effort */ }

        summary[table] = { copied, skipped };
      } catch (tableErr) {
        logger.error({ table, err: String(tableErr) }, "legacy copy: table failed — continuing with the rest.");
        summary[table] = { copied: 0, skipped: -1 };
      }
    }
    logger.info({ summary }, "legacy copy: COMPLETE. Remove LEGACY_DATABASE_URL so this does not run again.");
  } finally {
    try { await src.end(); } catch { /* ignore */ }
  }
}
