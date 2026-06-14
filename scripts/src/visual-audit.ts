
import { chromium, type Browser, type ConsoleMessage } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/* ===============================
   CONFIG
=============================== */

const BASE_URL = (process.env["BASE_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
const REPORT_DIR =
  process.env["REPORT_DIR"] ??
  join(process.cwd(), ".self-test", "audit");

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

const ROUTES = ["/", "/swarm", "/agents", "/tasks", "/cron", "/settings"];

/* ===============================
   TYPES
=============================== */

interface AuditResult {
  route: string;
  viewport: string;
  overflow: boolean;
  pageErrors: string[];
  consoleErrors: string[];
  screenshot: string;
}

/* ===============================
   HELPERS
=============================== */

function routeSafe(route: string) {
  return route === "/" ? "root" : route.replace(/\//g, "");
}

async function detectOverflow(page: any) {
  return await page.evaluate(() => {
    const w = window.innerWidth;
    const sw = document.documentElement.scrollWidth;
    return sw - w > 1;
  });
}

/* ===============================
   CORE AUDIT RUN
=============================== */

async function run(): Promise<number> {
  mkdirSync(REPORT_DIR, { recursive: true });

  let browser: Browser | null = null;
  const results: AuditResult[] = [];
  let issues = 0;

  try {
    browser = await chromium.launch({ headless: true });

    for (const vp of VIEWPORTS) {
      for (const route of ROUTES) {
        const page = await browser.newPage({
          viewport: { width: vp.width, height: vp.height },
          ignoreHTTPSErrors: true,
        });

        const pageErrors: string[] = [];
        const consoleErrors: string[] = [];

        page.on("pageerror", (e) => {
          pageErrors.push(String(e).slice(0, 250));
        });

        page.on("console", (m: ConsoleMessage) => {
          if (m.type() === "error") {
            const t = m.text();
            if (!t.includes("ERR_CERT_AUTHORITY_INVALID")) {
              consoleErrors.push(t.slice(0, 250));
            }
          }
        });

        const fileBase = `${vp.name}-${routeSafe(route)}.png`;
        const screenshotPath = join(REPORT_DIR, fileBase);

        let overflow = false;

        try {
          await page.goto(`${BASE_URL}${route}`, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });

          await page.waitForTimeout(1500);

          overflow = await detectOverflow(page);

          await page.screenshot({
            path: screenshotPath,
            fullPage: true,
          });
        } catch (e: any) {
          pageErrors.push(`NAV_FAIL: ${String(e?.message ?? e).slice(0, 150)}`);
        }

        const hasIssue =
          overflow || pageErrors.length > 0 || consoleErrors.length > 0;

        if (hasIssue) issues++;

        results.push({
          route,
          viewport: vp.name,
          overflow,
          pageErrors,
          consoleErrors,
          screenshot: screenshotPath,
        });

        const flags = [
          overflow ? "OVERFLOW" : "",
          pageErrors.length ? `pageerr(${pageErrors.length})` : "",
          consoleErrors.length ? `console(${consoleErrors.length})` : "",
        ]
          .filter(Boolean)
          .join(" ");

        console.log(
          ` ${hasIssue ? "✗" : "✓"} ${vp.name.padEnd(8)} ${route.padEnd(
            10
          )} ${flags}`
        );

        await page.close();
      }
    }
  } finally {
    await browser?.close();
  }

  /* ===============================
     SUMMARY
  =============================== */

  console.log(
    `\n${
      issues === 0
        ? "✓ VISUAL AUDIT CLEAN (no overflow / console / page errors)"
        : `✗ VISUAL AUDIT FAILED (${issues} issues)`
    }`
  );

  console.log(`Screenshots: ${REPORT_DIR}`);

  return issues === 0 ? 0 : 1;
}

/* ===============================
   ENTRYPOINT
=============================== */

run()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error("visual-audit crashed:", e);
    process.exit(1);
  });
