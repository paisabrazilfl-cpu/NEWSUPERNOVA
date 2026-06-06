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
  // Semantic-search embedding of the content, stored as a JSON-encoded float
  // array (text). Null when no embeddings provider is configured — search then
  // falls back to keyword matching. Kept provider-agnostic and extension-free
  // so it works on any Postgres without requiring pgvector.
  embedding: text("embedding"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAgentMemorySchema = createInsertSchema(agentMemoryTable).omit({ id: true, createdAt: true });
export type AgentMemory = typeof agentMemoryTable.$inferSelect;
export type InsertAgentMemory = z.infer<typeof insertAgentMemorySchema>;
