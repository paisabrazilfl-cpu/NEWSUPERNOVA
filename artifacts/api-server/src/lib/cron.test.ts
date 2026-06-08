import { describe, it, expect } from "vitest";
import { computeNextRun } from "./cron";

// Fixed reference time: 2026-06-08T17:50:00Z (a Monday).
const FROM = new Date("2026-06-08T17:50:00.000Z");
const minutesUntil = (d: Date) => Math.round((d.getTime() - FROM.getTime()) / 60000);

describe("computeNextRun — correct 5-field cron intervals", () => {
  it("'*/5 * * * *' → within ~5 minutes", () => {
    expect(minutesUntil(computeNextRun("*/5 * * * *", FROM))).toBeLessThanOrEqual(5);
    expect(minutesUntil(computeNextRun("*/5 * * * *", FROM))).toBeGreaterThan(0);
  });

  it("'0 0 * * *' (daily midnight) → NOT 5 min; ~next midnight (was the bug)", () => {
    const mins = minutesUntil(computeNextRun("0 0 * * *", FROM));
    expect(mins).toBeGreaterThan(60); // definitely not the old 5-minute fallback
    // next 00:00 UTC after 17:50 is ~370 min away
    expect(mins).toBe((24 * 60) - (17 * 60 + 50));
  });

  it("'0 */3 * * *' (every 3h) → next 3-hour boundary, not 5 min", () => {
    const next = computeNextRun("0 */3 * * *", FROM);
    expect(minutesUntil(next)).toBeGreaterThan(5);
    expect(next.getUTCHours() % 3).toBe(0);
    expect(next.getUTCMinutes()).toBe(0);
  });

  it("'0 * * * *' (hourly) → top of the next hour", () => {
    const next = computeNextRun("0 * * * *", FROM);
    expect(next.getUTCMinutes()).toBe(0);
    expect(minutesUntil(next)).toBe(10); // 17:50 → 18:00
  });

  it("never returns a time at/-before `from` (no double-fire / busy loop)", () => {
    for (const s of ["* * * * *", "0 0 * * *", "*/15 * * * *", "30 9 * * 1"]) {
      expect(computeNextRun(s, FROM).getTime()).toBeGreaterThan(FROM.getTime());
    }
  });
});
