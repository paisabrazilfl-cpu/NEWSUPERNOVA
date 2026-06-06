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
`;

// ABBY CLAW swarm — 6 agents (ids 1-6 align with external.ts AGENT_NAME_MAP)
const SEED_AGENTS = `
INSERT INTO agents (name, role, description, status, color, avatar_initials, model, capabilities)
VALUES
  ('ABBY', 'Orchestrator', 'Master orchestrator. Plans and delegates real work to the worker agents via delegate_to_agent, then synthesizes results.', 'idle', '#00e5ff', 'AB', 'x-ai/grok-4.3', ARRAY['orchestration', 'planning', 'routing', 'delegation', 'monologue']),
  ('FORGE', 'Code Executor', 'Reads/writes/edits code in the workspace, greps, and runs commands/tests/git when shell is enabled.', 'idle', '#bf00ff', 'FG', 'qwen/qwen3.7-plus', ARRAY['filesystem', 'code_execution', 'git', 'devops', 'debugging']),
  ('CRAWLER', 'Browser Agent', 'Web research and browser automation: web_search, web_fetch, page reading, link extraction, Steel browser.', 'idle', '#0066ff', 'CR', 'x-ai/grok-4.3', ARRAY['web_search', 'web_fetch', 'browser', 'crawl', 'extraction']),
  ('VAULT', 'Memory & RAG', 'Durable memory and local vector store: indexing, vector search, knowledge graph, context retrieval.', 'idle', '#00cc88', 'VT', 'qwen/qwen3.7-plus', ARRAY['memory', 'vector_search', 'rag', 'knowledge_graph', 'indexing']),
  ('WIRE', 'API Connector', 'External service integration via http_request/api_get/api_post/webhook_send/openapi_call.', 'idle', '#ff6b00', 'WR', 'x-ai/grok-4.3', ARRAY['http', 'api', 'webhooks', 'integration']),
  ('MR.NICE', 'Social Agent', 'Communications and outbound messaging via Slack/Discord/Telegram webhooks and drafted copy.', 'idle', '#ff2d78', 'MN', 'anthropic/claude-sonnet-4-5', ARRAY['messaging', 'social', 'communications', 'drafting'])
`;

// Inter-agent command protocols
const KEYSPLIT_ABORT_SEED = `
INSERT INTO agent_commands (from_agent_id, to_agent_id, command, payload, priority, status)
VALUES
  (1, 2, 'THInit', 'Task started: Study model architecture', 'priority_300', 'queued'),
  (2, 3, 'THInit', 'Send idea to critic for evaluation', 'priority_300', 'queued'),
  (3, 1, 'THResult', 'IDEA EVALUATED (SHARP=20), approved for phase 3.3', 'priority_300', 'queued'),
  (1, 5, 'THPlanDeal', 'Plan dealing for literature review', 'priority_200', 'queued'),
  (5, 6, 'THDispatch', 'Implement algorithm at: https://github.com/project/src', 'priority_400', 'queued'),
  (6, 7, 'THInit', 'Write paper draft for review', 'priority_300', 'queued'),
  (7, 1, 'THResult', 'Paper REVIEWED by critic. Ready for submission.', 'priority_300', 'queued')
`;

const SEED_CHANNELS = `
INSERT INTO channels (name, type, description)
VALUES
  ('general', 'general', 'General swarm communications'),
  ('abby', 'agent', 'ABBY orchestrator channel'),
  ('forge', 'agent', 'FORGE code executor channel'),
  ('crawler', 'agent', 'CRAWLER browser agent channel'),
  ('vault', 'agent', 'VAULT memory & RAG channel'),
  ('wire', 'agent', 'WIRE API connector channel'),
  ('mr.nice', 'agent', 'MR.NICE social agent channel')
`;

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    logger.info("Running startup migrations...");
    await client.query(SCHEMA_SQL);
    logger.info("Schema ready");

    const { rows } = await client.query("SELECT COUNT(*) AS n FROM agents");
    if (parseInt(rows[0].n, 10) === 0) {
      await client.query(SEED_AGENTS);
      await client.query(KEYSPLIT_ABORT_SEED);
      await client.query(SEED_CHANNELS);
      logger.info("Default agents, commands and channels seeded");
    }

    // Reconcile to the canonical ABBY CLAW roster (idempotent). Aligns ids 1-6
    // with external.ts and undoes any earlier buddy:bos-omega routing on ABBY.
    const roster: Array<[number, string, string, string, string, string]> = [
      [1, "ABBY", "Orchestrator", "#00e5ff", "AB", "x-ai/grok-4.3"],
      [2, "FORGE", "Code Executor", "#bf00ff", "FG", "qwen/qwen3.7-plus"],
      [3, "CRAWLER", "Browser Agent", "#0066ff", "CR", "x-ai/grok-4.3"],
      [4, "VAULT", "Memory & RAG", "#00cc88", "VT", "qwen/qwen3.7-plus"],
      [5, "WIRE", "API Connector", "#ff6b00", "WR", "x-ai/grok-4.3"],
      [6, "MR.NICE", "Social Agent", "#ff2d78", "MN", "anthropic/claude-sonnet-4-5"],
    ];
    const { rows: countRows } = await client.query("SELECT COUNT(*) AS n FROM agents");
    if (parseInt(countRows[0].n, 10) >= 6) {
      for (const [id, name, role, color, initials, model] of roster) {
        await client.query(
          "UPDATE agents SET name=$2, role=$3, color=$4, avatar_initials=$5, model=$6 WHERE id=$1",
          [id, name, role, color, initials, model],
        );
      }
      await client.query("DELETE FROM agents WHERE id > 6");
    }
    // Never leave any agent pointing at the dormant NeuroBuddy router.
    await client.query("UPDATE agents SET model = 'x-ai/grok-4.3' WHERE model LIKE 'buddy:%'");
  } catch (err) {
    logger.error({ err }, "Migration failed — continuing anyway");
  } finally {
    client.release();
  }
}
