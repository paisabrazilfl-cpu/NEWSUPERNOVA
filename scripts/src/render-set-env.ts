/**
 * render-set-env.ts
 *
 * Pushes required API keys to the bos-aura Render service via the Render API.
 * Preserves all existing env vars — only adds/updates the keys listed in REQUIRED.
 *
 * Usage:
 *   RENDER_API_KEY=<key> pnpm --filter @workspace/scripts run render:set-env
 *
 * Required env vars (must be set in the local shell or Replit Secrets):
 *   RENDER_API_KEY       — Render API key (https://dashboard.render.com/u/settings)
 *   OPENROUTER_API_KEY   — OpenRouter API key
 *   STEEL_API_KEY        — Steel Dev Browser API key
 *   FIRECRAWL_API_KEY    — Firecrawl API key
 */

const SERVICE_ID = "srv-d8hmeunlk1mc73faoh90";
const RENDER_API = "https://api.render.com/v1";

const REQUIRED_KEYS = ["OPENROUTER_API_KEY", "STEEL_API_KEY", "FIRECRAWL_API_KEY"] as const;

// Optional integration keys — pushed only when present in the local environment,
// so the script never fails just because an integration isn't configured yet.
const OPTIONAL_KEYS = [
  "NEUROBUDDY_API_KEY",
  "BUDDY_API_KEY",
  "BUDDY_BASE_URL",
  "BUDDY_MODEL",
  "COMPOSIO_API_KEY",
  "COMPOSIO_BASE_URL",
  "ALLOW_COMPOSIO_EXECUTE",
  "HELICONE_API_KEY",
  "LANGSMITH_API_KEY",
  "LANGSMITH_PROJECT",
  "TAVILY_API_KEY",
  "EXA_API_KEY",
  "EMBEDDINGS_API_KEY",
  "EMBEDDINGS_BASE_URL",
  "EMBEDDINGS_MODEL",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "E2B_API_KEY",
] as const;

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

async function renderFetch(path: string, init?: RequestInit) {
  const renderApiKey = requireEnv("RENDER_API_KEY");
  const res = await fetch(`${RENDER_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${renderApiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Render API ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function main() {
  console.log(`Fetching current env vars for service ${SERVICE_ID}…`);
  const current = (await renderFetch(`/services/${SERVICE_ID}/env-vars`)) as Array<{
    envVar: { key: string; value: string };
  }>;

  const existing: Record<string, string> = {};
  for (const entry of current) {
    existing[entry.envVar.key] = entry.envVar.value;
  }
  console.log("Existing keys:", Object.keys(existing).join(", "));

  const updates: Record<string, string> = {};
  for (const key of REQUIRED_KEYS) {
    updates[key] = requireEnv(key);
  }
  // Add any optional integration keys that happen to be set locally.
  const includedOptional: string[] = [];
  for (const key of OPTIONAL_KEYS) {
    const val = process.env[key];
    if (val) {
      updates[key] = val;
      includedOptional.push(key);
    }
  }

  const merged = { ...existing, ...updates };
  const payload = Object.entries(merged).map(([key, value]) => ({ key, value }));

  const pushedKeys = [...REQUIRED_KEYS, ...includedOptional];
  console.log(`Updating ${payload.length} env vars (adding/overwriting: ${pushedKeys.join(", ")})…`);
  const result = (await renderFetch(`/services/${SERVICE_ID}/env-vars`, {
    method: "PUT",
    body: JSON.stringify(payload),
  })) as Array<{ envVar: { key: string } }>;

  console.log("Env vars now set:", result.map((e) => e.envVar.key).join(", "));

  console.log(`\nTriggering redeploy on ${SERVICE_ID}…`);
  const deploy = (await renderFetch(`/services/${SERVICE_ID}/deploys`, {
    method: "POST",
    body: JSON.stringify({ clearCache: "do_not_clear" }),
  })) as { id: string; status: string };

  console.log(`Deploy started: id=${deploy.id} status=${deploy.status}`);
  console.log("Done. Monitor progress at https://dashboard.render.com/web/srv-d8hmeunlk1mc73faoh90");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
