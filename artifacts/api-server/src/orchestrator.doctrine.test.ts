import { describe, it, expect, vi } from "vitest";

// orchestrator.ts imports the db and many libs at load; mock the db the same way
// the other tests do so importing the doctrine constant never hits a real DB.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

import { SYNTHESIS_DOCTRINE } from "./orchestrator";

describe("SYNTHESIS_DOCTRINE — CLAWs report to ABBY, ABBY reports in full (every run)", () => {
  it("mandates the report on every run", () => {
    expect(SYNTHESIS_DOCTRINE).toContain("MANDATORY");
    expect(SYNTHESIS_DOCTRINE.toLowerCase()).toContain("every run");
  });

  it("requires the peer-to-peer conversational voice", () => {
    expect(SYNTHESIS_DOCTRINE.toLowerCase()).toContain("peer-to-peer");
    expect(SYNTHESIS_DOCTRINE.toLowerCase()).toContain("conversational");
  });

  it("enforces the three movements incl. Discovery AND Application", () => {
    expect(SYNTHESIS_DOCTRINE).toContain("DIRECT ANSWER");
    expect(SYNTHESIS_DOCTRINE).toContain("DISCOVERY");
    expect(SYNTHESIS_DOCTRINE).toContain("APPLICATION");
  });

  it("requires every CLAW (including blocked ones) to be attributed and labeled honestly", () => {
    expect(SYNTHESIS_DOCTRINE).toContain("EACH CLAW");
    expect(SYNTHESIS_DOCTRINE).toContain("UNVERIFIED");
    expect(SYNTHESIS_DOCTRINE.toLowerCase()).toContain("blocked");
  });

  it("resolves conflicting CLAW results by concrete evidence instead of echoing both", () => {
    expect(SYNTHESIS_DOCTRINE).toContain("RESOLVE CONFLICTS BY EVIDENCE");
    expect(SYNTHESIS_DOCTRINE).toContain("401");
    expect(SYNTHESIS_DOCTRINE).toContain("ONE evidence-based DIRECT ANSWER");
  });

  it("makes a verified 2xx tool result outrank ABBY's own later inference", () => {
    expect(SYNTHESIS_DOCTRINE).toContain("VERIFIED TOOL RESULT OUTRANKS YOUR OWN INFERENCE");
    expect(SYNTHESIS_DOCTRINE.toLowerCase()).toContain("ground truth");
    expect(SYNTHESIS_DOCTRINE).toContain("2xx");
  });
});
