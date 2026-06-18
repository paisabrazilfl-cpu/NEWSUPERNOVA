import { describe, it, expect } from "vitest";
import { resultWasBlocked } from "./orchestrator";

// §17 empty-response hardening regression: empty / placeholder / UNVERIFIED
// agent results must be treated as blocked (recoverable), never as a real answer.
describe("resultWasBlocked — §17 empty-response hardening", () => {
  it("flags empty and whitespace output as blocked", () => {
    expect(resultWasBlocked("")).toBe(true);
    expect(resultWasBlocked("   ")).toBe(true);
  });

  it("flags placeholder outputs as blocked", () => {
    expect(resultWasBlocked("(no response)")).toBe(true);
    expect(resultWasBlocked("(no result produced)")).toBe(true);
  });

  it("flags UNVERIFIED / empty-LLM markers as blocked", () => {
    expect(resultWasBlocked("UNVERIFIED — empty LLM response (no final text produced)")).toBe(true);
    expect(resultWasBlocked("UNVERIFIED — blocked or errored")).toBe(true);
    expect(resultWasBlocked("error: tool failed")).toBe(true);
  });

  it("does NOT flag a real answer as blocked", () => {
    expect(resultWasBlocked("The Moon drifts away ~3.8 cm per year.")).toBe(false);
    expect(resultWasBlocked("Done: created report.pdf")).toBe(false);
  });
});
