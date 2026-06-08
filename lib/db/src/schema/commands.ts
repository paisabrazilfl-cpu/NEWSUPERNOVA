import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentCommandsTable = pgTable("agent_commands", {
  id: serial("id").primaryKey(),
  fromAgentId: integer("from_agent_id").notNull(),
  toAgentId: integer("to_agent_id"),
  command: text("command").notNull(),
  payload: text("payload"),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("queued"),
  result: text("result"),
  model: text("model"),
  groundingChars: integer("grounding_chars"),
  groundingHash: text("grounding_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const cronJobsTable = pgTable("cron_jobs", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  name: text("name").notNull(),
  schedule: text("schedule").notNull(),
  task: text("task").notNull(),
  payload: text("payload"),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  runCount: integer("run_count").notNull().default(0),
  lastResult: text("last_result"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAgentCommandSchema = createInsertSchema(agentCommandsTable).omit({ id: true, createdAt: true, completedAt: true });
export const insertCronJobSchema = createInsertSchema(cronJobsTable).omit({ id: true, createdAt: true, lastRunAt: true, nextRunAt: true, runCount: true });

export type AgentCommand = typeof agentCommandsTable.$inferSelect;
export type CronJob = typeof cronJobsTable.$inferSelect;
export type InsertAgentCommand = z.infer<typeof insertAgentCommandSchema>;
export type InsertCronJob = z.infer<typeof insertCronJobSchema>;
