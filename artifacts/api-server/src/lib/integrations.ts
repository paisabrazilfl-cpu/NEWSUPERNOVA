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
    { key: "tavily", name: "Tavily", category: "search", envVar: "TAVILY_API_KEY", configured: has("TAVILY_API_KEY") },
    { key: "exa", name: "Exa", category: "search", envVar: "EXA_API_KEY", configured: has("EXA_API_KEY") },
    { key: "firecrawl", name: "Firecrawl", category: "search", envVar: "FIRECRAWL_API_KEY", configured: has("FIRECRAWL_API_KEY") },
    { key: "steel", name: "Steel", category: "browser", envVar: "STEEL_API_KEY", configured: has("STEEL_API_KEY") },
    { key: "inngest", name: "Inngest", category: "events", envVar: "INNGEST_EVENT_KEY", configured: has("INNGEST_EVENT_KEY") },
    { key: "e2b", name: "E2B", category: "sandbox", envVar: "E2B_API_KEY", configured: has("E2B_API_KEY") },
  ];
}
