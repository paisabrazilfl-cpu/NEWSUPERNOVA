/**
 * Visual audit (Playwright). Full-page screenshots of every route at mobile /
 * tablet / desktop, plus console + page-error capture and horizontal-overflow
 * detection. Evidence for a human (or me) to eyeball "does it all look good".
 *
 *   BASE_URL    app origin (default http://localhost:3001)
 *   REPORT_DIR  screenshots dir (default <cwd>/.self-test/audit)
 */
import { chromium, type Browser, type ConsoleMessage } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = (process.env["BASE_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
const REPORT_DIR = process.env["REPORT_DIR"] ?? join(process.cwd(), ".self-test", "audit");
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
];
const ROUTES = ["/", "/swarm", "/agents", "/tasks", "/cron", "/settings"];

async function run(): Promise<number> {
  mkdirSync(REPORT_DIR, { recursive: true });
  let browser: Browser | null = null;
  let issues = 0;
  try {
    browser = await chromium.launch();
    for (const vp of VIEWPORTS) {
      for (const route of ROUTES) {
        const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, ignoreHTTPSErrors: true });
        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];
        page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
        page.on("console", (m: ConsoleMessage) => {
          const t = m.text();
          // ERR_CERT_AUTHORITY_INVALID is a sandbox TLS quirk, not an app bug.
          if (m.type() === "error" && !t.includes("ERR_CERT_AUTHORITY_INVALID")) consoleErrors.push(t.slice(0, 200));
        });
        const safe = (route === "/" ? "root" : route.replace(/\//g, "")) || "root";
        let overflow = false;
        try {
          await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForTimeout(1800);
          const m = await page.evaluate(() => {
            const g = globalThis as unknown as { innerWidth: number; document: { documentElement: { scrollWidth: number } } };
            return { innerW: g.innerWidth, scrollW: g.document.documentElement.scrollWidth };
          });
          overflow = m.scrollW - m.innerW > 1;
          await page.screenshot({ path: join(REPORT_DIR, `${vp.name}-${safe}.png`), fullPage: true });
        } catch (e) {
          pageErrors.push(`NAV FAIL: ${String(e).split("\n")[0].slice(0, 150)}`);
        }
        const bad = overflow || pageErrors.length > 0 || consoleErrors.length > 0;
        if (bad) issues++;
        const flags = [overflow ? "OVERFLOW" : "", pageErrors.length ? `pageerr(${pageErrors.length})` : "", consoleErrors.length ? `console(${consoleErrors.length})` : ""].filter(Boolean).join(" ");
        console.log(`  ${bad ? "✗" : "✓"} ${vp.name.padEnd(8)} ${route.padEnd(10)} ${flags}`);
        for (const e of pageErrors) console.log(`        pageerror: ${e}`);
        for (const e of consoleErrors) console.log(`        console:   ${e}`);
        await page.close();
      }
    }
  } finally {
    await browser?.close();
  }
  console.log(`\n${issues === 0 ? "✓ no overflow / page errors / console errors on any route×viewport" : `✗ ${issues} route×viewport(s) flagged`}`);
  console.log(`Screenshots (full-page): ${REPORT_DIR}`);
  return issues === 0 ? 0 : 1;
}

run().then((c) => process.exit(c)).catch((e) => { console.error("visual-audit crashed:", e); process.exit(1); });
