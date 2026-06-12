/**
 * render-set-env.ts
 *
 * Pushes provided API keys to the bos-aura Render service via the Render API and
 * triggers a redeploy. PRESERVES every existing env var on Render — it only
 * overwrites the managed keys that are actually present in the local environment,
 * so nothing already configured is ever wiped.
 *
 * The ONLY hard requirement is RENDER_API_KEY. Every integration key is
 * push-if-present, so the script never fails just because one isn't set locally
 * (e.g. you're only rotating OPENROUTER_API_KEY).
 *
 * Usage:
 *   RENDER_API_KEY=<key> OPENROUTER_API_KEY=<key> [GEMINI_API_KEY=… …] \
 *     pnpm --filter @workspace/scripts run render:set-env
 *
 * Optional: RENDER_SERVICE_ID to target a different service.
 */

const SERVICE_ID = process.env["RENDER_SERVICE_ID"] || "srv-d8hmeunlk1mc73faoh90";
const RENDER_API = "https://api.render.com/v1";

// Every env var the app understands. Pushed only when present locally; anything
// not set locally keeps its current value on Render (never wiped).
const MANAGED_KEYS = [
  "OPENROUTER_API_KEY",
  "NVIDIA_API_KEY",
  "STEEL_API_KEY",
  "FIRECRAWL_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "COMPOSIO_API_KEY",
  "COMPOSIO_BASE_URL",
  "ALLOW_COMPOSIO_EXECUTE",
  "HELICONE_API_KEY",
  "LANGSMITH_API_KEY",
  "LANGCHAIN_API_KEY",
  "LANGSMITH_PROJECT",
  "TAVILY_API_KEY",
  "EXA_API_KEY",
  "EMBEDDINGS_API_KEY",
  "EMBEDDINGS_BASE_URL",
  "EMBEDDINGS_MODEL",
  "PINECONE_API_KEY",
  "PINECONE_INDEX",
  "PINECONE_INDEX_HOST",
  "PINECONE_NAMESPACE",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "E2B_API_KEY",
  "SANDBOX_GITHUB_TOKEN",
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
  requireEnv("RENDER_API_KEY");

  console.log(`Fetching current env vars for service ${SERVICE_ID}…`);
  const current = (await renderFetch(`/services/${SERVICE_ID}/env-vars`)) as Array<{
    envVar: { key: string; value: string };
  }>;

  const existing: Record<string, string> = {};
  for (const entry of current) existing[entry.envVar.key] = entry.envVar.value;
  console.log("Existing keys on Render:", Object.keys(existing).join(", ") || "(none)");

  // Push every managed key that is present locally; preserve the rest.
  const updates: Record<string, string> = {};
  const pushed: string[] = [];
  for (const key of MANAGED_KEYS) {
    const val = process.env[key];
    if (val) {
      updates[key] = val;
      pushed.push(key);
    }
  }
  if (!pushed.length) {
    throw new Error(
      "No managed keys present in the local environment to push. Set at least one (e.g. OPENROUTER_API_KEY) alongside RENDER_API_KEY.",
    );
  }

  const merged = { ...existing, ...updates };
  const payload = Object.entries(merged).map(([key, value]) => ({ key, value }));

  console.log(`Updating ${payload.length} env vars (overwriting/adding: ${pushed.join(", ")})…`);
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
  console.log("Monitor at https://dashboard.render.com/web/" + SERVICE_ID);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
