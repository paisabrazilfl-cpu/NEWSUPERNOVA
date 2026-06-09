import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { db, vaultSecretsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Secrets vault encryption.
 *
 * Values are encrypted with AES-256-GCM. The key is derived from SESSION_SECRET
 * via scrypt, so the plaintext key never lives on disk. Rotating SESSION_SECRET
 * intentionally invalidates all stored secrets (they can no longer be decrypted).
 *
 * We fail closed: if SESSION_SECRET is unset there is NO insecure default — every
 * vault operation throws, so secrets are never encrypted under a guessable key.
 */
let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is required to use the secrets vault — refusing to operate without it.",
    );
  }
  cachedKey = scryptSync(secret, "openclaw-vault-v1", 32);
  return cachedKey;
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
    const value = await getSecretValue(name);
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
