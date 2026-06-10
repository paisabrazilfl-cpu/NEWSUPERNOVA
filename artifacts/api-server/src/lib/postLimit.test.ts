import { describe, it, expect } from "vitest";
import { decidePostAllowed } from "./postLimit";

const now = new Date("2026-06-08T12:00:00Z");

describe("postLimit — daily cap + spacing (fully automated)", () => {
  it("allows a post when under cap and well-spaced", () => {
    const last = new Date(now.getTime() - 120 * 60000); // 2h ago
    expect(decidePostAllowed({ countLast24h: 3, last, now, maxPerDay: 12, minSpacingMin: 90 })).toBeNull();
  });

  it("allows the very first post (no prior)", () => {
    expect(decidePostAllowed({ countLast24h: 0, last: null, now, maxPerDay: 12, minSpacingMin: 90 })).toBeNull();
  });

  it("blocks when the daily cap is reached", () => {
    const out = decidePostAllowed({ countLast24h: 12, last: new Date(now.getTime() - 600 * 60000), now, maxPerDay: 12, minSpacingMin: 90 });
    expect(out).toBeTruthy();
    expect(out!).toContain("Daily");
    expect(out!).toContain("12/day");
  });

  it("blocks when posts are too close together (spacing)", () => {
    const last = new Date(now.getTime() - 10 * 60000); // 10 min ago
    const out = decidePostAllowed({ countLast24h: 2, last, now, maxPerDay: 12, minSpacingMin: 90 });
    expect(out).toBeTruthy();
    expect(out!.toLowerCase()).toContain("spaced out");
    expect(out!.toLowerCase()).toContain("nothing was posted");
  });

  it("cap removed (max=0 / spacing=0): never blocks, even at high counts and back-to-back", () => {
    const last = new Date(now.getTime() - 1 * 60000); // 1 min ago
    expect(decidePostAllowed({ countLast24h: 999, last, now, maxPerDay: 0, minSpacingMin: 0 })).toBeNull();
    expect(decidePostAllowed({ countLast24h: 50, last, now, maxPerDay: 0, minSpacingMin: 0 })).toBeNull();
  });
});
