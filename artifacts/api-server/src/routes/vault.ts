import { Router } from "express";
import { db, vaultSecretsTable, setVaultSecretSchema } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { encryptSecret } from "../lib/vault";
import { resetNimHealth } from "../lib/integrations";

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

  // A vault name becomes a process.env key (so integrations turn on live), so it
  // must be a real env-var identifier and must NOT clobber security-critical or
  // runtime vars — otherwise a stored secret could rotate the session key (which
  // bricks every other encrypted secret), change the operator password, or alter
  // PATH/NODE_ENV.
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    res.status(400).json({ error: "Secret name must be an UPPER_SNAKE_CASE env var identifier (A–Z, 0–9, _)." });
    return;
  }
  const PROTECTED = new Set([
    "OPERATOR_PASSWORD", "SESSION_SECRET", "OPENCLAW_API_KEY", "DATABASE_URL",
    "NODE_ENV", "PATH", "PORT", "BASE_PATH", "ALLOW_COMPOSIO_EXECUTE",
  ]);
  if (PROTECTED.has(name)) {
    res.status(400).json({ error: `'${name}' is a protected runtime variable and cannot be set from the vault.` });
    return;
  }
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
    // Activate the secret immediately so integrations that read it from the
    // environment (EMBEDDINGS_API_KEY, PINECONE_*, COMPOSIO_API_KEY, GITHUB_API_KEY,
    // …) turn On without waiting for a server restart. Boot still re-loads the vault.
    process.env[name] = value;
    // A rotated NVIDIA key must take effect immediately — the NIM breaker may
    // still be tripped by the OLD key's 401/403s, which would leave the swarm
    // on OpenRouter for the rest of the cooldown despite a now-valid key.
    if (name === "NVIDIA_API_KEY") resetNimHealth();
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
