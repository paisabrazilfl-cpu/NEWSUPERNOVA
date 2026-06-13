import { describe, it, expect, beforeEach, afterEach } from "vitest";

// The vault module imports @workspace/db at the top for getSecretValue/list
// helpers; we don't exercise those here, so stub it to avoid any DB side effects.
import { vi } from "vitest";
vi.mock("@workspace/db", () => ({
  db: {},
  vaultSecretsTable: {},
}));

import {
  encryptSecret,
  decryptSecret,
  vaultKeyConfigured,
  resetVaultKeyCache,
} from "./vault";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env["VAULT_KEY"];
  delete process.env["SESSION_SECRET"];
  resetVaultKeyCache();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetVaultKeyCache();
});

describe("vault encryption key resolution", () => {
  it("round-trips a value using a dedicated VAULT_KEY", () => {
    process.env["VAULT_KEY"] = "a-dedicated-vault-key";
    const enc = encryptSecret("nvapi-super-secret");
    expect(enc.ciphertext).not.toContain("nvapi-super-secret");
    expect(decryptSecret(enc)).toBe("nvapi-super-secret");
  });

  it("falls back to SESSION_SECRET when VAULT_KEY is unset (legacy compatibility)", () => {
    process.env["SESSION_SECRET"] = "legacy-login-secret";
    const enc = encryptSecret("composio-key");
    resetVaultKeyCache();
    expect(decryptSecret(enc)).toBe("composio-key");
  });

  it("decouples the vault from the login secret: rotating SESSION_SECRET does NOT break a VAULT_KEY-encrypted value", () => {
    process.env["VAULT_KEY"] = "stable-vault-key";
    process.env["SESSION_SECRET"] = "login-v1";
    const enc = encryptSecret("still-here");
    // Operator rotates the LOGIN secret only — vault key is unchanged.
    process.env["SESSION_SECRET"] = "login-v2-rotated";
    resetVaultKeyCache();
    expect(decryptSecret(enc)).toBe("still-here");
  });

  it("VAULT_KEY takes precedence over SESSION_SECRET", () => {
    process.env["VAULT_KEY"] = "the-real-key";
    process.env["SESSION_SECRET"] = "a-different-secret";
    const enc = encryptSecret("payload");
    // Drop VAULT_KEY and keep only the (different) SESSION_SECRET → can't decrypt.
    delete process.env["VAULT_KEY"];
    resetVaultKeyCache();
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("vaultKeyConfigured reflects whether any key is set, and ops fail closed otherwise", () => {
    expect(vaultKeyConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(/VAULT_KEY/);
    process.env["SESSION_SECRET"] = "y";
    expect(vaultKeyConfigured()).toBe(true);
  });
});
