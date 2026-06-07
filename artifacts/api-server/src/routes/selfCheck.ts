/**
 * Runtime self-check — GET /api/self-check
 *
 * Proves ONLY what the server can directly observe in-process: tool-registry
 * integrity, the agent roster, the SSRF guard, integration status, and DB
 * reachability. It deliberately does NOT inspect the repository, run a build, or
 * validate the UI — the runtime/agent sandbox cannot see those, and claiming
 * otherwise would be hallucination (see docs/anti-hallucination/).
 *
 * This is the honest counterpart to the dev/CI self-test harness
 * (scripts/src/self-test.ts), which DOES cover build/tests/UI from the real repo.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { agentsTable } from "@workspace/db";
import { TOOL_REGISTRY, AGENT_TOOLS, ssrfGuard } from "../tools";
import { integrationStatus } from "../lib/integrations";

const router = Router();

const REQUIRED_TOOLS = [
  "web_search", "web_scrape", "web_screenshot", "http_request", "code_exec",
  "cloud_code_exec", "memory_write", "memory_search", "social_api",
  "social_accounts", "calculator", "send_message", "vault_list",
];
const REQUIRED_AGENTS = [1, 2, 3, 4, 5, 6]; // ABBY, FORGE, CRAWLER, VAULT, WIRE, MR.NICE

router.get("/self-check", async (_req, res) => {
  const checks: Array<Record<string, unknown>> = [];

  // 1. Tool registry integrity: each required tool has schema + handler + assignment.
  const assigned = new Set<string>();
  for (const list of Object.values(AGENT_TOOLS)) for (const t of list) assigned.add(t);
  const toolMatrix = REQUIRED_TOOLS.map((name) => {
    const def = TOOL_REGISTRY[name];
    const schema = !!def && typeof def.parameters === "object";
    const handler = !!def && typeof def.run === "function";
    const inRouter = !!def; // runTool dispatches via TOOL_REGISTRY — presence = routed
    const agent = assigned.has(name);
    return { tool: name, exists: !!def, schema, handler, router: inRouter, agent, ok: !!def && schema && handler && agent };
  });
  checks.push({
    name: "tool_registry_integrity",
    ok: toolMatrix.every((t) => t.ok),
    detail: `${toolMatrix.filter((t) => t.ok).length}/${toolMatrix.length} required tools fully wired (schema+handler+router+agent)`,
    matrix: toolMatrix,
  });

  // 2. Agent roster present in DB.
  let presentIds: number[] = [];
  try {
    const rows = await db.select({ id: agentsTable.id }).from(agentsTable);
    presentIds = rows.map((r) => r.id);
  } catch { /* db check covered below */ }
  checks.push({
    name: "agent_roster",
    ok: REQUIRED_AGENTS.every((id) => presentIds.includes(id)),
    detail: `${REQUIRED_AGENTS.filter((id) => presentIds.includes(id)).length}/${REQUIRED_AGENTS.length} required agents seeded`,
  });

  // 3. SSRF guard blocks internal targets.
  const targets = ["http://127.0.0.1", "http://169.254.169.254", "http://10.0.0.1", "http://192.168.0.1", "http://0.0.0.0"];
  const ssrf = await Promise.all(targets.map(async (url) => ({ url, blocked: (await ssrfGuard(url)) !== null })));
  checks.push({
    name: "ssrf_guard",
    ok: ssrf.every((s) => s.blocked),
    detail: `${ssrf.filter((s) => s.blocked).length}/${ssrf.length} internal targets blocked`,
    targets: ssrf,
  });

  // 4. Integration status (booleans only).
  const integ = integrationStatus();
  checks.push({
    name: "integrations",
    ok: true,
    detail: `${integ.filter((i) => i.configured).length}/${integ.length} configured`,
    integrations: integ.map((i) => ({ key: i.key, configured: i.configured })),
  });

  // 5. Database reachability.
  let dbOk = false;
  try { await db.select({ id: agentsTable.id }).from(agentsTable).limit(1); dbOk = true; } catch { /* */ }
  checks.push({ name: "database", ok: dbOk, detail: dbOk ? "reachable" : "unreachable" });

  const verdict = checks.every((c) => c.ok) ? "PASS" : "PARTIAL";
  res.json({
    verdict,
    generatedAt: new Date().toISOString(),
    scope: "Runtime self-check — observes only what the server can prove in-process. Does NOT inspect the repo, build, or UI (the agent sandbox cannot see those). For build/tests/UI evidence use the dev self-test harness.",
    checks,
  });
});

export default router;
