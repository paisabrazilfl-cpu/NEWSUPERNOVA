import { chromium, type ConsoleMessage } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Focused live-site validation against production. Loads the app in desktop AND
// mobile viewports, records console/page errors and failed requests, checks the
// page actually rendered (not a blank/crash screen), and captures screenshots.
const BASE = (process.env["AUDIT_URL"] ?? "https://supernova.onrender.com").replace(/\/$/, "");
const OUT = join(process.cwd(), ".self-test", "live");
mkdirSync(OUT, { recursive: true });

interface ViewportSpec { name: string; width: number; height: number; isMobile: boolean }
const VIEWPORTS: ViewportSpec[] = [
  { name: "desktop", width: 1440, height: 900, isMobile: false },
  { name: "tablet", width: 768, height: 1024, isMobile: false },
  { name: "mobile", width: 390, height: 844, isMobile: true },
];

async function run() {
  const browser = await chromium.launch();
  const summary: Record<string, unknown>[] = [];

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
      // The sandbox network presents a proxy cert Chromium doesn't trust (curl, which
      // uses the system CA, reaches the live site fine). Ignore TLS so the audit can
      // actually load the production page.
      ignoreHTTPSErrors: true,
      userAgent: vp.isMobile
        ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        : undefined,
    });
    const page = await ctx.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedReq: string[] = [];
    page.on("console", (m: ConsoleMessage) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 200)));
    page.on("requestfailed", (r) => failedReq.push(`${r.method()} ${r.url().slice(0, 100)} — ${r.failure()?.errorText ?? "?"}`));

    let status = 0;
    let title = "";
    let bodyLen = 0;
    let bodyText = "";
    let rootChildren = 0;
    let overflow = -1;
    try {
      const resp = await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45_000 });
      status = resp?.status() ?? 0;
      // Give the SPA a beat to hydrate.
      await page.waitForTimeout(2500);
      title = await page.title();
      bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
      bodyLen = bodyText.length;
      rootChildren = await page.locator("#root > *, [id=root] > *").count().catch(() => 0);
      // Horizontal overflow = a non-responsive element wider than the viewport
      // (the classic "scrolls sideways on mobile" bug). scrollWidth must not exceed
      // the visible clientWidth (allow 2px for sub-pixel rounding).
      overflow = await page.evaluate(() => {
        // runs in the browser; scripts tsconfig has no DOM lib, so reach document via globalThis.
        const d = (globalThis as unknown as { document: { documentElement: { scrollWidth: number; clientWidth: number } } }).document;
        return d.documentElement.scrollWidth - d.documentElement.clientWidth;
      }).catch(() => -1);
    } catch (e) {
      pageErrors.push(`navigation: ${String(e).slice(0, 200)}`);
    }

    const shot = join(OUT, `${vp.name}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

    summary.push({
      viewport: vp.name,
      status,
      title,
      bodyTextChars: bodyLen,
      rootMounted: rootChildren > 0,
      horizontalOverflowPx: overflow,
      responsiveOK: overflow <= 2,
      bodyPreview: bodyText.replace(/\s+/g, " ").slice(0, 240),
      consoleErrors: consoleErrors.slice(0, 8),
      pageErrors: pageErrors.slice(0, 8),
      failedRequests: failedReq.slice(0, 8),
      screenshot: shot,
    });
    await ctx.close();
  }

  await browser.close();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ base: BASE, results: summary }, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
