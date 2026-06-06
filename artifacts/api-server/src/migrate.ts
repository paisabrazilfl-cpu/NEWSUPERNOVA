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

// Real OpenClaw multi-agent system with inter-agent communication
const SEED_AGENTS = `
INSERT INTO agents (name, role, description, status, color, avatar_initials, model, capabilities)
VALUES
  ('ABBY', 'Operations and Monitoring', 'Master orchestrator and system monitor. Delegates tasks to sub-agents and manages inter-agent communication.', 'idle', '#00e5ff', 'AB', 'x-ai/grok-4.3', ARRAY['orchestration', 'planning', 'routing', 'reply', 'monologue']),
  ('PLANNER', 'Task Decomposition', 'Task decomposition and project management. Creates and maintains project plans.', 'idle', '#bf00ff', 'PL', 'x-ai/grok-4.3', ARRAY['planning', 'task_decomposition', 'project_management', 'progress_tracking']),
  ('IDEATOR', 'Creative Design', 'Idea generation and novelty assessment. Collaborates with critic for idea evaluation.', 'idle', '#0066ff', 'ID', 'anthropic/claude-sonnet-4-5', ARRAY['idea_generation', 'novelty_assessment', 'creativity_evaluation', 'idea_screening']),
  ('CRITIC', 'Quality Assessment', 'SHARP taste gate for ideas and content. Maintains quality standards and rejects inferior work.', 'idle', '#ff0000', 'CR', 'anthropic/claude-sonnet-4-5', ARRAY['quality_assessment', 'sharp_evaluation', 'antipattern_detection', 'rejection_reasoning']),
  ('SURVEYOR', 'Research and Intelligence', 'Literature search and information gathering. Identifies research gaps and contributes facts.', 'idle', '#00cc88', 'SR', 'qwen/qwen3.7-plus', ARRAY['research', 'information_gathering', 'rag_retrieval', 'literature_review']),
  ('CODER', 'Engineering and Coding', 'Algorithm implementation, code generation and execution. Runs experiments and validates results.', 'idle', '#ff6b00', 'CD', 'qwen/qwen3.7-plus', ARRAY['code_generation', 'execution', 'debugging', 'experiment_run', 'validation']),
  ('WRITER', 'Writing and Distribution', 'Paper and document writing. Formats content for publication or reports.', 'idle', '#ff2d78', 'WR', 'x-ai/grok-4.3', ARRAY['writing', 'formatting', 'documentation', 'publication']),
  ('REVIEWER', 'Review and Quality Control', 'Internal peer review. Builds rebuttal strategies and feedback loops.', 'idle', '#ffff00', 'RV', 'anthropic/claude-sonnet-4-5', ARRAY['review', 'quality_control', 'rebuttal_strategy', 'feedback_loop']),
  ('SCOUT', 'Intelligence and Survey', 'Daily intelligence digest and trend monitor. Reports evolving technology trends.', 'idle', '#f6600c', 'SC', 'qwen/qwen3.7-plus', ARRAY['intelligence_digest', 'trend_monitor', 'survey_reporting'])
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
  ('planner', 'agent', 'PLANNER task decomposition channel'),
  ('ideator', 'agent', 'IDEATOR idea generation channel'),
  ('critic', 'agent', 'CRITIC quality assessment channel'),
  ('surveyor', 'agent', 'SURVEYOR research channel'),
  ('coder', 'agent', 'CODER engineering channel'),
  ('writer', 'agent', 'WRITER writing channel'),
  ('reviewer', 'agent', 'REVIEWER review channel'),
  ('scout', 'agent', 'SCOUT intelligence channel')
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
  } catch (err) {
    logger.error({ err }, "Migration failed — continuing anyway");
  } finally {
    client.release();
  }
}
