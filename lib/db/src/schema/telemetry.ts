import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const monologueLinesTable = pgTable("monologue_lines", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  text: text("text").notNull(),
  type: text("type").notNull().default("thought"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const toolCallsTable = pgTable("tool_calls", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  toolName: text("tool_name").notNull(),
  args: text("args"),
  result: text("result"),
  status: text("status").notNull().default("pending"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertMonologueLineSchema = createInsertSchema(monologueLinesTable).omit({ id: true });
export const insertToolCallSchema = createInsertSchema(toolCallsTable).omit({ id: true });
export type MonologueLine = typeof monologueLinesTable.$inferSelect;
export type ToolCall = typeof toolCallsTable.$inferSelect;
export type InsertMonologueLine = z.infer<typeof insertMonologueLineSchema>;
export type InsertToolCall = z.infer<typeof insertToolCallSchema>;
