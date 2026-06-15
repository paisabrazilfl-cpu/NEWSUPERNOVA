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

// SOLO MODE: ABBY is the only agent and holds EVERY tool herself — the five
// CLAW sub-agents were removed (operator decision). Fresh installs seed ABBY
// only; existing DBs are cleaned by REMOVE_OTHER_AGENTS below.
const SEED_AGENTS = `
INSERT INTO agents (name, role, description, status, color, avatar_initials, model, capabilities)
VALUES
  ('ABBY', 'Operator', 'Solo autonomous agent — holds every tool and does the work end to end', 'idle', '#00e5ff', 'AB', 'moonshotai/kimi-k2.6', ARRAY['code','execution','browser','scraping','research','memory','rag','api','integration','automation','social','images','files','scheduling'])
`;

// AVVY — image & video generation specialist (id 2). ABBY gives the orders; AVVY
// works ONLY when ABBY assigns her an image/video directive, nothing more. Seeded
// idempotently (by name) so she also lands on existing prod DBs where the
// count-based SEED_AGENTS block is skipped. Explicit id=2 reuses the freed legacy
// slot and matches AGENT_TOOLS[2] / AGENT_CAPABILITIES[2].
const SEED_AVVY = `
INSERT INTO agents (id, name, role, description, status, color, avatar_initials, model, capabilities)
SELECT 2, 'AVVY', 'Image & Video Specialist',
  'Image & video generation specialist — acts only when ABBY assigns the work. Free Hugging Face images (image_generate) + A2E video (video_generate).',
  'idle', '#a855f7', 'AV', 'moonshotai/kimi-k2.6', ARRAY['images','video']
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE name = 'AVVY')
`;

// BUZZ — social media & Composio specialist (id 3). ABBY gives the orders; BUZZ
// works ONLY when assigned a social/Composio directive. Handles the operator's
// connected accounts via Composio (new + existing) and the native social APIs.
// Seeded idempotently (by name) so it lands on existing prod DBs too. Explicit
// id=3 reuses a freed legacy slot and matches AGENT_TOOLS[3] / AGENT_CAPABILITIES[3].
const SEED_BUZZ = `
INSERT INTO agents (id, name, role, description, status, color, avatar_initials, model, capabilities)
SELECT 3, 'BUZZ', 'Social & Composio Specialist',
  'Social media & Composio specialist — acts only when ABBY assigns the work. Connects and acts on the operator''s accounts via Composio (new + existing) and the native social APIs; posts, schedules, and reports the real result.',
  'idle', '#1d9bf0', 'BZ', 'moonshotai/kimi-k2.6', ARRAY['social','composio','api','automation','scheduling']
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE name = 'BUZZ')
`;

// SCOUT — research & web-intelligence specialist (id 4). Web search, scraping,
// screenshots, crawling, Tier-1 sources, and the shared memory. Acts only when
// ABBY assigns research.
const SEED_SCOUT = `
INSERT INTO agents (id, name, role, description, status, color, avatar_initials, model, capabilities)
SELECT 4, 'SCOUT', 'Research & Web Specialist',
  'Research & web-intelligence specialist — acts only when ABBY assigns research. Searches the live web, scrapes pages, captures screenshots, crawls sites, and works from Tier-1 sources; cites the real URLs it used.',
  'idle', '#10b981', 'SC', 'moonshotai/kimi-k2.6', ARRAY['research','web','scraping','memory']
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE name = 'SCOUT')
`;

// FORGE — code & deploy specialist (id 5). Writes, runs, and verifies code in the
// sandbox; opens repo PRs; calls APIs. Acts only when ABBY assigns engineering work.
const SEED_FORGE = `
INSERT INTO agents (id, name, role, description, status, color, avatar_initials, model, capabilities)
SELECT 5, 'FORGE', 'Code & Deploy Specialist',
  'Code & deploy specialist — acts only when ABBY assigns engineering work. Writes, runs, and verifies code in the sandbox, opens repository PRs, and calls REST APIs. Researches docs/errors online (search + crawl) and self-learns when it hits something it does not know; reports real run output, never guesses.',
  'idle', '#f59e0b', 'FG', 'moonshotai/kimi-k2.6', ARRAY['code','execution','api','files','research','self-learn']
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE name = 'FORGE')
`;

// QUILL — documents & artifacts specialist (id 6). Produces real downloadable
// files (PDF, saved artifacts). Acts only when ABBY assigns document/file output.
const SEED_QUILL = `
INSERT INTO agents (id, name, role, description, status, color, avatar_initials, model, capabilities)
SELECT 6, 'QUILL', 'Documents & Artifacts Specialist',
  'Documents & artifacts specialist — acts only when ABBY assigns a deliverable file. Produces real, downloadable documents (PDF) and saves artifacts, returning the genuine download link; never fabricates a URL.',
  'idle', '#f43f5e', 'QL', 'moonshotai/kimi-k2.6', ARRAY['files','documents','pdf','memory']
WHERE NOT EXISTS (SELECT 1 FROM agents WHERE name = 'QUILL')
`;

// Idempotently remove the legacy CLAW sub-agents from any existing DB so the swarm
// is just ABBY (orchestrator) + AVVY (image/video) + BUZZ (social/Composio). Safe:
// the agents table has no foreign-key dependents (messages/tool-calls store
// agent_id as a plain value), so historical rows keep their attribution. Every boot.
const REMOVE_OTHER_AGENTS = `DELETE FROM agents WHERE name NOT IN ('ABBY', 'AVVY', 'BUZZ', 'SCOUT', 'FORGE', 'QUILL')`;

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
  // ABBY only — solo agent with the full toolset (display metadata; real tool
  // access is ALL_TOOLS via AGENT_TOOLS[1] in tools.ts).
  1: ["code_exec", "sandbox_exec", "web_search", "web_scrape", "web_screenshot", "http_request", "memory_search", "memory_write", "composio_action", "instagram_post", "image_generate", "pdf_generate", "save_artifact", "schedule_task"],
  // AVVY — image + video ONLY (free HF image_generate + A2E video_generate).
  2: ["image_generate", "video_generate"],
  // BUZZ — social media + Composio ONLY (connected accounts, posting, scheduling).
  3: ["composio_apps", "composio_tools", "composio_action", "instagram_post", "social_accounts", "social_api", "browser_login", "marketing_playbook", "render_card", "schedule_task", "list_scheduled_tasks", "cancel_scheduled_task"],
  // SCOUT — research & web intelligence ONLY.
  4: ["web_search", "web_scrape", "web_screenshot", "tier1_sources", "site_crawl", "site_crawl_status", "http_request", "memory_search", "memory_write"],
  // FORGE — code & deploy + research-when-stuck (search/crawl/self-learn).
  5: ["code_exec", "cloud_code_exec", "sandbox_exec", "sandbox_repo_pr", "calculator", "http_request", "web_search", "web_scrape", "web_screenshot", "tier1_sources", "site_crawl", "site_crawl_status", "save_artifact", "pdf_generate", "memory_search", "memory_write"],
  // QUILL — documents & artifacts ONLY.
  6: ["save_artifact", "pdf_generate", "memory_search"],
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

    // Keep only ABBY + AVVY (removes the legacy CLAW sub-agents from existing prod
    // DBs). Idempotent — a no-op once the roster is just ABBY + AVVY.
    const del = await client.query(REMOVE_OTHER_AGENTS);
    if (del.rowCount) logger.info({ removed: del.rowCount }, "Removed legacy CLAW sub-agents — roster is ABBY + AVVY");

    // Idempotently ensure AVVY (image/video specialist) exists, including on
    // existing prod DBs where the count-based seed above is skipped.
    const avvy = await client.query(SEED_AVVY);
    if (avvy.rowCount) logger.info("Seeded AVVY — image & video generation specialist");

    // Idempotently ensure BUZZ (social media & Composio specialist) exists.
    const buzz = await client.query(SEED_BUZZ);
    if (buzz.rowCount) logger.info("Seeded BUZZ — social media & Composio specialist");

    // Idempotently ensure the task specialists exist (research / code / documents).
    for (const [seed, label] of [[SEED_SCOUT, "SCOUT — research & web"], [SEED_FORGE, "FORGE — code & deploy"], [SEED_QUILL, "QUILL — documents & artifacts"]] as const) {
      const r = await client.query(seed);
      if (r.rowCount) logger.info(`Seeded ${label} specialist`);
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
