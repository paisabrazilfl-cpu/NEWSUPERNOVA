import { describe, it, expect } from "vitest";
import { MARKETING_ENGINE, MARKETING_ENGINE_POINTER } from "./marketing";

describe("MARKETING_ENGINE — universal post→conversion playbook", () => {
  it("carries the full conversion chain, not just attention", () => {
    expect(MARKETING_ENGINE).toContain("Attention → Trust → Desire → Action → Follow-up → Conversion");
    expect(MARKETING_ENGINE).toContain("CONVERSATIONS");
  });

  it("enforces accuracy-first (the guardrail that fixes fabricated stats)", () => {
    expect(MARKETING_ENGINE).toContain("ACCURACY FIRST");
    expect(MARKETING_ENGINE.toLowerCase()).toContain("never invent stats");
    expect(MARKETING_ENGINE.toLowerCase()).toContain("verifiable");
  });

  it("includes the universal post formula and named psychology triggers", () => {
    expect(MARKETING_ENGINE).toContain("Hook → Problem → Insight → Value → CTA → Follow-up");
    expect(MARKETING_ENGINE).toContain("PSYCHOLOGY TRIGGERS");
    expect(MARKETING_ENGINE.toLowerCase()).toContain("curiosity gap");
  });

  it("covers platform adaptation and CTA keyword bank", () => {
    expect(MARKETING_ENGINE).toContain("PLATFORM ADAPTATION");
    expect(MARKETING_ENGINE).toContain("Instagram");
    expect(MARKETING_ENGINE).toContain("CTA LADDER");
  });

  it("ties the engine to this swarm's real tools (executable, not just advice)", () => {
    expect(MARKETING_ENGINE).toContain("HOW THIS SWARM RUNS THE ENGINE");
    for (const tool of ["image_generate", "instagram_post", "schedule_task", "memory_write"]) {
      expect(MARKETING_ENGINE, `engine should reference ${tool}`).toContain(tool);
    }
  });

  it("the persona pointer routes marketing tasks through the playbook + accuracy rule", () => {
    expect(MARKETING_ENGINE_POINTER).toContain("marketing_playbook");
    expect(MARKETING_ENGINE_POINTER.toLowerCase()).toContain("never fabricate");
  });
});
