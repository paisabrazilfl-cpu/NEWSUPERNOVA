/**
 * Fallback-chain contract — the 2026-06-10 "BOS-OMEGA incident": when a CLAW's
 * primary model pool failed (429), execution dropped straight to the Buddy
 * endpoint, whose hosted personality (BOS-OMEGA) refused the CLAW personas and
 * its rejections were recorded as successful "done" runs. The fix: a secondary
 * swarm model is tried first, and Buddy output that self-identifies as
 * BOS-OMEGA is rejected as junk instead of masquerading as a result.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

import { buddyIdentityJunk } from "./orchestrator";

describe("buddyIdentityJunk — reject the Buddy endpoint's hosted personality", () => {
  it("flags the exact rejections observed live in production", () => {
    for (const junk of [
      "ERROR: Invalid agent state — received directive for WIRE but identity is BOS-OMEGA.",
      "Invalid role configuration: BOS-OMEGA and FORGE roles are mutually exclusive.",
      "the current cognitive engine running is BOS-OMEGA — a hierarchical, predictive, value-guided inference system",
      "You are interacting with BOS-OMEGA, a hierarchical cognitive system for evidence-based psychological intervention.",
      "GLOBAL_STATE\n[ MODE: EXECUTIVE | GATE: COMMIT ]\narousal ▓▓▓▓▓▓▓░░░ 0.70",
    ]) {
      expect(buddyIdentityJunk(junk), `should flag: "${junk.slice(0, 60)}"`).toBe(true);
    }
  });

  it("does NOT flag legitimate CLAW results", () => {
    for (const ok of [
      "✅ Instagram post is LIVE. media_id=1234 permalink: https://www.instagram.com/p/abc/",
      "Here are the latest AI news headlines from Reuters with sources.",
      "The market research shows a $4.2B TAM; sources cited inline.",
      "stored memory #42 (semantic · pinecone).",
    ]) {
      expect(buddyIdentityJunk(ok), `should NOT flag: "${ok.slice(0, 60)}"`).toBe(false);
    }
  });
});
