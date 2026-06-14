import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { db, vaultSecretsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Secrets vault encryption.
 *
 * Values are encrypted with AES-256-GCM. The key is derived via scrypt from a
 * DEDICATED `VAULT_KEY`, so the plaintext key never lives on disk.
 *
 * Why a dedicated key (and not SESSION_SECRET): the vault key and the
 * login/session signing secret are different concerns. Rotating or truncating
 * the LOGIN secret is a routine operation — but when the vault was keyed off
 * SESSION_SECRET, doing so silently orphaned every stored credential (they could
 * no longer be decrypted), surfacing only as "every integration is mysteriously
 * Off". Keying the vault off its own `VAULT_KEY` decouples the two, so rotating
 * the login secret never destroys the vault.
 *
 * Backward compatibility: when `VAULT_KEY` is unset we fall back to
 * `SESSION_SECRET` with the SAME scrypt salt, so secrets written by older
 * deployments still decrypt byte-for-byte — zero migration, zero loss.
 *
 * We fail closed: if NEITHER key is set there is NO insecure default — every
 * vault operation throws, so secrets are never encrypted under a guessable key.
 */
let cachedKey: Buffer | null = null;

/** Resolve the raw key material: dedicated VAULT_KEY, else legacy SESSION_SECRET. */
function vaultKeyMaterial(): string | undefined {
  return process.env["VAULT_KEY"] || process.env["SESSION_SECRET"] || undefined;
}

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = vaultKeyMaterial();
  if (!secret) {
    throw new Error(
      "VAULT_KEY (or legacy SESSION_SECRET) is required to use the secrets vault — refusing to operate without it.",
    );
  }
  cachedKey = scryptSync(secret, "openclaw-vault-v1", 32);
  return cachedKey;
}

/** True when a vault encryption key (VAULT_KEY or legacy SESSION_SECRET) is configured. */
export function vaultKeyConfigured(): boolean {
  return vaultKeyMaterial() !== undefined;
}

/**
 * Drop the cached scrypt key so the next operation re-derives it from the
 * current env. Only needed if the key material changes within a running
 * process (e.g. tests, or a future runtime rotation flow).
 */
export function resetVaultKeyCache(): void {
  cachedKey = null;
}

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(rec: EncryptedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(rec.iv, "base64"));
  decipher.setAuthTag(Buffer.from(rec.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(rec.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** Decrypt a stored secret by name. Returns null if it doesn't exist. */
export async function getSecretValue(name: string): Promise<string | null> {
  const [row] = await db.select().from(vaultSecretsTable).where(eq(vaultSecretsTable.name, name));
  if (!row) return null;
  try {
    return decryptSecret(row);
  } catch {
    return null;
  }
}

/**
 * List the NAMES (and optional descriptions) of every stored secret — never the
 * values. Used to inject the operator's Settings → Stored Secrets inventory into
 * the agent prompt so the swarm knows which credentials exist and can reach them
 * via {{secret:NAME}}, without ever seeing (or being able to read) a raw value.
 */
export async function listSecretNames(): Promise<{ name: string; description: string | null }[]> {
  return db
    .select({ name: vaultSecretsTable.name, description: vaultSecretsTable.description })
    .from(vaultSecretsTable)
    .orderBy(vaultSecretsTable.name);
}

const SECRET_PLACEHOLDER = /\{\{\s*secret:([A-Za-z0-9_\-]+)\s*\}\}/g;

/**
 * Replace every `{{secret:NAME}}` placeholder in a string with the decrypted
 * value from the vault. Unknown names are left intact so failures are visible.
 * The raw value is only ever produced here, at the moment of use — it never
 * enters the model context, message log, or tool-call telemetry.
 *
 * Any raw values that were actually injected are added to the optional `used`
 * set, so the caller can redact them from anything that gets persisted or sent
 * back to the model (e.g. an HTTP response body that echoes the request).
 */
export async function substituteSecrets(input: string, used?: Set<string>): Promise<string> {
  const names = new Set<string>();
  for (const m of input.matchAll(SECRET_PLACEHOLDER)) names.add(m[1]);
  if (names.size === 0) return input;

  const resolved = new Map<string, string>();
  for (const name of names) {
    // Primary: encrypted vault DB. Fallback: process.env so Render env vars
    // (SANDBOX_GITHUB_TOKEN, COMPOSIO_API_KEY, etc.) are reachable via
    // {{secret:NAME}} without a separate vault entry. The value is still
    // redacted from any response and never enters model context.
    const value = (await getSecretValue(name)) ?? process.env[name] ?? null;
    if (value !== null) {
      resolved.set(name, value);
      used?.add(value);
    }
  }
  return input.replace(SECRET_PLACEHOLDER, (full, name: string) => resolved.get(name) ?? full);
}

/**
 * Remove any raw secret values from a string before it is stored or returned to
 * the model. Defends against endpoints that reflect request data (auth headers,
 * echo/debug APIs, verbose error bodies) back in their response.
 */
export function redactSecrets(text: string, values: Iterable<string>): string {
  let out = text;
  for (const v of values) {
    if (v && out.includes(v)) out = out.split(v).join("‹redacted-secret›");
  }
  return out;
}

/** True if a string references at least one vault secret placeholder. */
export function hasSecretPlaceholder(input: string): boolean {
  SECRET_PLACEHOLDER.lastIndex = 0;
  return SECRET_PLACEHOLDER.test(input);
}

/**
 * Build a TRUTHFUL, actionable error for an input that still has unresolved
 * {{secret:NAME}} placeholders. The old generic "that name is not in the vault"
 * was actively misleading when the name IS in the vault but its value can't be
 * decrypted (the VAULT_KEY/SESSION_SECRET changed since it was saved) — agents
 * then loop forever re-checking vault_list (which shows the name) and retrying.
 * This distinguishes ORPHANED (present but undecryptable → re-enter it / set an
 * env var; do NOT retry) from genuinely MISSING names.
 */
export async function unresolvedSecretError(text: string): Promise<string> {
  const names = [...new Set([...text.matchAll(SECRET_PLACEHOLDER)].map((m) => m[1]))];
  if (!names.length) return "error: a {{secret:NAME}} placeholder did not resolve. (No request was sent.)";
  let existing = new Set<string>();
  try {
    existing = new Set((await listSecretNames()).map((s) => s.name));
  } catch { /* fall through with empty set */ }
  const orphaned = names.filter((n) => existing.has(n));
  const missing = names.filter((n) => !existing.has(n));
  const parts: string[] = [];
  if (orphaned.length) {
    parts.push(
      `${orphaned.join(", ")} EXIST(S) in the vault but the stored value could NOT be decrypted — the vault encryption key (VAULT_KEY/SESSION_SECRET) changed since it was saved, so it is orphaned. Do NOT retry the placeholder. Fix: re-enter it in Settings → Stored Secrets, or set it as a Render environment variable (env vars win over the vault).`,
    );
  }
  if (missing.length) {
    parts.push(`${missing.join(", ")} is/are not in the vault — call vault_list for the exact names.`);
  }
  return `error: secret placeholder(s) did not resolve. ${parts.join(" ")} (No request was sent.)`;
}
