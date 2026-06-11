/**
 * Loop-accuracy guard — a CLAW that repeats the exact same call, or makes no
 * forward progress for several steps, is flailing and must be stopped so it
 * concludes with what it has instead of burning the whole step budget
 * (observed live: ~40 identical web_search/save_artifact calls on one
 * directive). Pins the escalation policy so it can't silently drift.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

import { repeatedCallAction, MAX_IDENTICAL_CALL_ATTEMPTS, MAX_NO_PROGRESS_STREAK, stableStringify } from "./orchestrator";

describe("stableStringify — canonical keys so the dedupe/loop guards trigger", () => {
  it("produces the same string regardless of object key order", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it("is stable for nested objects and arrays", () => {
    expect(stableStringify({ q: "x", opts: { z: 1, a: 2 } })).toBe(
      stableStringify({ opts: { a: 2, z: 1 }, q: "x" }),
    );
  });

  it("distinguishes genuinely different args", () => {
    expect(stableStringify({ url: "a" })).not.toBe(stableStringify({ url: "b" }));
  });
});

describe("repeatedCallAction — escalate identical tool calls", () => {
  it("runs the first attempt normally", () => {
    expect(repeatedCallAction(1)).toBe("run");
  });

  it("nudges on the second-to-last allowed attempt", () => {
    expect(repeatedCallAction(MAX_IDENTICAL_CALL_ATTEMPTS - 1)).toBe("nudge");
  });

  it("hard-stops once the identical call hits the attempt cap", () => {
    expect(repeatedCallAction(MAX_IDENTICAL_CALL_ATTEMPTS)).toBe("stop");
    expect(repeatedCallAction(MAX_IDENTICAL_CALL_ATTEMPTS + 5)).toBe("stop");
  });

  it("has sane, loop-bounding constants", () => {
    expect(MAX_IDENTICAL_CALL_ATTEMPTS).toBeGreaterThanOrEqual(2);
    expect(MAX_IDENTICAL_CALL_ATTEMPTS).toBeLessThanOrEqual(5);
    expect(MAX_NO_PROGRESS_STREAK).toBeGreaterThanOrEqual(2);
  });
});
