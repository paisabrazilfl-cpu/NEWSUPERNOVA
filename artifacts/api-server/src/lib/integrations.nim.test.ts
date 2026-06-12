/**
 * NVIDIA NIM provider routing — the contract that makes the 2026-06-10 model
 * migration safe: NIM models route to integrate.api.nvidia.com when
 * NVIDIA_API_KEY is set, and transparently remap to their legacy OpenRouter
 * equivalents when it is not (zero loss of function on a key-less deploy).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isNimModel, nimConfigured, chatRequestFor, openRouterRequestFor, NIM_MODEL_FALLBACKS, reportNimHttpFailure, resetNimHealth, nimHealthy, nimDegraded, reportNimDegraded, nimKeyPool, advanceNimKey, llmFetch, modelStalled } from "./integrations";

const ENV_KEYS = ["NVIDIA_API_KEY", "NVIDIA_API_KEY_2", "OPENROUTER_API_KEY", "HELICONE_API_KEY", "NIM_ENABLE_THINKING", "LLM_TIMEOUT_MS"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  resetNimHealth();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("isNimModel", () => {
  it("recognises the swarm's NIM model ids", () => {
    expect(isNimModel("nvidia/nemotron-3-ultra-550b-a55b")).toBe(true);
    expect(isNimModel("nvidia/nemotron-3-super-120b-a12b")).toBe(true);
    expect(isNimModel("deepseek-ai/deepseek-v4-flash")).toBe(true);
    expect(isNimModel("qwen/qwen3.5-397b-a17b")).toBe(true);
    expect(isNimModel("qwen/qwen3.5-122b-a10b")).toBe(true);
    expect(isNimModel("mistralai/mistral-medium-3.5-128b")).toBe(true);
  });
  it("does NOT capture legacy OpenRouter ids (qwen3.6/3.7, mistral/, x-ai/)", () => {
    expect(isNimModel("x-ai/grok-4.3")).toBe(false);
    expect(isNimModel("qwen/qwen3.7-plus")).toBe(false);
    expect(isNimModel("qwen/qwen3.6-plus")).toBe(false);
    expect(isNimModel("mistral/mistral-large")).toBe(false);
    expect(isNimModel("meta-llama/llama-4-maverick")).toBe(false);
  });
});

describe("chatRequestFor", () => {
  it("routes NIM models to integrate.api.nvidia.com when NVIDIA_API_KEY is set", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-test";
    const r = chatRequestFor("qwen/qwen3.5-397b-a17b");
    expect(r.provider).toBe("nvidia-nim");
    expect(r.url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(r.model).toBe("qwen/qwen3.5-397b-a17b");
    expect(r.headers["Authorization"]).toBe("Bearer nvapi-test");
    // qwen3.5 needs explicit sampling params (500s without them — verified live)
    expect(r.bodyExtras["temperature"]).toBe(0.6);
    expect(r.bodyExtras["top_p"]).toBe(0.95);
  });

  it("defaults Nemotron thinking OFF for bounded latency, NIM_ENABLE_THINKING=on re-enables", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-test";
    const off = chatRequestFor("nvidia/nemotron-3-ultra-550b-a55b");
    expect(off.bodyExtras["chat_template_kwargs"]).toEqual({ enable_thinking: false });
    process.env["NIM_ENABLE_THINKING"] = "on";
    const on = chatRequestFor("nvidia/nemotron-3-ultra-550b-a55b");
    expect(on.bodyExtras["chat_template_kwargs"]).toEqual({ enable_thinking: true });
    // non-Nemotron NIM models get no template kwargs
    const ds = chatRequestFor("deepseek-ai/deepseek-v4-flash");
    expect(ds.bodyExtras["chat_template_kwargs"]).toBeUndefined();
  });

  it("throws a clear error when NVIDIA_API_KEY is absent (NIM-only deployment)", () => {
    process.env["OPENROUTER_API_KEY"] = "or-test"; // must be ignored — OpenRouter is removed
    expect(nimConfigured()).toBe(false);
    expect(() => chatRequestFor("nvidia/nemotron-3-ultra-550b-a55b")).toThrow("NVIDIA_API_KEY");
  });

  it("maps every NIM-internal fallback target to a real NIM model (no dead ids)", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-test";
    for (const [primary, fallback] of Object.entries(NIM_MODEL_FALLBACKS)) {
      expect(isNimModel(primary), `${primary} must be a NIM id`).toBe(true);
      expect(isNimModel(fallback), `${fallback} (fallback of ${primary}) must be a NIM id`).toBe(true);
      const r = chatRequestFor(fallback);
      expect(r.provider).toBe("nvidia-nim");
      expect(r.model).toBe(fallback);
    }
  });

  it("remaps legacy/foreign (non-NIM) ids INTO NIM instead of routing to a removed provider", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-test";
    process.env["OPENROUTER_API_KEY"] = "or-test"; // present but must never be used
    for (const legacy of ["x-ai/grok-4.3", "openai/gpt-4o", "qwen/qwen3.7-plus", "mistral/mistral-large"]) {
      const r = chatRequestFor(legacy);
      expect(r.provider, `${legacy} must resolve to NIM`).toBe("nvidia-nim");
      expect(isNimModel(r.model), `${legacy} → ${r.model} must be a real NIM id`).toBe(true);
      expect(r.url).toContain("nvidia.com");
      expect(r.headers["Authorization"]).toBe("Bearer nvapi-test");
    }
  });

  it("throws a clear error when no provider key exists at all", () => {
    expect(() => chatRequestFor("x-ai/grok-4.3")).toThrow("NVIDIA_API_KEY");
  });
});

describe("NIM auth circuit-breaker — a bad NVIDIA key is reported, never silently rerouted off-NVIDIA", () => {
  it("trips nimHealthy() on 401/403 (the marker llmFetch and the vault route consult)", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-revoked";
    expect(chatRequestFor("qwen/qwen3.5-397b-a17b").provider).toBe("nvidia-nim");
    // Observed live 2026-06-10: integrate.api.nvidia.com → 403 Authorization failed.
    reportNimHttpFailure(403);
    expect(nimHealthy()).toBe(false);
    // NIM-only: routing still targets NVIDIA (there is nowhere else to go);
    // the breaker is a health signal for llmFetch/operators, not a reroute.
    expect(chatRequestFor("qwen/qwen3.5-397b-a17b").provider).toBe("nvidia-nim");
  });

  it("does NOT trip on transient statuses (429/500) — only auth failures", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-good";
    reportNimHttpFailure(429);
    reportNimHttpFailure(500);
    expect(nimHealthy()).toBe(true);
    expect(chatRequestFor("nvidia/nemotron-3-ultra-550b-a55b").provider).toBe("nvidia-nim");
  });

  it("recovers after reset (cooldown expiry) so a fixed key clears the health mark without a restart", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-fixed";
    reportNimHttpFailure(401);
    expect(nimHealthy()).toBe(false);
    resetNimHealth(); // stands in for the 10-minute cooldown elapsing
    expect(nimHealthy()).toBe(true);
    expect(chatRequestFor("deepseek-ai/deepseek-v4-flash").provider).toBe("nvidia-nim");
  });
});

describe("NIM degraded breaker — a VALID key that is throttled/overloaded is marked, never rerouted off-NVIDIA", () => {
  it("degraded mark is set and readable, while routing stays on NIM", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-valid-but-throttled";
    expect(chatRequestFor("nvidia/nemotron-3-ultra-550b-a55b").provider).toBe("nvidia-nim");
    reportNimDegraded("test: 429 on every pooled key");
    expect(nimDegraded()).toBe(true);
    expect(nimHealthy()).toBe(true); // auth breaker untouched — the key IS valid
    expect(chatRequestFor("nvidia/nemotron-3-ultra-550b-a55b").provider).toBe("nvidia-nim");
  });

  it("resetNimHealth clears the degraded mark (cooldown expiry / key rotation)", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-x";
    reportNimDegraded("test");
    expect(nimDegraded()).toBe(true);
    resetNimHealth();
    expect(nimDegraded()).toBe(false);
    expect(chatRequestFor("z-ai/glm-5.1").provider).toBe("nvidia-nim");
  });

  it("openRouterRequestFor (the escape builder) now builds a NIM request — never a removed provider", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-healthy";
    process.env["OPENROUTER_API_KEY"] = "or-test"; // present but must never be used
    const r = openRouterRequestFor("nvidia/nemotron-3-ultra-550b-a55b");
    expect(r.provider).toBe("nvidia-nim");
    expect(r.url).toContain("nvidia.com");
    expect(r.model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
    expect(r.headers["Authorization"]).toBe("Bearer nvapi-healthy");
  });
});

describe("NIM key pool — the operator's multiple build.nvidia.com keys are all used", () => {
  it("parses comma/space/newline-separated keys plus NVIDIA_API_KEY_2…, deduped", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-a, nvapi-b\nnvapi-c nvapi-a";
    process.env["NVIDIA_API_KEY_2"] = "nvapi-d";
    expect(nimKeyPool()).toEqual(["nvapi-a", "nvapi-b", "nvapi-c", "nvapi-d"]);
    expect(nimConfigured()).toBe(true);
  });

  it("rotates the key used by chatRequestFor and wraps around the pool", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-a,nvapi-b";
    expect(chatRequestFor("z-ai/glm-5.1").headers["Authorization"]).toBe("Bearer nvapi-a");
    expect(advanceNimKey()).toBe(true);
    expect(chatRequestFor("z-ai/glm-5.1").headers["Authorization"]).toBe("Bearer nvapi-b");
    expect(advanceNimKey()).toBe(true); // wraps
    expect(chatRequestFor("z-ai/glm-5.1").headers["Authorization"]).toBe("Bearer nvapi-a");
  });

  it("reports no rotation possible with a single key", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-only";
    expect(advanceNimKey()).toBe(false);
  });
});

describe("llmFetch — rotation, breaker, and stall failover", () => {
  afterEach(() => vi.unstubAllGlobals());

  function jsonResponse(status: number, body: unknown = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  it("rotates to the next pooled key on 429 and succeeds without leaving NIM", async () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-a,nvapi-b";
    const seen: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>)["Authorization"];
      seen.push(auth);
      return auth === "Bearer nvapi-a" ? jsonResponse(429) : jsonResponse(200, { ok: true });
    }));
    const { r, req } = await llmFetch("z-ai/glm-5.1", { messages: [] });
    expect(r.status).toBe(200);
    expect(req.provider).toBe("nvidia-nim");
    expect(seen).toEqual(["Bearer nvapi-a", "Bearer nvapi-b"]);
  });

  it("rejected on EVERY pooled key: marks NIM unhealthy and returns the honest failure — zero off-NVIDIA traffic", async () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-a,nvapi-b";
    process.env["OPENROUTER_API_KEY"] = "or-test"; // present but must never be used
    const urls: string[] = [];
    const keys: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      urls.push(String(url));
      keys.push(String((init.headers as Record<string, string>)["Authorization"]));
      return jsonResponse(403);
    }));
    const { r, req } = await llmFetch("z-ai/glm-5.1", { messages: [] });
    // The failure is surfaced honestly to the caller.
    expect(r.status).toBe(403);
    expect(req.provider).toBe("nvidia-nim");
    expect(nimHealthy()).toBe(false);
    // Both pooled keys were tried; every single request stayed on NVIDIA.
    expect(new Set(keys)).toEqual(new Set(["Bearer nvapi-a", "Bearer nvapi-b"]));
    expect(urls.length).toBeGreaterThanOrEqual(2);
    expect(urls.every((u) => u.includes("nvidia"))).toBe(true);
    expect(urls.some((u) => u.includes("openrouter"))).toBe(false);
  });

  it("retries a 5xx (Nemotron 504 under load) once on the fast NIM model", async () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-a";
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string };
      models.push(body.model);
      return body.model.startsWith("nvidia/") ? jsonResponse(504) : jsonResponse(200, { ok: true });
    }));
    const { r, req } = await llmFetch("nvidia/nemotron-3-ultra-550b-a55b", { messages: [] });
    expect(r.status).toBe(200);
    expect(req.provider).toBe("nvidia-nim");
    expect(models).toEqual(["nvidia/nemotron-3-ultra-550b-a55b", "moonshotai/kimi-k2.6"]);
  });

  it("fails over to the fast NIM model when the upstream never starts responding", async () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-a";
    process.env["LLM_TIMEOUT_MS"] = "50";
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string };
      models.push(body.model);
      if (body.model.startsWith("nvidia/")) {
        // Simulate a stalled upstream: resolve only when aborted.
        return new Promise<Response>((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener("abort", () => reject(new Error("AbortError")));
        });
      }
      return jsonResponse(200, { ok: true });
    }));
    const { r, req } = await llmFetch("nvidia/nemotron-3-ultra-550b-a55b", { messages: [] });
    expect(r.status).toBe(200);
    expect(req.model).toBe("moonshotai/kimi-k2.6");
    expect(models).toEqual(["nvidia/nemotron-3-ultra-550b-a55b", "moonshotai/kimi-k2.6"]);
  });

  it("stall breaker: after one stall, later calls skip the sick model and go straight to the fast model", async () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-a";
    process.env["LLM_TIMEOUT_MS"] = "50";
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string };
      models.push(body.model);
      if (body.model.startsWith("nvidia/")) {
        return new Promise<Response>((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener("abort", () => reject(new Error("AbortError")));
        });
      }
      return jsonResponse(200, { ok: true });
    }));
    // First call pays the timeout once and marks the model as stalling.
    await llmFetch("nvidia/nemotron-3-ultra-550b-a55b", { messages: [] });
    expect(modelStalled("nvidia/nemotron-3-ultra-550b-a55b")).toBe(true);
    // Second call must NOT touch the sick model at all.
    const { r, req } = await llmFetch("nvidia/nemotron-3-ultra-550b-a55b", { messages: [] });
    expect(r.status).toBe(200);
    expect(req.model).toBe("moonshotai/kimi-k2.6");
    expect(models).toEqual([
      "nvidia/nemotron-3-ultra-550b-a55b", "moonshotai/kimi-k2.6", // first call: stall + failover
      "moonshotai/kimi-k2.6",                                       // second call: direct
    ]);
  });

  it("backs off and retries once when every pooled key is rate-limited (429), instead of surfacing it", async () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-only";
    process.env["NIM_429_BACKOFF_MS"] = "10";
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      return calls === 1 ? jsonResponse(429) : jsonResponse(200, { ok: true });
    }));
    const { r, req } = await llmFetch("z-ai/glm-5.1", { messages: [] });
    expect(r.status).toBe(200);
    expect(req.provider).toBe("nvidia-nim");
    expect(calls).toBe(2);
    delete process.env["NIM_429_BACKOFF_MS"];
  });

  it("a 5xx also marks the model stalled, and resetNimHealth clears the mark", async () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-a";
    process.env["OPENROUTER_API_KEY"] = "or-test";
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { model: string };
      return body.model.startsWith("nvidia/") ? jsonResponse(504) : jsonResponse(200, { ok: true });
    }));
    await llmFetch("nvidia/nemotron-3-ultra-550b-a55b", { messages: [] });
    expect(modelStalled("nvidia/nemotron-3-ultra-550b-a55b")).toBe(true);
    resetNimHealth(); // stands in for the 5-minute cooldown elapsing
    expect(modelStalled("nvidia/nemotron-3-ultra-550b-a55b")).toBe(false);
  });

  it("FINAL ESCAPE (NIM-only): 429 on every key + backoff retry → NIM marked degraded and the failure surfaced honestly — zero off-NVIDIA traffic", async () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-valid-but-throttled";
    process.env["OPENROUTER_API_KEY"] = "or-test"; // present but must never be used
    process.env["NIM_429_BACKOFF_MS"] = "5";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(String(url));
      return jsonResponse(429);
    }));
    const { r, req } = await llmFetch("nvidia/nemotron-3-ultra-550b-a55b", { messages: [] });
    // OpenRouter is removed: the throttle is surfaced honestly — it is NOT
    // silently rerouted to a third-party router with no credits (the source
    // of the live 402 outage).
    expect(r.status).toBe(429);
    expect(req.provider).toBe("nvidia-nim");
    expect(urls.length).toBeGreaterThanOrEqual(2); // initial + backoff retry at minimum
    expect(urls.every((u) => u.includes("nvidia.com"))).toBe(true);
    expect(urls.some((u) => u.includes("openrouter"))).toBe(false);
    // NIM is marked degraded so operators/vault routes can see and clear it.
    expect(nimDegraded()).toBe(true);
    // Routing still targets NVIDIA — there is no other provider.
    expect(chatRequestFor("qwen/qwen3.5-397b-a17b").provider).toBe("nvidia-nim");
    delete process.env["NIM_429_BACKOFF_MS"];
  });
});
