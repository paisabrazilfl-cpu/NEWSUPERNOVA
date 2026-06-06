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
`;

const SEED_AGENTS = `
INSERT INTO agents (name, role, description, status, color, avatar_initials, model, capabilities)
VALUES
  ('ABBY',   'Orchestrator',  'Master orchestrator and directive router',       'idle', '#00e5ff', 'AB', 'x-ai/grok-4.3',         ARRAY['orchestration','planning','routing']),
  ('CLAW-1', 'Code Executor', 'Code generation and execution specialist',       'idle', '#bf00ff', 'C1', 'qwen/qwen3.7-plus',      ARRAY['code','execution','debugging']),
  ('CLAW-2', 'Browser Agent', 'Web browsing and scraping via Steel',            'idle', '#0066ff', 'C2', 'x-ai/grok-build-0.1',   ARRAY['browser','scraping','research']),
  ('CLAW-3', 'Memory & RAG',  'Long-term memory and retrieval',                 'idle', '#00cc88', 'C3', 'qwen/qwen3.7-max',       ARRAY['memory','rag','search']),
  ('CLAW-4', 'API Connector', 'External API integration and automation',        'idle', '#ff6b00', 'C4', 'x-ai/grok-4.20',         ARRAY['api','integration','automation']),
  ('MR.NICE','Social Agent',  'Social media and communications specialist',     'idle', '#ff2d78', 'MN', 'qwen/qwen3.6-plus',      ARRAY['social','communications','engagement'])
`;

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
  } catch (err) {
    logger.error({ err }, "Migration failed — continuing anyway");
  } finally {
    client.release();
  }
}
