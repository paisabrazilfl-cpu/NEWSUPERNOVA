import { describe, it, expect } from "vitest";
import { groundingProof } from "./grounding";

describe("groundingProof — Context Integrity Check", () => {
  it("reports not-received for empty/missing source", () => {
    expect(groundingProof(undefined)).toEqual({ received: false, chars: 0, hash: "" });
    expect(groundingProof(null)).toEqual({ received: false, chars: 0, hash: "" });
    expect(groundingProof("   ")).toEqual({ received: false, chars: 0, hash: "" });
  });

  it("reports received + length + a short stable hash (no raw content)", () => {
    const p = groundingProof("HNW Acquisition Plan for the 33411 corridor...");
    expect(p.received).toBe(true);
    expect(p.chars).toBeGreaterThan(0);
    expect(p.hash).toMatch(/^sha256:[0-9a-f]{12}$/);
  });

  it("is deterministic + content-sensitive (integrity fingerprint)", () => {
    expect(groundingProof("same").hash).toBe(groundingProof("same").hash);
    expect(groundingProof("a").hash).not.toBe(groundingProof("b").hash);
  });

  it("never leaks the raw source in the proof", () => {
    const secret = "TOP-SECRET-SOURCE-MATERIAL-12345";
    const p = groundingProof(secret);
    expect(JSON.stringify(p)).not.toContain(secret);
  });
});
