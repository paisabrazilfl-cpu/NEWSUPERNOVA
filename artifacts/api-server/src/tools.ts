/**
 * OPENCLAW OMEGA — Agent Tool Registry
 *
 * Real, executable tools the autonomous CLAWs can call via OpenRouter native
 * function-calling. Each tool has a JSON-schema declaration (sent to the model)
 * and a `run` implementation (executed server-side). Tools return a plain string
 * that is fed back to the model as the tool result.
 *
 * SECURITY: code_exec runs in an isolated subprocess with a hard timeout, an
 * output cap, and a scrubbed environment (no DATABASE_URL / API keys leak into
 * user code). When the host supports unprivileged namespaces (detected at
 * runtime), it is additionally wrapped in `unshare` so the code has NO network
 * access and CANNOT see the app/repo filesystem (a private tmpfs hides /home).
 * If namespaces are unavailable, it falls back to a scrubbed-env subprocess.
 * http_request is outbound-only and truncates response bodies.
 */

import { spawn, spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logger } from "./lib/logger";
import { db } from "@workspace/db";
import { agentMemoryTable, vaultSecretsTable, messagesTable, cronJobsTable, attachmentsTable } from "@workspace/db";
import { desc, ilike, or, isNotNull, eq } from "drizzle-orm";
import { substituteSecrets, redactSecrets } from "./lib/vault";
import {
  PLATFORMS,
  getPlatform,
  platformKeys,
  isPlatformConnected,
  callPlatformApi,
} from "./lib/connectors";
import {
  tavilySearch,
  exaSearch,
  e2bExec,
  e2bConfigured,
  composioConfigured,
  composioExecuteEnabled,
  composioExecute,
} from "./lib/integrations";
import { embed, embeddingsConfigured, cosineSimilarity, parseEmbedding } from "./lib/embeddings";
import { pineconeConfigured, pineconeUpsert, pineconeQuery } from "./lib/pinecone";
import { runInSandbox, repoPr, sandboxConfigured, gitWriteConfigured } from "./lib/sandbox";
import { TIER1_SOURCES, tier1SourcesText } from "./lib/sources";

const STEEL_BASE = "https://api.steel.dev/v1";
const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";

// ─── SSRF guard ──────────────────────────────────────────────────────────────
// http_request makes outbound calls *from the server runtime*, so an unguarded
// URL lets a model probe internal services or the cloud metadata endpoint. We
// reject loopback, link-local (incl. 169.254.169.254), and private/reserved
// ranges, resolving DNS names first so a public name pointing at an internal IP
// is still blocked.

function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function ipIsPrivate(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true; // loopback / unspecified
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4IsPrivate(mapped[1]);
    return false;
  }
  return ipv4IsPrivate(ip);
}

/** Returns an error string if the URL is unsafe to fetch, or null if allowed. */
export async function ssrfGuard(url: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "error: invalid url.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "error: only http(s) urls are allowed.";
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return "error: requests to internal hostnames are blocked.";
  }
  if (isIP(host)) {
    return ipIsPrivate(host) ? "error: requests to private/internal addresses are blocked." : null;
  }
  try {
    const records = await lookup(host, { all: true });
    if (!records.length) return "error: could not resolve host.";
    for (const rec of records) {
      if (ipIsPrivate(rec.address)) {
        return "error: host resolves to a private/internal address; blocked.";
      }
    }
  } catch {
    return "error: could not resolve host.";
  }
  return null;
}

export interface ToolContext {
  agentId: number;
  agentName: string;
  agentColor?: string | null;
  channelId?: number | null;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s;
}

/**
 * Make a string safe to persist in a Postgres `text` column. Strips NUL bytes
 * (which Postgres text cannot store) and replaces lone UTF-16 surrogates (which
 * break UTF-8 encoding) — so binary-ish tool output, e.g. a scraped PDF, can be
 * written without crashing the insert/update. Valid text and emoji are kept.
 */
export function sanitizeForStorage(s: string): string {
  return s
    .split(String.fromCharCode(0)).join("")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "�") // high surrogate w/o following low
    .replace(/(^|[^\uD800-\uDBFF])([\uDC00-\uDFFF])/g, "$1�"); // low surrogate w/o preceding high
}

// ─── Firecrawl web search ────────────────────────────────────────────────────

/** Real web search via Firecrawl. Returns a ranked list of title/url/snippet. */
async function firecrawlSearch(query: string, limit: number): Promise<string> {
  const key = process.env["FIRECRAWL_API_KEY"];
  if (!key) throw new Error("FIRECRAWL_API_KEY is not set");
  const r = await fetch(`${FIRECRAWL_BASE}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  if (!r.ok) throw new Error(`Firecrawl ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = (await r.json()) as {
    data?: Array<{ title?: string; description?: string; url?: string }>;
  };
  const results = data.data ?? [];
  if (!results.length) return `no web results for "${query}".`;
  return `[search provider: firecrawl]\n${results
    .map((x, i) => `${i + 1}. ${x.title ?? "(untitled)"}\n   ${x.url ?? ""}\n   ${clip((x.description ?? "").trim(), 300)}`)
    .join("\n\n")}`;
}

// ─── Multi-provider web search ───────────────────────────────────────────────
// Tries the configured search providers in order of preference: Tavily (broad,
// fast) → Exa (neural/semantic) → Firecrawl. Falls through to the next provider
// on any error so a single provider outage doesn't blind the swarm.

async function webSearch(query: string, limit: number): Promise<string> {
  const providers: Array<{ name: string; enabled: boolean; run: () => Promise<string> }> = [
    { name: "tavily", enabled: !!process.env["TAVILY_API_KEY"], run: () => tavilySearch(query, limit) },
    { name: "exa", enabled: !!process.env["EXA_API_KEY"], run: () => exaSearch(query, limit) },
    { name: "firecrawl", enabled: !!process.env["FIRECRAWL_API_KEY"], run: () => firecrawlSearch(query, limit) },
  ].filter((p) => p.enabled);

  if (!providers.length) {
    return "error: no web search provider is configured (set TAVILY_API_KEY, EXA_API_KEY, or FIRECRAWL_API_KEY).";
  }

  const errors: string[] = [];
  for (const provider of providers) {
    try {
      return await provider.run();
    } catch (e) {
      errors.push(`${provider.name}: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
    }
  }
  return `error: all web search providers failed — ${errors.join("; ")}`;
}

// ─── Shared long-term memory (semantic + keyword) ────────────────────────────
// Real retrieval over the swarm's shared memory. When an embeddings provider is
// configured, ranks candidates by cosine similarity against the query vector;
// otherwise falls back to SQL keyword matching. Always degrades gracefully.

const MEMORY_CANDIDATE_LIMIT = 1000; // newest N embedded rows considered per query

function formatMemoryRow(m: { id: number; agentName: string | null; key: string | null; content: string }, score?: number): string {
  const tag = score != null ? ` · sim ${score.toFixed(3)}` : "";
  return `#${m.id} [${m.agentName ?? "?"}${m.key ? ` · ${m.key}` : ""}${tag}] ${clip(m.content, 600)}`;
}

// Swarm self-audit / architecture / vault-meta entries: prior runs littered the
// store with these, and surfacing them makes agents "report on themselves"
// instead of the operator's task. They are never a deliverable, so they are
// filtered out of every memory_search result.
const INTERNAL_META_RE =
  /(vault[-\s]?(full[-\s]?state|state[-\s]?dump|rag|audit|targeted|secret)|swarm[-\s]?architecture|architecture[-\s]?(consolidated|definitions)|memory[-\s]?(audit|store[-\s]?audit)|rag[-\s]?(sweep|requery|response)|system topology|substrate audit|bundle matrix|sentinel|six[_\s]?zips|_directive_|self[-\s]?audit|abby[-\s]?claw[-\s]?memory)/i;

export function isInternalMeta(m: { key?: string | null; content?: string | null; tags?: string | null }): boolean {
  return INTERNAL_META_RE.test(`${m.key ?? ""} ${m.tags ?? ""} ${m.content ?? ""}`);
}

async function keywordMemorySearch(query: string, limit: number): Promise<string> {
  const like = `%${query}%`;
  const rows = await db
    .select()
    .from(agentMemoryTable)
    .where(or(ilike(agentMemoryTable.content, like), ilike(agentMemoryTable.key, like), ilike(agentMemoryTable.tags, like)))
    .orderBy(desc(agentMemoryTable.createdAt))
    .limit(limit * 3);
  const visible = rows.filter((m) => !isInternalMeta(m)).slice(0, limit);
  if (!visible.length) return `no relevant memory entries matched "${query}".`;
  return visible.map((m) => formatMemoryRow(m)).join("\n---\n");
}

async function memorySearch(query: string, limit: number): Promise<string> {
  // Primary: Pinecone (managed vector DB) when configured. Falls through to the
  // Postgres cosine / keyword search below if it's unset, errors, or has no hits.
  if (pineconeConfigured()) {
    const queryVec = await embed(query);
    if (queryVec) {
      const matches = await pineconeQuery(queryVec, limit * 3);
      if (matches && matches.length) {
        const rows = matches
          .map((m) => {
            const md = m.metadata ?? {};
            return {
              id: Number(md["pgId"] ?? m.id) || 0,
              agentName: (md["agentName"] as string) ?? null,
              key: (md["key"] as string) ?? null,
              content: String(md["content"] ?? ""),
              score: m.score,
            };
          })
          .filter((r) => !isInternalMeta(r))
          .slice(0, limit);
        if (rows.length) return rows.map((r) => formatMemoryRow(r, r.score)).join("\n---\n");
      }
    }
  }

  if (embeddingsConfigured()) {
    const queryVec = await embed(query);
    if (queryVec) {
      const candidates = await db
        .select()
        .from(agentMemoryTable)
        .where(isNotNull(agentMemoryTable.embedding))
        .orderBy(desc(agentMemoryTable.createdAt))
        .limit(MEMORY_CANDIDATE_LIMIT);

      const scored = candidates
        .filter((m) => !isInternalMeta(m))
        .map((m) => {
          const vec = parseEmbedding(m.embedding);
          return vec ? { row: m, score: cosineSimilarity(queryVec, vec) } : null;
        })
        .filter((x): x is { row: typeof candidates[number]; score: number } => x !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      if (scored.length) {
        return scored.map((s) => formatMemoryRow(s.row, s.score)).join("\n---\n");
      }
      // Embeddings on but nothing embedded yet (e.g. legacy rows) — fall through.
    }
  }
  return keywordMemorySearch(query, limit);
}

// ─── Safe arithmetic ─────────────────────────────────────────────────────────

/**
 * Evaluate a pure arithmetic expression. The input is whitelisted to digits,
 * decimal points, exponent notation, whitespace, parentheses, and the operators
 * + - * / % ** — so no identifiers can be referenced and no globals are reachable.
 */
function safeCalc(expr: string): string {
  const cleaned = expr.trim();
  if (!cleaned) return "error: expression is required.";
  if (cleaned.length > 500) return "error: expression is too long (max 500 chars).";
  if (!/^[-+*/%.()0-9eE\s]+$/.test(cleaned)) {
    return "error: only numbers and the operators + - * / % ** ( ) are allowed.";
  }
  try {
    // No identifiers can survive the whitelist above, so this cannot reference
    // any variable, global, or function — it only evaluates arithmetic.
    const fn = new Function(`"use strict"; return (${cleaned});`);
    const val = fn();
    if (typeof val !== "number" || !Number.isFinite(val)) {
      return "error: expression did not evaluate to a finite number.";
    }
    return String(val);
  } catch {
    return "error: could not evaluate expression.";
  }
}

// ─── Steel browser ───────────────────────────────────────────────────────────

/**
 * A scrape result looks blocked/empty when a bot-wall or near-empty shell came
 * back instead of real content. Listing sites (cars.com etc.) serve a security
 * interstitial to datacenter IPs; that's the signal to retry through a proxy.
 */
function scrapeLooksBlocked(text: string): boolean {
  const t = text.trim();
  if (t.length < 200) return true;
  return /performing security verification|verify you are (not a |a )?(human|bot)|enable javascript|access denied|captcha|unusual traffic|request blocked|are not a bot/i.test(
    t,
  );
}

/** Single Steel scrape pass (optionally through a residential proxy). */
async function steelScrapeOnce(url: string, useProxy: boolean): Promise<string> {
  const key = process.env["STEEL_API_KEY"];
  if (!key) throw new Error("STEEL_API_KEY is not set");
  const r = await fetch(`${STEEL_BASE}/scrape`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    // Ask for cleaned markdown, not raw HTML — far more signal per character, so a
    // single scrape fits the readable content (titles, scores) inside the response
    // budget instead of being truncated mid-page and forcing extra calls.
    body: JSON.stringify({ url, format: ["markdown"], useProxy }),
  });
  if (!r.ok) throw new Error(`Steel ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = (await r.json()) as Record<string, unknown>;
  const content = data["content"] as Record<string, unknown> | string | undefined;
  if (typeof content === "string") return content;
  if (content && typeof content === "object") {
    return (
      (content["markdown"] as string) ||
      (content["text"] as string) ||
      (content["html"] as string) ||
      JSON.stringify(content)
    );
  }
  return (data["markdown"] as string) || JSON.stringify(data);
}

/**
 * Real Steel scrape. Tries direct first (fast/cheap); if the page comes back as a
 * bot-wall or empty shell, retries once through Steel's proxy — which defeats the
 * security interstitials that listing/marketplace sites serve to datacenter IPs.
 */
export async function steelScrape(url: string): Promise<string> {
  const direct = await steelScrapeOnce(url, false);
  if (!scrapeLooksBlocked(direct)) return direct;
  try {
    const viaProxy = await steelScrapeOnce(url, true);
    // Prefer the proxied result when it actually got through; otherwise keep
    // whichever has more usable content so we never return less than we had.
    if (!scrapeLooksBlocked(viaProxy)) return viaProxy;
    return viaProxy.trim().length > direct.trim().length ? viaProxy : direct;
  } catch {
    return direct;
  }
}

async function steelScreenshot(url: string): Promise<number> {
  const key = process.env["STEEL_API_KEY"];
  if (!key) throw new Error("STEEL_API_KEY is not set");
  const r = await fetch(`${STEEL_BASE}/screenshot`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, fullPage: true }),
  });
  if (!r.ok) throw new Error(`Steel ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const buf = await r.arrayBuffer();
  return buf.byteLength;
}

// ─── Sandboxed code execution ────────────────────────────────────────────────

const CODE_TIMEOUT_MS = 8000;
const CODE_OUTPUT_CAP = 4000;

// Detect once whether unprivileged namespace isolation is available on this
// host. When it is, code_exec is wrapped so executed code has no network and
// cannot see the app/repo filesystem. Cached after the first probe.
let sandboxMode: "namespace" | "none" | null = null;
function detectSandboxMode(): "namespace" | "none" {
  if (sandboxMode) return sandboxMode;
  try {
    // Probe must verify BOTH that unshare works AND that we can mask the repo
    // by mounting tmpfs over /home inside the namespace. If the mount can't
    // happen, "namespace" mode would silently leave the repo visible, so we
    // require the full capability before claiming isolation. The throwaway
    // namespace is discarded when the probe shell exits.
    const probe = spawnSync(
      "unshare",
      [
        "--net",
        "--mount",
        "--map-root-user",
        "/bin/sh",
        "-c",
        "mount -t tmpfs tmpfs /home && exit 0",
      ],
      { timeout: 4000 },
    );
    sandboxMode = probe.status === 0 ? "namespace" : "none";
  } catch {
    sandboxMode = "none";
  }
  if (sandboxMode === "none") {
    logger.warn(
      "code_exec: unprivileged namespaces unavailable — running with scrubbed env only (no network/fs isolation). Code execution should be treated as untrusted on this host.",
    );
  } else {
    logger.info("code_exec: namespace isolation active (no network, repo hidden).");
  }
  return sandboxMode;
}

function runSandboxed(language: string, source: string): Promise<string> {
  return new Promise((resolve) => {
    const lang = language.toLowerCase();
    let runtime: string;
    let filename: string;
    let runtimeArgs: string[];
    if (lang === "python" || lang === "py" || lang === "python3") {
      runtime = "python3";
      filename = "main.py";
      runtimeArgs = ["-I", filename];
    } else if (lang === "javascript" || lang === "js" || lang === "node") {
      runtime = "node";
      filename = "main.js";
      runtimeArgs = [filename];
    } else {
      resolve(`error: unsupported language "${language}". Use "python" or "javascript".`);
      return;
    }

    // Write source to a private temp dir and execute the FILE (never inline),
    // so the source can't break out of shell quoting in the namespace wrapper.
    let dir: string;
    try {
      dir = mkdtempSync(join(tmpdir(), "clawexec-"));
      writeFileSync(join(dir, filename), source, "utf8");
    } catch (e) {
      resolve(`error: failed to prepare sandbox: ${String(e).slice(0, 200)}`);
      return;
    }
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    };

    const mode = detectSandboxMode();
    let cmd: string;
    let args: string[];
    if (mode === "namespace") {
      // --net: no network. --mount + tmpfs over /home: the app/repo is invisible.
      // The values interpolated here are runtime-fixed (our own temp path and
      // hardcoded runtime), never user input — user code lives in the file.
      cmd = "unshare";
      args = [
        "--net",
        "--mount",
        "--map-root-user",
        "/bin/sh",
        "-c",
        // Fail-closed: if the /home mask can't be applied, abort WITHOUT
        // running the code (otherwise the repo would stay visible). The temp
        // source dir lives under /tmp, so it survives the tmpfs mount on /home.
        `mount -t tmpfs tmpfs /home || { echo "sandbox: filesystem isolation failed" >&2; exit 97; }; cd "${dir}" && exec ${runtime} ${runtimeArgs.join(" ")}`,
      ];
    } else {
      cmd = runtime;
      args = runtimeArgs;
    }

    // Scrubbed env — user code never sees DATABASE_URL, API keys, secrets.
    // detached so the whole process group can be killed on timeout/overflow
    // (killing only the `unshare` parent would orphan the runtime child).
    const child = spawn(cmd, args, {
      cwd: dir,
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: dir },
      killSignal: "SIGKILL",
      detached: true,
    });

    let killReason: "timeout" | "output-cap" | null = null;
    const killTree = (reason: "timeout" | "output-cap") => {
      if (killReason) return;
      killReason = reason;
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already gone */
        }
      }
    };
    const timer = setTimeout(() => killTree("timeout"), CODE_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";
    let bytes = 0;
    const onData = (chunk: Buffer, sink: "out" | "err") => {
      bytes += chunk.length;
      if (bytes > CODE_OUTPUT_CAP * 2) {
        killTree("output-cap");
        return;
      }
      if (sink === "out") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout?.on("data", (c: Buffer) => onData(c, "out"));
    child.stderr?.on("data", (c: Buffer) => onData(c, "err"));

    child.on("error", (err) => {
      clearTimeout(timer);
      cleanup();
      resolve(`error: failed to spawn sandbox: ${String(err).slice(0, 200)}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      cleanup();
      const out = clip(stdout.trim(), CODE_OUTPUT_CAP);
      const errOut = clip(stderr.trim(), CODE_OUTPUT_CAP);
      if (killReason === "timeout") {
        resolve(`error: execution killed (timeout ${CODE_TIMEOUT_MS}ms).\nstdout:\n${out}`);
        return;
      }
      if (killReason === "output-cap") {
        resolve(`error: execution killed (output cap exceeded).\nstdout:\n${out}`);
        return;
      }
      const parts: string[] = [`exit code: ${code ?? 0}`];
      if (out) parts.push(`stdout:\n${out}`);
      if (errOut) parts.push(`stderr:\n${errOut}`);
      if (!out && !errOut) parts.push("(no output)");
      resolve(parts.join("\n"));
    });
  });
}

// ─── Tool registry ───────────────────────────────────────────────────────────

export const TOOL_REGISTRY: Record<string, ToolDef> = {
  web_scrape: {
    name: "web_scrape",
    description:
      "Fetch and extract the readable text/markdown content of a live web page by URL. Use to read articles, docs, competitor pages, or any public webpage. " +
      "Do NOT use it for github.com pages (search results, repos) — those are JavaScript-rendered and return no useful content; use http_request against the GitHub API (https://api.github.com/...) instead, which is auto-authenticated.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL of the page to read." },
      },
      required: ["url"],
    },
    run: async (args) => {
      const url = String(args["url"] ?? "").trim();
      if (!/^https?:\/\//i.test(url)) return "error: a valid absolute http(s) url is required.";
      // Steer agents away from scraping JS-rendered GitHub web pages (which return
      // only an empty HTML shell and waste a browser call). The REST API works and
      // is auto-authenticated by http_request.
      try {
        const host = new URL(url).hostname.toLowerCase();
        if (host === "github.com" || host === "www.github.com") {
          const m = url.match(/github\.com\/search\?(.*)$/i);
          const apiHint = m
            ? `https://api.github.com/search/repositories?${m[1].replace(/type=repositories&?/i, "")}`
            : "https://api.github.com/repos/<owner>/<repo>  (or /search/repositories?q=...)";
          return `error: github.com web pages are JavaScript-rendered and not scrapable. Use http_request (GET) against the GitHub REST API instead — it is auto-authenticated. Try: ${apiHint}`;
        }
      } catch { /* ignore; validated above */ }
      const content = await steelScrape(url);
      return clip(content, 8000);
    },
  },

  web_screenshot: {
    name: "web_screenshot",
    description:
      "Capture a full-page screenshot of a URL via the Steel browser. Returns a confirmation with the image size in bytes.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute http(s) URL to screenshot." },
      },
      required: ["url"],
    },
    run: async (args) => {
      const url = String(args["url"] ?? "").trim();
      if (!/^https?:\/\//i.test(url)) return "error: a valid absolute http(s) url is required.";
      const bytes = await steelScreenshot(url);
      // A near-empty buffer means the capture failed (blocked page, timeout, or a
      // non-image error body) — report that honestly instead of "0 KB captured".
      if (bytes < 1024) {
        return `error: screenshot returned no usable image (${bytes} bytes) for ${url} — the page likely blocked the capture or timed out.`;
      }
      return `screenshot captured for ${url} (${Math.round(bytes / 1024)} KB).`;
    },
  },

  web_search: {
    name: "web_search",
    description:
      "Search the live web and return the top results (title, URL, snippet). Backed by Tavily, Exa, and Firecrawl with automatic failover. Use to discover current information and find pages worth reading. To read a result's full content, follow up with web_scrape on its URL.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
        limit: { type: "integer", description: "How many results to return (1-10, default 5).", minimum: 1, maximum: 10 },
      },
      required: ["query"],
    },
    run: async (args) => {
      const query = String(args["query"] ?? "").trim();
      if (!query) return "error: query is required.";
      let limit = Number(args["limit"] ?? 5);
      if (!Number.isFinite(limit)) limit = 5;
      limit = Math.max(1, Math.min(10, Math.floor(limit)));
      return webSearch(query, limit);
    },
  },

  http_request: {
    name: "http_request",
    description:
      "Make a real outbound HTTP request to any API endpoint. Supports GET/POST/PUT/PATCH/DELETE with optional headers and a JSON/text body. Returns the status and response body (truncated). " +
      "For rate-limited or private APIs, authenticate with a vault secret placeholder in the headers rather than a raw key — e.g. GitHub: headers { \"Authorization\": \"Bearer {{secret:GITHUB_TOKEN}}\" }. " +
      "Always authenticate GitHub (api.github.com) calls this way: it raises the limit from 60 to 5,000 requests/hour, and the placeholder is resolved to the real token only at send time, so the secret never enters your context. Use vault_list to see which secret names exist.",
    parameters: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], description: "HTTP method." },
        url: { type: "string", description: "Absolute http(s) URL." },
        headers: { type: "object", description: "Optional request headers as a flat key/value object." },
        body: { type: "string", description: "Optional request body (send JSON as a string)." },
      },
      required: ["method", "url"],
    },
    run: async (args) => {
      // Resolve {{secret:NAME}} placeholders to real values ONLY here, at the
      // moment of the outbound fetch. The model-supplied args (stored verbatim in
      // tool-call telemetry) keep the placeholder, so the raw secret never enters
      // the model context, the message log, or the telemetry record. Every value
      // we inject is collected in `usedSecrets` so we can strip it back out of the
      // response in case the endpoint reflects request data (echo/debug/error).
      const usedSecrets = new Set<string>();
      const url = (await substituteSecrets(String(args["url"] ?? ""), usedSecrets)).trim();
      if (!/^https?:\/\//i.test(url)) return "error: a valid absolute http(s) url is required.";
      const blocked = await ssrfGuard(url);
      if (blocked) return blocked;
      const method = String(args["method"] ?? "GET").toUpperCase();
      const headers: Record<string, string> = {};
      const rawHeaders = args["headers"];
      if (rawHeaders && typeof rawHeaders === "object") {
        for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) {
          headers[k] = await substituteSecrets(String(v), usedSecrets);
        }
      }
      const body =
        args["body"] != null && method !== "GET" && method !== "DELETE"
          ? await substituteSecrets(String(args["body"]), usedSecrets)
          : undefined;

      // Auto-authenticate GitHub calls. Agents repeatedly hit api.github.com
      // unauthenticated and burn the 60-request/hour limit (a costly 403 loop).
      // When a GitHub token is available (Render env or the in-app vault via the
      // boot loader) and the agent didn't already set Authorization, attach it —
      // lifting the limit to 5,000/hour. The token never enters the model context
      // and is redacted from any echoed response.
      try {
        const host = new URL(url).hostname.toLowerCase();
        if (host === "api.github.com" || host.endsWith(".githubusercontent.com")) {
          const lc = Object.keys(headers).map((k) => k.toLowerCase());
          const ghToken = process.env["GITHUB_API_KEY"] || process.env["GITHUB_TOKEN"] || process.env["SANDBOX_GITHUB_TOKEN"];
          if (ghToken && !lc.includes("authorization")) {
            headers["Authorization"] = `Bearer ${ghToken}`;
            usedSecrets.add(ghToken);
          }
          if (!lc.includes("user-agent")) headers["User-Agent"] = "OpenClaw-Omega";
          if (host === "api.github.com" && !lc.includes("accept")) headers["Accept"] = "application/vnd.github+json";
        }
      } catch { /* url already validated above; ignore */ }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        // Follow redirects manually so every hop is re-checked by ssrfGuard — a
        // public/open-redirect URL must not be able to bounce us onto an
        // internal target.
        let currentUrl = url;
        let r: Response | null = null;
        for (let hop = 0; hop < 5; hop++) {
          r = await fetch(currentUrl, { method, headers, body, signal: ctrl.signal, redirect: "manual" });
          if (r.status < 300 || r.status >= 400) break;
          const location = r.headers.get("location");
          if (!location) break;
          const next = new URL(location, currentUrl).toString();
          if (!/^https?:\/\//i.test(next)) return "error: redirect to a non-http(s) target was blocked.";
          const redirectBlocked = await ssrfGuard(next);
          if (redirectBlocked) return `error: redirect blocked — ${redirectBlocked.replace(/^error: /, "")}`;
          currentUrl = next;
          if (hop === 4) return "error: too many redirects.";
        }
        if (!r) return "error: request failed: no response.";
        const text = await r.text();
        // Strip any injected secret values that the endpoint may have echoed
        // back before this result is stored or fed to the model.
        const safe = redactSecrets(text, usedSecrets);
        return `HTTP ${r.status} ${r.statusText}\n${clip(safe, 4000)}`;
      } catch (e) {
        return redactSecrets(`error: request failed: ${String(e).slice(0, 200)}`, usedSecrets);
      } finally {
        clearTimeout(timer);
      }
    },
  },

  code_exec: {
    name: "code_exec",
    description:
      "Execute a short code snippet in an isolated subprocess and return its stdout/stderr. Supports 'python' and 'javascript'. Hard 8s timeout. Secrets, env vars, and the database are never exposed. Where the host supports unprivileged namespaces, execution also has NO network access and CANNOT see the app/repo filesystem; on hosts without that support it falls back to a scrubbed-env subprocess with network/filesystem still reachable. Use for self-contained calculations, data transforms, and quick logic checks — not for fetching URLs (use http_request) or reading project files.",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["python", "javascript"], description: "Runtime to use." },
        source: { type: "string", description: "Self-contained source code. Print results to stdout." },
      },
      required: ["language", "source"],
    },
    run: async (args) => {
      const language = String(args["language"] ?? "");
      const source = String(args["source"] ?? "");
      if (!source.trim()) return "error: source is required.";
      return runSandboxed(language, source);
    },
  },

  cloud_code_exec: {
    name: "cloud_code_exec",
    description:
      "Execute code in a fully isolated E2B cloud sandbox (a real remote VM with network access and a full runtime). Supports 'python' and 'javascript'. Use this instead of code_exec when the code needs network access, pip/npm packages, or stronger isolation than the local sandbox. Returns stdout/stderr/result.",
    parameters: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["python", "javascript"], description: "Runtime to use." },
        source: { type: "string", description: "Self-contained source code. Print results to stdout." },
      },
      required: ["language", "source"],
    },
    run: async (args) => {
      const language = String(args["language"] ?? "");
      const source = String(args["source"] ?? "");
      if (!source.trim()) return "error: source is required.";
      if (!e2bConfigured()) {
        return "error: E2B cloud sandbox is not configured (set E2B_API_KEY). Use code_exec for local execution instead.";
      }
      return e2bExec(language, source);
    },
  },

  sandbox_exec: {
    name: "sandbox_exec",
    description:
      "Run a shell script inside a fresh, isolated E2B cloud VM (its own real computer — node, git, network, full Linux). Use for anything that needs a real dev environment: clone a public repo, install packages, run a build/test suite, run scripts, curl APIs, etc. " +
      "It is also your INTERACTIVE-AUTOMATION substrate: pip/npm-install and drive real tools here — e.g. Playwright (`pip install playwright && playwright install chromium`) to navigate multi-step web forms, fill fields, click, and submit; or reportlab/fpdf2/fillpdf/pypdf to generate and fill official PDF forms (e.g. AcroForm fields). Print results/paths to stdout and read back any output. " +
      "Each call gets a clean disposable VM with NO access to the OpenClaw server or its secrets. For making changes to the OpenClaw repo and opening a PR, use sandbox_repo_pr instead.",
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "A bash script to run in the VM (commands can be chained with && and newlines)." },
      },
      required: ["script"],
    },
    run: async (args) => {
      const script = String(args["script"] ?? "").trim();
      if (!script) return "error: script is required.";
      if (!sandboxConfigured()) return "error: E2B cloud sandbox is not configured (E2B_API_KEY).";
      return runInSandbox(script);
    },
  },

  sandbox_repo_pr: {
    name: "sandbox_repo_pr",
    description:
      "Work on the OpenClaw (bos-aura) repository for real: clones it into an isolated E2B VM, runs your shell script to make changes and/or run the test suite (cwd = repo root), commits, pushes a branch, and opens a Pull Request for human review. Use this to implement a fix/feature, run the real tests against your changes, and propose them. Scoped to the bos-aura repo only. The GitHub token is handled server-side and never exposed to you.",
    parameters: {
      type: "object",
      properties: {
        branch: { type: "string", description: "New branch name, e.g. 'agent/fix-typo'." },
        script: { type: "string", description: "Bash script run inside the cloned repo to make changes (e.g. edit files with sed/tee) and optionally run tests. cwd is the repo root." },
        title: { type: "string", description: "PR title (also used as the commit message)." },
        body: { type: "string", description: "Optional PR description." },
        baseBranch: { type: "string", description: "Base branch for the PR (default 'main')." },
      },
      required: ["branch", "script", "title"],
    },
    run: async (args) => {
      const branch = String(args["branch"] ?? "").trim();
      const script = String(args["script"] ?? "").trim();
      const title = String(args["title"] ?? "").trim();
      if (!branch || !script || !title) return "error: branch, script, and title are required.";
      if (!sandboxConfigured()) return "error: E2B cloud sandbox is not configured (E2B_API_KEY).";
      if (!gitWriteConfigured()) return "error: git push is not enabled — the operator must set SANDBOX_GITHUB_TOKEN.";
      return repoPr({
        branch,
        script,
        title,
        body: args["body"] != null ? String(args["body"]) : undefined,
        baseBranch: args["baseBranch"] != null ? String(args["baseBranch"]) : undefined,
      });
    },
  },

  memory_write: {
    name: "memory_write",
    description:
      "Persist a fact, finding, or result to the swarm's shared long-term memory so any agent can retrieve it later.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The information to store." },
        key: { type: "string", description: "Optional short label/topic for the memory." },
        tags: { type: "string", description: "Optional comma-separated tags." },
      },
      required: ["content"],
    },
    run: async (args, ctx) => {
      const content = String(args["content"] ?? "").trim();
      if (!content) return "error: content is required.";
      const key = args["key"] != null ? String(args["key"]).slice(0, 200) : null;
      const stored = content.slice(0, 8000);
      // Embed the content (key + content) for semantic retrieval. Best-effort:
      // if embeddings aren't configured or fail, we store null and search falls
      // back to keyword matching.
      const vector = await embed(key ? `${key}\n${stored}` : stored);
      const tags = args["tags"] != null ? String(args["tags"]).slice(0, 300) : null;
      const [row] = await db
        .insert(agentMemoryTable)
        .values({
          agentId: ctx.agentId,
          agentName: ctx.agentName,
          key,
          content: stored,
          tags,
          embedding: vector ? JSON.stringify(vector) : null,
        })
        .returning();

      // Postgres is the durable record + fallback. When Pinecone is configured,
      // also upsert the vector there as the primary semantic index (best-effort).
      let pineconed = false;
      if (vector && row?.id != null && pineconeConfigured()) {
        pineconed = await pineconeUpsert(String(row.id), vector, {
          pgId: row.id,
          agentName: ctx.agentName ?? null,
          key,
          tags,
          content: stored.slice(0, 1500),
        });
      }
      return `stored memory #${row?.id ?? "?"}${vector ? (pineconed ? " (semantic · pinecone)" : " (semantic)") : ""}.`;
    },
  },

  memory_search: {
    name: "memory_search",
    description:
      "Search the swarm's shared long-term memory for prior TASK-RELEVANT facts about the operator's domain (e.g. earlier findings, figures, sources for this project). Semantic vector similarity when embeddings are configured, else keyword. " +
      "Do NOT use this to research the swarm itself (its architecture, roles, vault, prior audits) — that is internal state, not a deliverable. If results are only internal/meta/self-audit entries, ignore them and gather the real answer from web_search/web_scrape/http_request. Call it at most a couple of times; don't loop.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to retrieve from stored memory (natural language or keywords)." },
      },
      required: ["query"],
    },
    run: async (args) => {
      const query = String(args["query"] ?? "").trim();
      if (!query) return "error: query is required.";
      return memorySearch(query, 5);
    },
  },

  calculator: {
    name: "calculator",
    description:
      "Evaluate an arithmetic expression precisely and return the numeric result. Supports + - * / % ** and parentheses. Use this instead of doing mental math for any non-trivial calculation.",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "Arithmetic expression, e.g. '(1234 * 19) / 7 + 2**8'." },
      },
      required: ["expression"],
    },
    run: async (args) => safeCalc(String(args["expression"] ?? "")),
  },

  tier1_sources: {
    name: "tier1_sources",
    description:
      "Return the vetted Tier-1 (authoritative, primary) source URLs to research from — government/regulatory, primary institutions, peer-reviewed journals & standards bodies, official company/platform docs, Tier-1 wire services, and recognized data authorities. Call this BEFORE web research so you start from serious sources, then web_scrape/http_request those URLs. Optionally pass a category to filter.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: TIER1_SOURCES.map((c) => c.key),
          description: "Optional domain filter: medicine, finance, markets, news, ai, marketing, engineering, law, social, gov.",
        },
      },
    },
    run: async (args) => {
      const category = args["category"] != null ? String(args["category"]) : undefined;
      return tier1SourcesText(category);
    },
  },

  save_artifact: {
    name: "save_artifact",
    description:
      "Save a file you created so the OPERATOR can DOWNLOAD it. Returns a real download URL — use this for any deliverable file (report, CSV, markdown, code, JSON, or a PDF). After saving, you MUST include the returned markdown download link in your final answer so the operator can click it. " +
      "For text deliverables pass the text in `content` (encoding 'utf8'). For a binary file you generated in sandbox_exec/code_exec (e.g. a PDF), base64-encode it there (`base64 -w0 file.pdf`), print it, then pass that string as `content` with encoding 'base64'. Never claim a file exists without saving it here first.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "File name with extension, e.g. 'fl-llc-articles.pdf' or 'market-research.md'." },
        content: { type: "string", description: "The file content: UTF-8 text, or base64 bytes when encoding='base64'." },
        mime: { type: "string", description: "Optional MIME type, e.g. 'application/pdf', 'text/markdown', 'text/csv'. Inferred from the extension if omitted." },
        encoding: { type: "string", enum: ["utf8", "base64"], description: "How `content` is encoded (default 'utf8')." },
      },
      required: ["filename", "content"],
    },
    run: async (args) => {
      const filename = String(args["filename"] ?? "").trim().slice(0, 255) || "artifact";
      const raw = String(args["content"] ?? "");
      if (!raw) return "error: content is required.";
      const encoding = String(args["encoding"] ?? "utf8").toLowerCase() === "base64" ? "base64" : "utf8";
      // Normalize to base64 for storage (the attachments column stores base64).
      let base64: string;
      let bytes: number;
      try {
        const buf = encoding === "base64"
          ? Buffer.from(raw.includes(",") ? raw.slice(raw.indexOf(",") + 1) : raw, "base64")
          : Buffer.from(raw, "utf8");
        bytes = buf.length;
        if (bytes === 0) return "error: content decoded to 0 bytes.";
        if (bytes > 20 * 1024 * 1024) return "error: file too large (max 20 MB).";
        base64 = buf.toString("base64");
      } catch (e) {
        return `error: could not decode content: ${String(e).slice(0, 200)}`;
      }
      const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
      const MIME: Record<string, string> = {
        pdf: "application/pdf", md: "text/markdown", markdown: "text/markdown", txt: "text/plain",
        csv: "text/csv", json: "application/json", html: "text/html", xml: "application/xml",
        js: "text/javascript", ts: "text/plain", py: "text/plain", png: "image/png", jpg: "image/jpeg",
        jpeg: "image/jpeg", svg: "image/svg+xml", zip: "application/zip", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
      const mimeType = (args["mime"] != null ? String(args["mime"]) : (MIME[ext] ?? "application/octet-stream")).slice(0, 128);
      const kind = /^image\//.test(mimeType) ? "image" : (/^text\/|json|xml|javascript/.test(mimeType) ? "text" : "other");
      try {
        const [row] = await db
          .insert(attachmentsTable)
          .values({ filename, mimeType, kind, sizeBytes: bytes, data: base64, extractedText: null })
          .returning();
        const url = `/api/uploads/${row.id}?download=1`;
        return `saved "${filename}" (${bytes} bytes, ${mimeType}). Operator download link — INCLUDE THIS in your final answer:\n[Download ${filename}](${url})`;
      } catch (e) {
        return `error: could not save artifact: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`;
      }
    },
  },

  image_generate: {
    name: "image_generate",
    description:
      "Generate an IMAGE from a text prompt and save it as a downloadable file; returns a markdown image preview plus a download link. Use whenever the operator asks for an image, picture, logo, illustration, diagram, icon, mockup, poster, or banner. Needs OPENAI_API_KEY (or IMAGE_API_KEY).",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to draw — describe the image in detail." },
        size: { type: "string", enum: ["1024x1024", "1536x1024", "1024x1536"], description: "Image size (default 1024x1024)." },
        filename: { type: "string", description: "Optional output filename, e.g. 'logo.png'." },
      },
      required: ["prompt"],
    },
    run: async (args) => {
      const apiKey = process.env["OPENAI_API_KEY"] || process.env["IMAGE_API_KEY"];
      if (!apiKey) return "error: image generation is not configured (set OPENAI_API_KEY).";
      const prompt = String(args["prompt"] ?? "").trim();
      if (!prompt) return "error: prompt is required.";
      const allowed = new Set(["1024x1024", "1536x1024", "1024x1536"]);
      const size = allowed.has(String(args["size"])) ? String(args["size"]) : "1024x1024";
      const base = (process.env["IMAGE_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/$/, "");
      const model = process.env["IMAGE_MODEL"] ?? "gpt-image-1";
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90000);
      try {
        const r = await fetch(`${base}/images/generations`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt, size, n: 1 }),
          signal: ctrl.signal,
        });
        const data = (await r.json()) as { data?: Array<{ b64_json?: string; url?: string }>; error?: { message?: string } };
        if (!r.ok) return `error: image API ${r.status}: ${data?.error?.message ?? "request failed"}`;
        let b64 = data.data?.[0]?.b64_json ?? "";
        if (!b64 && data.data?.[0]?.url) {
          const img = await fetch(data.data[0].url);
          b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
        }
        if (!b64) return "error: image API returned no image data.";
        const buf = Buffer.from(b64, "base64");
        const filename = (args["filename"] != null ? String(args["filename"]) : prompt.slice(0, 40).replace(/[^a-z0-9]+/gi, "_")).replace(/\.(png|jpg|jpeg)$/i, "") + ".png";
        const [row] = await db
          .insert(attachmentsTable)
          .values({ filename, mimeType: "image/png", kind: "image", sizeBytes: buf.length, data: b64, extractedText: null })
          .returning();
        const url = `/api/uploads/${row.id}`;
        return `generated image "${filename}" (${buf.length} bytes). Show this in your answer:\n![${prompt.slice(0, 60)}](${url})\n[Download ${filename}](${url}?download=1)`;
      } catch (e) {
        return `error: image generation failed: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`;
      } finally {
        clearTimeout(timer);
      }
    },
  },

  send_message: {
    name: "send_message",
    description:
      "Post a message into the live operator channel feed as yourself. Use to report progress, surface a finding, or coordinate with the operator and the other CLAWs. The message appears immediately in the Discord-style chat stream.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The message to post (markdown supported)." },
      },
      required: ["content"],
    },
    run: async (args, ctx) => {
      const content = String(args["content"] ?? "").trim();
      if (!content) return "error: content is required.";
      if (!ctx.channelId) return "error: no channel context is available to post into.";
      await db.insert(messagesTable).values({
        channelId: ctx.channelId,
        agentId: ctx.agentId,
        agentName: ctx.agentName,
        agentColor: ctx.agentColor ?? null,
        content: content.slice(0, 4000),
        messageType: "agent",
      });
      return `message posted to the operator channel.`;
    },
  },

  vault_list: {
    name: "vault_list",
    description:
      "List the NAMES of secrets available in the operator's encrypted vault (API keys, tokens). Values are never revealed. To USE a secret, put the placeholder {{secret:NAME}} into an http_request url, header, or body — it is substituted with the real value only at request time.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const rows = await db
        .select({ name: vaultSecretsTable.name, description: vaultSecretsTable.description })
        .from(vaultSecretsTable)
        .orderBy(desc(vaultSecretsTable.updatedAt));
      if (!rows.length) return "the vault is empty — no secrets are stored.";
      return rows
        .map((s) => `{{secret:${s.name}}}${s.description ? ` — ${s.description}` : ""}`)
        .join("\n");
    },
  },

  social_accounts: {
    name: "social_accounts",
    description:
      "List the main social platforms wired to their OFFICIAL APIs (via Replit-managed OAuth) and show which are currently authorized/connected for the operator's own account. Call this before social_api to see what you can use.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const entries = Object.values(PLATFORMS);
      const results = await Promise.all(
        entries.map(async (p) => `${(await isPlatformConnected(p)) ? "✓ connected" : "✗ not connected"}  ${p.key} — ${p.displayName} (${p.apiBase})`),
      );
      return [
        "Official social APIs (OAuth handled by Replit; tokens never exposed):",
        ...results,
        "",
        'Use social_api with one of: ' + platformKeys().join(", ") + ".",
      ].join("\n");
    },
  },

  composio_action: {
    name: "composio_action",
    description:
      "Execute an authenticated action on a connected SaaS app (Gmail, Slack, GitHub, Notion, Calendar, Sheets, CRM, …) via Composio's tool/auth router. Use for real external actions on accounts the operator has connected in Composio. Disabled unless the operator has enabled it.",
    parameters: {
      type: "object",
      properties: {
        toolkit: { type: "string", description: "Composio toolkit/app slug, e.g. 'gmail', 'slack', 'github'." },
        action: { type: "string", description: "The action/tool to run, e.g. 'GMAIL_SEND_EMAIL'." },
        arguments: { type: "object", description: "Action arguments as a key/value object." },
        connectedAccountId: { type: "string", description: "Optional connected-account id to act as." },
      },
      required: ["action"],
    },
    run: async (args) => {
      if (!composioConfigured()) return "error: Composio is not configured (set COMPOSIO_API_KEY).";
      if (!composioExecuteEnabled()) {
        return "error: Composio execution is disabled. The operator must set ALLOW_COMPOSIO_EXECUTE=true after connecting accounts.";
      }
      return composioExecute({
        toolkit: args["toolkit"] != null ? String(args["toolkit"]) : undefined,
        action: args["action"] != null ? String(args["action"]) : undefined,
        arguments: (args["arguments"] as Record<string, unknown>) ?? {},
        connectedAccountId: args["connectedAccountId"] != null ? String(args["connectedAccountId"]) : undefined,
      });
    },
  },

  social_api: {
    name: "social_api",
    description:
      "Call the OFFICIAL API of a connected social platform on the operator's own authorized account. OAuth and the access token are fully managed by Replit — you never see or handle the token. Use this for real reads (profile, media, insights, comments) and writes (publishing) instead of any browser/password login. Run social_accounts first to confirm the platform is connected.",
    parameters: {
      type: "object",
      properties: {
        platform: {
          type: "string",
          enum: platformKeys(),
          description: "Which connected platform's official API to call.",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          description: "HTTP method (default GET).",
        },
        path: {
          type: "string",
          description:
            "API path relative to the platform's base, e.g. '/me?fields=id,username' for Instagram or '/users/me' for X. Do not include the host.",
        },
        query: {
          type: "object",
          description: "Optional query parameters as a flat key/value object.",
        },
        body: { type: "string", description: "Optional JSON request body (as a string) for writes." },
      },
      required: ["platform", "path"],
    },
    run: async (args) => {
      const platform = getPlatform(String(args["platform"] ?? ""));
      if (!platform) {
        return `error: unknown platform. Available: ${platformKeys().join(", ")}.`;
      }
      const path = String(args["path"] ?? "").trim();
      if (!path) return "error: path is required.";
      const method = String(args["method"] ?? "GET");
      let query: Record<string, string> | undefined;
      const rawQuery = args["query"];
      if (rawQuery && typeof rawQuery === "object") {
        query = {};
        for (const [k, v] of Object.entries(rawQuery as Record<string, unknown>)) {
          query[k] = String(v);
        }
      }
      const body = args["body"] != null ? String(args["body"]) : undefined;
      try {
        const res = await callPlatformApi({ platform, method, path, query, body });
        return `${platform.displayName} API → HTTP ${res.status} ${res.statusText}\n${clip(res.body, 4000)}`;
      } catch (e) {
        return `error: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`;
      }
    },
  },

  schedule_task: {
    name: "schedule_task",
    description:
      "Schedule a recurring task the swarm runs automatically on a cron schedule (e.g. '0 9 * * *' = daily 9am, '*/30 * * * *' = every 30 min). The task is a natural-language goal executed later through the same agent machinery. Use for monitoring, daily digests, periodic research, or anything the operator wants to happen on a repeat.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short name for the scheduled job." },
        schedule: { type: "string", description: "5-field cron expression, e.g. '0 9 * * *'." },
        task: { type: "string", description: "The goal/instruction to run on each tick." },
      },
      required: ["name", "schedule", "task"],
    },
    run: async (args, ctx) => {
      const name = String(args["name"] ?? "").trim();
      const schedule = String(args["schedule"] ?? "").trim();
      const task = String(args["task"] ?? "").trim();
      if (!name || !schedule || !task) return "error: name, schedule, and task are all required.";
      if (schedule.split(/\s+/).length !== 5) return "error: schedule must be a 5-field cron expression, e.g. '*/30 * * * *'.";
      // Inline next-run (mirrors scheduler.computeNextRun) to avoid an import cycle.
      const min = schedule.split(/\s+/)[0];
      const ms = min === "*" ? 60_000 : min.startsWith("*/") ? Math.max(Number(min.slice(2)) * 60_000, 60_000) : 5 * 60_000;
      const nextRunAt = new Date(Date.now() + ms);
      try {
        const [row] = await db
          .insert(cronJobsTable)
          .values({ agentId: ctx.agentId, name, schedule, task, enabled: true, nextRunAt })
          .returning();
        return `scheduled "${name}" (job #${row?.id ?? "?"}) on '${schedule}', next run ~${nextRunAt.toISOString()}.`;
      } catch (e) {
        return `error: could not schedule task: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`;
      }
    },
  },

  list_scheduled_tasks: {
    name: "list_scheduled_tasks",
    description: "List the swarm's scheduled (cron) jobs — name, schedule, owner agent, enabled state, run count, last result. Use to see what is set to run automatically.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const rows = await db.select().from(cronJobsTable).orderBy(desc(cronJobsTable.createdAt)).limit(50);
      if (!rows.length) return "no scheduled tasks.";
      return rows
        .map((j) => `#${j.id} "${j.name}" [${j.schedule}] agent ${j.agentId} · ${j.enabled ? "enabled" : "disabled"} · runs ${j.runCount}${j.lastResult ? ` · last: ${clip(j.lastResult, 80)}` : ""}\n   task: ${clip(j.task, 160)}`)
        .join("\n---\n");
    },
  },

  cancel_scheduled_task: {
    name: "cancel_scheduled_task",
    description: "Cancel (delete) a scheduled cron job by its id. Use list_scheduled_tasks first to find the id.",
    parameters: {
      type: "object",
      properties: { id: { type: "number", description: "The scheduled job id to cancel." } },
      required: ["id"],
    },
    run: async (args) => {
      const id = Number(args["id"]);
      if (!Number.isFinite(id)) return "error: a numeric job id is required.";
      const [row] = await db.delete(cronJobsTable).where(eq(cronJobsTable.id, id)).returning();
      return row ? `cancelled scheduled job #${id} ("${row.name}").` : `no scheduled job #${id} found.`;
    },
  },
};

// ─── Per-agent tool permissions ──────────────────────────────────────────────
// Every CLAW gets read tools (web_scrape, memory_search, memory_write) plus its
// specialty. ABBY (orchestrator) has the full set.

const ALL_TOOLS = Object.keys(TOOL_REGISTRY);

export const AGENT_TOOLS: Record<number, string[]> = {
  1: ALL_TOOLS, // ABBY — full authority
  2: ["code_exec", "cloud_code_exec", "sandbox_exec", "sandbox_repo_pr", "calculator", "http_request", "web_scrape", "web_search", "tier1_sources", "memory_search", "memory_write", "vault_list", "save_artifact", "image_generate", "send_message"], // FORGE — code
  3: ["web_scrape", "web_screenshot", "web_search", "tier1_sources", "http_request", "calculator", "memory_search", "memory_write", "vault_list", "social_accounts", "social_api", "save_artifact", "image_generate", "send_message"], // CRAWLER — browser
  4: ["memory_write", "memory_search", "web_search", "tier1_sources", "web_scrape", "http_request", "calculator", "vault_list", "save_artifact", "image_generate", "send_message"], // VAULT — memory/RAG
  5: ["http_request", "web_scrape", "web_search", "tier1_sources", "code_exec", "cloud_code_exec", "sandbox_exec", "sandbox_repo_pr", "calculator", "memory_search", "memory_write", "vault_list", "social_accounts", "social_api", "composio_action", "schedule_task", "list_scheduled_tasks", "cancel_scheduled_task", "save_artifact", "image_generate", "send_message"], // WIRE — APIs + scheduling
  6: ["web_scrape", "web_search", "tier1_sources", "http_request", "calculator", "memory_search", "memory_write", "vault_list", "social_accounts", "social_api", "save_artifact", "image_generate", "send_message"], // MR.NICE — social
};

export function getToolNamesForAgent(agentId: number): string[] {
  return AGENT_TOOLS[agentId] ?? ["web_scrape", "memory_search"];
}

const ABBY_ID = 1;
const SWARM_ROSTER: Array<[number, string, string]> = [
  [2, "FORGE", "code execution & sandbox PRs"],
  [3, "CRAWLER", "web browsing, scraping, screenshots, search"],
  [4, "VAULT", "long-term memory & semantic RAG"],
  [5, "WIRE", "external APIs, integrations, scheduling"],
  [6, "MR.NICE", "social media & communications"],
];

/** First sentence of a tool's description, for a compact capability listing. */
function toolSummary(name: string): string {
  const d = TOOL_REGISTRY[name]?.description ?? "";
  return clip(d.split(/\.\s/)[0], 100);
}

/**
 * A self-knowledge block injected into every agent's system prompt so each agent
 * always knows EXACTLY which tools it has (single source of truth = the registry)
 * — including scheduling/cron — and, for ABBY, the whole swarm's roster so it can
 * delegate accurately. Prevents the failure where an agent forgets or invents its
 * capabilities. Tools only actually run during task execution; this is awareness,
 * not a licence to claim a tool ran without a real result.
 */
export function buildCapabilityCard(agentId: number): string {
  const names = getToolNamesForAgent(agentId);
  const list = names.map((n) => `- ${n}: ${toolSummary(n)}`).join("\n");
  let card = `\n\nYOUR TOOLS (${names.length}; call them to do real work, never guess or fabricate results):\n${list}`;
  card += names.includes("schedule_task")
    ? `\n\nSCHEDULING: use schedule_task to run work automatically on a cron schedule, list_scheduled_tasks to review jobs, cancel_scheduled_task to stop one.`
    : `\n\nSCHEDULING: the swarm can run recurring cron jobs (managed by ABBY/WIRE) — ask ABBY to schedule recurring work.`;
  card += `\n\nGITHUB: query the GitHub REST API with http_request (https://api.github.com/...); it is auto-authenticated. Never web_scrape github.com pages — they are JS-rendered and return nothing useful.`;
  if (names.includes("sandbox_exec")) {
    card += `\n\nINTERACTIVE AUTOMATION: web_scrape is read-only and won't render JS-heavy or multi-step pages. When a task needs to actually fill/submit a web form or read a JS-rendered page, use sandbox_exec to run Playwright in the cloud VM (install chromium, navigate, fill, click, submit). To produce or fill official PDF forms (e.g. AcroForm fields), use sandbox_exec with reportlab/fpdf2/fillpdf/pypdf and return the output file path. Generate/prepare documents and demonstrate the flow — never submit a person's legal/financial filing on their behalf.`;
  }
  if (names.includes("save_artifact")) {
    card += `\n\nDELIVERABLE FILES: whenever you produce a file the operator should keep (report, CSV, code, JSON, or a generated PDF), call save_artifact to store it and get a real download URL, then put that [Download …](url) link in your final answer. Do NOT claim a file exists or name a file you didn't save — an unsaved file is not downloadable and counts as a fabrication. To make a PDF: generate it in sandbox_exec (reportlab/fpdf2), base64 it, then save_artifact with encoding 'base64'.`;
  }
  if (names.includes("image_generate")) {
    card += `\n\nIMAGES: for ANY request for an image/picture/logo/illustration/render/artwork, call image_generate with a detailed prompt — it produces a REAL raster PNG and returns a preview + download link to put in your answer. Do NOT hand-code an SVG or merely describe the image; only produce SVG if the operator explicitly asks for SVG/vector.`;
  }
  if (agentId === ABBY_ID) {
    card += `\n\nYOUR SWARM (delegate each directive to the right CLAW):\n` +
      SWARM_ROSTER.map(([id, name, role]) => `- ${name} (#${id}) — ${role}`).join("\n");
  }
  return card;
}

/** OpenAI/OpenRouter tool schema for the given agent's allowed tools. */
export function getOpenAiToolsForAgent(agentId: number): Array<Record<string, unknown>> {
  return getToolNamesForAgent(agentId)
    .map((n) => TOOL_REGISTRY[n])
    .filter((t): t is ToolDef => !!t)
    .map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
}

export function isToolAllowed(agentId: number, toolName: string): boolean {
  return getToolNamesForAgent(agentId).includes(toolName);
}

/** Execute a tool by name with parsed args. Always resolves to a string. */
export async function runTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const def = TOOL_REGISTRY[toolName];
  if (!def) return `error: unknown tool "${toolName}".`;
  if (!isToolAllowed(ctx.agentId, toolName)) {
    return `error: tool "${toolName}" is not permitted for this agent.`;
  }
  // Sanitize so binary-ish output (e.g. a scraped PDF with NUL bytes) can be
  // persisted to tool_calls/messages without crashing the DB write.
  return sanitizeForStorage(await def.run(args, ctx));
}
