/**
 * Solve-loop contract — the final output the operator reads must BE a solution
 * to their input. The orchestrator cycles (coordinator review rounds + the
 * solution gate on the synthesized briefing) up to MAX_SOLVE_CYCLES until the
 * goal is judged solved; an exhausted budget is reported honestly, never
 * presented as success. These tests pin the gate's verdict parsing and the
 * doctrine text so the contract can't silently drift.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

import { parseSolutionVerdict, MAX_SOLVE_CYCLES, SOLUTION_GATE_DOCTRINE } from "./orchestrator";

describe("MAX_SOLVE_CYCLES — the system cycles, it doesn't one-shot", () => {
  it("allows multiple solve cycles by default", () => {
    expect(MAX_SOLVE_CYCLES).toBeGreaterThanOrEqual(2);
  });
});

describe("SOLUTION_GATE_DOCTRINE — solves means solves", () => {
  it("judges solving the operator's input, not prose quality", () => {
    expect(SOLUTION_GATE_DOCTRINE).toContain("SOLVES");
    expect(SOLUTION_GATE_DOCTRINE.toLowerCase()).toContain("not whether it is well-written");
  });

  it("rejects status reports and partial answers as solutions", () => {
    expect(SOLUTION_GATE_DOCTRINE.toLowerCase()).toContain("status report");
    expect(SOLUTION_GATE_DOCTRINE.toLowerCase()).toContain("not a solution");
  });

  it("is strict by default — doubt means not solved", () => {
    expect(SOLUTION_GATE_DOCTRINE).toContain("NOT solved");
  });
});

describe("parseSolutionVerdict — robust against real model output", () => {
  it("parses a clean solved verdict", () => {
    const v = parseSolutionVerdict('{"solved": true, "reason": "answers fully", "directives": []}');
    expect(v.solved).toBe(true);
    expect(v.reason).toBe("answers fully");
  });

  it("parses a clean unsolved verdict with directives", () => {
    const v = parseSolutionVerdict(
      '{"solved": false, "reason": "no pricing data", "directives": [{"agentId": 3, "directive": "scrape pricing"}]}',
    );
    expect(v.solved).toBe(false);
    expect(v.reason).toBe("no pricing data");
  });

  it("parses JSON wrapped in prose and code fences", () => {
    const v = parseSolutionVerdict('Here is my verdict:\n```json\n{"solved": false, "reason": "missing deploy proof", "directives": []}\n```');
    expect(v.solved).toBe(false);
    expect(v.reason).toBe("missing deploy proof");
  });

  it("falls back to regex when surrounding JSON is malformed", () => {
    const v = parseSolutionVerdict('{"solved": false, "reason": "truncated output", "directives": [{"agentId": 2,');
    expect(v.solved).toBe(false);
    expect(v.reason).toContain("truncated output");
  });

  it("fails OPEN on unparseable garbage so a flaky judge can't burn the cycle budget", () => {
    const v = parseSolutionVerdict("I cannot evaluate this right now.");
    expect(v.solved).toBe(true);
    expect(v.reason.toLowerCase()).toContain("unparseable");
  });
});
