/**
 * Self-test harness — the automatable subset of the agent self-test phases.
 *
 * Runs the static gates always (typecheck, api build, api tests). If BASE_URL is
 * set (a server is running), it also runs the runtime gates (key endpoints) and
 * the Playwright UI smoke. Emits the Verdict format + an Execution Trace to
 * .self-test/report.json. Evidence only: a gate is PASS solely when its command
 * exits 0 / its check actually succeeded. Nothing is assumed.
 *
 *   pnpm --filter @workspace/scripts run self-test
 *   BASE_URL=http://localhost:3001 pnpm --filter @workspace/scripts run self-test
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

type Status = "PASS" | "FAIL" | "NOT RUN";
interface Gate { name: string; status: Status; detail: string; }

const trace: { cmd: string; code: number | null }[] = [];
const gates: Gate[] = [];

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}
const ROOT = repoRoot();

function sh(cmd: string, args: string[]): { code: number | null; out: string } {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", env: process.env });
  trace.push({ cmd: `${cmd} ${args.join(" ")}`, code: r.status });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function gate(name: string, cmd: string, args: string[], passDetail = "ok") {
  const { code, out } = sh(cmd, args);
  const ok = code === 0;
  // Pull a useful summary line (e.g. vitest "Tests  52 passed").
  const summary = (out.match(/Tests\s+\d+ passed[^\n]*/) ?? out.match(/built in[^\n]*/) ?? [])[0];
  gates.push({ name, status: ok ? "PASS" : "FAIL", detail: ok ? (summary ?? passDetail) : `exit ${code}: ${out.trim().split("\n").slice(-3).join(" ").slice(0, 240)}` });
}

async function endpoint(name: string, path: string, check: (status: number, body: string) => boolean) {
  const base = process.env["BASE_URL"]!.replace(/\/$/, "");
  try {
    const r = await fetch(`${base}${path}`);
    const body = await r.text();
    const ok = check(r.status, body);
    trace.push({ cmd: `GET ${path}`, code: r.status });
    gates.push({ name, status: ok ? "PASS" : "FAIL", detail: `HTTP ${r.status}` });
  } catch (e) {
    gates.push({ name, status: "FAIL", detail: String(e).slice(0, 160) });
  }
}

async function main() {
  // ── Static gates (always) ──
  gate("typecheck", "pnpm", ["run", "typecheck"]);
  gate("build:api", "pnpm", ["--filter", "@workspace/api-server", "run", "build"]);
  gate("test:api", "pnpm", ["--filter", "@workspace/api-server", "run", "test"]);

  // ── Runtime + UI gates (only when a server is running) ──
  const base = process.env["BASE_URL"];
  if (base) {
    // /api/healthz is the real JSON health endpoint. In production "/" serves
    // the SPA (the static frontend), not the health JSON.
    await endpoint("health", "/api/healthz", (s) => s === 200);
    await endpoint("integrations", "/api/integrations", (s, b) => s === 200 && b.includes("integrations"));
    await endpoint("channels", "/api/channels", (s) => s === 200);
    await endpoint("cron", "/api/cron", (s) => s === 200);
    await endpoint("openai-models", "/api/external/v1/models", (s, b) => s === 200 && b.includes("data"));
    await endpoint("self-check", "/api/self-check", (s, b) => s === 200 && b.includes('"verdict"'));
    const ui = sh("pnpm", ["--filter", "@workspace/scripts", "run", "ui-smoke"]);
    gates.push({ name: "ui-smoke (playwright)", status: ui.code === 0 ? "PASS" : "FAIL", detail: (ui.out.match(/\d+\/\d+ routes OK/) ?? ["see log"])[0] });
    const resp = sh("pnpm", ["--filter", "@workspace/scripts", "run", "responsive-check"]);
    gates.push({ name: "responsive (3 viewports)", status: resp.code === 0 ? "PASS" : "FAIL", detail: resp.out.includes("no horizontal overflow") ? "no overflow mobile/tablet/desktop" : "overflow detected" });
  } else {
    for (const n of ["health", "integrations", "channels", "cron", "openai-models", "ui-smoke (playwright)"])
      gates.push({ name: n, status: "NOT RUN", detail: "BASE_URL not set (no running server)" });
  }

  // ── Verdict ──
  const failed = gates.filter((g) => g.status === "FAIL");
  const notRun = gates.filter((g) => g.status === "NOT RUN");
  const verdict: Status | "PARTIAL" = failed.length ? "FAIL" : notRun.length ? "PARTIAL" : "PASS";

  const report = { verdict, timestamp: new Date().toISOString(), gates, trace };
  const dir = join(ROOT, ".self-test");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));

  console.log(`\n# Self-Test Report\n\nSTATUS: ${verdict}\n`);
  console.log("VERIFICATION:");
  for (const g of gates) console.log(`  ${g.status === "PASS" ? "✓" : g.status === "FAIL" ? "✗" : "•"} ${g.name.padEnd(22)} ${g.status.padEnd(8)} ${g.detail}`);
  if (failed.length) {
    console.log("\nFAILURES:");
    for (const g of failed) console.log(`  - ${g.name}: ${g.detail}`);
  }
  console.log(`\nExecution trace: ${trace.length} commands. Report: .self-test/report.json`);
  if (process.env["SELF_TEST_JSON"]) console.log("JSON_RESULT=" + JSON.stringify(report));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error("self-test crashed:", e); process.exit(1); });
