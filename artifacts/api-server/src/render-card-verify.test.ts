import { describe, it, expect } from "vitest";
import { renderContentCard } from "./lib/worldEngine";

describe("renderContentCard — the $0 ASCII/code image generator", () => {
  it("renders a valid PNG news card with no AI image API", async () => {
    const buf = await renderContentCard({
      kind: "news",
      eyebrow: "> AI_NEWS",
      headline: "Test headline card",
      body: "Why it matters: verification run.",
      seed: 42,
    });
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(buf.length).toBeGreaterThan(5000);
  });
});
