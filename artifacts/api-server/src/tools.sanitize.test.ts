import { describe, it, expect, vi } from "vitest";

// tools.ts pulls in the db via its imports; mock it like the other route tests so
// importing the pure sanitizer never touches a real database.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

import { sanitizeForStorage, isInternalMeta } from "./tools";

const NUL = String.fromCharCode(0);
const REPL = String.fromCharCode(0xfffd);
const HIGH = String.fromCharCode(0xd800); // lone high surrogate
const LOW = String.fromCharCode(0xdc00); // lone low surrogate

describe("sanitizeForStorage", () => {
  it("strips NUL bytes (the Postgres-text killer from scraped PDFs)", () => {
    expect(sanitizeForStorage("%PDF-1.6" + NUL + "binary")).toBe("%PDF-1.6binary");
    expect(sanitizeForStorage(NUL + NUL + "x")).toBe("x");
  });

  it("PRESERVES ordinary text, spaces, punctuation and newlines", () => {
    const s = "Hello, world!  Two spaces.\nLine two — em dash. $125.00";
    expect(sanitizeForStorage(s)).toBe(s);
  });

  it("preserves valid emoji (surrogate pairs)", () => {
    const s = "done ✅ 🚀 ok";
    expect(sanitizeForStorage(s)).toBe(s);
  });

  it("replaces lone surrogates that would break UTF-8 encoding", () => {
    expect(sanitizeForStorage("x" + HIGH + "y")).toBe("x" + REPL + "y");
    expect(sanitizeForStorage("x" + LOW + "y")).toBe("x" + REPL + "y");
  });

  it("is a no-op for already-clean strings", () => {
    expect(sanitizeForStorage("")).toBe("");
    expect(sanitizeForStorage("plain text 123")).toBe("plain text 123");
  });
});

describe("isInternalMeta — filters swarm self-audit / vault-meta entries from memory", () => {
  it("flags the polluting self-audit entries", () => {
    for (const key of [
      "abby-claw-memory-audit-architecture",
      "swarm-architecture-definitions",
      "vault-full-state-dump-2025",
      "vault-rag-sweep-code-prompts-2025",
      "claw4-vault-directive-memory-store-audit-2025",
      "six_ZIPs_identification_error",
    ]) {
      expect(isInternalMeta({ key })).toBe(true);
    }
    expect(isInternalMeta({ content: "SYSTEM TOPOLOGY (6 nodes): ABBY orchestrator, CLAW-3 SENTINEL ..." })).toBe(true);
  });

  it("keeps real operator-domain findings", () => {
    expect(isInternalMeta({ key: "fl-llc-fees", content: "Florida LLC filing fee is $125 total" })).toBe(false);
    expect(isInternalMeta({ key: "wellington-vpd", content: "US-441 AADT 48,500 (FDOT 2024)" })).toBe(false);
    expect(isInternalMeta({ content: "TAM/SAM/SOM for Palm Beach HNW market" })).toBe(false);
  });
});
