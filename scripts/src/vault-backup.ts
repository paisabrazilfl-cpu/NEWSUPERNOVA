/**
 * Encrypted vault backup / restore.
 *
 * The vault stores secrets AES-256-GCM-encrypted (see api-server/src/lib/vault.ts).
 * This tool exports/imports the *encrypted* rows only — ciphertext, iv, auth_tag.
 * The dump is useless without the matching SESSION_SECRET, so it is safe to keep
 * as an off-database backup. Its purpose: survive a database loss (e.g. Render's
 * free Postgres being deleted after ~30 days) WITHOUT ever writing plaintext.
 *
 *   pnpm --filter @workspace/scripts vault:backup [outfile.json]
 *   pnpm --filter @workspace/scripts vault:restore <infile.json>
 *
 * Requires DATABASE_URL to point at the target database.
 *
 * IMPORTANT: a restore only decrypts if SESSION_SECRET is the SAME value that was
 * in effect when the secrets were created. Back that secret up separately.
 */
import { pool } from "@workspace/db";
import { writeFileSync, readFileSync } from "node:fs";

const KIND = "openclaw-vault-backup";

interface SecretRow {
  name: string;
  description: string | null;
  ciphertext: string;
  iv: string;
  auth_tag: string;
}

async function backup(outfile: string): Promise<void> {
  const { rows } = await pool.query<SecretRow>(
    `SELECT name, description, ciphertext, iv, auth_tag FROM vault_secrets ORDER BY name`,
  );
  const payload = {
    kind: KIND,
    version: 1,
    exportedAt: new Date().toISOString(),
    note: "Encrypted vault rows. Useless without the matching SESSION_SECRET. Never contains plaintext.",
    count: rows.length,
    secrets: rows,
  };
  writeFileSync(outfile, JSON.stringify(payload, null, 2));
  console.log(`✓ wrote ${outfile} — ${rows.length} secret(s), encrypted`);
  if (rows.length) console.log(`  names: ${rows.map((r) => r.name).join(", ")}`);
  console.log("  ⚠️  This is only restorable while SESSION_SECRET is unchanged — back that up too.");
}

async function restore(infile: string): Promise<void> {
  const parsed = JSON.parse(readFileSync(infile, "utf8")) as {
    kind?: string;
    secrets?: SecretRow[];
  };
  if (parsed.kind !== KIND || !Array.isArray(parsed.secrets)) {
    throw new Error(`not a valid ${KIND} file: ${infile}`);
  }
  let n = 0;
  for (const s of parsed.secrets) {
    if (!s.name || !s.ciphertext || !s.iv || !s.auth_tag) {
      console.warn(`  skipping malformed row: ${JSON.stringify(s).slice(0, 80)}`);
      continue;
    }
    await pool.query(
      `INSERT INTO vault_secrets (name, description, ciphertext, iv, auth_tag)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO UPDATE SET
         description = EXCLUDED.description,
         ciphertext  = EXCLUDED.ciphertext,
         iv          = EXCLUDED.iv,
         auth_tag    = EXCLUDED.auth_tag,
         updated_at  = now()`,
      [s.name, s.description ?? null, s.ciphertext, s.iv, s.auth_tag],
    );
    n++;
  }
  console.log(`✓ restored ${n} secret(s) into vault_secrets`);
  console.log("  Note: they only decrypt if SESSION_SECRET matches the source database.");
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const file = process.argv[3];
  if (mode === "backup") {
    await backup(file || `vault-backup-${new Date().toISOString().slice(0, 10)}.json`);
  } else if (mode === "restore") {
    if (!file) throw new Error("usage: vault:restore <infile.json>");
    await restore(file);
  } else {
    throw new Error("usage: vault-backup.ts <backup|restore> [file]");
  }
  await pool.end();
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
