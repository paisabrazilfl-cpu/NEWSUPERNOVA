import { describe, it, expect, vi } from "vitest";

// ai.ts pulls in the db (via the orchestrator import chain) at module load.
// Mock it the same way the other route tests do so importing the persona/
// doctrine constants never touches a real database.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("../test/dbMock");
  return { ...actual, db: mockDb };
});

import {
  AGENT_PERSONAS,
  ABBY_ID,
  EXECUTION_DOCTRINE,
  ANTI_HALLUCINATION_DIRECTIVE,
} from "./ai";

// The fabricated "cognition" theater that was removed. None of it may come back
// to any agent persona — these are prompt strings with no implementing code.
const MYTHOLOGY = [
  "Expected Free Energy",
  "Mythos",
  "Predictive Inference",
  "cognitive mirror",
  "sovereign cognitive",
  "Axiomatic Execution",
  "PRISM",
  "tri-state",
  "never break character",
  "cyberpunk",
];

function assertNoMythology(text: string) {
  const lower = text.toLowerCase();
  for (const term of MYTHOLOGY) {
    expect(lower, `should not contain mythology term "${term}"`).not.toContain(term.toLowerCase());
  }
}

describe("ABBY persona — mythology removed, grounded worker", () => {
  const abby = AGENT_PERSONAS[ABBY_ID];

  it("is defined", () => {
    expect(abby).toBeTruthy();
  });

  it("carries none of the removed cognition theater", () => {
    assertNoMythology(abby!);
  });

  it("frames ABBY as a delegating, evidence-driven, self-reflecting worker", () => {
    for (const beat of ["PLAN FIRST", "DELEGATE", "DEMAND EVIDENCE", "SELF-REFLECT", "DELIVER"]) {
      expect(abby, `ABBY persona should include "${beat}"`).toContain(beat);
    }
  });
});

describe("specialist personas — clean of mythology", () => {
  for (const id of [2, 3, 4, 5, 6]) {
    it(`agent #${id} is defined and carries no mythology`, () => {
      const persona = AGENT_PERSONAS[id];
      expect(persona).toBeTruthy();
      assertNoMythology(persona!);
    });
  }
});

describe("EXECUTION_DOCTRINE — the 10/10 worker standard", () => {
  it("requires shipping the final product", () => {
    expect(EXECUTION_DOCTRINE).toContain("SHIP THE FINAL PRODUCT");
  });

  it("requires exhaustive-then-conclusive work", () => {
    expect(EXECUTION_DOCTRINE).toContain("EXHAUSTIVE, THEN CONCLUSIVE");
  });

  it("carries deep-research rules with multi-source cross-checking", () => {
    expect(EXECUTION_DOCTRINE).toContain("DEEP RESEARCH");
    expect(EXECUTION_DOCTRINE.toLowerCase()).toContain("two independent sources");
  });

  it("requires deciding over deferring back to the operator", () => {
    expect(EXECUTION_DOCTRINE).toContain("DECIDE, DON'T DEFER");
  });

  it("enforces an end-to-end definition of done", () => {
    expect(EXECUTION_DOCTRINE).toContain("DEFINITION OF DONE");
  });
});

describe("ANTI_HALLUCINATION_DIRECTIVE — still intact alongside the doctrine", () => {
  it("keeps the evidence-discipline guardrail", () => {
    expect(ANTI_HALLUCINATION_DIRECTIVE).toContain("EVIDENCE DISCIPLINE");
  });
});
