import { describe, it, expect } from "vitest";
import { screenForSensitive, blockIfSensitiveForPublic } from "./safety";

describe("safety — block confidential content from public publishing", () => {
  it("flags confidential / deal / credential material", () => {
    expect(screenForSensitive("CONFIDENTIAL acquisition proposal — do not distribute").length).toBeGreaterThan(0);
    expect(screenForSensitive("Here is the term sheet and cap table for the merger").length).toBeGreaterThan(0);
    expect(screenForSensitive("api_key: sk-abc123def456ghi789").length).toBeGreaterThan(0);
    expect(screenForSensitive("SSN 123-45-6789 on file").length).toBeGreaterThan(0);
    expect(screenForSensitive("This is attorney-client privileged and internal only").length).toBeGreaterThan(0);
  });

  it("does NOT flag a normal public AI-news caption", () => {
    const caption = "🚨 Big AI news: Microsoft's new chip improves reliability 1000x. Comment NEWS for the breakdown. #AINews #Tech";
    expect(screenForSensitive(caption)).toEqual([]);
    expect(blockIfSensitiveForPublic(caption)).toBeNull();
  });

  it("blockIfSensitiveForPublic returns a refusal for the acquisition-proposal case", () => {
    const out = blockIfSensitiveForPublic("Top secret: our acquisition proposal values them at $40M pre-money", "your public Instagram");
    expect(out).toBeTruthy();
    expect(out!).toContain("BLOCKED");
    expect(out!.toLowerCase()).toContain("nothing was posted");
  });
});
