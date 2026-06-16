/**
 * OPENCLAW OMEGA — Third-party integration layer.
 *
 * Every integration here is driven ENTIRELY by environment variables — no
 * secret is ever hardcoded. Each helper degrades gracefully: if its key is not
 * configured it either throws a clear, human-readable error (for tools the model
 * calls explicitly) or silently no-ops (for fire-and-forget observability).
 *
 * Wired here:
 *   - Helicone   — observability proxy in front of NVIDIA NIM (LLM logging).
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

// ─── Helicone (LLM observability proxy in front of NVIDIA NIM) ────────────────
// Helicone sits transparently in front of the LLM provider: same OpenAI-
// compatible API, but requests route through Helicone's gateway with a
// Helicone-Auth header so calls are logged. The swarm runs entirely on NVIDIA
// NIM; Helicone proxies to integrate.api.nvidia.com via its gateway target URL
// header. When no Helicone key is configured we call NIM directly.

export function heliconeEnabled(): boolean {
  return !!process.env["HELICONE_API_KEY"];
}

/**
 * Extra headers that enable Helicone logging in front of NVIDIA NIM. Returns an
 * empty object when Helicone is not configured, so callers can always spread it
 * safely. Uses Helicone's gateway pattern (Helicone-Target-Url) so the upstream
 * stays NVIDIA NIM rather than any third-party router.
 */
export function heliconeHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = process.env["HELICONE_API_KEY"];
  if (!key) return {};
  return {
    "Helicone-Auth": `Bearer ${key}`,
    "Helicone-Target-Url": NVIDIA_NIM_BASE,
    "Helicone-Cache-Enabled": "false",
    ...extra,
  };
}

// ─── NVIDIA NIM (build.nvidia.com) — the swarm's ONLY LLM provider ───────────
// OpenAI-compatible chat endpoint for NVIDIA-hosted models (Nemotron, DeepSeek,
// Qwen 3.5, Mistral NIM builds, …). Activated by NVIDIA_API_KEY — store it in
// the vault (loadVaultIntoEnv puts it in process.env at boot) or set it as an
// env var. Every model id resolves to NVIDIA NIM — there is no other LLM
// provider or fallback.

const NVIDIA_NIM_BASE = "https://integrate.api.nvidia.com/v1";
const HELICONE_GATEWAY = "https://gateway.helicone.ai/v1";

/** The LLM base URL — Helicone gateway (in front of NIM) when configured, else NIM direct. */
export function llmBaseUrl(): string {
  return heliconeEnabled() ? HELICONE_GATEWAY : NVIDIA_NIM_BASE;
}

// ─── NIM key pool ────────────────────────────────────────────────────────────
// The operator holds MULTIPLE build.nvidia.com keys (one per NVIDIA project),
// each with its own rate-limit budget. NVIDIA_API_KEY accepts them all —
// separated by commas, spaces, or newlines — and llmFetch() rotates to the
// next key whenever NIM answers 401/403/429, so one revoked or rate-limited
// key never stalls the swarm. NVIDIA_API_KEY_2…_9 are also honored for
// operators who prefer one key per vault entry.
let nimKeyIndex = 0;

export function nimKeyPool(): string[] {
  const keys: string[] = [];
  const main = process.env["NVIDIA_API_KEY"];
  if (main) keys.push(...main.split(/[\s,]+/).filter(Boolean));
  for (let i = 2; i <= 9; i++) {
    const extra = process.env[`NVIDIA_API_KEY_${i}`];
    if (extra) keys.push(...extra.split(/[\s,]+/).filter(Boolean));
  }
  return [...new Set(keys)];
}

function currentNimKey(): string | undefined {
  const pool = nimKeyPool();
  if (pool.length === 0) return undefined;
  return pool[nimKeyIndex % pool.length];
}

/** Rotate to the next key in the pool. Returns false when there is no other key. */
export function advanceNimKey(): boolean {
  const pool = nimKeyPool();
  if (pool.length <= 1) return false;
  nimKeyIndex = (nimKeyIndex + 1) % pool.length;
  logger.warn({ keyOrdinal: (nimKeyIndex % pool.length) + 1, poolSize: pool.length }, "Rotated to the next NVIDIA NIM key in the pool.");
  return true;
}

export function nimConfigured(): boolean {
  return nimKeyPool().length > 0;
}

// ─── NIM auth circuit-breaker ────────────────────────────────────────────────
// Observed live 2026-06-10: NVIDIA_API_KEY was set on the server but REJECTED
// by integrate.api.nvidia.com (403 "Authorization failed" — a revoked/typo'd
// key). Because a configured key routes EVERY swarm model through NIM
// (including the fallbacks), one bad key killed all LLM calls. The breaker
// marks NIM unhealthy on 401/403 as an operator-visible health signal (the
// vault route consults it to clear on key rotation). Routing stays on NVIDIA —
// there is no other LLM provider. NIM is re-probed after the cooldown so a
// fixed key recovers without a restart.
const NIM_AUTH_COOLDOWN_MS = 10 * 60_000;
let nimDisabledUntil = 0;

export function nimHealthy(): boolean {
  return Date.now() >= nimDisabledUntil;
}

/** Report a NIM HTTP failure. Only auth failures (401/403) trip the breaker. */
export function reportNimHttpFailure(status: number): void {
  if (status === 401 || status === 403) {
    nimDisabledUntil = Date.now() + NIM_AUTH_COOLDOWN_MS;
    logger.error(
      { status, cooldownMinutes: NIM_AUTH_COOLDOWN_MS / 60_000 },
      "NVIDIA NIM rejected the API key — marked unhealthy; calls will fail until fixed. Fix/rotate NVIDIA_API_KEY on the server.",
    );
  }
}

/** Test hook + key-rotation hook: reset the breaker, key cursor, and stall marks. */
export function resetNimHealth(): void {
  nimDisabledUntil = 0;
  nimDegradedUntil = 0;
  nimKeyIndex = 0;
  modelStallUntil.clear();
}

// ─── NIM degraded breaker (throttle/overload) ───────────────────────────────
// Observed live 2026-06-10 (night): the NVIDIA key was VALID, so the auth
// breaker never tripped — but nemotron-3-ultra stalled (25s+, zero bytes) AND
// the fast failover model answered 429 on every pooled key. With NIM healthy-
// but-drowning, every agent turn paid the full stall/rotation/backoff gauntlet
// (minutes per LLM call) and still failed — the whole system looked dead.
// This breaker marks NIM "degraded" when the full gauntlet fails with
// throttle/overload (429/5xx/stall). It is an operator-visible health signal
// for the cooldown window; routing stays on NVIDIA — then NIM is re-probed.
function nimDegradedCooldownMs(): number {
  const v = Number(process.env["NIM_DEGRADED_COOLDOWN_MS"]);
  return Number.isFinite(v) && v > 0 ? v : 120_000;
}
let nimDegradedUntil = 0;

export function nimDegraded(): boolean {
  return Date.now() < nimDegradedUntil;
}

export function reportNimDegraded(reason: string): void {
  nimDegradedUntil = Date.now() + nimDegradedCooldownMs();
  logger.error(
    { reason, cooldownMs: nimDegradedCooldownMs() },
    "NVIDIA NIM is throttled/overloaded on every pooled key — marked degraded for the cooldown.",
  );
}

// ─── NIM model stall breaker ─────────────────────────────────────────────────
// Observed live 2026-06-10 (evening): nemotron-3-ultra-550b produced NO
// response for 120s+ on a minimal direct request — NVIDIA-side overload, while
// other NIM models answered in ~2s. Without this breaker every agent turn
// pays the full timeout before failing over. With it, the first stall marks
// the model and subsequent calls route straight to NIM_FAST_MODEL until the
// cooldown expires, then the original model is re-probed.
const MODEL_STALL_COOLDOWN_MS = 5 * 60_000;
const modelStallUntil = new Map<string, number>();

export function modelStalled(model: string): boolean {
  return (modelStallUntil.get(model) ?? 0) > Date.now();
}

export function reportModelStall(model: string): void {
  modelStallUntil.set(model, Date.now() + MODEL_STALL_COOLDOWN_MS);
  logger.warn(
    { model, cooldownMinutes: MODEL_STALL_COOLDOWN_MS / 60_000 },
    "NIM model is stalling/5xxing — routing its traffic to the fast NIM model for the cooldown.",
  );
}

// Model-id prefixes served by NVIDIA NIM. NIM uses `mistralai/` + `meta/` and
// `qwen/qwen3.5-*`; any id outside these prefixes is treated as a non-catalog id
// and remapped to a real NIM model in nimRequestFor.
const NIM_PREFIXES = [
  "nvidia/",
  "deepseek-ai/",
  "mistralai/",
  "z-ai/",
  "moonshotai/",
  "minimaxai/",
  "stepfun-ai/",
  "qwen/qwen3.5-",
  // 2026-06-12 key-pool expansion: families live-verified on
  // integrate.api.nvidia.com (one-token completion, HTTP 200) this session.
  // microsoft/phi-4-multimodal is deliberately NOT listed — it answered 400 on
  // a plain chat call, so it remaps to the generic fallback instead of dying.
  "meta/",
  "openai/",
];

export function isNimModel(model: string): boolean {
  return NIM_PREFIXES.some((p) => model.startsWith(p));
}

// NIM-internal fallback for each swarm model: a sibling NIM model to use when
// the primary is throttled/5xx. Every fallback is itself a NIM id served from
// integrate.api.nvidia.com. NIM_FAST_MODEL is the last-resort fast engine inside
// the gauntlet.
export const NIM_MODEL_FALLBACKS: Record<string, string> = {
  "nvidia/nemotron-3-super-120b-a12b": "qwen/qwen3.5-122b-a10b",
  "deepseek-ai/deepseek-v4-flash": "qwen/qwen3.5-122b-a10b",
  "deepseek-ai/deepseek-v4-pro": "deepseek-ai/deepseek-v4-flash",
  "qwen/qwen3.5-397b-a17b": "qwen/qwen3.5-122b-a10b",
  "qwen/qwen3.5-122b-a10b": "nvidia/nemotron-3-super-120b-a12b",
  "mistralai/mistral-medium-3.5-128b": "qwen/qwen3.5-122b-a10b",
  "z-ai/glm-5.1": "qwen/qwen3.5-122b-a10b",
  // 2026-06-12 roster expansion — each entry live-verified (HTTP 200) today.
  // kimi-k2.6 was 429-throttled during verification (pool rotation's job);
  // nemotron-3-ultra answered in ~68s and deepseek-v4-pro timed out at 90s,
  // so both stay behind the existing stall breaker.
  "mistralai/mistral-small-4-119b-2603": "mistralai/mistral-medium-3.5-128b",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": "meta/llama-3.1-8b-instruct",
  "nvidia/llama-3.1-nemotron-nano-vl-8b-v1": "meta/llama-3.1-8b-instruct",
  "nvidia/ising-calibration-1-35b-a3b": "meta/llama-3.1-8b-instruct",
  "meta/llama-3.1-8b-instruct": "qwen/qwen3.5-122b-a10b",
  "openai/gpt-oss-120b": "mistralai/mistral-medium-3.5-128b",
};
const NIM_GENERIC_FALLBACK = "qwen/qwen3.5-122b-a10b";

// Models EVICTED from the swarm by operator order. Applied at the request
// layer (nimRequestFor), so a banned id is unreachable no matter where it
// comes from — a stale DB row, a UI override, an external API caller, or a
// fallback chain. nemotron-3-ultra-550b: repeat staller (45-60s zero-byte
// hangs observed live 2026-06-10; ~68s on a one-token probe 2026-06-12) —
// removed 2026-06-12.
export const NIM_MODEL_BANS: Record<string, string> = {
  // nemotron-3-ultra-550b was evicted for being slow/504-prone under load. The
  // redirect target MUST be a fast, reliably-available model: kimi-k2.6 (the old
  // target) is per-model 429-throttled on the free tier, so this ban silently
  // forced ABBY (its seed model) onto a dead engine. gpt-oss-120b is reasoning-
  // capable and returns 200 under load.
  "nvidia/nemotron-3-ultra-550b-a55b": "openai/gpt-oss-120b",
};

// Global completion budget — operator directive 2026-06-12: max_tokens 8000 on
// every model. Applies to chat, routing, planning, CLAW turns, and synthesis.
// Deliberate exceptions (short-form by design): the voice loop's spoken turns
// and the ambient world flavor text. Tunable via LLM_MAX_TOKENS without a
// redeploy; the 402 shrink-and-retry logic still fits the budget downward when
// credits demand it.
export function llmMaxTokens(): number {
  const v = Number(process.env["LLM_MAX_TOKENS"]);
  return Number.isFinite(v) && v > 0 ? v : 8000;
}

// NOTE deliberately NO reverse legacy→NIM upgrade at request time. There used
// to be one (built from NIM_MODEL_FALLBACKS) and it broke the safety net live
// on 2026-06-10: every fallback target got "upgraded" straight back into the
// SAME overloaded NIM model it was escaping from, leaving a healthy-but-throttled
// NIM with no working failover at all. Stale legacy ids in the DB are handled
// once at boot (AGENT_MODEL_UPGRADES in migrate.ts).

export interface LlmChatRequest {
  url: string;
  headers: Record<string, string>;
  /** The model id to put in the request body (may be remapped for fallback). */
  model: string;
  provider: "nvidia-nim" | "openrouter" | "bitdeer";
  /**
   * Provider-specific body defaults (sampling, template kwargs). Spread these
   * FIRST in the request body so call-site values win on key collisions.
   */
  bodyExtras: Record<string, unknown>;
}

/**
 * Resolve the chat-completions endpoint, auth headers, and effective model id
 * for a given model. NIM is the primary provider. Models prefixed with "or:"
 * route directly to OpenRouter (OPENROUTER_API_KEY required). Falls back to
 * OpenRouter when NIM is exhausted. Throws only when the required key is missing.
 */
export function chatRequestFor(model: string): LlmChatRequest {
  // Explicit OpenRouter selection: "or:openai/gpt-4o" → openrouterRequestFor("openai/gpt-4o")
  if (model.startsWith("or:")) {
    return openrouterRequestFor(model.slice(3));
  }
  // Explicit Bitdeer selection: "bd:mistralai/Devstral-2-123B-Instruct-2512" → Bitdeer inference.
  if (model.startsWith("bd:")) {
    return bitdeerRequestFor(model.slice(3));
  }
  return nimRequestFor(model);
}

// ─── Bitdeer (api-inference.bitdeer.ai) ──────────────────────────────────────
// OpenAI-compatible inference provider. Activated by BITDEER_API_KEY. Selected
// explicitly via the "bd:" model prefix (e.g. "bd:nvidia/NVIDIA-Nemotron-3-Super-
// 120B-A12B"); the model id after the prefix is Bitdeer's own model id.
const BITDEER_BASE = "https://api-inference.bitdeer.ai/v1";

export function bitdeerConfigured(): boolean {
  return !!process.env["BITDEER_API_KEY"];
}

export function bitdeerRequestFor(model: string): LlmChatRequest {
  const key = process.env["BITDEER_API_KEY"];
  if (!key) throw new Error("BITDEER_API_KEY is not set");
  return {
    url: `${BITDEER_BASE}/chat/completions`,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    model,
    provider: "bitdeer",
    bodyExtras: { temperature: 1, top_p: 1 },
  };
}

// ─── OpenRouter ───────────────────────────────────────────────────────────────
// OpenAI-compatible fallback provider. Activated when OPENROUTER_API_KEY is
// set. Only used when NIM's full survival kit (key rotation, backoff, fast-model
// retry, escape) has been exhausted — OpenRouter is the last-resort backstop,
// not the primary path. Model IDs are mapped to OpenRouter equivalents where
// needed. Env-tunable fallback model via OPENROUTER_FALLBACK_MODEL.

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// Default fallback model on OpenRouter: fast, cheap, reliable.
// Override with OPENROUTER_FALLBACK_MODEL env var.
const OPENROUTER_FALLBACK_MODEL =
  process.env["OPENROUTER_FALLBACK_MODEL"] ?? "openai/gpt-4o-mini";

// Best-effort mapping from NIM model ids to their OpenRouter equivalents.
// Models not in this map use the NIM id as-is (OpenRouter supports many of the
// same model ids e.g. meta-llama/*, mistralai/*, deepseek/*).
const OR_MODEL_MAP: Record<string, string> = {
  "openai/gpt-oss-120b": "openai/gpt-4o",
  "nvidia/nemotron-3-super-120b-a12b": "nvidia/llama-3.1-nemotron-70b-instruct",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": "nvidia/llama-3.1-nemotron-70b-instruct",
  "meta/llama-3.1-8b-instruct": "meta-llama/llama-3.1-8b-instruct",
  "deepseek-ai/deepseek-v4-pro": "deepseek/deepseek-chat",
  "deepseek-ai/deepseek-v4-flash": "deepseek/deepseek-chat",
  "qwen/qwen3.5-397b-a17b": "qwen/qwen3-235b-a22b",
  "qwen/qwen3.5-122b-a10b": "qwen/qwen3-72b",
  "mistralai/mistral-medium-3.5-128b": "mistralai/mistral-medium-3",
  "mistralai/mistral-small-4-119b-2603": "mistralai/mistral-small",
  "z-ai/glm-5.1": "qwen/qwen3-72b", // no GLM on OR, fallback to Qwen
  "moonshotai/kimi-k2.6": "qwen/qwen3-72b",
  "stepfun-ai/step-3.7-flash": "openai/gpt-4o-mini", // no StepFun on OR → fast GPT-4o mini
};

export function openrouterConfigured(): boolean {
  return !!process.env["OPENROUTER_API_KEY"];
}

export function openrouterRequestFor(nimModel: string): LlmChatRequest {
  const key = process.env["OPENROUTER_API_KEY"];
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const orModel = OR_MODEL_MAP[nimModel] ?? nimModel;
  return {
    url: `${OPENROUTER_BASE}/chat/completions`,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://supernova.onrender.com",
      "X-Title": "OPENCLAW OMEGA",
    },
    model: orModel,
    provider: "openrouter",
    bodyExtras: { temperature: 0.6, top_p: 0.95 },
  };
}

/**
 * Build a NVIDIA NIM request for a model. NIM model ids go through as-is; any
 * non-NIM id (a legacy fallback alias, or a stale DB value) is remapped to its
 * NIM equivalent so a request is ALWAYS a valid NIM call. This is the single
 * request builder for the swarm.
 */
function nimRequestFor(model: string, opts?: { bypassHealthGate?: boolean }): LlmChatRequest {
  if (!nimConfigured()) throw new Error("NVIDIA_API_KEY is not set");
  // Global model override: when NIM_FORCE_MODEL is set, every swarm call uses
  // that single model (key/entitlement-safe pinning). Must be a NIM-catalog id.
  const forced = process.env["NIM_FORCE_MODEL"];
  if (forced) model = forced;
  // Banned ids are rewritten FIRST so they are unreachable from any path.
  model = NIM_MODEL_BANS[model] ?? model;
  // Map any non-NIM id to a real NIM model so we never emit a non-NIM model id.
  const effectiveModel = isNimModel(model) ? model : (NIM_MODEL_FALLBACKS[model] ?? NIM_GENERIC_FALLBACK);
  const healthy = nimHealthy() && !nimDegraded();
  void opts; // health gate no longer changes the provider — there is only NIM.
  void healthy;
  const key = currentNimKey()!;
  const bodyExtras: Record<string, unknown> = {
    // Verified live 2026-06-10: qwen/qwen3.5-* 500s without explicit sampling
    // params, and Nemotron's default thinking budget can exceed the swarm's
    // patience — so default thinking off (NIM_ENABLE_THINKING=on to re-enable)
    // and set NVIDIA-recommended sampling.
    temperature: 0.6,
    top_p: 0.95,
  };
  if (effectiveModel.startsWith("nvidia/nemotron")) {
    const thinking = (process.env["NIM_ENABLE_THINKING"] ?? "off").toLowerCase() === "on";
    bodyExtras["chat_template_kwargs"] = { enable_thinking: thinking };
  }
  // mistral-medium-3.5-128b supports reasoning_effort (high/medium/low).
  // Verified in NVIDIA NIM sample code — "high" gives best quality.
  // Override with NIM_MISTRAL_REASONING env var.
  if (effectiveModel === "mistralai/mistral-medium-3.5-128b") {
    bodyExtras["reasoning_effort"] = process.env["NIM_MISTRAL_REASONING"] ?? "high";
  }
  // stepfun-ai models: provider-verified sampling params from NIM sample.
  if (effectiveModel.startsWith("stepfun-ai/")) {
    bodyExtras["temperature"] = 1.0;
    bodyExtras["top_p"] = 0.95;
  }
  return {
    url: `${llmBaseUrl()}/chat/completions`,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "OPENCLAW OMEGA",
      ...heliconeHeaders(),
    },
    model: effectiveModel,
    provider: "nvidia-nim",
    bodyExtras,
  };
}

/**
 * Guaranteed-request builder used by llmFetch as the "escape" path: a NIM
 * request for the model that bypasses the health gate (remapping any non-NIM id
 * to its NIM equivalent), so a degraded-but-keyed NIM still gets one direct
 * attempt before the failure is surfaced.
 */
export function nimEscapeRequestFor(model: string): LlmChatRequest {
  return nimRequestFor(model, { bypassHealthGate: true });
}

// A NIM model that answers in seconds (verified live 2026-06-10: ~2s for a
// short completion while nemotron-3-ultra-550b 504'd under load). Used as the
// same-provider retry target when the requested NIM model stalls or 5xxes —
// the persona and tools stay intact, only the engine swaps.
// The degraded/stall escape engine. MUST be a model that stays available under
// load — it's where EVERY call routes when NIM is marked degraded, so a heavily
// rate-limited model here causes a total outage (observed live 2026-06-13:
// moonshotai/kimi-k2.6 was 429-throttled per-model while nemotron/llama/gpt-oss
// returned 200, yet the breaker forced everything onto kimi → all calls failed).
// Defaults to the small, reliably-available Llama 3.1 8B; override via env.
const NIM_FAST_MODEL = process.env["NIM_FAST_MODEL"] || "meta/llama-3.1-8b-instruct";

// Time budget for the upstream to START responding (headers received). Without
// this, one stalled Nemotron request hangs an agent turn forever — observed
// live 2026-06-10 as ABBY timing out instead of answering. Streaming bodies
// are NOT subject to this budget (the timer is cleared once headers arrive).
function llmTimeoutMs(): number {
  const v = Number(process.env["LLM_TIMEOUT_MS"]);
  return Number.isFinite(v) && v > 0 ? v : 60_000;
}

async function timedFetch(
  req: LlmChatRequest,
  payload: Record<string, unknown>,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const ac = new AbortController();
  // Abort on EITHER the time budget OR the caller's signal (e.g. the SSE client
  // disconnected) — so a closed tab stops the in-flight upstream request.
  if (externalSignal) {
    if (externalSignal.aborted) ac.abort();
    else externalSignal.addEventListener("abort", () => ac.abort(), { once: true });
  }
  const timer = setTimeout(() => ac.abort(), llmTimeoutMs());
  try {
    return await fetch(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify({ ...req.bodyExtras, model: req.model, ...payload }),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Provider-aware chat-completions fetch with the full NIM survival kit:
 *
 * 1. KEY ROTATION — 401/403/429 from NIM advances to the next key in the
 *    NVIDIA_API_KEY pool and retries (each build.nvidia.com key has its own
 *    rate-limit budget, so the pool multiplies throughput).
 * 2. AUTH BREAKER — when EVERY pooled key is rejected, the breaker marks NIM
 *    unhealthy and the failure surfaces honestly; the swarm is NIM-only, so
 *    nothing ever reroutes off NVIDIA.
 * 3. STALL/5XX FAILOVER — a NIM request that produces no response within the
 *    time budget, or answers 5xx, retries once on NIM_FAST_MODEL (same
 *    provider, same persona/tools, much faster engine).
 *
 * `payload` is the call-specific body (messages, tools, stream, max_tokens, …);
 * bodyExtras are spread first so payload wins. An optional `signal` may be passed
 * in `payload`; it is lifted OUT of the request body (never serialized) and used
 * to abort the upstream fetch when the caller cancels (e.g. SSE client disconnect).
 */
export async function llmFetch(
  model: string,
  payload: Record<string, unknown>,
): Promise<{ r: Response; req: LlmChatRequest }> {
  // Lift the AbortSignal out of the body — it must steer fetch(), not be JSON.stringified.
  const { signal: externalSignal, ...body } = payload as { signal?: AbortSignal } & Record<string, unknown>;
  let req = chatRequestFor(model);
  // Fast-model preference: a model that recently stalled, OR a NIM that is
  // currently DEGRADED (throttled/overloaded across the pool), routes straight
  // to the fast NIM model — don't re-pay the timeout or re-hammer the throttled
  // slow models. This is the "next calls skip the gauntlet" the degraded breaker
  // is meant to provide (previously recorded but never acted on).
  if (req.provider === "nvidia-nim" && req.model !== NIM_FAST_MODEL && (modelStalled(req.model) || nimDegraded())) {
    req = chatRequestFor(NIM_FAST_MODEL);
  }
  let r: Response;
  try {
    r = await timedFetch(req, body, externalSignal);
  } catch (err) {
    if (req.provider !== "nvidia-nim") throw err;
    // NIM stalled (no headers within the budget) or the connection died —
    // retry once on the fast NIM model instead of hanging the agent turn.
    logger.warn({ model: req.model, err: String(err) }, "NIM request stalled/failed before responding — retrying on the fast NIM model.");
    reportModelStall(req.model);
    req = chatRequestFor(NIM_FAST_MODEL);
    try {
      r = await timedFetch(req, body, externalSignal);
    } catch (err2) {
      // The FAST model stalled too — NIM is drowning across the board. Mark it
      // degraded and take the guaranteed escape (a health-gate-bypassing NIM
      // request) instead of throwing (observed live 2026-06-10: ultra stalled
      // AND kimi 429'd → total outage).
      logger.warn({ err: String(err2) }, "Fast NIM model also stalled — taking the guaranteed NIM escape.");
      reportNimDegraded("stall on primary and fast NIM models");
      req = nimEscapeRequestFor(model);
      r = await timedFetch(req, body, externalSignal);
    }
  }

  // Rotate through the key pool on auth/rate-limit answers.
  let rotations = 0;
  const maxRotations = Math.max(0, nimKeyPool().length - 1);
  while (
    !r.ok && req.provider === "nvidia-nim" &&
    (r.status === 401 || r.status === 403 || r.status === 429) &&
    rotations < maxRotations
  ) {
    advanceNimKey();
    rotations++;
    req = chatRequestFor(model);
    r = await timedFetch(req, body, externalSignal);
  }

  // Every pooled key rejected → trip the breaker and surface the auth failure.
  // There is no other provider, so this is one last direct NIM attempt; the
  // tripped breaker makes the next calls fail fast until the key is fixed.
  if (!r.ok && req.provider === "nvidia-nim" && (r.status === 401 || r.status === 403)) {
    reportNimHttpFailure(r.status);
    req = chatRequestFor(model);
    r = await timedFetch(req, body, externalSignal);
  }

  // Still rate-limited after exhausting the key pool. A model throttled across
  // EVERY key is usually a per-MODEL RPM cap, so first fail over to the fast
  // model (separate throttle budget) before backing off — observed live
  // 2026-06-13 as 429 on all 10 pooled keys, which left ABBY stalling.
  if (!r.ok && req.provider === "nvidia-nim" && r.status === 429 && req.model !== NIM_FAST_MODEL) {
    logger.warn({ model: req.model }, "NIM 429 on every pooled key — failing over to the fast model (separate throttle budget).");
    req = chatRequestFor(NIM_FAST_MODEL);
    r = await timedFetch(req, body, externalSignal);
  }
  // Then bounded exponential backoff with jitter (default 2 attempts) instead of
  // surfacing a transient 429 — tunable via NIM_429_BACKOFF_MS / NIM_429_RETRIES.
  if (!r.ok && req.provider === "nvidia-nim" && r.status === 429) {
    const base = Number(process.env["NIM_429_BACKOFF_MS"]) || 2_500;
    const attempts = Math.max(1, Number(process.env["NIM_429_RETRIES"]) || 2);
    for (let i = 0; i < attempts && !r.ok && r.status === 429; i++) {
      const wait = Math.round(base * 2 ** i * (0.5 + Math.random())); // exponential + jitter
      logger.warn({ model: req.model, attempt: i + 1, waitMs: wait }, "NIM still rate-limited — backing off before retry.");
      await new Promise((resolve) => setTimeout(resolve, wait));
      r = await timedFetch(req, body, externalSignal);
    }
  }

  // NIM-side 5xx (Nemotron 504s under load — observed live) → fast NIM model.
  if (!r.ok && req.provider === "nvidia-nim" && r.status >= 500 && req.model !== NIM_FAST_MODEL) {
    logger.warn({ model: req.model, status: r.status }, "NIM answered 5xx — retrying on the fast NIM model.");
    reportModelStall(req.model);
    req = chatRequestFor(NIM_FAST_MODEL);
    r = await timedFetch(req, body, externalSignal);
  }

  // FINAL ESCAPE — the whole NIM gauntlet (key rotation, backoff, fast-model
  // retry) failed and the key is VALID (429/5xx, not auth). Mark NIM degraded so
  // the next calls skip the gauntlet entirely, and give THIS call one last
  // direct, health-gate-bypassing NIM attempt before routing to OpenRouter.
  if (!r.ok && req.provider === "nvidia-nim") {
    reportNimDegraded(`HTTP ${r.status} after key rotation, backoff, and fast-model retry`);
    req = nimEscapeRequestFor(model);
    r = await timedFetch(req, body, externalSignal);
  }

  // ── OpenRouter fallback ───────────────────────────────────────────────────
  // NIM's entire survival kit (key rotation, stall failover, backoff, escape)
  // has been exhausted. If OPENROUTER_API_KEY is configured, route this call
  // to OpenRouter as a last-resort backstop — same OpenAI-compatible API shape,
  // different infra, so NIM outages don't take the whole swarm down.
  if (!r.ok && openrouterConfigured()) {
    const orReq = openrouterRequestFor(model);
    logger.warn(
      { nimStatus: r.status, nimModel: req.model, orModel: orReq.model },
      "NIM exhausted — falling back to OpenRouter.",
    );
    try {
      const orR = await timedFetch(orReq, body, externalSignal);
      if (orR.ok) {
        return { r: orR, req: orReq };
      }
      // OpenRouter also failed — log but surface the NIM error (it's the primary).
      logger.warn({ orStatus: orR.status, orModel: orReq.model }, "OpenRouter fallback also failed — surfacing NIM error.");
    } catch (orErr) {
      logger.warn({ err: String(orErr) }, "OpenRouter fallback threw — surfacing NIM error.");
    }
  }

  return { r, req };
}

/** Human label for an LlmChatRequest's provider — for error messages the operator sees. */
export function providerLabel(req: LlmChatRequest): string {
  if (req.provider === "openrouter") return "OpenRouter";
  if (req.provider === "bitdeer") return "Bitdeer";
  return "NVIDIA NIM";
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
    if (!r.ok) {
      logger.warn(
        { status: r.status, toolkit: input.toolkit, endpoint: input.endpoint, action: input.action, body: text.slice(0, 400) },
        "composioExecute: non-2xx response from Composio/upstream",
      );
    }
    return `Composio → HTTP ${r.status} ${r.statusText}\n${cleanComposioBody(text)}`;
  } catch (err) {
    logger.error({ err, toolkit: input.toolkit, endpoint: input.endpoint }, "composioExecute: fetch failed");
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

export interface ComposioTool {
  slug: string;
  name: string;
  description: string;
  required: string[];
}

/**
 * List the REAL action slugs for a toolkit (e.g. gmail → GMAIL_SEND_EMAIL,
 * GMAIL_CREATE_EMAIL_DRAFT, …). Agents otherwise guess slugs from memory and
 * 404 (the swarm tried GMAIL_DRAFT_EMAIL / GET_PROFILE — neither exists). This
 * hits Composio's authoritative `/tools?toolkit_slug=` endpoint so a CLAW can
 * pick a slug that actually exists before calling composio_action.
 * NOTE: the query param is snake_case `toolkit_slug`; `toolkitSlug` is ignored
 * by the API and returns the entire (unfiltered) tool catalog.
 */
export async function composioListTools(toolkitSlug: string, limit = 100): Promise<ComposioTool[]> {
  const params = new URLSearchParams({ toolkit_slug: toolkitSlug.toLowerCase(), limit: String(limit) });
  const data = await composioApi("GET", `/tools?${params.toString()}`);
  const items = (data["items"] as Array<Record<string, unknown>>) ?? [];
  return items.map((t) => {
    const ip = (t["input_parameters"] as Record<string, unknown>) ?? {};
    return {
      slug: String(t["slug"] ?? ""),
      name: String(t["name"] ?? ""),
      description: String(t["description"] ?? ""),
      required: (ip["required"] as string[]) ?? [],
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

/**
 * Delete a connected account (e.g. an EXPIRED linkedin/slack connection) so the
 * operator can clean up stale entries and re-connect fresh. Composio v3:
 * DELETE /connected_accounts/{id}.
 */
export async function composioDeleteConnection(connectionId: string): Promise<void> {
  await composioApi("DELETE", `/connected_accounts/${encodeURIComponent(connectionId)}`);
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
    { key: "nvidia-nim", name: "NVIDIA NIM", category: "llm", envVar: "NVIDIA_API_KEY", configured: has("NVIDIA_API_KEY") },
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
    { key: "image-generation", name: "Image generation (image_generate)", category: "tools", envVar: "IMAGE_API_KEY", configured: has("IMAGE_API_KEY") || has("DEEPINFRA_API_KEY") || has("OPENAI_API_KEY") || has("HUGGINGFACE_API_KEY") || has("HF_TOKEN") || has("HF_API_KEY") || has("BITDEER_API_KEY") || has("A2E_API_KEY") },
    { key: "video-generation", name: "Video generation (video_generate · A2E)", category: "tools", envVar: "A2E_API_KEY", configured: has("A2E_API_KEY") },
  ];
}
