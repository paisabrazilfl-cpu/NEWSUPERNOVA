import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Relay sessions — the primary/secondary collaboration loop between two
 * OPENCLAW swarms (e.g. NEWSUPERNOVA = primary, T800-AURA = secondary).
 *
 * The operator hands a goal to the PRIMARY. The primary runs its own swarm
 * cycle, then forwards the output to the SECONDARY as input. The secondary
 * analyses it as an INDEPENDENT swarm and replies (question / result /
 * no-action). They ping-pong until the PRIMARY judges the MVP done (by the
 * relay's definition of done) or the hard round cap is hit.
 *
 * `relayId` is a stable cross-service id minted by the primary and echoed by
 * the secondary, so one logical session has one row on EACH side.
 */
export const relaySessionsTable = pgTable("relay_sessions", {
  id: serial("id").primaryKey(),
  relayId: text("relay_id").notNull(),
  // This swarm's role in the session: "primary" | "secondary".
  role: text("role").notNull(),
  goal: text("goal").notNull(),
  channelId: integer("channel_id").notNull().default(1),
  // Highest round number this side has processed (used for idempotent dedupe of
  // re-delivered turns).
  round: integer("round").notNull().default(0),
  // active | done | no-action | aborted | error
  status: text("status").notNull().default("active"),
  lastActor: text("last_actor"),
  // turn | question | result | no-action | done | continue
  lastKind: text("last_kind"),
  lastPayload: text("last_payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRelaySessionSchema = createInsertSchema(relaySessionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type RelaySession = typeof relaySessionsTable.$inferSelect;
export type InsertRelaySession = z.infer<typeof insertRelaySessionSchema>;
