/**
 * browser_login — the credentialed browser fallback. These tests pin the
 * generated Playwright script (credentials referenced by vault NAME via
 * {{secret:…}}, never inlined; url/selectors/steps JSON-embedded so quotes can't
 * break it) and that the financial / government-ID guardrail still applies.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

import { buildBrowserLoginScript } from "./tools";
import { assessActionRisk } from "./lib/safetyPolicy";

describe("buildBrowserLoginScript", () => {
  const script = buildBrowserLoginScript({
    cdpUrl: "wss://connect.steel.dev?apiKey=SECRETKEY&sessionId=sess123",
    url: "https://example.com/login",
    userSecret: "MYSITE_EMAIL",
    passSecret: "MYSITE_PASSWORD",
    steps: 'page.goto("https://example.com/app"); print(page.title())',
  });

  it("references credentials by vault placeholder, never inlines a value", () => {
    expect(script).toContain("{{secret:MYSITE_EMAIL}}");
    expect(script).toContain("{{secret:MYSITE_PASSWORD}}");
  });

  it("injects creds via single-quoted env vars, not the page-script source", () => {
    expect(script).toContain("export BL_USER='{{secret:MYSITE_EMAIL}}'");
    expect(script).toContain("export BL_PASS='{{secret:MYSITE_PASSWORD}}'");
    expect(script).toContain('os.environ.get("BL_USER"');
  });

  it("connects to the remote Steel browser over CDP (no local chromium install)", () => {
    expect(script).toContain("connect_over_cdp(CDP)");
    expect(script).toContain("CDP = json.loads(");
    expect(script).not.toContain("playwright install chromium");
    expect(script).toContain("pip install playwright");
  });

  it("embeds url and steps as JSON so quotes can't break the script", () => {
    expect(script).toContain("URL = json.loads(");
    expect(script).toContain("STEPS = json.loads(");
    // A step containing quotes/backslashes must be embedded safely: the script
    // line is `STEPS = json.loads(<jsLiteral>)` where <jsLiteral> is a valid
    // double-encoded JSON string. The raw step text must NOT appear unescaped.
    const tricky = buildBrowserLoginScript({
      cdpUrl: "wss://connect.steel.dev?apiKey=K&sessionId=s",
      url: "https://x.test",
      userSecret: "U",
      passSecret: "P",
      steps: 'page.fill("input", "a\\"b")',
    });
    const line = tricky.split("\n").find((l) => l.startsWith("STEPS = json.loads("))!;
    const literal = line.slice("STEPS = json.loads(".length, -1);
    // The literal parses to the inner JSON string, which parses to the step text.
    expect(JSON.parse(JSON.parse(literal))).toBe('page.fill("input", "a\\"b")');
  });
});

describe("browser_login guardrail still applies to login targets/steps", () => {
  it("would block a financial-account-opening flow", () => {
    expect(assessActionRisk("https://bank.example/signup open a new bank account").blocked).toBe(true);
  });
  it("would block a government-ID submission step", () => {
    expect(assessActionRisk('page.fill("#ssn", "enter my social security number")').blocked).toBe(true);
  });
  it("allows an ordinary site login", () => {
    expect(assessActionRisk("https://news.example/login read my saved articles").blocked).toBe(false);
  });
});
