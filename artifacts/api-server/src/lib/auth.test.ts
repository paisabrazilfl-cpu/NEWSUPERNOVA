import { describe, it, expect } from "vitest";
import { timingSafeStrEqual } from "./auth";

describe("timingSafeStrEqual — constant-time secret compare", () => {
  it("returns true only for an exact match", () => {
    expect(timingSafeStrEqual("sk-abc123", "sk-abc123")).toBe(true);
  });

  it("returns false for any mismatch, including different lengths", () => {
    expect(timingSafeStrEqual("sk-abc123", "sk-abc124")).toBe(false);
    expect(timingSafeStrEqual("short", "a-much-longer-secret")).toBe(false);
    expect(timingSafeStrEqual("", "x")).toBe(false);
    expect(timingSafeStrEqual("x", "")).toBe(false);
  });

  it("never throws on length mismatch (hashes to a fixed width first)", () => {
    expect(() => timingSafeStrEqual("a", "abcdefghijklmnop")).not.toThrow();
  });
});
