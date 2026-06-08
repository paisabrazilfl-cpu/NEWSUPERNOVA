/**
 * OPENCLAW OMEGA — Third-party integration layer.
 *
 * Every integration here is driven ENTIRELY by environment variables — no
 * secret is ever hardcoded. Each helper degrades gracefully: if its key is not
 * configured it either throws a clear, human-readable error (for tools the model
 * calls explicitly) or silently no-ops (for fire-and-forget observability).
 *
 * Wired here:
 *   - Helicone   — observability proxy in front of OpenRouter (LLM logging).
 *   - Tavily     — web search provider.
 *   - Exa        — neural web search provider.
 *   - Inngest    — durable event bus (fire-and-forget swarm events).
 *   - LangSmith  — LLM run tracing (fire-and-forget).
 *   - E2B        — cloud code-interpreter sandbox (optional SDK).
 *
 * SECURITY: keys are read from process.env at call time, never logged, never
 * returned to a model. Outbound bodies that may echo a key are not used here.
 */

import { randomUUID } from "node:crypto";
import { logger } from "./logger";

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s;
}

// ─── Helicone (OpenRouter observability proxy) ───────────────────────────────
// Helicone sits transparently in front of OpenRouter: same OpenAI-compatible
// API, but the base host changes and a Helicone-Auth header is added. When no
// Helicone key is configured we fall through to OpenRouter directly.

const OPENROUTER_DIRECT = "https://openrouter.ai/api/v1";
const OPENROUTER_VIA_HELICONE = "https://openrouter.helicone.ai/api/v1";

export function heliconeEnabled(): boolean {
  return !!process.env["HELICONE_API_KEY"];
}

/** The LLM base URL to use — Helicone proxy when configured, else OpenRouter. */
export function llmBaseUrl(): string {
  return heliconeEnabled() ? OPENROUTER_VIA_HELICONE : OPENROUTER_DIRECT;
}

/**
 * Extra headers that enable Helicone logging. Returns an empty object when
 * Helicone is not configured, so callers can always spread it safely.
 */
export function heliconeHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = process.env["HELICONE_API_KEY"];
  if (!key) return {};
  return {
    "Helicone-Auth": `Bearer ${key}`,
    "Helicone-Cache-Enabled": "false",
    ...extra,
  };
}

// ─── Tavily web search ───────────────────────────────────────────────────────

interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

function formatHits(provider: string, query: string, hits: SearchHit[]): string {
  if (!hits.length) return `no web results for "${query}" (via ${provider}).`;
  const body = hits
    .map((h, i) => `${i + 1}. ${h.title || "(untitled)"}\n   ${h.url}\n   ${clip(h.snippet.trim(), 300)}`)
    .join("\n\n");
  return `[search provider: ${provider}]\n${body}`;
}

/** Real web search via Tavily. Throws if TAVILY_API_KEY is unset or the call fails. */
export async function tavilySearch(query: string, limit: number): Promise<string> {
  const key = process.env["TAVILY_API_KEY"];
  if (!key) throw new Error("TAVILY_API_KEY is not set");
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      max_results: limit,
      search_depth: "basic",
      include_answer: false,
    }),
  });
  if (!r.ok) throw new Error(`Tavily ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = (await r.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  const hits: SearchHit[] = (data.results ?? []).map((x) => ({
    title: x.title ?? "",
    url: x.url ?? "",
    snippet: x.content ?? "",
  }));
  return formatHits("tavily", query, hits);
}

// ─── Exa neural web search ───────────────────────────────────────────────────

/** Real web search via Exa. Throws if EXA_API_KEY is unset or the call fails. */
export async function exaSearch(query: string, limit: number): Promise<string> {
  const key = process.env["EXA_API_KEY"];
  if (!key) throw new Error("EXA_API_KEY is not set");
  const r = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "x-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      numResults: limit,
      type: "auto",
      contents: { text: { maxCharacters: 600 } },
    }),
  });
  if (!r.ok) throw new Error(`Exa ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = (await r.json()) as {
    results?: Array<{ title?: string; url?: string; text?: string }>;
  };
  const hits: SearchHit[] = (data.results ?? []).map((x) => ({
    title: x.title ?? "",
    url: x.url ?? "",
    snippet: x.text ?? "",
  }));
  return formatHits("exa", query, hits);
}

// ─── Inngest (durable event bus) ─────────────────────────────────────────────
// Send an event to Inngest's ingestion endpoint. The event KEY is the trailing
// path segment of the webhook URL Inngest gives you (https://inn.gs/e/<KEY>).
// Fire-and-forget: failures are logged at debug and never bubble up — emitting
// telemetry must never break the swarm.

export async function sendInngestEvent(
  name: string,
  data: Record<string, unknown>,
): Promise<void> {
  const key = process.env["INNGEST_EVENT_KEY"];
  if (!key) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(`https://inn.gs/e/${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data, ts: Date.now() }),
        signal: ctrl.signal,
      });
      if (!r.ok) {
        logger.debug({ status: r.status, event: name }, "inngest: event rejected");
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.debug({ err, event: name }, "inngest: event send failed");
  }
}

// ─── LangSmith (LLM run tracing) ─────────────────────────────────────────────
// Post a single completed LLM run to LangSmith. Fire-and-forget — tracing must
// never affect request latency or break a completion. Enabled when a LangSmith
// (a.k.a. LangChain) API key is present and tracing isn't explicitly disabled.

function langsmithEnabled(): boolean {
  const key = process.env["LANGSMITH_API_KEY"] ?? process.env["LANGCHAIN_API_KEY"];
  if (!key) return false;
  const flag = (process.env["LANGSMITH_TRACING"] ?? process.env["LANGCHAIN_TRACING_V2"] ?? "true").toLowerCase();
  return flag !== "false" && flag !== "0";
}

/** Microsecond, sortable timestamp prefix LangSmith uses for run ordering. */
function dottedTime(d: Date): string {
  const iso = d.toISOString(); // 2026-06-06T12:34:56.789Z
  const [date, time] = iso.replace("Z", "").split("T");
  const [hms, ms = "000"] = time.split(".");
  return `${date.replace(/-/g, "")}T${hms.replace(/:/g, "")}${ms.padEnd(3, "0")}000Z`;
}

export interface LlmTrace {
  name: string;
  model: string;
  input: unknown;
  output: unknown;
  startedAt: Date;
  endedAt?: Date;
  error?: string;
  metadata?: Record<string, unknown>;
}

export function traceLlmRun(trace: LlmTrace): void {
  if (!langsmithEnabled()) return;
  // Detach fully — do not await, do not let rejection surface.
  void (async () => {
    try {
      const key = (process.env["LANGSMITH_API_KEY"] ?? process.env["LANGCHAIN_API_KEY"])!;
      const endpoint =
        process.env["LANGSMITH_ENDPOINT"] ?? process.env["LANGCHAIN_ENDPOINT"] ?? "https://api.smith.langchain.com";
      const project = process.env["LANGSMITH_PROJECT"] ?? process.env["LANGCHAIN_PROJECT"] ?? "openclaw-omega";
      const id = randomUUID();
      const start = trace.startedAt;
      const end = trace.endedAt ?? new Date();
      const body = {
        id,
        trace_id: id,
        dotted_order: `${dottedTime(start)}${id}`,
        name: trace.name,
        run_type: "llm",
        session_name: project,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        inputs: { input: trace.input },
        outputs: trace.error ? undefined : { output: trace.output },
        error: trace.error,
        extra: { metadata: { model: trace.model, ...(trace.metadata ?? {}) } },
      };
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      try {
        const r = await fetch(`${endpoint.replace(/\/$/, "")}/runs`, {
          method: "POST",
          headers: { "x-api-key": key, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!r.ok) logger.debug({ status: r.status }, "langsmith: run rejected");
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      logger.debug({ err }, "langsmith: trace failed");
    }
  })();
}

// ─── E2B (cloud code-interpreter sandbox) ────────────────────────────────────
// Runs code in a fully isolated remote sandbox via E2B. The SDK is loaded with a
// runtime dynamic import so the package is OPTIONAL — if it isn't installed the
// tool reports that clearly instead of crashing the build/server. Install with:
//   pnpm --filter @workspace/api-server add @e2b/code-interpreter

export function e2bConfigured(): boolean {
  return !!process.env["E2B_API_KEY"];
}

const E2B_PKG = "@e2b/code-interpreter";
const E2B_TIMEOUT_MS = 30000;

export async function e2bExec(language: string, source: string): Promise<string> {
  const apiKey = process.env["E2B_API_KEY"];
  if (!apiKey) return "error: E2B_API_KEY is not set — cloud sandbox is unavailable.";

  // Casting the specifier to a plain string keeps tsc/esbuild from hard-resolving
  // this OPTIONAL dependency at build time — it stays a pure runtime import.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mod: any;
  try {
    mod = await import(E2B_PKG as string);
  } catch {
    return `error: the E2B SDK (${E2B_PKG}) is not installed on the server. Install it to enable cloud_code_exec.`;
  }
  const Sandbox = mod?.Sandbox;
  if (!Sandbox || typeof Sandbox.create !== "function") {
    return "error: E2B SDK loaded but no Sandbox export was found.";
  }

  const lang = language.toLowerCase();
  const e2bLanguage = lang === "javascript" || lang === "js" || lang === "node" ? "js" : "python";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sandbox: any;
  try {
    sandbox = await Sandbox.create({ apiKey, timeoutMs: E2B_TIMEOUT_MS });
    const execution = (await sandbox.runCode(source, { language: e2bLanguage })) as {
      logs?: { stdout?: string[]; stderr?: string[] };
      error?: { name?: string; value?: string; traceback?: string } | null;
      text?: string;
    };
    const stdout = (execution.logs?.stdout ?? []).join("");
    const stderr = (execution.logs?.stderr ?? []).join("");
    const parts: string[] = ["[e2b cloud sandbox]"];
    if (stdout) parts.push(`stdout:\n${clip(stdout.trim(), 4000)}`);
    if (stderr) parts.push(`stderr:\n${clip(stderr.trim(), 4000)}`);
    if (execution.error) {
      parts.push(`error: ${execution.error.name ?? ""} ${execution.error.value ?? ""}`.trim());
    }
    if (execution.text && !stdout) parts.push(`result:\n${clip(execution.text.trim(), 4000)}`);
    if (parts.length === 1) parts.push("(no output)");
    return parts.join("\n");
  } catch (err) {
    return `error: E2B execution failed: ${String(err).slice(0, 300)}`;
  } finally {
    try {
      await sandbox?.kill();
    } catch {
      /* best-effort cleanup */
    }
  }
}

// ─── Composio (authenticated SaaS/API tool router) ───────────────────────────
// Executes authenticated actions across connected SaaS apps (Gmail, Slack,
// GitHub, Notion, …) via Composio. Gated by ALLOW_COMPOSIO_EXECUTE so it can't
// fire external writes until the operator explicitly enables it.

export function composioConfigured(): boolean {
  return !!process.env["COMPOSIO_API_KEY"];
}

export function composioExecuteEnabled(): boolean {
  const v = process.env["ALLOW_COMPOSIO_EXECUTE"];
  return v != null && ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export async function composioExecute(input: {
  endpoint?: string;
  method?: string;
  body?: unknown;
  parameters?: unknown;
  toolkit?: string;
  action?: string;
  arguments?: Record<string, unknown>;
  connectedAccountId?: string;
  userId?: string;
}): Promise<string> {
  const key = process.env["COMPOSIO_API_KEY"];
  if (!key) return "error: COMPOSIO_API_KEY is not set.";
  const base = (process.env["COMPOSIO_BASE_URL"] ?? "https://backend.composio.dev/api/v3.1").replace(/\/$/, "");

  // Auto-resolve the connected account for the toolkit when the caller didn't
  // pass one — agents know the app ('instagram'), not the ca_… id.
  let accId = input.connectedAccountId;
  if (!accId && input.toolkit) {
    try {
      const conns = await composioListConnections();
      const t = input.toolkit.toLowerCase();
      accId =
        (conns.find((c) => c.toolkit.toLowerCase() === t && /ACTIVE|CONNECTED|ENABLED/i.test(c.status)) ??
          conns.find((c) => c.toolkit.toLowerCase() === t))?.id;
    } catch { /* Composio returns a clear error below if the account is missing */ }
  }

  // Two execution modes, each with Composio's real v3 contract (snake_case):
  //  - NAMED action:  POST /tools/execute/{TOOL_SLUG}  { arguments, connected_account_id }
  //  - RAW proxy:     POST /tools/execute/proxy        { endpoint, method, connected_account_id, parameters }
  let url: string;
  let payload: Record<string, unknown>;
  if (input.action) {
    url = `${base}/tools/execute/${encodeURIComponent(input.action)}`;
    payload = {
      arguments: input.arguments ?? {},
      ...(accId ? { connected_account_id: accId } : {}),
      ...(input.userId ? { user_id: input.userId } : {}),
    };
  } else if (input.endpoint && input.method) {
    url = `${base}/tools/execute/proxy`;
    // Composio's proxy takes a `parameters` array ({name,value,type}). Agents
    // naturally pass key/value via `arguments` (e.g. image_url, caption) — convert
    // those into query parameters so they actually reach the app's API. Without
    // this they were silently dropped (IG: "The parameter image_url is required").
    let parameters: Array<Record<string, unknown>> | undefined = Array.isArray(input.parameters)
      ? (input.parameters as Array<Record<string, unknown>>)
      : undefined;
    if (!parameters && input.arguments && Object.keys(input.arguments).length) {
      parameters = Object.entries(input.arguments).map(([name, value]) => ({
        name,
        value: typeof value === "string" ? value : JSON.stringify(value),
        type: "query",
      }));
    }
    payload = {
      endpoint: input.endpoint,
      method: input.method.toUpperCase(),
      ...(accId ? { connected_account_id: accId } : {}),
      ...(parameters ? { parameters } : {}),
      ...(input.body != null ? { body: input.body } : {}),
    };
  } else {
    return "error: composio_action needs an `action` (tool slug like INSTAGRAM_LIST_POSTS), OR an `endpoint`+`method` for a raw proxy call (e.g. endpoint:'/me/media', method:'GET').";
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await r.text();
    return `Composio → HTTP ${r.status} ${r.statusText}\n${cleanComposioBody(text)}`;
  } catch (err) {
    return `error: Composio call failed: ${String(err).slice(0, 300)}`;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Composio's proxy wraps the app payload as { data, status, headers } where
 * `headers` is a huge block of proxy-status tokens / fb-debug noise. Strip it so
 * the agent (and the operator) see just the real data — cleaner output, fewer
 * tokens, no confusing junk. Also surface the inner upstream status when present.
 */
function cleanComposioBody(text: string): string {
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    if (j && typeof j === "object" && "headers" in j) {
      const { headers: _omit, ...rest } = j;
      void _omit;
      return clip(JSON.stringify(rest), 4000);
    }
    return clip(JSON.stringify(j), 4000);
  } catch {
    return clip(text, 4000);
  }
}

// ─── Composio connection management (connect apps via OAuth) ─────────────────
// The execution path above can only act on accounts that are ALREADY connected.
// These helpers drive the connection itself: list available apps, find-or-create
// a Composio-managed auth config for an app, initiate a connection (returns the
// OAuth authorize URL the operator approves), and read connection status. This
// turns "wire it up by hand in the Composio dashboard" into a one-click flow.

function composioBase(): string {
  return (process.env["COMPOSIO_BASE_URL"] ?? "https://backend.composio.dev/api/v3.1").replace(/\/$/, "");
}

/** Authenticated call to the Composio management API. Returns parsed JSON or throws. */
async function composioApi(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const key = process.env["COMPOSIO_API_KEY"];
  if (!key) throw new Error("COMPOSIO_API_KEY is not set");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(`${composioBase()}${path.startsWith("/") ? path : `/${path}`}`, {
      method,
      headers: { "x-api-key": key, "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    if (!r.ok) {
      const msg = (data as { error?: { message?: string }; message?: string })?.error?.message
        ?? (data as { message?: string })?.message
        ?? text.slice(0, 200);
      throw new Error(`Composio ${r.status}: ${msg}`);
    }
    return (data as Record<string, unknown>) ?? {};
  } finally {
    clearTimeout(timer);
  }
}

export interface ComposioToolkit {
  slug: string;
  name: string;
  logo?: string;
  authSchemes: string[];
  composioManagedAuthSchemes: string[];
  noAuth: boolean;
}

/** List available toolkits (apps), optionally filtered by a search string. */
export async function composioListToolkits(search?: string, limit = 50): Promise<ComposioToolkit[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (search) params.set("search", search);
  const data = await composioApi("GET", `/toolkits?${params.toString()}`);
  const items = (data["items"] as Array<Record<string, unknown>>) ?? [];
  return items.map((t) => {
    const meta = (t["meta"] as Record<string, unknown>) ?? {};
    return {
      slug: String(t["slug"] ?? ""),
      name: String(t["name"] ?? t["slug"] ?? ""),
      logo: meta["logo"] != null ? String(meta["logo"]) : undefined,
      authSchemes: (t["auth_schemes"] as string[]) ?? [],
      composioManagedAuthSchemes: (t["composio_managed_auth_schemes"] as string[]) ?? [],
      noAuth: Boolean(t["no_auth"]),
    };
  });
}

export interface ComposioConnection {
  id: string;
  toolkit: string;
  status: string;
}

/** List the operator's connected accounts (id, app, status). */
export async function composioListConnections(): Promise<ComposioConnection[]> {
  const data = await composioApi("GET", "/connected_accounts");
  const items = (data["items"] as Array<Record<string, unknown>>) ?? [];
  return items.map((c) => ({
    id: String(c["id"] ?? ""),
    toolkit: String((c["toolkit"] as Record<string, unknown>)?.["slug"] ?? c["toolkit"] ?? ""),
    status: String(c["status"] ?? "UNKNOWN"),
  }));
}

/** Find an existing enabled auth config for a toolkit, else create a Composio-managed one. */
async function findOrCreateAuthConfig(toolkitSlug: string): Promise<string> {
  const existing = await composioApi("GET", "/auth_configs");
  const items = (existing["items"] as Array<Record<string, unknown>>) ?? [];
  const match = items.find(
    (a) => String((a["toolkit"] as Record<string, unknown>)?.["slug"] ?? "").toLowerCase() === toolkitSlug.toLowerCase()
      && String(a["status"] ?? "ENABLED") !== "DISABLED",
  );
  if (match?.["id"]) return String(match["id"]);

  const created = await composioApi("POST", "/auth_configs", {
    toolkit: { slug: toolkitSlug },
    auth_config: { type: "use_composio_managed_auth" },
  });
  const id = (created["auth_config"] as Record<string, unknown>)?.["id"] ?? created["id"];
  if (!id) throw new Error("auth config created but no id was returned");
  return String(id);
}

export interface ComposioConnectResult {
  connectionId: string;
  status: string;
  redirectUrl: string | null;
  authConfigId: string;
  toolkit: string;
}

/**
 * Connect an app end to end: find-or-create the toolkit's auth config, then
 * initiate a connection for `userId`. Returns the OAuth authorize URL the
 * operator visits to approve (null for no-auth/API-key apps that complete
 * without a redirect).
 */
export async function composioConnect(toolkitSlug: string, userId = "operator"): Promise<ComposioConnectResult> {
  const slug = toolkitSlug.trim().toLowerCase();
  if (!slug) throw new Error("toolkit slug is required");
  const authConfigId = await findOrCreateAuthConfig(slug);
  const conn = await composioApi("POST", "/connected_accounts", {
    auth_config: { id: authConfigId },
    connection: { user_id: userId },
  });
  const connectionData = (conn["connectionData"] as Record<string, unknown>) ?? {};
  return {
    connectionId: String(conn["id"] ?? ""),
    status: String(conn["status"] ?? "INITIATED"),
    redirectUrl:
      (conn["redirect_url"] as string) ?? (conn["redirectUrl"] as string) ?? (connectionData["redirectUrl"] as string) ?? null,
    authConfigId,
    toolkit: slug,
  };
}

/** Read a single connection's current status (INITIATED → ACTIVE once approved). */
export async function composioConnectionStatus(connectionId: string): Promise<{ id: string; status: string; toolkit: string }> {
  const c = await composioApi("GET", `/connected_accounts/${encodeURIComponent(connectionId)}`);
  return {
    id: String(c["id"] ?? connectionId),
    status: String(c["status"] ?? "UNKNOWN"),
    toolkit: String((c["toolkit"] as Record<string, unknown>)?.["slug"] ?? c["toolkit"] ?? ""),
  };
}

// ─── Status snapshot ─────────────────────────────────────────────────────────
// A non-secret view of which integrations are configured, for the dashboard /
// health checks. Only booleans are exposed — never the key values themselves.

export interface IntegrationStatus {
  key: string;
  name: string;
  category: string;
  configured: boolean;
  envVar: string;
}

export function integrationStatus(): IntegrationStatus[] {
  const has = (k: string) => !!process.env[k];
  return [
    { key: "openrouter", name: "OpenRouter", category: "llm", envVar: "OPENROUTER_API_KEY", configured: has("OPENROUTER_API_KEY") },
    { key: "neurobuddy", name: "Buddy AI (NeuroBuddy)", category: "llm", envVar: "NEUROBUDDY_API_KEY", configured: has("NEUROBUDDY_API_KEY") },
    { key: "helicone", name: "Helicone", category: "observability", envVar: "HELICONE_API_KEY", configured: has("HELICONE_API_KEY") },
    { key: "langsmith", name: "LangSmith (LangChain)", category: "observability", envVar: "LANGSMITH_API_KEY", configured: langsmithEnabled() },
    { key: "embeddings", name: "Embeddings (semantic memory)", category: "memory", envVar: "EMBEDDINGS_API_KEY", configured: has("EMBEDDINGS_API_KEY") },
    { key: "pinecone", name: "Pinecone (vector memory)", category: "memory", envVar: "PINECONE_API_KEY", configured: has("PINECONE_API_KEY") && (has("PINECONE_INDEX_HOST") || has("PINECONE_INDEX_URL") || has("PINECONE_INDEX")) },
    { key: "tavily", name: "Tavily", category: "search", envVar: "TAVILY_API_KEY", configured: has("TAVILY_API_KEY") },
    { key: "exa", name: "Exa", category: "search", envVar: "EXA_API_KEY", configured: has("EXA_API_KEY") },
    { key: "firecrawl", name: "Firecrawl", category: "search", envVar: "FIRECRAWL_API_KEY", configured: has("FIRECRAWL_API_KEY") },
    { key: "steel", name: "Steel", category: "browser", envVar: "STEEL_API_KEY", configured: has("STEEL_API_KEY") },
    { key: "inngest", name: "Inngest", category: "events", envVar: "INNGEST_EVENT_KEY", configured: has("INNGEST_EVENT_KEY") },
    { key: "e2b", name: "E2B", category: "sandbox", envVar: "E2B_API_KEY", configured: has("E2B_API_KEY") },
    { key: "composio", name: "Composio", category: "tools", envVar: "COMPOSIO_API_KEY", configured: has("COMPOSIO_API_KEY") },
    { key: "buddy", name: "Buddy AI (fallback LLM)", category: "llm", envVar: "BUDDY_API_KEY", configured: has("BUDDY_API_KEY") && has("BUDDY_BASE_URL") },
  ];
}
