/**
 * Minimal, dependency-free 5-field cron "next run" calculator.
 *
 * Supports the standard fields — minute hour day-of-month month day-of-week —
 * each accepting a wildcard, a step, a single value, a range A-B, and comma
 * lists. Returns the next matching time STRICTLY after `from` (rounded up to the
 * next whole minute), so a job can never double-fire within the same minute and
 * never busy-loops.
 *
 * Lives on its own (imports nothing from the app) so both the scheduler and the
 * schedule_task tool can use ONE correct implementation without an import cycle.
 * Previously each had a copy that only understood the minute field, so a daily
 * "0 0 star star star" job silently fell back to firing every 5 minutes.
 */

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const partRaw of field.split(",")) {
    const part = partRaw.trim();
    if (!part) continue;
    let step = 1;
    let range = part;
    const slash = part.indexOf("/");
    if (slash >= 0) {
      step = Number(part.slice(slash + 1)) || 1;
      range = part.slice(0, slash);
    }
    let lo = min;
    let hi = max;
    if (range === "*" || range === "") {
      // full range
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = hi = Number(range);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    for (let v = lo; v <= hi; v += step) {
      if (v >= min && v <= max) out.add(v);
    }
  }
  return out;
}

/** Next run time strictly after `from` matching the 5-field cron `schedule` (UTC-agnostic; uses server local = UTC on Render). */
export function computeNextRun(schedule: string, from: Date = new Date()): Date {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return new Date(from.getTime() + 60_000);
  const [minF, hourF, domF, monF, dowF] = parts;

  const mins = parseField(minF, 0, 59);
  const hours = parseField(hourF, 0, 23);
  const doms = parseField(domF, 1, 31);
  const mons = parseField(monF, 1, 12);
  const dows = parseField(dowF, 0, 6);
  if (/(^|[,/-])7([,/-]|$)/.test(dowF)) dows.add(0); // 7 = Sunday too

  const domRestricted = domF.trim() !== "*";
  const dowRestricted = dowF.trim() !== "*";

  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // strictly after `from`, on a minute boundary

  const MAX_ITER = 367 * 24 * 60; // up to ~1 year of minutes
  for (let i = 0; i < MAX_ITER; i++) {
    const monthOk = mons.has(d.getMonth() + 1);
    const minOk = mins.has(d.getMinutes());
    const hourOk = hours.has(d.getHours());
    let dayOk: boolean;
    if (domRestricted && dowRestricted) dayOk = doms.has(d.getDate()) || dows.has(d.getDay());
    else if (domRestricted) dayOk = doms.has(d.getDate());
    else if (dowRestricted) dayOk = dows.has(d.getDay());
    else dayOk = true;

    if (minOk && hourOk && dayOk && monthOk) return new Date(d.getTime());
    d.setMinutes(d.getMinutes() + 1);
  }
  return new Date(from.getTime() + 60_000); // safety fallback (should never hit)
}
