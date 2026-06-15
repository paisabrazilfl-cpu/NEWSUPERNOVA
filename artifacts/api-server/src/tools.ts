/**
 * OPENCLAW OMEGA — Agent Tool Registry
 *
 * Real, executable tools the autonomous CLAWs can call via NVIDIA NIM native
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
import { agentMemoryTable, vaultSecretsTable, messagesTable, cronJobsTable, attachmentsTable, agentCommandsTable, tasksTable } from "@workspace/db";
import { desc, ilike, or, isNotNull, eq } from "drizzle-orm";
import { substituteSecrets, redactSecrets, hasSecretPlaceholder, unresolvedSecretError } from "./lib/vault";
import { assessActionRisk, policyRefusal } from "./lib/safetyPolicy";
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
  composioListConnections,
  composioListTools,
} from "./lib/integrations";
import { embed, embeddingsConfigured, cosineSimilarity, parseEmbedding } from "./lib/embeddings";
import { pineconeConfigured, pineconeUpsert, pineconeQuery } from "./lib/pinecone";
import { runInSandbox, repoPr, sandboxConfigured, gitWriteConfigured } from "./lib/sandbox";
import { TIER1_SOURCES, tier1SourcesText } from "./lib/sources";
import { marketingPlaybook, MARKETING_SECTIONS } from "./lib/marketing";
import { computeNextRun } from "./lib/cron";
import { blockIfSensitiveForPublic } from "./lib/safety";
import { checkPostAllowed, recordPost } from "./lib/postLimit";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const STEEL_BASE = "https://api.steel.dev/v1";
const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";
const FREECRAWL_BASE = process.env["FREECRAWL_URL"] ?? "https://freecrawl-api.onrender.com";

// ─── Real, server-side PDF rendering (powers the pdf_generate tool) ──────────
// Renders text/markdown into an actual PDF in-process with pdf-lib (pure JS — no
// native deps, no headless browser), so a PDF deliverable NEVER depends on the
// sandbox. The sandbox is a fresh disposable VM where `pip install` and written
// files do not persist between calls — the live failure that left agents unable
// to make a PDF and fabricating storage.googleapis.com download links. Standard
// Helvetica only encodes WinAnsi, so non-Latin text is folded to safe ASCII and
// any unmapped glyph (emoji, arrows) is dropped — pdf-lib never throws on input.
const PDF_FOLD: Record<string, string> = {
  "“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "‚": "'",
  "—": "-", "–": "-", "―": "-", "−": "-", "•": "-", "·": "-",
  "‣": "-", "▪": "-", "…": "...", "→": "->", "←": "<-", "↔": "<->",
  "⇒": "=>", "™": "(TM)", "®": "(R)", "©": "(C)", "€": "EUR", "£": "GBP",
  "✅": "[x]", "✔": "[x]", "✓": "[x]", "☑": "[x]", "❌": "[ ]", "✗": "x",
  "★": "*", "☆": "*", "♠": "*",
};
function pdfWinAnsi(s: string): string {
  let out = s;
  for (const k in PDF_FOLD) out = out.split(k).join(PDF_FOLD[k]);
  return out.replace(/[^\x09\x20-\x7E\xA0-\xFF]/g, ""); // keep printable ASCII + Latin-1 only
}

export async function renderPdf(title: string, content: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  if (title) doc.setTitle(pdfWinAnsi(title).slice(0, 200));
  doc.setCreator("OPENCLAW OMEGA");
  doc.setProducer("OPENCLAW OMEGA — pdf_generate");

  const PAGE_W = 612, PAGE_H = 792, MARGIN = 54, maxW = PAGE_W - MARGIN * 2;
  const ink = rgb(0.12, 0.12, 0.14), head = rgb(0.07, 0.09, 0.2);
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const wrap = (text: string, f: typeof font, size: number): string[] => {
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const trial = line ? `${line} ${word}` : word;
      if (line && f.widthOfTextAtSize(trial, size) > maxW) { lines.push(line); line = word; }
      else line = trial;
      while (f.widthOfTextAtSize(line, size) > maxW && line.length > 1) { // hard-break an over-wide token
        let cut = line.length - 1;
        while (cut > 1 && f.widthOfTextAtSize(line.slice(0, cut), size) > maxW) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };

  const draw = (text: string, f: typeof font, size: number, gap: number, color = ink) => {
    const lineH = size * 1.35;
    for (const ln of wrap(pdfWinAnsi(text), f, size)) {
      if (y - lineH < MARGIN) { page = doc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
      if (ln) page.drawText(ln, { x: MARGIN, y: y - size, size, font: f, color });
      y -= lineH;
    }
    y -= gap;
  };

  if (title) draw(title, bold, 22, 12, head);

  const strip = (s: string) =>
    s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1")
      .replace(/`(.+?)`/g, "$1").replace(/^\s*>\s?/, "");

  for (const raw of content.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/\t/g, "    ");
    if (!line.trim()) { y -= 6; continue; } // blank line → vertical gap
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\s{0,3}(#{1,3})\s+(.*)$/))) {
      const lvl = m[1].length;
      draw(strip(m[2]), bold, lvl === 1 ? 18 : lvl === 2 ? 15 : 13, 6, head);
    } else if (/^\s{0,3}[-*•]\s+/.test(line)) {
      draw(`-  ${strip(line.replace(/^\s{0,3}[-*•]\s+/, ""))}`, font, 11, 2);
    } else if ((m = line.match(/^\s{0,3}(\d+)[.)]\s+(.*)$/))) {
      draw(`${m[1]}.  ${strip(m[2])}`, font, 11, 2);
    } else {
      draw(strip(line), font, 11, 4);
    }
  }
  return await doc.save();
}

/**
 * Absolute, publicly-reachable base URL for serving saved files. Saved artifacts
 * and generated images MUST be referenced by an absolute https URL so external
 * services (e.g. Instagram fetching an image_url to publish) can actually fetch
 * them — a relative "/api/uploads/ID" becomes a broken "https://api.uploads/ID"
 * when handed to a third-party API. Render injects RENDER_EXTERNAL_URL.
 */
function publicBaseUrl(): string {
  return (
    process.env["PUBLIC_BASE_URL"] ||
    process.env["RENDER_EXTERNAL_URL"] ||
    "https://bos-aura.onrender.com"
  ).replace(/\/$/, "");
}
function uploadUrl(id: number, download = false): string {
  return `${publicBaseUrl()}/api/uploads/${id}${download ? "?download=1" : ""}`;
}

// ─── Chunked artifact buffers ────────────────────────────────────────────────
// A large file (e.g. a base64 PDF) often does not fit in a single tool-call
// turn — the model's arguments truncate and the save fails repeatedly. To save
// it accurately, save_artifact accepts the content in ordered slices
// (chunk:true) which accumulate here, then assembles + stores them on done:true.
// Keyed per agent+filename; concatenating ordered string slices losslessly
// reconstructs the original payload regardless of where the model split it.
interface ArtifactBuffer { parts: string[]; bytes: number; encoding: string; mime?: string; updatedAt: number }
const artifactChunks = new Map<string, ArtifactBuffer>();
const ARTIFACT_CHUNK_TTL_MS = 15 * 60_000;
const ARTIFACT_CHUNK_MAX_CHARS = 30 * 1024 * 1024; // ~22 MB binary once decoded

function pruneArtifactChunks(now = Date.now()): void {
  for (const [k, v] of artifactChunks) {
    if (now - v.updatedAt > ARTIFACT_CHUNK_TTL_MS) artifactChunks.delete(k);
  }
}

function isTrue(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

/**
 * Build the bash+Playwright script for browser_login. The browser itself runs on
 * STEEL (managed, stealth, proxy + CAPTCHA-capable) — Playwright connects to it
 * over CDP, so the sandbox only needs `pip install playwright` (no local Chromium
 * or system deps). The operator's credentials are referenced as {{secret:NAME}}
 * placeholders (resolved by substituteSecrets just before the VM runs, then
 * redacted) and passed to Python via single-quoted env vars so they never sit in
 * the page-script source. The Steel CDP URL (which carries the Steel API key) is
 * embedded as a JSON literal and redacted from output. URL/selectors/steps are
 * JSON-embedded so quotes can't break the script. Exported for unit testing.
 */
export function buildBrowserLoginScript(opts: {
  cdpUrl: string;
  url: string;
  userSecret: string;
  passSecret: string;
  userSelector?: string;
  passSelector?: string;
  submitSelector?: string;
  steps?: string;
}): string {
  const j = (v: unknown) => JSON.stringify(v ?? "");
  const userSel = opts.userSelector || "input[type=email], input[name=email], input[name=username], input[id=identifierId], input[type=text]";
  const passSel = opts.passSelector || "input[type=password], input[name=password]";
  const submitSel = opts.submitSelector || "button[type=submit], input[type=submit], button#identifierNext, button:has-text('Sign in'), button:has-text('Log in'), button:has-text('Next')";
  return [
    "set -e",
    "pip install playwright -q >/dev/null 2>&1 || pip install playwright -q",
    `export BL_USER='{{secret:${opts.userSecret}}}'`,
    `export BL_PASS='{{secret:${opts.passSecret}}}'`,
    "python3 <<'PYEOF'",
    "import os, json",
    "from playwright.sync_api import sync_playwright",
    `CDP = json.loads(${j(j(opts.cdpUrl))})`,
    `URL = json.loads(${j(j(opts.url))})`,
    `USEL = json.loads(${j(j(userSel))})`,
    `PSEL = json.loads(${j(j(passSel))})`,
    `SSEL = json.loads(${j(j(submitSel))})`,
    `STEPS = json.loads(${j(j(opts.steps ?? ""))})`,
    'USER = os.environ.get("BL_USER", ""); PWD = os.environ.get("BL_PASS", "")',
    "with sync_playwright() as p:",
    "    browser = p.chromium.connect_over_cdp(CDP)",  // remote Steel browser
    "    context = browser.contexts[0] if browser.contexts else browser.new_context()",
    "    page = context.pages[0] if context.pages else context.new_page()",
    "    try:",
    '        page.goto(URL, wait_until="domcontentloaded", timeout=45000)',
    "        page.fill(USEL, USER, timeout=15000)",
    "        try:",
    "            page.fill(PSEL, PWD, timeout=4000)",
    "        except Exception:",
    "            # Two-step login (username, then password on the next screen).",
    "            page.click(SSEL, timeout=5000); page.wait_for_timeout(2000)",
    "            page.fill(PSEL, PWD, timeout=15000)",
    "        page.click(SSEL, timeout=8000)",
    "        page.wait_for_timeout(5000)",
    '        print("POST_LOGIN_URL:", page.url)',
    '        print("TITLE:", page.title())',
    '        print("BODY:", page.inner_text("body")[:1500])',
    "        if STEPS.strip():",
    '            exec(STEPS, {"page": page, "context": context, "browser": browser, "print": print})',
    "    except Exception as e:",
    '        print("BROWSER_LOGIN_ERROR:", repr(e)[:400])',
    "    finally:",
    "        browser.close()",
    "PYEOF",
  ].join("\n");
}

/**
 * Defense-in-depth for the code sandboxes: agent-authored code runs in a VM with
 * full network egress, so a {{secret:NAME}} it injects could be exfiltrated. When
 * SANDBOX_SECRET_ALLOWLIST is set (comma-separated names), only those secrets may
 * be referenced in sandbox/cloud_code_exec scripts; any other placeholder is
 * refused before execution. Unset = no restriction (preserves authenticated git
 * push and existing flows). Returns an error string to abort, or null to proceed.
 */
function sandboxSecretsBlocked(script: string): string | null {
  const allow = (process.env["SANDBOX_SECRET_ALLOWLIST"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!allow.length) return null;
  const referenced = [...script.matchAll(/\{\{secret:([^}]+)\}\}/gi)].map((m) => m[1]!.trim());
  const blocked = referenced.filter((n) => !allow.includes(n));
  if (blocked.length) {
    return `error: secret(s) ${[...new Set(blocked)].join(", ")} are not permitted in sandbox execution (SANDBOX_SECRET_ALLOWLIST). Nothing was executed.`;
  }
  return null;
}

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
  // Reject non-dotted-quad numeric encodings of an IP (decimal e.g. 2130706433,
  // hex e.g. 0x7f000001, octal, or shorthand 127.1). isIP() returns 0 for these,
  // so without this they'd skip the IP branch and reach DNS where some resolvers
  // map them back to 127.0.0.1 — a classic SSRF bypass. If the host has no
  // letters and isn't a normal dotted IPv4, treat it as a blocked numeric form.
  if (!isIP(host) && /^(0x[0-9a-f]+|\d+|\d{1,3}(\.\d{1,3}){1,2})$/i.test(host)) {
    return "error: numeric/shorthand IP encodings are blocked.";
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

// SerpAPI — real Google results. The operator has a SerpAPI key; it just was
// never wired into webSearch (only Tavily/Exa/Firecrawl were), so the key sat
// unused while those ran out of credit. Highest quality, so it runs FIRST.
// Reads SERP_API_KEY (preferred) or SERP_AI_API_KEY.
async function serpapiSearch(query: string, limit: number): Promise<string> {
  const key = process.env["SERP_API_KEY"] || process.env["SERP_AI_API_KEY"];
  if (!key) throw new Error("SERP_API_KEY is not set");
  const url = `https://serpapi.com/search.json?engine=google&num=${Math.max(1, Math.min(20, limit))}&q=${encodeURIComponent(query)}&api_key=${encodeURIComponent(key)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`SerpAPI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = (await r.json()) as {
    error?: string;
    organic_results?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  if (data.error) throw new Error(`SerpAPI: ${data.error}`);
  const results = (data.organic_results ?? []).slice(0, limit);
  if (!results.length) return `no web results for "${query}".`;
  return `[search provider: serpapi/google]\n${results
    .map((x, i) => `${i + 1}. ${x.title ?? "(untitled)"}\n   ${x.link ?? ""}\n   ${clip((x.snippet ?? "").trim(), 300)}`)
    .join("\n\n")}`;
}

// POST to the keyless FreeCrawl instance with COLD-START retry. FreeCrawl runs
// on a free Render tier that spins DOWN when idle, so the first request after an
// idle period must wake the dyno (~30-60s) and frequently aborts on the
// per-attempt timeout. FreeCrawl is only ever reached when the paid providers
// are out of credit/throttled — exactly the moment a single timeout blinds the
// whole swarm (observed live 2026-06-14: every paid search provider 402/429 and
// "freecrawl: operation aborted due to timeout" → zero results). Retrying lets
// that first request wake the instance and a follow-up hit it warm. Retries only
// transient failures (timeout / network / 5xx); a 4xx or a body-level error is a
// real error and fails fast. Returns the parsed JSON body.
async function freecrawlPost(
  path: string,
  body: Record<string, unknown>,
  opts: { attempts?: number; perAttemptMs?: number } = {},
): Promise<Record<string, unknown>> {
  const attempts = opts.attempts ?? 3;
  const perAttemptMs = opts.perAttemptMs ?? 60_000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    let retryable = true; // a thrown fetch timeout / network error is retryable
    try {
      const r = await fetch(`${FREECRAWL_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(perAttemptMs),
      });
      if (r.ok) {
        const data = (await r.json()) as Record<string, unknown>;
        if (data["error"]) { retryable = false; throw new Error(String(data["error"])); }
        return data;
      }
      const text = (await r.text()).slice(0, 200);
      retryable = r.status >= 500; // 4xx = real client error; 5xx = cold-start/transient
      throw new Error(`FreeCrawl ${r.status}: ${text}`);
    } catch (e) {
      lastErr = e;
      if (!retryable || i === attempts - 1) break;
      await new Promise((res) => setTimeout(res, 2000 * (i + 1))); // backoff lets the cold start wake
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Keyless last-resort search: scrape DuckDuckGo's lightweight HTML results page
// through FreeCrawl (self-hosted, always on). Needs NO API key or credits, so
// web_search never fully fails just because the paid providers are throttled or
// out of credit (observed live 2026-06-13: tavily 432 + exa 402 blinded the
// whole swarm). Lower quality than Tavily/Exa, so it runs only after them.
async function freecrawlSearch(query: string, limit: number): Promise<string> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  // Cold-start retry (see freecrawlPost): the first request after idle wakes the
  // free-tier dyno; without the retry that wake-up timeout left the swarm blind
  // the instant the paid providers were out of credit.
  const data = (await freecrawlPost(
    "/scrape",
    { url, formats: ["markdown", "links"], include_links: true },
    { attempts: 3, perAttemptMs: 60_000 },
  )) as { markdown?: string; links?: string[] };
  // DuckDuckGo HTML wraps each target in a redirect link (/l/?uddg=<encoded>).
  const decode = (href: string): string | null => {
    try {
      const m = href.match(/[?&]uddg=([^&]+)/);
      if (m) return decodeURIComponent(m[1]);
      if (/^https?:\/\//i.test(href) && !/duckduckgo\.com/i.test(href)) return href;
    } catch { /* ignore */ }
    return null;
  };
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const href of data.links ?? []) {
    const t = decode(href);
    if (t && !seen.has(t)) { seen.add(t); urls.push(t); }
    if (urls.length >= limit) break;
  }
  const md = (data.markdown ?? "").trim();
  if (!urls.length && !md) return `no web results for "${query}".`;
  const list = urls.map((u, i) => `${i + 1}. ${u}`).join("\n");
  return `[search provider: freecrawl/duckduckgo — keyless fallback]\n${list}${md ? `\n\n--- results page text ---\n${clip(md, 1500)}` : ""}`;
}

// ─── Multi-provider web search ───────────────────────────────────────────────
// Tries the configured search providers in order of preference: Tavily (broad,
// fast) → Exa (neural/semantic) → Firecrawl → FreeCrawl/DuckDuckGo (keyless,
// always on). Falls through to the next provider on any error so a single
// provider outage — or all paid providers being out of credit — never blinds
// the swarm.

async function webSearch(query: string, limit: number): Promise<string> {
  const providers: Array<{ name: string; enabled: boolean; run: () => Promise<string> }> = [
    { name: "serpapi", enabled: !!(process.env["SERP_API_KEY"] || process.env["SERP_AI_API_KEY"]), run: () => serpapiSearch(query, limit) },
    { name: "tavily", enabled: !!process.env["TAVILY_API_KEY"], run: () => tavilySearch(query, limit) },
    { name: "exa", enabled: !!process.env["EXA_API_KEY"], run: () => exaSearch(query, limit) },
    { name: "firecrawl", enabled: !!process.env["FIRECRAWL_API_KEY"], run: () => firecrawlSearch(query, limit) },
    // Always-on keyless backstop — keeps search working when the paid keys fail.
    { name: "freecrawl", enabled: true, run: () => freecrawlSearch(query, limit) },
  ].filter((p) => p.enabled);

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

/** FreeCrawl fallback scrape — used when Steel is unavailable or blocked.
 * Uses the same cold-start retry as freecrawlSearch so an idle free-tier dyno
 * doesn't fail the scrape on its first (wake-up) request. */
async function freecrawlScrape(url: string): Promise<string> {
  const data = await freecrawlPost(
    "/scrape",
    { url, formats: ["markdown", "text"], include_links: false },
    { attempts: 3, perAttemptMs: 45_000 },
  );
  return (data["markdown"] as string) || (data["text"] as string) || "";
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

/**
 * Normalize GitHub HTTPS auth in a shell script to the form that actually works.
 *
 * GitHub rejects `https://<token>@github.com/...` (token as username, EMPTY
 * password) with "Invalid username or token. Password authentication is not
 * supported for Git operations." — the exact error the swarm hit on every mirror
 * push. The form that authenticates for PAT/GitHub-App tokens is
 * `https://x-access-token:<token>@github.com/...`. We rewrite any single-userinfo
 * github.com URL to that form so an authenticated clone/push/mirror just works,
 * regardless of how the agent wrote the URL. URLs that already carry a
 * `user:pass`-style colon are left untouched.
 */
export function normalizeGitHubAuth(script: string): string {
  return script.replace(/https:\/\/([^/@:\s]+)@github\.com/g, "https://x-access-token:$1@github.com");
}

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
      let content: string;
      try {
        content = await steelScrape(url);
      } catch (steelErr) {
        // Steel unavailable — fall back to FreeCrawl (self-hosted, always on)
        try {
          content = await freecrawlScrape(url);
        } catch {
          return `error scraping ${url}: ${String(steelErr)}`;
        }
      }
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

  site_crawl: {
    name: "site_crawl",
    description:
      "Recursively crawl an entire website and return all pages as clean Markdown. Use when you need to ingest a whole docs site, knowledge base, or multi-page resource — not just a single page. Returns a job_id immediately; poll with site_crawl_status to get results. Backed by FreeCrawl (self-hosted).",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Root URL to start crawling from." },
        max_pages: { type: "integer", description: "Max pages to crawl (default 30, max 200).", minimum: 1, maximum: 200 },
        max_depth: { type: "integer", description: "Link depth to follow (default 2, max 5).", minimum: 1, maximum: 5 },
        include_patterns: {
          type: "array",
          items: { type: "string" },
          description: "Regex patterns — only crawl URLs matching at least one. Leave empty to crawl all same-domain pages.",
        },
      },
      required: ["url"],
    },
    run: async (args) => {
      const url = String(args["url"] ?? "").trim();
      if (!/^https?:\/\//i.test(url)) return "error: valid absolute http(s) url required.";
      const maxPages = Math.min(Number(args["max_pages"] ?? 30), 200);
      const maxDepth = Math.min(Number(args["max_depth"] ?? 2), 5);
      const includePatterns = (args["include_patterns"] as string[] | undefined) ?? [];
      try {
        const r = await fetch(`${FREECRAWL_BASE}/crawl`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, max_pages: maxPages, max_depth: maxDepth, include_patterns: includePatterns }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) return `error: FreeCrawl ${r.status} — ${(await r.text()).slice(0, 200)}`;
        const data = (await r.json()) as Record<string, unknown>;
        return `crawl job queued. job_id=${data["job_id"]} status=${data["status"]} url=${url} max_pages=${maxPages}. Poll with site_crawl_status to get results.`;
      } catch (err) {
        return `error: ${String(err)}`;
      }
    },
  },

  site_crawl_status: {
    name: "site_crawl_status",
    description:
      "Poll a site_crawl job and return its status and completed page content. Call after site_crawl to retrieve crawled Markdown pages.",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "The job_id returned by site_crawl." },
        include_pages: { type: "boolean", description: "Set true to get the full Markdown content of all crawled pages (default false — just status/counts)." },
      },
      required: ["job_id"],
    },
    run: async (args) => {
      const jobId = String(args["job_id"] ?? "").trim();
      const includePages = Boolean(args["include_pages"] ?? false);
      try {
        const r = await fetch(
          `${FREECRAWL_BASE}/crawl/${jobId}?include_pages=${includePages}`,
          { signal: AbortSignal.timeout(15_000) },
        );
        if (!r.ok) return `error: FreeCrawl ${r.status} — ${(await r.text()).slice(0, 200)}`;
        const data = (await r.json()) as Record<string, unknown>;
        const pages = (data["pages"] as Array<Record<string, unknown>> | undefined) ?? [];
        const summary = `job_id=${jobId} status=${data["status"]} pages_done=${data["pages_done"]}/${data["pages_found"]}`;
        if (!includePages || pages.length === 0) return summary;
        const pageTexts = pages
          .slice(0, 20)
          .map((p) => `### ${p["url"]}\n${String(p["markdown"] ?? p["text"] ?? "(no content)").slice(0, 2000)}`)
          .join("\n\n---\n\n");
        return clip(`${summary}\n\n${pageTexts}`, 12000);
      } catch (err) {
        return `error: ${String(err)}`;
      }
    },
  },

  http_request: {
    name: "http_request",
    description:
      "Make a real outbound HTTP request to any API endpoint. Supports GET/POST/PUT/PATCH/DELETE with optional headers and a JSON/text body. Returns the status and response body (truncated). " +
      "To authenticate ANY private/authenticated API (Render, OpenAI, etc.), put a vault secret placeholder in the header rather than a raw key — e.g. headers { \"Authorization\": \"Bearer {{secret:RENDER_API_KEY}}\" }. " +
      "The placeholder is resolved to the real value only at send time, so the secret never enters your context — the vault is write-only BY DESIGN and you never need the raw key. Use vault_list (or the STORED SECRETS list in your prompt) to see which names exist; if a name is there the credential is available — never report it missing, just use {{secret:NAME}} and make the call. " +
      "GITHUB API (api.github.com): DO NOT add an Authorization header — GitHub is AUTO-AUTHENTICATED by the server at 5,000 req/hr. Just call https://api.github.com/... with NO Authorization header and the token is injected automatically. Adding {{secret:GITHUB_API_KEY}} manually will FAIL if that vault name does not exist; omitting the header lets auto-auth handle it correctly.",
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

      // If a {{secret:NAME}} placeholder did NOT resolve, the exact name isn't in
      // the vault. Fail loudly here instead of firing a request that sends the
      // literal "{{secret:...}}" string as a credential (a guaranteed 401) and
      // then mis-reporting the key as invalid/missing.
      if (hasSecretPlaceholder(url) || Object.values(headers).some(hasSecretPlaceholder) || (body != null && hasSecretPlaceholder(body))) {
        return await unresolvedSecretError(`${url}\n${Object.values(headers).join("\n")}\n${body ?? ""}`);
      }

      // Auto-authenticate the APIs the swarm calls constantly. Agents repeatedly
      // send these with NO Authorization header (e.g. headers={}) and then read
      // the resulting 401 as "the key is invalid / the service isn't connected" —
      // when in fact they simply never attached the credential. When the vault has
      // the token (loaded into env at boot) and the agent didn't set Authorization,
      // attach it. The token never enters the model context and is redacted from
      // any echoed response.
      try {
        const host = new URL(url).hostname.toLowerCase();
        const lc = Object.keys(headers).map((k) => k.toLowerCase());
        if (host === "api.github.com" || host.endsWith(".githubusercontent.com")) {
          const ghToken = process.env["GITHUB_API_KEY"] || process.env["GITHUB_TOKEN"] || process.env["SANDBOX_GITHUB_TOKEN"];
          if (ghToken && !lc.includes("authorization")) {
            headers["Authorization"] = `Bearer ${ghToken}`;
            usedSecrets.add(ghToken);
          }
          if (!lc.includes("user-agent")) headers["User-Agent"] = "OpenClaw-Omega";
          if (host === "api.github.com" && !lc.includes("accept")) headers["Accept"] = "application/vnd.github+json";
        } else if (host === "api.render.com") {
          const rnToken = process.env["RENDER_API_KEY"];
          if (rnToken && !lc.includes("authorization")) {
            headers["Authorization"] = `Bearer ${rnToken}`;
            usedSecrets.add(rnToken);
          }
          if (!lc.includes("accept")) headers["Accept"] = "application/json";
        }
      } catch { /* url already validated above; ignore */ }
      const authSent = Object.keys(headers).some((k) => k.toLowerCase() === "authorization");

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      try {
        // Follow redirects manually so every hop is re-checked by ssrfGuard — a
        // public/open-redirect URL must not be able to bounce us onto an
        // internal target.
        let currentUrl = url;
        const originalOrigin = new URL(url).origin;
        let r: Response | null = null;
        let reqHeaders = headers;
        let reqBody = body;
        for (let hop = 0; hop < 5; hop++) {
          r = await fetch(currentUrl, { method, headers: reqHeaders, body: reqBody, signal: ctrl.signal, redirect: "manual" });
          if (r.status < 300 || r.status >= 400) break;
          const location = r.headers.get("location");
          if (!location) break;
          const next = new URL(location, currentUrl).toString();
          if (!/^https?:\/\//i.test(next)) return "error: redirect to a non-http(s) target was blocked.";
          const redirectBlocked = await ssrfGuard(next);
          if (redirectBlocked) return `error: redirect blocked — ${redirectBlocked.replace(/^error: /, "")}`;
          // Cross-origin redirect: strip credentials and the body before following,
          // exactly as browsers do — otherwise an open-redirect would forward the
          // operator's Authorization header (incl. injected vault/GitHub/Render
          // tokens) and request body to an arbitrary attacker host.
          if (new URL(next).origin !== originalOrigin) {
            reqHeaders = Object.fromEntries(
              Object.entries(reqHeaders).filter(([k]) => !/^(authorization|cookie|x-api-key)$/i.test(k)),
            );
            reqBody = undefined;
          }
          currentUrl = next;
          if (hop === 4) return "error: too many redirects.";
        }
        if (!r) return "error: request failed: no response.";
        const text = await r.text();
        // Strip any injected secret values that the endpoint may have echoed
        // back before this result is stored or fed to the model.
        const safe = redactSecrets(text, usedSecrets);
        // A 401/403 on a request we sent with NO Authorization header is a
        // missing-credential mistake, not proof the key is bad. Tell the agent so
        // it retries with the placeholder instead of declaring the service dead.
        const hint =
          (r.status === 401 || r.status === 403) && !authSent
            ? `\n\n[hint: this request was sent with NO Authorization header — that is why it was rejected. This is NOT evidence the credential is missing or invalid. Retry with headers {"Authorization":"Bearer {{secret:NAME}}"} using the correct vault name (see vault_list / your STORED SECRETS list).]`
            : "";
        return `HTTP ${r.status} ${r.statusText}\n${clip(safe, 4000)}${hint}`;
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
      "Execute code in a fully isolated E2B cloud sandbox (a real remote VM with network access and a full runtime). Supports 'python' and 'javascript'. Use this instead of code_exec when the code needs network access, pip/npm packages, or stronger isolation than the local sandbox. Returns stdout/stderr/result. You can authenticate calls using your vault secrets via the {{secret:NAME}} placeholder (injected at run time, redacted from output).",
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
      const rawSource = String(args["source"] ?? "");
      if (!rawSource.trim()) return "error: source is required.";
      if (!e2bConfigured()) {
        return "error: E2B cloud sandbox is not configured (set E2B_API_KEY). Use code_exec for local execution instead.";
      }
      const cloudSecretBlock = sandboxSecretsBlocked(rawSource);
      if (cloudSecretBlock) return cloudSecretBlock;
      // Resolve {{secret:NAME}} placeholders (injected only into the code sent to
      // the remote VM, redacted from the returned output) so code can authenticate.
      const usedSecrets = new Set<string>();
      const source = await substituteSecrets(rawSource, usedSecrets);
      if (hasSecretPlaceholder(source)) {
        return await unresolvedSecretError(source);
      }
      return redactSecrets(await e2bExec(language, source), usedSecrets);
    },
  },

  sandbox_exec: {
    name: "sandbox_exec",
    description:
      "Run a shell script inside a fresh, isolated E2B cloud VM (its own real computer — node, git, network, full Linux). Use for anything that needs a real dev environment: clone a public repo, install packages, run a build/test suite, run scripts, curl APIs, etc. " +
      "It is also your INTERACTIVE-AUTOMATION substrate: pip/npm-install and drive real tools here — e.g. Playwright (`pip install playwright && playwright install chromium`) to navigate multi-step web forms, fill fields, click, and submit; or reportlab/fpdf2/fillpdf/pypdf to generate and fill official PDF forms (e.g. AcroForm fields). Print results/paths to stdout and read back any output. " +
      "STATELESS: each call is a clean disposable VM and files do NOT persist between calls — generate a file, base64 it, and print it ALL in ONE script (then pass to save_artifact); never write in one call and read in the next. " +
      "It cannot read the OpenClaw server, its database, or its filesystem — BUT it CAN authenticate using your vault secrets via the {{secret:NAME}} placeholder: the real value is injected into the command at run time and redacted from the returned output. So authenticated git works, e.g. `git remote set-url origin https://x-access-token:{{secret:GITHUB_API_KEY}}@github.com/<owner>/<repo>.git && git push` (the x-access-token: form is auto-applied even if you omit it). Use vault_list / your STORED SECRETS list for exact names. For changes to the OpenClaw repo with an automatic PR, prefer sandbox_repo_pr.",
    parameters: {
      type: "object",
      properties: {
        script: { type: "string", description: "A bash script to run in the VM (commands can be chained with && and newlines)." },
      },
      required: ["script"],
    },
    run: async (args) => {
      const raw = String(args["script"] ?? "").trim();
      if (!raw) return "error: script is required.";
      if (!sandboxConfigured()) return "error: E2B cloud sandbox is not configured (E2B_API_KEY).";
      const sandboxSecretBlock = sandboxSecretsBlocked(raw);
      if (sandboxSecretBlock) return sandboxSecretBlock;
      // Resolve {{secret:NAME}} placeholders the same way http_request does, so a
      // script can authenticate (e.g. git push to https://{{secret:GITHUB_API_KEY}}@…)
      // without the literal placeholder reaching the shell. Raw values are injected
      // ONLY into the command sent to the VM and redacted from the returned output.
      const usedSecrets = new Set<string>();
      let script = await substituteSecrets(raw, usedSecrets);
      if (hasSecretPlaceholder(script)) {
        return await unresolvedSecretError(script);
      }
      // Rewrite "https://<token>@github.com" → "https://x-access-token:<token>@…"
      // so authenticated git push/mirror works (the bare-token form is rejected
      // by GitHub as "password authentication is not supported").
      script = normalizeGitHubAuth(script);
      return redactSecrets(await runInSandbox(script), usedSecrets);
    },
  },

  browser_login: {
    name: "browser_login",
    description:
      "HARD FALLBACK for sites with no connected API: log into a website AS THE OPERATOR using their vaulted credentials, then optionally drive the page. The browser runs on STEEL (managed, stealth, residential proxy + CAPTCHA-solving) and Playwright connects to it over CDP. " +
      "Pass `url` (the login page), `username_secret` and `password_secret` (the VAULT NAMES, e.g. 'MYSITE_EMAIL' / 'MYSITE_PASSWORD' — never a raw password; the operator stores these in the vault and you reference the name only). Optionally pass CSS selectors (`username_selector`, `password_selector`, `submit_selector`) if the defaults miss, and `steps`: Python lines that use the Playwright `page` object to do the task after login (e.g. page.goto(...), page.click(...), print(page.inner_text('main'))). " +
      "PREFER a connected Composio app when one exists — use this only when there is no API, for accounts the operator owns. 2FA-gated sites may still challenge. Never use this to open financial accounts or submit government IDs.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The login page URL (https://…)." },
        username_secret: { type: "string", description: "Vault NAME holding the username/email (not the value)." },
        password_secret: { type: "string", description: "Vault NAME holding the password (not the value)." },
        username_selector: { type: "string", description: "Optional CSS selector for the username/email field." },
        password_selector: { type: "string", description: "Optional CSS selector for the password field." },
        submit_selector: { type: "string", description: "Optional CSS selector for the submit/next button." },
        steps: { type: "string", description: "Optional Python lines (using the Playwright `page` object) to run after login to perform the task." },
      },
      required: ["url", "username_secret", "password_secret"],
    },
    run: async (args) => {
      const url = String(args["url"] ?? "").trim();
      const userSecret = String(args["username_secret"] ?? "").trim();
      const passSecret = String(args["password_secret"] ?? "").trim();
      const steps = args["steps"] != null ? String(args["steps"]) : "";
      if (!url || !userSecret || !passSecret) {
        return "error: url, username_secret, and password_secret (vault names) are all required.";
      }
      const urlBlocked = await ssrfGuard(url);
      if (urlBlocked) return urlBlocked;
      // HARD GUARDRAIL: never use the browser to open a financial account or
      // submit government-ID/KYC identity, regardless of how the steps are framed.
      const policy = assessActionRisk(`${url} ${steps}`);
      if (policy.blocked) return policyRefusal(policy);
      const steelKey = process.env["STEEL_API_KEY"];
      if (!steelKey) return "error: the browser fallback runs on Steel — set STEEL_API_KEY.";
      if (!sandboxConfigured()) return "error: the browser fallback needs the E2B sandbox to host Playwright (set E2B_API_KEY).";

      // 1) Open a managed Steel browser session (proxy + CAPTCHA solving on).
      let sessionId: string;
      try {
        const r = await fetch(`${STEEL_BASE}/sessions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${steelKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ solveCaptcha: true, useProxy: true, sessionTimeout: 300000 }),
        });
        if (!r.ok) return `error: could not start a Steel browser session (HTTP ${r.status}).`;
        const data = (await r.json()) as { id?: string };
        if (!data.id) return "error: Steel did not return a session id.";
        sessionId = data.id;
      } catch (e) {
        return `error: Steel session start failed: ${String(e).slice(0, 200)}`;
      }

      try {
        // 2) Playwright connects to the remote Steel browser over CDP. The key is
        //    in the URL — embedded server-side, redacted from any output.
        const cdpUrl = `wss://connect.steel.dev?apiKey=${steelKey}&sessionId=${sessionId}`;
        const rawScript = buildBrowserLoginScript({
          cdpUrl,
          url,
          userSecret,
          passSecret,
          userSelector: args["username_selector"] != null ? String(args["username_selector"]) : undefined,
          passSelector: args["password_selector"] != null ? String(args["password_selector"]) : undefined,
          submitSelector: args["submit_selector"] != null ? String(args["submit_selector"]) : undefined,
          steps,
        });
        const allowBlock = sandboxSecretsBlocked(rawScript);
        if (allowBlock) return allowBlock;
        // Inject the vaulted credentials (by name) just-in-time; redact the
        // Steel key AND the credential values from everything returned.
        const usedSecrets = new Set<string>([steelKey]);
        const script = await substituteSecrets(rawScript, usedSecrets);
        if (hasSecretPlaceholder(script)) {
          return `error: a credential vault name did not resolve — '${userSecret}' and/or '${passSecret}' are not in the vault. Add them in Settings → vault, then retry. (Nothing was executed.)`;
        }
        return redactSecrets(await runInSandbox(script), usedSecrets);
      } finally {
        // 3) Always release the Steel session (single-run, no lingering browser).
        //    DELETE /sessions/{id} is the release method used elsewhere in this codebase.
        await fetch(`${STEEL_BASE}/sessions/${sessionId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${steelKey}` },
        }).catch(() => {});
      }
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
      "Persist a fact, finding, or result to the swarm's shared long-term memory (durable — Postgres + semantic vector search, survives across runs) so any agent can retrieve it later. Use it to LEARN: after you solve a non-obvious problem or verify something online, store the lesson in reusable 'PROBLEM → SOLUTION (evidence)' form with clear tags, so the swarm never re-learns it.",
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

  marketing_playbook: {
    name: "marketing_playbook",
    description:
      "Return the Marketing Engine — the universal plug-and-play post→conversion playbook (ANY niche/offer/platform). Call with NO args BEFORE writing any marketing content for the core engine: hook→problem→insight→value→CTA→follow-up, one goal + one CTA keyword, platform-tuned, accuracy-first (research & cite every claim — never fabricate stats/studies/testimonials). Pass a `section` for the enterprise build (campaign_brief, offer_ladder, audience, post_templates, campaign_types, lead_magnets, dm_flow, landing_page, email_nurture, paid_media, channels, production, governance, qa, kpis, experiments, rollout). Execute with image_generate → instagram_post/composio_action → schedule_task → memory_write.",
    parameters: {
      type: "object",
      properties: {
        section: {
          type: "string",
          enum: Object.keys(MARKETING_SECTIONS),
          description: "Optional deep module to return instead of the core engine.",
        },
      },
    },
    run: async (args) => marketingPlaybook(args["section"] != null ? String(args["section"]) : undefined),
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
      "For text deliverables pass the text in `content` (encoding 'utf8'). For a binary file you generated in sandbox_exec/code_exec (e.g. a PDF), base64-encode it there (`base64 -w0 file.pdf`), print it, then pass that string as `content` with encoding 'base64'. " +
      "If the base64 is too large to fit in one call, save it in CHUNKS: call repeatedly with `chunk:true` and a slice of the base64 in `content` (same filename + encoding each time), in order, then a final call with `done:true` (no content needed) to assemble and store the file. Never claim a file exists without saving it here first.",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "File name with extension, e.g. 'fl-llc-articles.pdf' or 'market-research.md'." },
        content: { type: "string", description: "The file content: UTF-8 text, or base64 bytes when encoding='base64'. For a chunked save, a consecutive slice of the full content." },
        mime: { type: "string", description: "Optional MIME type, e.g. 'application/pdf', 'text/markdown', 'text/csv'. Inferred from the extension if omitted." },
        encoding: { type: "string", enum: ["utf8", "base64"], description: "How `content` is encoded (default 'utf8')." },
        chunk: { type: "boolean", description: "Set true to APPEND this content slice to a buffer instead of saving immediately (for large files split across calls). Finish with a call where done=true." },
        done: { type: "boolean", description: "Set true to assemble all previously buffered chunks for this filename and save the file. May include a final content slice." },
      },
      required: ["filename"],
    },
    run: async (args, ctx) => {
      pruneArtifactChunks();
      const filename = String(args["filename"] ?? "").trim().slice(0, 255) || "artifact";
      const chunkMode = isTrue(args["chunk"]);
      const doneMode = isTrue(args["done"]);
      const bufKey = `${ctx.agentId}:${filename}`;
      let encoding = String(args["encoding"] ?? "utf8").toLowerCase() === "base64" ? "base64" : "utf8";
      const encodingExplicit = args["encoding"] != null;
      let raw: string;

      // ── Chunked save: accumulate ordered slices, assemble on done. ──
      if (chunkMode || doneMode) {
        const buf = artifactChunks.get(bufKey) ?? { parts: [], bytes: 0, encoding, updatedAt: Date.now() };
        const slice = String(args["content"] ?? "");
        if (slice) {
          if (buf.bytes + slice.length > ARTIFACT_CHUNK_MAX_CHARS) {
            artifactChunks.delete(bufKey);
            return "error: chunked artifact exceeded the size limit; aborted. Save a smaller file.";
          }
          buf.parts.push(slice);
          buf.bytes += slice.length;
          if (String(args["encoding"] ?? "").toLowerCase() === "base64") buf.encoding = "base64";
          if (args["mime"] != null) buf.mime = String(args["mime"]);
          buf.updatedAt = Date.now();
          artifactChunks.set(bufKey, buf);
        }
        if (!doneMode) {
          return `chunk stored for "${filename}" (${buf.parts.length} chunk${buf.parts.length === 1 ? "" : "s"}, ${buf.bytes} chars buffered). Send the next chunk, or call with done:true to assemble and save.`;
        }
        // Finalize: assemble buffered chunks, then fall through to the save path.
        if (buf.parts.length === 0) return "error: no chunks were buffered for this filename — nothing to assemble.";
        artifactChunks.delete(bufKey);
        raw = buf.parts.join("");
        if (buf.mime != null && args["mime"] == null) (args as Record<string, unknown>)["mime"] = buf.mime;
        encoding = buf.encoding === "base64" ? "base64" : "utf8";
      } else {
        raw = String(args["content"] ?? "");
        if (!raw) return "error: content is required.";
      }
      // Models routinely pass base64 binary content but forget encoding:'base64'.
      // Stored as utf8 that double-encodes the file — the served "PNG" is base64
      // text Instagram/browsers can't decode (observed live: attachment #476).
      // Detect the well-known binary magic prefixes in their base64 form and
      // auto-correct: iVBORw0KGgo=PNG, /9j/=JPEG, JVBERi0=PDF, UEsDB=ZIP/DOCX.
      if (!encodingExplicit && encoding === "utf8" && /^(iVBORw0KGgo|\/9j\/|JVBERi0|UEsDB)[A-Za-z0-9+/=\s]*$/.test(raw.trim().slice(0, 100)) && /^[A-Za-z0-9+/=\s]+$/.test(raw.trim())) {
        encoding = "base64";
      }
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
        const url = uploadUrl(row.id, true);
        return `saved "${filename}" (${bytes} bytes, ${mimeType}). Operator download link — INCLUDE THIS in your final answer:\n[Download ${filename}](${url})`;
      } catch (e) {
        return `error: could not save artifact: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`;
      }
    },
  },

  image_generate: {
    name: "image_generate",
    description:
      "Generate an IMAGE from a text prompt and save it as a downloadable file; returns a markdown image preview plus a public URL + download link. Use whenever the operator asks for an image, picture, logo, illustration, diagram, icon, mockup, poster, or banner. This is ONE generator that combines several image models (FLUX.2 pro/dev, Gemini Flash Image, Seedream, …) with automatic fallback: if the chosen model errors, refuses, or is out of credit it transparently retries the next — so generation never hard-fails on a single model. Needs IMAGE_API_KEY (DeepInfra, serves the whole menu) or OPENAI_API_KEY.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "What to draw — describe the image in detail." },
        size: { type: "string", enum: ["1024x1024", "1536x1024", "1024x1536"], description: "Image size (default 1024x1024)." },
        model: { type: "string", description: "Optional model / routing hint — leave empty for the smart default (FLUX.2 pro) with automatic fallback. Hints: 'photo' (FLUX.2 pro, best photoreal+text), 'text'/'edit' (Gemini Flash Image 2.5, best instruction-following), 'budget' (FLUX.2 dev, cheapest), 'seedream' (bilingual), 'max'/'hero' (FLUX.2 max, top quality). Or pass any provider slug, e.g. 'black-forest-labs/FLUX-2-pro'. The pick leads; the rest stay as fallback." },
        filename: { type: "string", description: "Optional output filename, e.g. 'logo.png'." },
      },
      required: ["prompt"],
    },
    run: async (args) => {
      const prompt = String(args["prompt"] ?? "").trim();
      if (!prompt) return "error: prompt is required.";
      const allowed = new Set(["1024x1024", "1536x1024", "1024x1536"]);
      const size = allowed.has(String(args["size"])) ? String(args["size"]) : "1024x1024";

      // ── The combined image generator ─────────────────────────────────────
      // Several image models behind ONE tool, sharing an OpenAI-compatible
      // /images/generations endpoint (DeepInfra by default — it serves FLUX.2,
      // Seedream and Google models under a single key), plus a gpt-image-1
      // OpenAI backstop. We try them in order and fall through to the next on
      // ANY failure — exactly like web_search — so one model outage, a content
      // refusal, or an out-of-credit key never blocks the swarm. `model`
      // reorders the chain (routes the job) but keeps the rest as fallback.
      type ImgModel = { id: string; label: string; base: string; key?: string; tags: string[]; kind?: "openai" | "hf" };
      const diBase = (process.env["IMAGE_BASE_URL"] ?? "https://api.deepinfra.com/v1/openai").replace(/\/$/, "");
      const diKey = process.env["IMAGE_API_KEY"] || process.env["DEEPINFRA_API_KEY"];
      const oaBase = (process.env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1").replace(/\/$/, "");
      const oaKey = process.env["OPENAI_API_KEY"] || process.env["IMAGE_API_KEY"];
      // Bitdeer image backend — OpenAI-compatible /images/generations at
      // api-inference.bitdeer.ai (model: seedream-5.0-lite). Keyed off the
      // operator's own BITDEER_API_KEY, so when no DeepInfra key is set the chain
      // does NOT collapse to a single billing-blocked OpenAI model: Bitdeer is a
      // real, key-backed fallback that keeps image_generate working. Verified
      // 2026-06-15 against bitdeer.ai/en/services/ai-inference (OpenAI-compatible).
      const bdBase = (process.env["BITDEER_IMAGE_BASE_URL"] ?? "https://api-inference.bitdeer.ai/v1").replace(/\/$/, "");
      const bdKey = process.env["BITDEER_API_KEY"];
      const bdImageModel = process.env["BITDEER_IMAGE_MODEL"] ?? "seedream-5.0-lite";
      const di = (id: string, label: string, tags: string[]): ImgModel => ({ id, label, base: diBase, key: diKey, tags });
      const bitdeer: ImgModel = { id: bdImageModel, label: `Bitdeer ${bdImageModel}`, base: bdBase, key: bdKey, tags: ["bitdeer", "bd", "seedream", "imagen"] };
      const gptImage: ImgModel = { id: "gpt-image-1", label: "gpt-image-1", base: oaBase, key: oaKey, tags: ["openai", "dalle", "gpt"] };
      // Hugging Face Inference — the FREE backend. FLUX.1-schnell on the free tier
      // (a no-credit-card HF access token). Different protocol from the rest: POST
      // {inputs} → raw image BYTES (not OpenAI /images/generations JSON), so it has
      // its own request branch below (kind:"hf"). Keyed off a free HUGGINGFACE_API_KEY
      // so image_generate has a zero-cost path that can't hit a billing limit.
      // Verified 2026-06-15: router.huggingface.co/hf-inference route is live (401
      // without a token — i.e. real, just needs the free key).
      const hfBase = (process.env["HF_IMAGE_BASE_URL"] ?? "https://router.huggingface.co/hf-inference/models").replace(/\/$/, "");
      const hfKey = process.env["HUGGINGFACE_API_KEY"] || process.env["HF_TOKEN"] || process.env["HF_API_KEY"];
      const hfImageModel = process.env["HF_IMAGE_MODEL"] ?? "black-forest-labs/FLUX.1-schnell";
      const huggingface: ImgModel = { id: hfImageModel, label: `Hugging Face ${hfImageModel}`, base: hfBase, key: hfKey, tags: ["hf", "huggingface", "free", "flux", "schnell"], kind: "hf" };

      let chain: ImgModel[];
      const custom = (process.env["IMAGE_MODELS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const single = process.env["IMAGE_MODEL"];
      if (custom.length) {
        chain = custom.map((id) => di(id, id, [])); // explicit operator-defined fallback chain
      } else if (single) {
        // Legacy single-model config stays honored (base auto-routes by slug shape).
        const slug = single.includes("/");
        chain = [slug ? di(single, single, []) : { ...gptImage, id: single, label: single }];
      } else {
        // Default combined router: FREE Hugging Face first (zero cost, no billing
        // limit) when its key is set, then best photoreal/cost, cheapest, then the
        // OpenAI backstop (only reachable when a DeepInfra key is absent).
        chain = [
          huggingface,
          di("black-forest-labs/FLUX-2-pro", "FLUX.2 pro", ["photo", "flux", "default", "photoreal", "logo", "poster", "banner"]),
          di("google/flash-image-2.5", "Gemini Flash Image 2.5", ["text", "edit", "gemini", "flash", "instruction", "nano"]),
          di("byteplus/Seedream-5.0-Lite", "Seedream 5.0 Lite", ["seedream", "bilingual", "byteplus"]),
          di("black-forest-labs/FLUX-2-dev", "FLUX.2 dev", ["budget", "cheap", "dev", "draft"]),
          di("black-forest-labs/FLUX-2-max", "FLUX.2 max", ["max", "hero", "premium"]),
          // Bitdeer (operator's own key) sits ahead of the OpenAI backstop so a
          // billing-blocked gpt-image-1 is never the ONLY reachable model.
          bitdeer,
          gptImage,
        ];
      }

      // Route: move the requested model / hint to the front (rest stay as fallback).
      const prefer = String(args["model"] ?? "").toLowerCase().trim();
      if (prefer) {
        const idx = chain.findIndex(
          (m) => m.id.toLowerCase() === prefer || m.tags.includes(prefer) || m.id.toLowerCase().includes(prefer) || m.label.toLowerCase().includes(prefer),
        );
        if (idx > 0) chain = [chain[idx], ...chain.slice(0, idx), ...chain.slice(idx + 1)];
        else if (idx < 0 && prefer.includes("/")) chain = [di(prefer, prefer, []), ...chain]; // honor any explicit slug
      }

      const candidates = chain.filter((m) => !!m.key).slice(0, 5); // try only key-backed models; cap fallbacks
      if (!candidates.length) return "error: image generation is not configured. Set a FREE Hugging Face token (HUGGINGFACE_API_KEY — huggingface.co token, no card) for zero-cost generation, or IMAGE_API_KEY (DeepInfra) / BITDEER_API_KEY / OPENAI_API_KEY.";

      const errors: string[] = [];
      for (const m of candidates) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 60000);
        try {
          let b64 = "";
          if (m.kind === "hf") {
            // Hugging Face Inference: POST {inputs} → raw image bytes (or a JSON
            // error, e.g. 503 while the model cold-starts). Free-tier path.
            const r = await fetch(`${m.base}/${m.id}`, {
              method: "POST",
              headers: { Authorization: `Bearer ${m.key}`, "Content-Type": "application/json", Accept: "image/png" },
              body: JSON.stringify({ inputs: prompt }),
              signal: ctrl.signal,
            });
            if (!r.ok) {
              let detail = "request failed";
              try { const j = (await r.json()) as { error?: string }; if (j?.error) detail = j.error; } catch { /* binary/empty body */ }
              errors.push(`${m.label}: ${r.status} ${detail}`); continue;
            }
            b64 = Buffer.from(await r.arrayBuffer()).toString("base64");
            if (!b64) { errors.push(`${m.label}: returned no image data`); continue; }
          } else {
            const r = await fetch(`${m.base}/images/generations`, {
              method: "POST",
              headers: { Authorization: `Bearer ${m.key}`, "Content-Type": "application/json" },
              body: JSON.stringify({ model: m.id, prompt, size, n: 1 }),
              signal: ctrl.signal,
            });
            const data = (await r.json()) as { data?: Array<{ b64_json?: string; url?: string }>; error?: { message?: string } };
            if (!r.ok) { errors.push(`${m.label}: ${r.status} ${data?.error?.message ?? "request failed"}`); continue; }
            b64 = data.data?.[0]?.b64_json ?? "";
            if (!b64 && data.data?.[0]?.url) {
              const img = await fetch(data.data[0].url);
              b64 = Buffer.from(await img.arrayBuffer()).toString("base64");
            }
            if (!b64) { errors.push(`${m.label}: returned no image data`); continue; }
          }
          const buf = Buffer.from(b64, "base64");
          const filename = (args["filename"] != null ? String(args["filename"]) : prompt.slice(0, 40).replace(/[^a-z0-9]+/gi, "_")).replace(/\.(png|jpg|jpeg)$/i, "") + ".png";
          const [row] = await db
            .insert(attachmentsTable)
            .values({ filename, mimeType: "image/png", kind: "image", sizeBytes: buf.length, data: b64, extractedText: null })
            .returning();
          const url = uploadUrl(row.id);
          const note = errors.length ? ` (after ${errors.length} fallback${errors.length > 1 ? "s" : ""})` : "";
          return `generated image "${filename}" (${buf.length} bytes) via ${m.label}${note}. Its PUBLIC image URL (use this directly as image_url when posting to Instagram/social, or as the link in your answer):\n${url}\n\nShow it in your answer:\n![${prompt.slice(0, 60)}](${url})\n[Download ${filename}](${url}?download=1)`;
        } catch (e) {
          errors.push(`${m.label}: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`);
        } finally {
          clearTimeout(timer);
        }
      }
      return `error: all image models failed — ${errors.join("; ")}`;
    },
  },

  pdf_generate: {
    name: "pdf_generate",
    description:
      "Generate a REAL, downloadable PDF document from text or markdown and save it — returns a genuine download link. Use for any deliverable the operator wants as a PDF: report, plan, brief, guide, or content calendar. Renders server-side in-process (NO sandbox needed). Understands simple markdown: '#/##/###' headings, '-' or '*' bullets, '1.' numbered lists, and blank lines as spacing. This is the ONLY correct way to produce a PDF — do NOT use reportlab/fpdf in sandbox_exec/code_exec (each run is a throwaway VM, so pip installs and written files never persist), and NEVER fabricate a download URL (e.g. a storage.googleapis.com link); only the URL this tool returns is real.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The full document body, as markdown or plain text." },
        title: { type: "string", description: "Optional document title — rendered as the heading and set as the PDF's metadata title." },
        filename: { type: "string", description: "Optional output filename, e.g. 'content-calendar.pdf'." },
      },
      required: ["content"],
    },
    run: async (args) => {
      const content = String(args["content"] ?? "");
      if (!content.trim()) return "error: content is required (the document body as markdown or text).";
      const title = String(args["title"] ?? "").trim().slice(0, 200);
      try {
        const bytes = await renderPdf(title, content.slice(0, 200_000));
        const b64 = Buffer.from(bytes).toString("base64");
        let stem = (args["filename"] != null ? String(args["filename"]) : title || "document")
          .replace(/\.pdf$/i, "").replace(/[^a-z0-9._-]+/gi, "_").replace(/^[_.]+|[_.]+$/g, "").slice(0, 80);
        if (!stem) stem = "document";
        const filename = `${stem}.pdf`;
        const [row] = await db
          .insert(attachmentsTable)
          .values({ filename, mimeType: "application/pdf", kind: "other", sizeBytes: bytes.length, data: b64, extractedText: null })
          .returning();
        const dl = uploadUrl(row.id, true);
        const view = uploadUrl(row.id);
        return `generated PDF "${filename}" (${bytes.length} bytes from ${content.length} chars). REAL downloadable file — put THIS exact link in your final answer (never invent any other URL):\n[Download ${filename}](${dl})\nInline view URL: ${view}`;
      } catch (e) {
        return `error: pdf generation failed: ${String(e instanceof Error ? e.message : e).slice(0, 200)}`;
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

  composio_apps: {
    name: "composio_apps",
    description:
      "List which SaaS apps are LIVE/connected via Composio for this operator (Gmail, Slack, GitHub, Notion, Calendar, Sheets, …) and their connection status. ALWAYS call this before composio_action so you know exactly which apps you can act on — never assume an app is connected.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      if (!composioConfigured()) return "error: Composio is not configured (set COMPOSIO_API_KEY).";
      let conns: Awaited<ReturnType<typeof composioListConnections>>;
      try {
        conns = await composioListConnections();
      } catch (e) {
        return `error: could not list Composio connections: ${String(e).slice(0, 200)}`;
      }
      const active = conns.filter((c) => /ACTIVE|CONNECTED|ENABLED/i.test(c.status));
      const execNote = composioExecuteEnabled()
        ? "Execution is ENABLED — you may call composio_action on the connected apps below."
        : "Execution is DISABLED (operator must set ALLOW_COMPOSIO_EXECUTE=true). You can see connections but cannot act yet.";
      if (!conns.length) {
        return `No Composio apps are connected yet. ${execNote}\nThe operator connects apps in Settings → Connect Apps (Composio).`;
      }
      const lines = conns.map((c) => `${/ACTIVE|CONNECTED|ENABLED/i.test(c.status) ? "✓ live" : "• " + c.status}  ${c.toolkit}  (account ${c.id})`);
      return [
        `Composio connected apps (${active.length} live of ${conns.length}):`,
        ...lines,
        "",
        execNote,
        "Use composio_action with the toolkit slug above (e.g. toolkit: 'github') to act on a live app.",
      ].join("\n");
    },
  },

  composio_tools: {
    name: "composio_tools",
    description:
      "List the REAL action slugs available for a connected app (e.g. gmail → GMAIL_SEND_EMAIL, GMAIL_CREATE_EMAIL_DRAFT). Call this BEFORE composio_action whenever you are unsure of the exact slug — do NOT guess slugs from memory (guesses like GMAIL_DRAFT_EMAIL or GET_PROFILE return 404 and waste the run). Pass `toolkit` (the app slug) and optionally `search` to filter (e.g. 'send', 'draft').",
    parameters: {
      type: "object",
      properties: {
        toolkit: { type: "string", description: "App slug to list tools for, e.g. 'gmail', 'github', 'notion'." },
        search: { type: "string", description: "Optional case-insensitive filter on slug/name, e.g. 'send' or 'draft'." },
      },
      required: ["toolkit"],
    },
    run: async (args: Record<string, unknown>) => {
      if (!composioConfigured()) return "error: Composio is not configured (set COMPOSIO_API_KEY).";
      const tk = args["toolkit"] != null ? String(args["toolkit"]) : "";
      if (!tk) return "error: composio_tools needs a `toolkit` (app slug like 'gmail').";
      let tools: Awaited<ReturnType<typeof composioListTools>>;
      try {
        tools = await composioListTools(tk);
      } catch (e) {
        return `error: could not list Composio tools for '${tk}': ${String(e).slice(0, 200)}`;
      }
      const q = args["search"] != null ? String(args["search"]).toLowerCase() : "";
      const filtered = q
        ? tools.filter((t) => t.slug.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
        : tools;
      if (!filtered.length) {
        return `No Composio tools matched${q ? ` "${q}"` : ""} for toolkit '${tk}'. Try composio_tools with no search, or check the app slug via composio_apps.`;
      }
      const lines = filtered
        .slice(0, 60)
        .map((t) => `${t.slug} — ${t.name}${t.required.length ? ` (required: ${t.required.join(", ")})` : ""}`);
      return [
        `Composio '${tk}' tools (${filtered.length}${q ? ` matching "${q}"` : ""}):`,
        ...lines,
        "",
        "Call composio_action with toolkit + action=<one of these slugs> + arguments={...the required fields...}.",
      ].join("\n");
    },
  },

  composio_action: {
    name: "composio_action",
    description:
      "Execute an authenticated action on a connected SaaS app (Gmail, Slack, GitHub, Notion, Calendar, Sheets, Instagram, …) via Composio. Call composio_apps FIRST to confirm the app is live; if unsure of the exact action slug, call composio_tools to look it up — NEVER guess a slug from memory (guesses 404 and waste the run). The connected account is auto-resolved from the toolkit. TWO modes: (1) NAMED action (PREFERRED) — pass `toolkit` + `action` (a real Composio slug, e.g. GMAIL_SEND_EMAIL, GMAIL_CREATE_EMAIL_DRAFT) + `arguments` (the action's documented fields). (2) RAW PROXY — pass `toolkit` + `endpoint` (the app's FULL native API path) + `method`; arguments become query params. Proxy paths are app-specific and NOT interchangeable: Gmail uses '/gmail/v1/users/me/...', Instagram/Graph uses '/me/media' — reusing one app's path shape on another is why '/me/messages' 404s on Gmail. For Gmail PREFER the NAMED action GMAIL_SEND_EMAIL over a hand-built proxy path. Disabled unless the operator enabled execution.",
    parameters: {
      type: "object",
      properties: {
        toolkit: { type: "string", description: "Composio app slug, e.g. 'gmail', 'github', 'instagram'. Used to auto-pick your connected account." },
        action: { type: "string", description: "NAMED mode: the Composio tool/action slug, e.g. 'GMAIL_SEND_EMAIL'. Omit to use raw proxy mode." },
        arguments: { type: "object", description: "NAMED mode: action arguments as a key/value object." },
        endpoint: { type: "string", description: "RAW PROXY mode: the connected app's REST path, e.g. '/me/media?fields=id,caption'. Put query params in the path." },
        method: { type: "string", description: "RAW PROXY mode: HTTP method for the endpoint (GET, POST, …)." },
        connectedAccountId: { type: "string", description: "Optional explicit connected-account id; auto-resolved from toolkit when omitted." },
      },
    },
    run: async (args) => {
      if (!composioConfigured()) return "error: Composio is not configured (set COMPOSIO_API_KEY).";
      if (!composioExecuteEnabled()) {
        return "error: Composio execution is disabled. The operator must set ALLOW_COMPOSIO_EXECUTE=true after connecting accounts.";
      }
      // HARD GUARDRAIL (defense in depth): never execute a financial-account
      // opening or a government-ID/KYC submission via a connected app, even if the
      // orchestrator's pre-check was somehow bypassed.
      const policy = assessActionRisk(
        `${args["action"] ?? ""} ${args["endpoint"] ?? ""} ${JSON.stringify(args["arguments"] ?? {})} ${JSON.stringify(args["body"] ?? "")}`,
      );
      if (policy.blocked) return policyRefusal(policy);
      // SAFEGUARD: when this is a WRITE to a public social platform (e.g. publishing
      // a post), screen the payload for confidential/sensitive content first.
      const tk = (args["toolkit"] != null ? String(args["toolkit"]) : "").toLowerCase();
      const mth = (args["method"] != null ? String(args["method"]) : "").toUpperCase();
      const ep = args["endpoint"] != null ? String(args["endpoint"]) : "";
      const isSocialWrite =
        /instagram|facebook|threads|^x$|twitter|tiktok|linkedin|reddit|youtube/.test(tk) &&
        (["POST", "PUT", "PATCH"].includes(mth) || /publish|media|post|tweet|status|share/i.test(ep));
      if (isSocialWrite) {
        const payload = `${ep} ${JSON.stringify(args["arguments"] ?? {})} ${JSON.stringify(args["body"] ?? "")}`;
        const blockedSocial = blockIfSensitiveForPublic(payload, `your public ${tk || "social"} account`);
        if (blockedSocial) return blockedSocial;
      }
      return composioExecute({
        toolkit: args["toolkit"] != null ? String(args["toolkit"]) : undefined,
        action: args["action"] != null ? String(args["action"]) : undefined,
        arguments: (args["arguments"] as Record<string, unknown>) ?? {},
        endpoint: args["endpoint"] != null ? String(args["endpoint"]) : undefined,
        method: args["method"] != null ? String(args["method"]) : undefined,
        connectedAccountId: args["connectedAccountId"] != null ? String(args["connectedAccountId"]) : undefined,
      });
    },
  },

  instagram_post: {
    name: "instagram_post",
    description:
      "Publish ONE image post to the operator's connected Instagram, end to end. Pass `image_url` (an ABSOLUTE public https URL — use exactly the URL image_generate returns) and `caption`. This does the whole Instagram flow server-side and correctly: create media container → publish → fetch permalink, and returns the live permalink. ALWAYS use this for 'post to my Instagram' instead of hand-driving composio_action — it can't be malformed. Posts exactly once.",
    parameters: {
      type: "object",
      properties: {
        image_url: { type: "string", description: "Absolute public https URL of the image (the URL image_generate returns)." },
        caption: { type: "string", description: "The post caption (hook + body + hashtags)." },
      },
      required: ["image_url"],
    },
    run: async (args) => {
      if (!composioConfigured()) return "error: Composio is not configured (set COMPOSIO_API_KEY). The operator must add this in Settings → Environment Variables.";
      if (!composioExecuteEnabled()) return "error: Composio execution is disabled (operator must set ALLOW_COMPOSIO_EXECUTE=true in Environment Variables).";

      // Pre-flight: verify Instagram is actually connected before attempting the post.
      try {
        const conns = await composioListConnections();
        const ig = conns.find((c) => c.toolkit.toLowerCase() === "instagram");
        if (!ig) {
          return "error: Instagram is NOT connected in Composio. The operator must connect their Instagram account in Settings → Connect Apps (Composio) before posts can be published. No connected Instagram account was found.";
        }
        if (!/ACTIVE|CONNECTED|ENABLED/i.test(ig.status)) {
          return `error: Instagram connection exists but is ${ig.status} (not ACTIVE). The operator must re-connect their Instagram account in Settings → Connect Apps. Connection id: ${ig.id}`;
        }
      } catch (e) {
        logger.warn({ err: e }, "instagram_post: pre-flight connection check failed (proceeding anyway)");
      }

      const imageUrl = String(args["image_url"] ?? "").trim();
      const caption = args["caption"] != null ? String(args["caption"]) : "";
      // SAFEGUARD: never auto-publish confidential/sensitive material to a public account.
      const blocked = blockIfSensitiveForPublic(caption, "your public Instagram");
      if (blocked) return blocked;
      if (!/^https:\/\/\S+/i.test(imageUrl)) {
        return "error: image_url must be an absolute https URL that Instagram can fetch (use the URL image_generate returns, e.g. https://<host>/api/uploads/<id>). A relative path will not work.";
      }
      // SAFEGUARD: enforce the daily cap + spacing so the feed never gets spammed.
      const limited = await checkPostAllowed("instagram");
      if (limited) return limited;
      const pick = (s: string): Record<string, unknown> | null => {
        const nl = s.indexOf("\n");
        try { return JSON.parse(nl >= 0 ? s.slice(nl + 1) : s) as Record<string, unknown>; } catch { return null; }
      };
      const dataId = (j: Record<string, unknown> | null): string | undefined =>
        (((j?.["data"] as Record<string, unknown>)?.["id"]) as string | undefined);

      // Step 1 — create the media container.
      const r1 = await composioExecute({ toolkit: "instagram", endpoint: "/me/media", method: "POST", arguments: { image_url: imageUrl, caption } });
      const creationId = dataId(pick(r1));
      if (!creationId) {
        logger.error({ imageUrl: imageUrl.slice(0, 100), response: r1.slice(0, 400) }, "instagram_post: media container creation failed");
        return `error: Instagram did not create the media container.\n${r1.slice(0, 600)}`;
      }

      // Step 2 — publish it (containers can need a moment to process; retry briefly).
      let publishedId: string | undefined;
      let last = "";
      for (let attempt = 0; attempt < 4 && !publishedId; attempt++) {
        if (attempt > 0) await new Promise((res) => setTimeout(res, 3000));
        const r2 = await composioExecute({ toolkit: "instagram", endpoint: "/me/media_publish", method: "POST", arguments: { creation_id: String(creationId) } });
        last = r2;
        publishedId = dataId(pick(r2));
      }
      if (!publishedId) {
        logger.error({ creationId, lastResponse: last.slice(0, 400) }, "instagram_post: publish failed after 4 attempts");
        return `error: Instagram container ${creationId} was created but publish failed after 4 retries.\n${last.slice(0, 600)}`;
      }

      // Step 3 — fetch the permalink as proof it's live.
      const r3 = await composioExecute({ toolkit: "instagram", endpoint: `/${publishedId}?fields=permalink`, method: "GET" });
      const permalink = ((pick(r3)?.["data"] as Record<string, unknown>)?.["permalink"]) as string | undefined;
      await recordPost("instagram", "", permalink ?? String(publishedId)); // count toward the daily cap + spacing
      return `✅ Instagram post is LIVE. media_id=${publishedId} (container ${creationId}).${permalink ? `\npermalink: ${permalink}` : "\n(permalink fetch returned no link, but publish succeeded)"}`;
    },
  },

  world_post: {
    name: "world_post",
    description:
      "Post Aura's WORLD-00 — her OWN code-rendered ASCII/light world (drawn by the engine from text glyphs, ~$0 per image). This is the ONLY image style Aura uses for her self-expression — NEVER use image_generate for her world. kind='story' renders + posts an ephemeral Instagram STORY of her walk or dream in her free voice; kind='art' renders a wide ASCII panorama, slices it into 3, and posts a triptych = one clean feed-grid row (the grid is reserved for these). The engine enforces her safety gates, the expression wall (state-only, never internal/task data), and the daily caps (stories 12/day, art 3 rows/day). Returns whether it posted + the permalink(s).",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["story", "art"], description: "story = ephemeral ASCII story (walk/dream, her free voice); art = 3-tile ASCII triptych = one feed-grid row. Default story." },
      },
    },
    run: async (args) => {
      const kind = String(args["kind"] ?? "story") === "art" ? "art" : "story";
      // dynamic import: world.ts imports from this module, so a static import
      // would create a load-time circular dependency.
      const { runStoryCycle, runArtTriptych } = await import("./lib/world");
      const r = kind === "art" ? await runArtTriptych({}) : await runStoryCycle({});
      const links = (r.permalinks ?? []).join(", ");
      return r.posted
        ? `✅ posted ${kind} (code-rendered ASCII world): ${r.reason}${links ? `\npermalinks: ${links}` : ""}`
        : `did not post ${kind}: ${r.reason}`;
    },
  },

  render_card: {
    name: "render_card",
    description:
      "Render a FREE on-brand terminal/cyber post image from text — drawn by code (~$0 per image), NO AI image generation. PREFER THIS over image_generate for news cards, quote cards, hooks, stat cards, and any text/terminal-style visual. Only use image_generate when you specifically need a PHOTOREAL image. The LLM writes the words; this draws the card. Returns a PUBLIC image URL to use directly as image_url when posting to Instagram/social. For factual 'news' cards the accuracy rule still applies — only real, verified, cited facts.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["news", "quote", "hook", "stat"], description: "news = headline + 'why it matters'; quote = big centered quote; hook = bold hook + 'the build'; stat = giant number + label." },
        eyebrow: { type: "string", description: "small top label, e.g. '> AI_NEWS' or '> nobody_is_talking_about_this'." },
        headline: { type: "string", description: "the main large text. For quote: the quote itself (no surrounding quotes needed). For stat: the line under the big number." },
        body: { type: "string", description: "smaller supporting paragraph (optional). For quote: the attribution line." },
        big: { type: "string", description: "stat kind only: the giant number, e.g. '$0.00' or '10x'." },
        footer: { type: "string", description: "optional bottom ticker line (defaults to the brand ticker)." },
      },
      required: ["headline"],
    },
    run: async (args) => {
      const kinds = new Set(["news", "quote", "hook", "stat"]);
      const kind = (kinds.has(String(args["kind"])) ? String(args["kind"]) : "news") as "news" | "quote" | "hook" | "stat";
      const str = (k: string) => (args[k] != null ? String(args[k]) : undefined);
      const { renderContentCard } = await import("./lib/worldEngine");
      const buf = await renderContentCard({
        kind, eyebrow: str("eyebrow"), headline: str("headline") ?? "", body: str("body"), big: str("big"), footer: str("footer"),
        seed: Date.now() & 0xffff,
      });
      const filename = `card_${kind}_${Date.now()}.png`;
      const [row] = await db
        .insert(attachmentsTable)
        .values({ filename, mimeType: "image/png", kind: "image", sizeBytes: buf.length, data: buf.toString("base64"), extractedText: null })
        .returning();
      const url = uploadUrl(row.id);
      return `rendered $0 ${kind} card "${filename}" (${buf.length} bytes) — code-drawn, no AI image gen. Its PUBLIC image URL (use directly as image_url when posting):\n${url}\n\nShow it:\n![${kind} card](${url})`;
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
      const nextRunAt = computeNextRun(schedule);
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

  // ── HEARTBEAT — autonomous persistence loop ──────────────────────────────
  // Every CLAW calls this at the top of each heartbeat cron tick. It queries
  // the DB for that agent's real pending / in-progress / recently-failed work
  // and feeds the results back into the agent's context so it RESUMES work
  // rather than starting blind. Without this, a CLAW completes one LLM pass,
  // marks itself done, and idles — the heartbeat cron fires again but the agent
  // has no memory of what it was doing. heartbeat_respond breaks that cycle:
  //   tick → call heartbeat_respond → see unfinished tasks → continue executing
  // → tick → call heartbeat_respond → queue clear → report IDLE.
  heartbeat_respond: {
    name: "heartbeat_respond",
    description:
      "HEARTBEAT — Report your alive status and pull your REAL task queue from the swarm DB. " +
      "Call this FIRST on every heartbeat cycle. The result shows every task that is pending, " +
      "in-progress, or recently failed for YOU specifically. " +
      "If unfinished work is listed, resume executing it NOW using your other tools — " +
      "do NOT stop after one pass, do NOT declare done until you have a verified tool result. " +
      "Only report IDLE when your queue is genuinely empty. " +
      "This is the core mechanism that keeps CLAWs autonomous across multiple heartbeat cycles.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "idle", "resuming"],
          description:
            "'resuming' = picking up incomplete work found in queue, " +
            "'active' = mid-execution on a task right now, " +
            "'idle' = queue is genuinely empty, standing by.",
        },
        note: {
          type: "string",
          description: "Optional: one-line note on what you are working on or what you found.",
        },
      },
      required: ["status"],
    },
    run: async (args, ctx) => {
      const status = String(args["status"] ?? "active").trim();
      const note = args["note"] ? String(args["note"]).slice(0, 300) : null;
      const agentId = ctx.agentId;
      const ts = new Date().toISOString();

      // ── Query this agent's real work queue ──────────────────────────────
      let pendingCmds: Array<{ id: number; command: string; status: string | null; result: string | null }> = [];
      let pendingTasks: Array<{ id: number; title: string; status: string | null; progress: number | null }> = [];

      try {
        const cmds = await db
          .select({
            id: agentCommandsTable.id,
            command: agentCommandsTable.command,
            status: agentCommandsTable.status,
            result: agentCommandsTable.result,
          })
          .from(agentCommandsTable)
          .where(eq(agentCommandsTable.toAgentId, agentId))
          .orderBy(desc(agentCommandsTable.id))
          .limit(30);
        // Keep only actionable states — done/interrupted are genuinely finished
        pendingCmds = cmds.filter((c) =>
          ["queued", "running", "failed"].includes(c.status ?? ""),
        );
      } catch { /* non-fatal — report empty */ }

      try {
        const tasks = await db
          .select({
            id: tasksTable.id,
            title: tasksTable.title,
            status: tasksTable.status,
            progress: tasksTable.progress,
          })
          .from(tasksTable)
          .where(eq(tasksTable.agentId, agentId))
          .orderBy(desc(tasksTable.id))
          .limit(30);
        // Keep only unfinished tasks
        pendingTasks = tasks.filter((t) =>
          !["completed", "failed", "interrupted"].includes(t.status ?? ""),
        );
      } catch { /* non-fatal */ }

      // ── Build the status report ──────────────────────────────────────────
      const lines: string[] = [
        `HEARTBEAT — ${ctx.agentName} (#${agentId}) | status: ${status} | ${ts}`,
        note ? `Note: ${note}` : "",
      ].filter(Boolean);

      if (pendingCmds.length) {
        lines.push(`\nPENDING COMMANDS (${pendingCmds.length}):`);
        for (const c of pendingCmds.slice(0, 6)) {
          const res = c.result ? ` → ${clip(c.result, 80)}` : "";
          lines.push(`  #${c.id} [${c.status}] ${clip(c.command, 140)}${res}`);
        }
      } else {
        lines.push("\nPENDING COMMANDS: none");
      }

      if (pendingTasks.length) {
        lines.push(`\nIN-PROGRESS TASKS (${pendingTasks.length}):`);
        for (const t of pendingTasks.slice(0, 6)) {
          lines.push(
            `  #${t.id} [${t.status}] ${clip(t.title, 140)} — ${t.progress ?? 0}% complete`,
          );
        }
        lines.push(
          "\n⚡ RESUME NOW: Use your tools to make real progress on the tasks above. " +
          "Do NOT mark done until each item has a verified tool result. " +
          "Continue executing — do not stop after one pass.",
        );
      } else {
        lines.push("\nIN-PROGRESS TASKS: none");
        lines.push(
          "\n✅ Queue clear. You are IDLE. Stand by for new directives from ABBY, " +
          "or use this cycle to run a proactive check relevant to your specialty.",
        );
      }

      return lines.join("\n");
    },
  },
};

// ─── Per-agent tool permissions ──────────────────────────────────────────────
// Every CLAW gets read tools (web_scrape, memory_search, memory_write) plus its
// specialty. ABBY (orchestrator) has the full set.

const ALL_TOOLS = Object.keys(TOOL_REGISTRY);

export const AGENT_TOOLS: Record<number, string[]> = {
  1: ALL_TOOLS, // ABBY — full authority
  2: ["code_exec", "cloud_code_exec", "sandbox_exec", "sandbox_repo_pr", "calculator", "http_request", "web_scrape", "web_search", "tier1_sources", "site_crawl", "site_crawl_status", "memory_search", "memory_write", "vault_list", "save_artifact", "pdf_generate", "image_generate", "heartbeat_respond", "send_message"], // FORGE — code
  3: ["web_scrape", "web_screenshot", "web_search", "tier1_sources", "site_crawl", "site_crawl_status", "http_request", "calculator", "memory_search", "memory_write", "vault_list", "social_accounts", "social_api", "sandbox_exec", "browser_login", "save_artifact", "pdf_generate", "image_generate", "heartbeat_respond", "send_message"], // CRAWLER — browser
  4: ["memory_write", "memory_search", "web_search", "tier1_sources", "web_scrape", "site_crawl", "site_crawl_status", "http_request", "calculator", "vault_list", "save_artifact", "pdf_generate", "image_generate", "heartbeat_respond", "send_message"], // VAULT — memory/RAG
  5: ["http_request", "web_scrape", "web_search", "tier1_sources", "site_crawl", "site_crawl_status", "marketing_playbook", "code_exec", "cloud_code_exec", "sandbox_exec", "sandbox_repo_pr", "calculator", "memory_search", "memory_write", "vault_list", "social_accounts", "social_api", "composio_apps", "composio_tools", "composio_action", "instagram_post", "browser_login", "schedule_task", "list_scheduled_tasks", "cancel_scheduled_task", "save_artifact", "pdf_generate", "image_generate", "render_card", "heartbeat_respond", "send_message"], // WIRE — APIs + scheduling
  6: ["web_scrape", "web_search", "tier1_sources", "marketing_playbook", "http_request", "calculator", "memory_search", "memory_write", "vault_list", "social_accounts", "social_api", "composio_apps", "composio_tools", "composio_action", "instagram_post", "browser_login", "save_artifact", "pdf_generate", "image_generate", "render_card", "heartbeat_respond", "send_message"], // MR.NICE — social
};

export function getToolNamesForAgent(agentId: number): string[] {
  return AGENT_TOOLS[agentId] ?? ["web_scrape", "memory_search"];
}

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
    card += `\n\nINTERACTIVE AUTOMATION: web_scrape is read-only and won't render JS-heavy or multi-step pages. When a task needs to actually fill/submit a web form or read a JS-rendered page, use sandbox_exec to run Playwright in the cloud VM (install chromium, navigate, fill, click, submit). To GENERATE a document PDF from text/markdown, call pdf_generate (server-side, always works) instead of the sandbox. To FILL an official PDF form (e.g. AcroForm fields), use sandbox_exec with fillpdf/pypdf and return the output file path. Generate/prepare documents and demonstrate the flow — never submit a person's legal/financial filing on their behalf.`;
  }
  if (names.includes("save_artifact")) {
    card += `\n\nDELIVERABLE FILES: whenever you produce a file the operator should keep (report, CSV, code, JSON, or a generated PDF), call save_artifact to store it and get a real download URL, then put that [Download …](url) link in your final answer. Do NOT claim a file exists or name a file you didn't save, and NEVER invent a download URL (e.g. a storage.googleapis.com link) — only the exact URL save_artifact returns is real; a made-up link is a fabrication. To make a PDF, call pdf_generate (it renders a real PDF server-side from your text/markdown and returns a download URL) — do NOT generate PDFs with reportlab/fpdf in the sandbox, where written files never persist. If the base64 is large and a single save_artifact call gets truncated, do NOT retry it whole — save it in CHUNKS: repeated calls with chunk:true and a slice of the base64 each, in order, then one call with done:true to assemble and store it.`;
  }
  if (names.includes("image_generate")) {
    card += `\n\nIMAGES: prefer the CHEAP path first. For news/quote/hook/stat cards and any terminal/cyber TEXT visual, call render_card — it draws a real on-brand 1080×1080 PNG by code for ~$0 (no AI image gen) and returns a public image URL. Only call image_generate (paid) when you specifically need a PHOTOREAL picture/logo/illustration/photo. Either way you get a real PNG + a URL to use as image_url; do NOT hand-code SVG or merely describe the image, and only produce SVG if the operator explicitly asks for SVG/vector.`;
  }
  if (names.includes("pdf_generate")) {
    card += `\n\nPDFs: to deliver a PDF (report, plan, content calendar, guide), call pdf_generate with the full text/markdown as \`content\` — it renders a REAL PDF server-side and returns a genuine [Download](url) link. This ALWAYS works; never build PDFs with reportlab/fpdf in sandbox_exec/code_exec (each run is a throwaway VM, so installs and files don't persist), and never fabricate a storage/download URL — only the pdf_generate link is real.`;
  }
  if (names.includes("composio_apps") || names.includes("composio_action")) {
    card += `\n\nCONNECTED APPS (Composio): the operator connects their apps — social like Instagram/YouTube/Reddit AND SaaS like Gmail/GitHub/Notion/Calendar/Sheets — in Settings → Connect Apps, which is COMPOSIO. To act on any of them, FIRST call composio_apps to see which are LIVE, THEN call composio_action on a live app. For a read with no obvious named action slug, use composio_action RAW PROXY mode: pass toolkit + endpoint (the app's REST path) + method, e.g. toolkit:'instagram', endpoint:'/me/media?fields=id,caption', method:'GET'.`;
    if (names.includes("social_accounts")) {
      card += ` NOTE: social_accounts/social_api is a SEPARATE native-OAuth path that is usually EMPTY for this operator — NEVER conclude an app is "not connected" from social_accounts alone. The operator's accounts live in COMPOSIO, so always check composio_apps before saying anything is unavailable.`;
    }
    if (names.includes("instagram_post")) {
      card += ` TO POST AN IMAGE TO INSTAGRAM: call image_generate (it returns an ABSOLUTE public https URL), then call instagram_post with that exact image_url + your caption. instagram_post does the full create→publish→permalink flow server-side and returns the live link — do NOT hand-build the /me/media calls yourself, and NEVER upload the image to an external host (imgbb/imgur/etc.); the image_generate URL is already public.`;
    }
  }
  // SOLO MODE: ABBY is the only agent and holds every tool herself — no swarm
  // roster to delegate to.
  return card;
}

/** OpenAI-compatible (NVIDIA NIM) tool schema for the given agent's allowed tools. */
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
