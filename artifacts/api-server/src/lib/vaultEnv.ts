import { db, vaultSecretsTable } from "@workspace/db";
import { decryptSecret, vaultKeyConfigured } from "./vault";
import { recordVaultHealth } from "./vaultHealth";
import { logger } from "./logger";

/**
 * Load vault secrets into process.env at boot, so a key saved in the in-app
 * Settings/Vault activates its integration (e.g. EMBEDDINGS_API_KEY, COMPOSIO_API_KEY,
 * PINECONE_API_KEY) after a restart — without ever committing it.
 *
 * Precedence: explicit environment variables WIN. We only fill names that are
 * currently unset/empty, so a value set in the Render dashboard is never
 * overridden by the vault. Secret values are never logged (names only).
 *
 * Best-effort: never throws, so server boot always proceeds even if the vault
 * is empty, SESSION_SECRET is missing, or a row fails to decrypt.
 */
export async function loadVaultIntoEnv(): Promise<void> {
  if (!vaultKeyConfigured()) {
    logger.warn("Vault→env skipped: neither VAULT_KEY nor SESSION_SECRET is set");
    return;
  }
  try {
    const rows = await db.select().from(vaultSecretsTable);
    const applied: string[] = [];
    const skippedEnvSet: string[] = [];
    const undecryptable: string[] = [];
    for (const row of rows) {
      const existing = process.env[row.name];
      if (existing != null && existing !== "") {
        skippedEnvSet.push(row.name);
        continue;
      }
      try {
        const value = decryptSecret(row);
        if (value) {
          process.env[row.name] = value;
          applied.push(row.name);
        }
      } catch {
        undecryptable.push(row.name);
      }
    }
    recordVaultHealth({ undecryptable: undecryptable.length });
    if (undecryptable.length) {
      // ERROR, not warn: these credentials are effectively lost — the encryption
      // key (VAULT_KEY/SESSION_SECRET) changed since they were saved, so the
      // affected integrations will read as Off until the keys are re-entered.
      // Also surfaced as a count at GET /api/integrations (vault.orphaned) so the
      // operator sees it without grepping logs.
      logger.error(
        { undecryptable, orphaned: undecryptable.length },
        `Vault→env: ${undecryptable.length} secret(s) FAILED to decrypt — the vault encryption key changed since they were saved. ` +
          `Re-enter these keys in Settings → Stored Secrets to restore their integrations. (surfaced at GET /api/integrations → vault.orphaned)`,
      );
    }
    logger.info({ applied, skippedEnvSet }, "Loaded vault secrets into environment");
  } catch (err) {
    logger.error({ err }, "Vault→env load failed — continuing without it");
  }
}
