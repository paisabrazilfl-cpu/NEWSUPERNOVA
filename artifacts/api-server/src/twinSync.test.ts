/**
 * Twin teaching sync contract (AURA ⇄ T800 — teacher/learner link).
 *
 * Teacher side (lib/twinSync.ts): after the nightly self-learning review, AURA
 * pushes her VERIFIED lessons to the sibling swarm. Learner side (routes/
 * external.ts POST /external/v1/twin-lessons): inbound lessons are stored
 * QUARANTINED — visible but never auto-trusted, and never re-exportable as if
 * verified locally. These tests pin the flag gating and the quarantine
 * re-tagging so the no-echo guarantee can't silently drift.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

import { twinSyncEnabled, quarantineTags, teachTwin } from "./lib/twinSync";

const TWIN_ENV = ["TWIN_SYNC_ENABLED", "TWIN_API_URL", "TWIN_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of TWIN_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of TWIN_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("twinSyncEnabled — hard feature flag", () => {
  it("is OFF when nothing is configured", () => {
    expect(twinSyncEnabled()).toBe(false);
  });

  it("is OFF when the flag is on but URL/key are missing", () => {
    process.env["TWIN_SYNC_ENABLED"] = "true";
    expect(twinSyncEnabled()).toBe(false);
    process.env["TWIN_API_URL"] = "https://t800.example.com";
    expect(twinSyncEnabled()).toBe(false);
  });

  it("is ON only with flag + URL + key all set", () => {
    process.env["TWIN_SYNC_ENABLED"] = "true";
    process.env["TWIN_API_URL"] = "https://t800.example.com";
    process.env["TWIN_API_KEY"] = "k";
    expect(twinSyncEnabled()).toBe(true);
  });

  it("teachTwin is a no-op (never throws, never fetches) when disabled", async () => {
    await expect(teachTwin()).resolves.toBe("twin sync disabled");
  });
});

describe("quarantineTags — inbound twin lessons are quarantined, not trusted", () => {
  it("tags the lesson from-twin + proposed with a stable src marker", () => {
    const tags = quarantineTags("aura:42", "lesson,nightly");
    expect(tags).toContain("from-twin");
    expect(tags).toContain("proposed");
    expect(tags).toContain("src:aura:42");
    expect(tags).toContain("lesson");
    expect(tags).toContain("nightly");
  });

  it("STRIPS the teacher's self-learned tag so the lesson can never be re-exported as verified", () => {
    const tags = quarantineTags("aura:7", "lesson,self-learned,nightly");
    expect(tags).not.toContain("self-learned");
  });

  it("strips pre-existing quarantine/src markers so a relayed lesson can't smuggle trust", () => {
    const tags = quarantineTags("t800:9", "from-twin,proposed,src:aura:1,lesson");
    expect(tags.match(/from-twin/g)).toHaveLength(1);
    expect(tags.match(/src:/g)).toHaveLength(1);
    expect(tags).toContain("src:t800:9");
    expect(tags).not.toContain("src:aura:1");
  });

  it("caps the tag string at the column budget (300 chars)", () => {
    const tags = quarantineTags("aura:1", "x".repeat(500));
    expect(tags.length).toBeLessThanOrEqual(300);
  });
});
