import { Router } from "express";
import { db, vaultSecretsTable, setVaultSecretSchema } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { encryptSecret } from "../lib/vault";

const router = Router();

/** Public shape — NEVER includes the secret value. */
function fmt(row: typeof vaultSecretsTable.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// List stored secrets (metadata only — values are never returned).
router.get("/vault", async (_req, res) => {
  const rows = await db.select().from(vaultSecretsTable).orderBy(desc(vaultSecretsTable.updatedAt));
  res.json(rows.map(fmt));
});

// Create or update a secret (upsert by name).
router.put("/vault", async (req, res) => {
  const parsed = setVaultSecretSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid secret data" });
    return;
  }
  const { name, value, description } = parsed.data;
  const enc = encryptSecret(value);

  try {
    const [row] = await db
      .insert(vaultSecretsTable)
      .values({
        name,
        description: description ?? null,
        ciphertext: enc.ciphertext,
        iv: enc.iv,
        authTag: enc.authTag,
      })
      .onConflictDoUpdate({
        target: vaultSecretsTable.name,
        set: {
          description: description ?? null,
          ciphertext: enc.ciphertext,
          iv: enc.iv,
          authTag: enc.authTag,
          updatedAt: new Date(),
        },
      })
      .returning();
    res.status(200).json(fmt(row));
  } catch (err) {
    req.log.error({ err }, "Failed to store secret");
    res.status(500).json({ error: "Failed to store secret" });
  }
});

// Delete a secret by name.
router.delete("/vault/:name", async (req, res) => {
  const name = req.params.name;
  try {
    const [row] = await db.delete(vaultSecretsTable).where(eq(vaultSecretsTable.name, name)).returning();
    if (!row) {
      res.status(404).json({ error: "Secret not found" });
      return;
    }
    res.json({ deleted: row.name });
  } catch (err) {
    req.log.error({ err }, "Failed to delete secret");
    res.status(500).json({ error: "Failed to delete secret" });
  }
});

export default router;
