/**
 * Responsive check (Playwright). For each route × viewport, detects horizontal
 * overflow (the #1 mobile bug: scrollWidth > viewport width) and screenshots.
 * Evidence-based: reports actual measured overflow, not opinions.
 *
 *   BASE_URL    app origin (default http://localhost:3001)
 *   REPORT_DIR  screenshots dir (default <cwd>/.self-test/responsive)
 *
 * Exit 0 = no route overflows at any viewport; exit 1 = at least one overflow.
 */
import { chromium, type Browser } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env["BASE_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
const REPORT_DIR = process.env["REPORT_DIR"] ?? join(process.cwd(), ".self-test", "responsive");

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];
const ROUTES = ["/", "/swarm", "/agents", "/tasks", "/cron", "/settings"];

async function run(): Promise<number> {
  mkdirSync(REPORT_DIR, { recursive: true });
  let browser: Browser | null = null;
  const rows: { route: string; vp: string; innerW: number; scrollW: number; overflow: boolean }[] = [];
  try {
    browser = await chromium.launch();
    for (const vp of VIEWPORTS) {
      for (const route of ROUTES) {
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, ignoreHTTPSErrors: true });
        try {
          // The app polls constantly (react-query), so networkidle never settles —
          // wait for DOM + a fixed render settle instead.
          await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(1800);
          // Runs in the browser; reference DOM globals via globalThis so the
          // Node-only tsconfig (no DOM lib) still typechecks.
          const m = await page.evaluate(() => {
            const g = globalThis as unknown as { innerWidth: number; document: { documentElement: { scrollWidth: number } } };
            return { innerW: g.innerWidth, scrollW: g.document.documentElement.scrollWidth };
          });
          // >1px slack to ignore sub-pixel rounding.
          const overflow = m.scrollW - m.innerW > 1;
          rows.push({ route, vp: vp.name, innerW: m.innerW, scrollW: m.scrollW, overflow });
          const safe = (route === "/" ? "root" : route.replace(/\//g, "")) || "root";
          await page.screenshot({ path: join(REPORT_DIR, `${vp.name}-${safe}.png`), fullPage: false });
        } catch (e) {
          rows.push({ route, vp: vp.name, innerW: vp.width, scrollW: -1, overflow: true });
          console.error(`  ${vp.name} ${route} FAILED: ${String(e).split("\n")[0].slice(0, 120)}`);
        }
        await page.close();
      }
    }
  } finally {
    await browser?.close();
  }

  const bad = rows.filter((r) => r.overflow);
  console.log(`\n=== RESPONSIVE CHECK (${BASE_URL}) ===`);
  for (const vp of VIEWPORTS) {
    const line = ROUTES.map((rt) => {
      const r = rows.find((x) => x.route === rt && x.vp === vp.name)!;
      return `${rt}${r.overflow ? "✗" : "✓"}`;
    }).join("  ");
    console.log(`  ${vp.name.padEnd(8)} ${line}`);
  }
  if (bad.length) {
    console.log(`\nOVERFLOWS (horizontal scroll = broken on that size):`);
    for (const r of bad) console.log(`  ✗ ${r.vp.padEnd(8)} ${r.route.padEnd(10)} viewport=${r.innerW} content=${r.scrollW}`);
  } else {
    console.log("\n  ✓ no horizontal overflow at any viewport.");
  }
  console.log(`\nScreenshots: ${REPORT_DIR}`);
  return bad.length ? 1 : 0;
}

run().then((c) => process.exit(c)).catch((e) => { console.error("responsive-check crashed:", e); process.exit(1); });
