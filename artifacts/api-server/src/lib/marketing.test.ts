import { describe, it, expect } from "vitest";
import { MARKETING_ENGINE, MARKETING_ENGINE_POINTER, MARKETING_SECTIONS, marketingPlaybook } from "./marketing";

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

  it("explicitly differentiates the channel (social vs email vs paid vs sms)", () => {
    expect(MARKETING_ENGINE).toContain("DIFFERENTIATE THE CHANNEL FIRST");
    expect(MARKETING_ENGINE).toContain("EMAIL");
    expect(MARKETING_ENGINE).toContain("CAN-SPAM");
    expect(MARKETING_ENGINE).toContain("PAID ADS");
    expect(MARKETING_ENGINE).toContain("SMS");
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

describe("MARKETING_SECTIONS — enterprise deep modules, on demand", () => {
  it("includes the key enterprise modules", () => {
    for (const k of ["campaign_brief", "offer_ladder", "post_templates", "email_nurture", "paid_media", "governance", "qa", "kpis", "rollout"]) {
      expect(MARKETING_SECTIONS[k], `missing section ${k}`).toBeTruthy();
    }
  });

  it("compliance modules carry the real obligations (CAN-SPAM / FTC / GDPR / incrementality)", () => {
    expect(MARKETING_SECTIONS["email_nurture"]!.body).toContain("CAN-SPAM");
    expect(MARKETING_SECTIONS["governance"]!.body).toContain("FTC");
    expect(MARKETING_SECTIONS["governance"]!.body).toContain("GDPR");
    expect(MARKETING_SECTIONS["paid_media"]!.body.toLowerCase()).toContain("incrementality");
  });

  it("marketingPlaybook() returns core by default and a section when asked", () => {
    expect(marketingPlaybook()).toBe(MARKETING_ENGINE);
    expect(marketingPlaybook("campaign_brief")).toContain("Master Campaign Brief");
    expect(marketingPlaybook("nonsense")).toContain("Available:");
  });
});
