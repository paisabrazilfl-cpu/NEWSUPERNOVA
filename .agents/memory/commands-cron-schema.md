
// ===============================
// DB SCHEMA — agent_commands
// ===============================

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  boolean,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";

/* ---------------- ENUMS ---------------- */

export const commandStatus = pgEnum("command_status", [
  "queued",
  "running",
  "done",
  "failed",
]);

export const priorityLevel = pgEnum("priority_level", [
  "low",
  "normal",
  "high",
  "urgent",
]);

/* ---------------- TABLE: agent_commands ---------------- */

export const agentCommands = pgTable("agent_commands", {
  id: serial("id").primaryKey(),

  fromAgentId: integer("from_agent_id").notNull(),
  toAgentId: integer("to_agent_id"), // null = broadcast

  command: text("command").notNull(),
  payload: jsonb("payload").default({}),

  priority: priorityLevel("priority").default("normal"),

  status: commandStatus("status").default("queued"),

  result: jsonb("result"),

  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

/* ---------------- TABLE: cron_jobs ---------------- */

export const cronJobs = pgTable("cron_jobs", {
  id: serial("id").primaryKey(),

  agentId: integer("agent_id").notNull(),

  name: text("name").notNull(),

  schedule: text("schedule").notNull(), // cron expression

  task: text("task").notNull(),

  payload: jsonb("payload").default({}),

  enabled: boolean("enabled").default(true),

  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),

  runCount: integer("run_count").default(0),

  lastResult: jsonb("last_result"),

  createdAt: timestamp("created_at").defaultNow(),
});
