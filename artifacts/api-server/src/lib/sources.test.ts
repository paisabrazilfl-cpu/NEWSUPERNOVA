import { describe, it, expect } from "vitest";
import { TIER1_SOURCES, tier1SourcesText, SOURCE_POLICY } from "./sources";

describe("Tier-1 source whitelist", () => {
  it("covers all requested domains", () => {
    const keys = TIER1_SOURCES.map((c) => c.key);
    for (const k of ["medicine", "finance", "markets", "news", "ai", "marketing", "engineering", "law", "social", "gov"]) {
      expect(keys).toContain(k);
    }
  });

  it("lists authoritative URLs (full dump)", () => {
    const all = tier1SourcesText();
    expect(all).toContain("https://www.sec.gov/edgar");
    expect(all).toContain("https://pubmed.ncbi.nlm.nih.gov/");
    expect(all).toContain("https://arxiv.org/");
  });

  it("filters by category", () => {
    const law = tier1SourcesText("law");
    expect(law).toContain("https://www.congress.gov/");
    expect(law).not.toContain("https://pubmed.ncbi.nlm.nih.gov/");
  });

  it("handles an unknown category gracefully", () => {
    expect(tier1SourcesText("nonsense")).toMatch(/No Tier-1 category matched/i);
  });

  it("source policy states the hierarchy + evidence labels", () => {
    expect(SOURCE_POLICY).toContain("SOURCE POLICY");
    for (const label of ["CONFIRMED", "INFERRED", "UNKNOWN"]) expect(SOURCE_POLICY).toContain(label);
  });
});
