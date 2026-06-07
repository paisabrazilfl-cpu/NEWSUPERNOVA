import { describe, it, expect, vi } from "vitest";

// tools.ts pulls in the db via its imports; mock it like the other route tests so
// importing the pure sanitizer never touches a real database.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

import { sanitizeForStorage } from "./tools";

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
