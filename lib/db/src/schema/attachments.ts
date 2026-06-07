import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Uploaded files (images, documents) the operator drops into chat. Bytes are
 * stored base64 in `data` (kept simple + portable; images are small). For
 * images, the agent "sees" them via a vision model; for text-like files we
 * pre-extract `extractedText` so the agent can read them without a vision call.
 */
export const attachmentsTable = pgTable("attachments", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  kind: text("kind").notNull().default("other"), // "image" | "text" | "other"
  sizeBytes: integer("size_bytes").notNull().default(0),
  data: text("data").notNull(), // base64-encoded bytes
  extractedText: text("extracted_text"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAttachmentSchema = createInsertSchema(attachmentsTable).omit({ id: true, createdAt: true });
export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
export type Attachment = typeof attachmentsTable.$inferSelect;
