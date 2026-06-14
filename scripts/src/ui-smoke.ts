```ts id="ui-smoke-test-playwright"

import { chromium, type Browser, type Page, type ConsoleMessage } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/* ===============================
   CONFIG (HARD MVP DEFAULTS)
=============================== */

const BASE_URL = (process.env["BASE_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
const REPORT_DIR =
  process.env["REPORT_DIR"] ??
  join(process.cwd(), ".self-test", "ui");

const TIMEOUT_NAV = 30_000;
const TIMEOUT_ASSERT = 15_000;
const VIEWPORT = { width: 1280, height: 800 } as const;

/* ===============================
   ROUTE CONTRACT (APP SHELL INVARIANT)
=============================== */

interface RouteCheck {
  path: string;
  expect: string;
  label: string;
}

const ROUTES: RouteCheck[] = [
  { path: "/", expect: 'textarea[aria-label="Message"]', label: "Chat composer" },
  { path: "/swarm", expect: "text=Chat", label: "Swarm shell" },
  { path: "/agents", expect: "text=AGENTS", label: "Agents page" },
  { path: "/tasks", expect: "text=TASK QUEUE", label: "Tasks page" },
  { path: "/cron", expect: "text=Cron Scheduler", label: "Cron page" },
  { path: "/settings", expect: "text=Chat", label: "Settings shell" },
];

/* ===============================
   RESULT MODEL
=============================== */

interface RouteResult {
  path: string;
  ok: boolean;
  title: string;
  detail: string;
  pageErrors: string[];
  consoleErrors: string[];
  screenshot: string;
}

/* ===============================
   HELPERS
=============================== */

async function attachDiagnostics(page: Page, store: RouteResult) {
  page.on("pageerror", (err) => {
    store.pageErrors.push(String(err).slice(0, 400));
  });

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      store.consoleErrors.push(msg.text().slice(0, 400));
    }
  });
}

async function safeScreenshot(page: Page, path: string) {
  try {
    await page.screenshot({ path, fullPage: false });
  } catch {
    // never fail test due to screenshot
  }
}

/* ===============================
   CORE ROUTE EXECUTION
=============================== */

async function runRoute(browser: Browser, route: RouteCheck): Promise<RouteResult> {
  const page = await browser.newPage({ viewport: VIEWPORT });

  const result: RouteResult = {
    path: route.path,
    ok: false,
    title: "",
    detail: "",
    pageErrors: [],
    consoleErrors: [],
    screenshot: "",
  };

  await attachDiagnostics(page, result);

  const shotName =
    route.path === "/"
      ? "root.png"
      : `${route.path.replace(/\//g, "_")}.png`;

  result.screenshot = join(REPORT_DIR, shotName);

  try {
    await page.goto(`${BASE_URL}${route.path}`, {
      waitUntil: "networkidle",
      timeout: TIMEOUT_NAV,
    });

    const locator = page.locator(route.expect).first();
    await locator.waitFor({ state: "visible", timeout: TIMEOUT_ASSERT });

    result.title = await page.title();

    result.ok = result.pageErrors.length === 0;

    result.detail = result.ok
      ? `rendered: ${route.label}`
      : `rendered with ${result.pageErrors.length} runtime error(s)`;

  } catch (e: any) {
    result.detail = `FAILED: ${String(e?.message ?? e).slice(0, 300)}`;
  }

  await safeScreenshot(page, result.screenshot);

  await page.close();

  return result;
}

/* ===============================
   TEST RUNNER
=============================== */

export async function run(): Promise<number> {
  mkdirSync(REPORT_DIR, { recursive: true });

  let browser: Browser | null = null;
  const results: RouteResult[] = [];

  try {
    browser = await chromium.launch({
      headless: true,
    });

    for (const route of ROUTES) {
      const res = await runRoute(browser, route);
      results.push(res);
    }
  } finally {
    await browser?.close();
  }

  /* ===============================
     REPORTING (HARD TRUTH OUTPUT)
  =============================== */

  const passed = results.filter((r) => r.ok).length;
  const allOk = passed === results.length;

  console.log(
    `\n=== UI SMOKE (${BASE_URL}) :: ${passed}/${results.length} PASSED ===`
  );

  for (const r of results) {
    console.log(
      `${r.ok ? "✓" : "✗"} ${r.path.padEnd(12)} ${r.detail} :: ${r.screenshot}`
    );

    if (r.pageErrors.length) {
      console.log(`   pageerrors: ${r.pageErrors.slice(0, 2).join(" | ")}`);
    }

    if (r.consoleErrors.length) {
      console.log(`   consoleerr: ${r.consoleErrors.slice(0, 2).join(" | ")}`);
    }
  }

  if (process.env["SELF_TEST_JSON"]) {
    console.log(
      "\nJSON_RESULT=" +
        JSON.stringify({
          baseUrl: BASE_URL,
          passed,
          total: results.length,
          allOk,
          results,
        })
    );
  }

  return allOk ? 0 : 1;
}

/* ===============================
   ENTRYPOINT
=============================== */

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("[UI_SMOKE_FATAL]", err);
    process.exit(1);
  });
```
