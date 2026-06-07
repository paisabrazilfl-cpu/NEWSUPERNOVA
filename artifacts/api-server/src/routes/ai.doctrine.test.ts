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
  RESEARCH_PLAYBOOKS,
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

  it("requires output to be the answer, not internal state", () => {
    expect(EXECUTION_DOCTRINE).toContain("OUTPUT IS THE ANSWER, NOT YOUR INTERNAL STATE");
  });
});

describe("RESEARCH_PLAYBOOKS — VPD(both) + market research + decks", () => {
  it("defines VPD as Vehicles Per Day (traffic/site research)", () => {
    expect(RESEARCH_PLAYBOOKS).toContain("VEHICLES PER DAY");
    expect(RESEARCH_PLAYBOOKS).toContain("VPD");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("aadt");
  });

  it("also covers Value Proposition Design", () => {
    expect(RESEARCH_PLAYBOOKS).toContain("VALUE PROPOSITION DESIGN");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("pain reliever");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("gain creator");
  });

  it("includes a market-research playbook with TAM/SAM/SOM", () => {
    expect(RESEARCH_PLAYBOOKS).toContain("MARKET RESEARCH");
    expect(RESEARCH_PLAYBOOKS).toContain("TAM/SAM/SOM");
  });

  it("includes a deck/presentation playbook with per-slide spec + design system", () => {
    expect(RESEARCH_PLAYBOOKS).toContain("DECK / PRESENTATION BUILDING");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("speaker notes");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("save_artifact");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("canva");
  });

  it("covers the domain library (SEO/AEO, marketing, geofencing, money, engineering)", () => {
    expect(RESEARCH_PLAYBOOKS).toContain("SEO / AEO / GEO");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("llms.txt");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("gptbot");
    expect(RESEARCH_PLAYBOOKS).toContain("PERFORMANCE MARKETING");
    expect(RESEARCH_PLAYBOOKS).toContain("GEOFENCING");
    expect(RESEARCH_PLAYBOOKS).toContain("UNIT ECONOMICS");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("cac");
  });
});

describe("RESEARCH_PLAYBOOKS — Tier-1 source policy", () => {
  it("carries the source hierarchy + evidence labeling + tier1_sources pointer", () => {
    expect(RESEARCH_PLAYBOOKS).toContain("SOURCE POLICY");
    expect(RESEARCH_PLAYBOOKS).toContain("CONFIRMED");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("tier1_sources");
  });
});

describe("EXECUTION_DOCTRINE — no internal-state / navel-gazing", () => {
  it("forbids reporting on the swarm itself", () => {
    expect(EXECUTION_DOCTRINE).toContain("NEVER REPORT ON THE SWARM ITSELF");
    expect(EXECUTION_DOCTRINE).toContain("DON'T NAVEL-GAZE IN MEMORY");
  });
});

describe("ANTI_HALLUCINATION_DIRECTIVE — still intact alongside the doctrine", () => {
  it("keeps the evidence-discipline guardrail", () => {
    expect(ANTI_HALLUCINATION_DIRECTIVE).toContain("EVIDENCE DISCIPLINE");
  });
});
