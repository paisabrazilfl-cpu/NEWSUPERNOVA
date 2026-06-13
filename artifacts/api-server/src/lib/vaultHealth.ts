/**
 * Vault decryption health.
 *
 * Tracks how many stored vault rows FAILED to decrypt at boot (orphaned
 * ciphertext — almost always because the encryption key changed since the
 * secrets were saved). This is surfaced via `GET /api/integrations` as a COUNT
 * only (never names — the no-disclosure rule still applies on that public
 * endpoint) so the operator sees an explicit, explained signal instead of a
 * buried log line when integrations "mysteriously" read as Off.
 */
let orphanedCount = 0;
let lastCheckedAt: string | null = null;

/** Record the result of a vault decryption sweep (called from loadVaultIntoEnv). */
export function recordVaultHealth(opts: { undecryptable: number }): void {
  orphanedCount = opts.undecryptable;
  lastCheckedAt = new Date().toISOString();
}

/** Current vault health — orphaned (undecryptable) row count, never names. */
export function vaultHealth(): { orphaned: number; checkedAt: string | null } {
  return { orphaned: orphanedCount, checkedAt: lastCheckedAt };
}
