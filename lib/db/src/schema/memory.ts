import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentMemoryTable = pgTable("agent_memory", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull(),
  agentName: text("agent_name"),
  key: text("key"),
  content: text("content").notNull(),
  tags: text("tags"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAgentMemorySchema = createInsertSchema(agentMemoryTable).omit({ id: true, createdAt: true });
export type AgentMemory = typeof agentMemoryTable.$inferSelect;
export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
