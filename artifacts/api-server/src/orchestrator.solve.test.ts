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

import { parseSolutionVerdict, directiveIsExecutable, MAX_SOLVE_CYCLES, SOLUTION_GATE_DOCTRINE } from "./orchestrator";

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

  it("accepts a verified dead end as a solution instead of forcing fabrication", () => {
    expect(SOLUTION_GATE_DOCTRINE).toContain("VERIFIED IMPOSSIBILITY IS A SOLUTION");
    expect(SOLUTION_GATE_DOCTRINE.toLowerCase()).toContain("only the operator holds");
    expect(SOLUTION_GATE_DOCTRINE.toLowerCase()).toContain("invites fabrication");
  });

  it("forbids corrective directives the sandbox cannot execute", () => {
    expect(SOLUTION_GATE_DOCTRINE).toContain("DIRECTIVES MUST BE EXECUTABLE");
    expect(SOLUTION_GATE_DOCTRINE).toContain("CANNOT see the application");
    expect(SOLUTION_GATE_DOCTRINE.toLowerCase()).toContain("agent to clone, open, inspect, build, or test local files");
  });
});

describe("directiveIsExecutable — code-level guard against impossible gate directives", () => {
  it("rejects the verbatim osint-hub incident verdict", () => {
    expect(
      directiveIsExecutable(
        "The briefing fails to exhaust the swarm's tools—it did not attempt to clone or inspect the local `/workspace/osint-hub` (if it exists in the operator's environment) or verify the operator's GitHub access for private repos, and it defers to the operator instead of forcing the result.",
      ),
    ).toBe(false);
  });

  it("rejects cloning, local paths, filesystem access, and toolchain runs", () => {
    expect(directiveIsExecutable("Clone the repository and audit src/")).toBe(false);
    expect(directiveIsExecutable("Inspect /workspace/osint-hub for backend files")).toBe(false);
    expect(directiveIsExecutable("Check the local filesystem for the project")).toBe(false);
    expect(directiveIsExecutable("Run pnpm test in the repo to confirm the build")).toBe(false);
    expect(directiveIsExecutable("Read the local files on the operator's machine")).toBe(false);
    expect(directiveIsExecutable("Audit the codebase for the missing route")).toBe(false);
  });

  it("accepts directives the swarm's real tools can perform", () => {
    expect(directiveIsExecutable("Use web_search to find the canonical osint-hub repository on GitHub")).toBe(true);
    expect(directiveIsExecutable("Call the GitHub API via http_request to verify whether luis-osint/osint-hub exists")).toBe(true);
    expect(directiveIsExecutable("Scrape the repository page and list the files it shows")).toBe(true);
    expect(directiveIsExecutable("Write the verified findings to shared memory and post the briefing")).toBe(true);
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
