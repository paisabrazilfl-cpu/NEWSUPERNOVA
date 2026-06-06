import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

/**
 * Encrypted secrets vault. Values are NEVER stored in plaintext — the API server
 * encrypts them (AES-256-GCM) before insert and only ever returns metadata to
 * the client. Agents use them via `{{secret:NAME}}` placeholders so the raw
 * value never enters the model context or telemetry.
 */
export const vaultSecretsTable = pgTable("vault_secrets", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const setVaultSecretSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_\-]+$/, "Name may only contain letters, numbers, underscores, and dashes."),
  value: z.string().min(1).max(8000),
  description: z.string().max(300).optional(),
});

export type VaultSecret = typeof vaultSecretsTable.$inferSelect;
export type SetVaultSecret = z.infer<typeof setVaultSecretSchema>;
