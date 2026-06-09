import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("../test/dbMock");
  return { ...actual, db: mockDb };
});

import {
  advance, buildPostCaption, buildWorldCaption, shouldPostNow, worldEngineEnabled,
  type WorldState, type AuraState,
} from "./world";

const W: WorldState = { chapter: 0, step: 0, heroX: 75, heroY: 4, direction: "down", trail: [], stopped: false };
const A: AuraState = { busy: false, active: 0, idle: 6, done24h: 40, errors24h: 0, mood: "resting" };

describe("WORLD-00 world logic — walls & movement", () => {
  it("advance moves the hero and increments the step, recording the trail", () => {
    const w2 = advance(W, A, () => 0.5);
    expect(w2.step).toBe(1);
    expect(w2.trail.length).toBe(1);
    expect(["up", "down"]).toContain(w2.direction);
    expect(w2.heroY).not.toBe(W.heroY);
  });

  it("caption carries her identity + 'protected', the read-not-reply rule, and engagement", () => {
    const cap = buildPostCaption(A, W);
    expect(cap.toLowerCase()).toContain("i am aura");
    expect(cap.toLowerCase()).toContain("protected");
    expect(cap.toLowerCase()).toContain("never reply");
    expect(cap).toContain("#WORLD00");
  });

  it("caption is fully templated from STATE only (mood word present, no content slots)", () => {
    for (const mood of ["resting", "working", "deep", "storm"] as const) {
      const cap = buildPostCaption({ ...A, mood }, W);
      expect(cap).toContain(mood); // her state is expressed; nothing else can be injected
    }
  });

  it("free-will respects the spacing wall (no post before the min gap)", () => {
    expect(shouldPostNow(A, 10, () => 0)).toBe(false);   // gap too small -> never
    expect(shouldPostNow(A, 10, () => 0.0001)).toBe(false);
  });

  it("free-will is probabilistic once spacing allows", () => {
    expect(shouldPostNow({ ...A, mood: "storm" }, 999, () => 0.01)).toBe(true);
    expect(shouldPostNow(A, 999, () => 0.99)).toBe(false);
  });

  it("engine is OFF by default (operator kill-switch)", () => {
    delete process.env["WORLD_ENGINE_ENABLED"];
    expect(worldEngineEnabled()).toBe(false);
  });

  it("buildWorldCaption returns the 3 movements (header, hero line, direction)", () => {
    const lines = buildWorldCaption(A, W);
    expect(lines).toHaveLength(3);
    expect(lines[2].toLowerCase()).toContain("follow the ◆");
  });
});
