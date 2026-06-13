import { pool } from "@workspace/db";
import { logger } from "./lib/logger";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "agents" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "role" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'idle' NOT NULL,
  "color" text NOT NULL,
  "avatar_initials" text,
  "model" text,
  "context_used" integer DEFAULT 0 NOT NULL,
  "context_max" integer DEFAULT 128000 NOT NULL,
  "capabilities" text[] DEFAULT '{}' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "channels" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "type" text DEFAULT 'general' NOT NULL,
  "description" text,
  "unread_count" integer DEFAULT 0 NOT NULL,
  "last_activity" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "channel_id" integer NOT NULL,
  "agent_id" integer,
  "agent_name" text,
  "agent_color" text,
  "content" text NOT NULL,
  "message_type" text DEFAULT 'user' NOT NULL,
  "metadata" text,
  "timestamp" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tasks" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "agent_id" integer,
  "agent_name" text,
  "status" text DEFAULT 'queued' NOT NULL,
  "priority" text DEFAULT 'medium' NOT NULL,
  "progress" integer DEFAULT 0 NOT NULL,
  "channel_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

CREATE TABLE IF NOT EXISTS "monologue_lines" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" integer NOT NULL,
  "text" text NOT NULL,
  "type" text DEFAULT 'thought' NOT NULL,
  "timestamp" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tool_calls" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" integer NOT NULL,
  "tool_name" text NOT NULL,
  "args" text,
  "result" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

CREATE TABLE IF NOT EXISTS "agent_commands" (
  "id" serial PRIMARY KEY NOT NULL,
  "from_agent_id" integer NOT NULL,
  "to_agent_id" integer,
  "command" text NOT NULL,
  "payload" text,
  "priority" text DEFAULT 'normal' NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "result" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

CREATE TABLE IF NOT EXISTS "cron_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" integer NOT NULL,
  "name" text NOT NULL,
  "schedule" text NOT NULL,
  "task" text NOT NULL,
  "payload" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "last_run_at" timestamp,
  "next_run_at" timestamp,
  "run_count" integer DEFAULT 0 NOT NULL,
  "last_result" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "agent_memory" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" integer NOT NULL,
  "agent_name" text,
  "key" text,
  "content" text NOT NULL,
  "tags" text,
  "embedding" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Backfill the embedding column on databases created before semantic memory.
ALTER TABLE "agent_memory" ADD COLUMN IF NOT EXISTS "embedding" text;

-- Dispatch observability: model + grounding proof per directive (Dispatch panel).
ALTER TABLE "agent_commands" ADD COLUMN IF NOT EXISTS "model" text;
ALTER TABLE "agent_commands" ADD COLUMN IF NOT EXISTS "grounding_chars" integer;
ALTER TABLE "agent_commands" ADD COLUMN IF NOT EXISTS "grounding_hash" text;

-- Reclassify historical restart interruptions: a deploy/redeploy killing
-- in-flight work was previously marked 'failed', polluting the failure view as
-- if the CLAW failed. Re-tag them 'interrupted' so they stop counting as agent
-- failures (the recovery routine now writes 'interrupted' directly).
UPDATE "agent_commands" SET "status" = 'interrupted'
  WHERE "status" = 'failed' AND "result" LIKE 'Interrupted by server restart%';

CREATE TABLE IF NOT EXISTS "vault_secrets" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" text NOT NULL UNIQUE,
  "description" text,
  "ciphertext" text NOT NULL,
  "iv" text NOT NULL,
  "auth_tag" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "filename" text NOT NULL,
  "mime_type" text NOT NULL,
  "kind" text DEFAULT 'other' NOT NULL,
  "size_bytes" integer DEFAULT 0 NOT NULL,
  "data" text NOT NULL,
  "extracted_text" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes for the hot read paths the dashboard polls every few seconds. Without
-- these, each poll seq-scans + sorts and holds a pool connection longer, which
-- (under concurrent orchestration writes) caused reads to hang and return empty.
CREATE INDEX IF NOT EXISTS "messages_channel_ts_idx" ON "messages" ("channel_id", "timestamp");
CREATE INDEX IF NOT EXISTS "agent_commands_created_idx" ON "agent_commands" ("created_at");
CREATE INDEX IF NOT EXISTS "tool_calls_agent_idx" ON "tool_calls" ("agent_id");
CREATE INDEX IF NOT EXISTS "tasks_status_idx" ON "tasks" ("status");
-- Social posting log — powers the per-platform daily cap + spacing limiter.
CREATE TABLE IF NOT EXISTS "social_posts" (
  "id" serial PRIMARY KEY NOT NULL,
  "platform" text NOT NULL,
  "account" text,
  "permalink" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "social_posts_platform_created_idx" ON "social_posts" ("platform", "created_at");

-- WORLD-00: single-row persistent state for Aura's living world (her position,
-- direction, chapter, path history, breadcrumb clues, enabled flag). Only ONE
-- row (id=1). Stores NO task content — world/render state only.
CREATE TABLE IF NOT EXISTS "world_state" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "chapter" integer DEFAULT 0 NOT NULL,
  "step" integer DEFAULT 0 NOT NULL,
  "hero_x" double precision DEFAULT 75 NOT NULL,
  "hero_y" double precision DEFAULT 4 NOT NULL,
  "direction" text DEFAULT 'down' NOT NULL,
  "trail" text DEFAULT '[]' NOT NULL,
  "last_caption" text,
  "stopped" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
INSERT INTO "world_state" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- Relay sessions — the primary/secondary collaboration loop between two
-- OPENCLAW swarms (BOS-AURA = primary, T800-AURA = secondary). One logical
-- session has ONE row on EACH side, keyed by the cross-service relay_id.
-- Defined in the Drizzle schema (lib/db/schema/relay.ts) but previously absent
-- from this boot migration, so GET/POST /api/relay 500'd ("relation
-- relay_sessions does not exist") on any DB that was provisioned fresh (the
-- standalone openclaw-db that replaced the auto-deleted free DB). IF NOT EXISTS
-- is idempotent and never touches an existing table's data.
CREATE TABLE IF NOT EXISTS "relay_sessions" (
  "id" serial PRIMARY KEY NOT NULL,
  "relay_id" text NOT NULL,
  "role" text NOT NULL,
  "goal" text NOT NULL,
  "channel_id" integer DEFAULT 1 NOT NULL,
  "round" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_actor" text,
  "last_kind" text,
  "last_payload" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "relay_sessions_relay_id_idx" ON "relay_sessions" ("relay_id");
`;

const SEED_AGENTS = `
INSERT INTO agents (name, role, description, status, color, avatar_initials, model, capabilities)
VALUES
  ('ABBY',   'Orchestrator',  'Master orchestrator and directive router',       'idle', '#00e5ff', 'AB', 'moonshotai/kimi-k2.6',               ARRAY['orchestration','planning','routing']),
  ('CLAW-1', 'Code Executor', 'Code generation and execution specialist',       'idle', '#bf00ff', 'C1', 'qwen/qwen3.5-397b-a17b',             ARRAY['code','execution','debugging']),
  ('CLAW-2', 'Browser Agent', 'Web browsing and scraping via Steel',            'idle', '#0066ff', 'C2', 'deepseek-ai/deepseek-v4-flash',      ARRAY['browser','scraping','research']),
  ('CLAW-3', 'Memory & RAG',  'Long-term memory and retrieval',                 'idle', '#00cc88', 'C3', 'qwen/qwen3.5-122b-a10b',             ARRAY['memory','rag','search']),
  ('CLAW-4', 'API Connector', 'External API integration and automation',        'idle', '#ff6b00', 'C4', 'nvidia/nemotron-3-super-120b-a12b',  ARRAY['api','integration','automation']),
  ('MR.NICE','Social Agent',  'Social media and communications specialist',     'idle', '#ff2d78', 'MN', 'qwen/qwen3.5-122b-a10b',             ARRAY['social','communications','engagement'])
`;

// 2026-06-10 NVIDIA NIM migration: upgrade each agent's LEGACY default model to
// its NIM replacement (live-verified on integrate.api.nvidia.com — completion,
// tool calling, and JSON mode all pass). Matched on the old model id, so any
// custom model an operator picked in the UI is left untouched. Runtime routing
// remaps any legacy id to a NIM model at request time (NIM-only runtime), so
// this upgrade can never strand an agent on an unreachable model.
const AGENT_MODEL_UPGRADES: Array<[oldModel: string, newModel: string]> = [
  ["x-ai/grok-4.3",        "moonshotai/kimi-k2.6"],
  // 2026-06-10: nemotron-3-ultra-550b stalled live (45-60s, zero bytes) while
  // kimi-k2.6 answered in <1s — fast models in charge. Runs AFTER the
  // grok-4.3 remap above, so legacy grok rows chain straight to kimi too.
  ["nvidia/nemotron-3-ultra-550b-a55b", "moonshotai/kimi-k2.6"],
  ["qwen/qwen3.7-plus",    "qwen/qwen3.5-397b-a17b"],
  ["x-ai/grok-build-0.1",  "deepseek-ai/deepseek-v4-flash"],
  ["qwen/qwen3.7-max",     "qwen/qwen3.5-122b-a10b"],
  ["x-ai/grok-4.20",       "nvidia/nemotron-3-super-120b-a12b"],
  ["qwen/qwen3.6-plus",    "qwen/qwen3.5-122b-a10b"],
];

const SEED_CHANNELS = `
INSERT INTO channels (name, type, description)
VALUES
  ('general', 'general', 'General swarm communications'),
  ('abby',    'agent',   'ABBY orchestrator channel'),
  ('claw-1',  'agent',   'CLAW-1 code executor channel'),
  ('claw-2',  'agent',   'CLAW-2 browser agent channel'),
  ('claw-3',  'agent',   'CLAW-3 memory channel'),
  ('claw-4',  'agent',   'CLAW-4 API connector channel'),
  ('mr-nice', 'agent',   'MR.NICE social agent channel')
`;

// Real executable tools each agent can call (mirrors AGENT_TOOLS in tools.ts).
// Synced into agents.capabilities so the dashboard Inspector reflects the tools
// each CLAW actually wields.
const AGENT_CAPABILITIES: Record<number, string[]> = {
  1: ["web_scrape", "web_screenshot", "http_request", "code_exec", "memory_write", "memory_search"],
  2: ["code_exec", "http_request", "web_scrape", "memory_search", "memory_write"],
  3: ["web_scrape", "web_screenshot", "http_request", "memory_search", "memory_write"],
  4: ["memory_write", "memory_search", "web_scrape", "http_request"],
  5: ["http_request", "web_scrape", "code_exec", "memory_search", "memory_write"],
  6: ["web_scrape", "http_request", "memory_search", "memory_write"],
};

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    logger.info("Running startup migrations...");
    await client.query(SCHEMA_SQL);
    logger.info("Schema ready");

    const { rows } = await client.query("SELECT COUNT(*) AS n FROM agents");
    if (parseInt(rows[0].n, 10) === 0) {
      await client.query(SEED_AGENTS);
      await client.query(SEED_CHANNELS);
      logger.info("Default agents and channels seeded");
    }

    // Idempotently sync each agent's real tool capabilities.
    for (const [id, caps] of Object.entries(AGENT_CAPABILITIES)) {
      await client.query("UPDATE agents SET capabilities = $1 WHERE id = $2", [caps, Number(id)]);
    }

    // Idempotently upgrade legacy default models to their NIM replacements.
    for (const [oldModel, newModel] of AGENT_MODEL_UPGRADES) {
      await client.query("UPDATE agents SET model = $2 WHERE model = $1", [oldModel, newModel]);
    }

    // Idempotently seed the nightly self-learning job. Runs at 04:00, 05:00 and
    // 06:00 UTC — i.e. 12AM, 1AM, 2AM US-Eastern (Render runs UTC) — three
    // review cycles inside the operator's requested 12-3AM window. ABBY reviews
    // the day's tool failures, researches unresolved ones, and memory_writes the
    // verified lessons tagged "lesson,self-learned,nightly". The twin-teach push
    // (lib/twinSync.ts) then forwards those verified lessons to the T800 twin.
    // Matched on the fixed name so re-runs never create duplicates and an
    // operator schedule edit in the UI is preserved (we only INSERT when absent).
    const NIGHTLY_JOB_NAME = "Nightly Self-Learning Review";
    const NIGHTLY_TASK =
      "Run the nightly self-learning review. (1) Read today's tool failures and unresolved errors from recent agent activity. " +
      "(2) For each recurring or unresolved failure, follow the SELF-LEARN protocol: memory_search for a prior lesson, then web_search/web_scrape for a fix if memory has none, then verify the fix actually works. " +
      "(3) memory_write each VERIFIED lesson in reusable \"PROBLEM → SOLUTION (evidence)\" form, tagged \"lesson,self-learned,nightly\". " +
      "Store only lessons you actually verified — never speculation. This makes the swarm permanently smarter overnight.";
    await client.query(
      `INSERT INTO cron_jobs (agent_id, name, schedule, task, enabled)
       SELECT $1, $2, $3, $4, true
       WHERE NOT EXISTS (SELECT 1 FROM cron_jobs WHERE name = $2)`,
      [1, NIGHTLY_JOB_NAME, "0 4,5,6 * * *", NIGHTLY_TASK],
    );

    // Indexes on the hot polling-read / foreign-key-like columns. The dashboard
    // polls messages/commands/tasks/telemetry every few seconds, and these
    // columns were unindexed (sequential scans that grow with table size).
    // CREATE INDEX IF NOT EXISTS is idempotent and safe to run on every boot.
    const INDEXES: Array<[string, string]> = [
      ["idx_messages_channel_id", "messages (channel_id, id)"],
      ["idx_tool_calls_agent_id", "tool_calls (agent_id, id)"],
      ["idx_monologue_agent_id", "monologue_lines (agent_id, id)"],
      ["idx_tasks_status", "tasks (status)"],
      ["idx_tasks_channel_id", "tasks (channel_id)"],
      ["idx_agent_commands_status", "agent_commands (status)"],
      ["idx_agent_commands_to_agent", "agent_commands (to_agent_id)"],
      ["idx_agent_memory_agent_id", "agent_memory (agent_id, created_at)"],
      ["idx_agent_memory_tags", "agent_memory (tags)"],
      ["idx_cron_jobs_enabled_next", "cron_jobs (enabled, next_run_at)"],
    ];
    for (const [name, target] of INDEXES) {
      await client.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${target}`).catch((e: unknown) =>
        logger.warn({ err: e, index: name }, "index creation skipped"),
      );
    }
  } catch (err) {
    logger.error({ err }, "Migration failed — continuing anyway");
  } finally {
    client.release();
  }
}
