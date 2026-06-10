/**
 * NVIDIA NIM provider routing — the contract that makes the 2026-06-10 model
 * migration safe: NIM models route to integrate.api.nvidia.com when
 * NVIDIA_API_KEY is set, and transparently remap to their legacy OpenRouter
 * equivalents when it is not (zero loss of function on a key-less deploy).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isNimModel, nimConfigured, chatRequestFor, NIM_MODEL_FALLBACKS, reportNimHttpFailure, resetNimHealth, nimHealthy } from "./integrations";

const ENV_KEYS = ["NVIDIA_API_KEY", "OPENROUTER_API_KEY", "HELICONE_API_KEY", "NIM_ENABLE_THINKING"] as const;
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

  it("remaps every NIM model to its legacy OpenRouter equivalent when NVIDIA_API_KEY is absent", () => {
    process.env["OPENROUTER_API_KEY"] = "or-test";
    expect(nimConfigured()).toBe(false);
    for (const [nim, legacy] of Object.entries(NIM_MODEL_FALLBACKS)) {
      const r = chatRequestFor(nim);
      expect(r.provider).toBe("openrouter");
      expect(r.model).toBe(legacy);
      expect(r.url).toContain("openrouter");
    }
    // unknown NIM-prefixed model still gets a working fallback, never a dead id
    const unknown = chatRequestFor("nvidia/some-future-model");
    expect(unknown.provider).toBe("openrouter");
    expect(unknown.model).toBe("x-ai/grok-4.3");
  });

  it("auto-upgrades legacy DB model ids to NIM at request time (self-healing)", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-test";
    // DB still says qwen/qwen3.7-plus but runtime upgrades to qwen/qwen3.5-397b-a17b
    const r = chatRequestFor("qwen/qwen3.7-plus");
    expect(r.provider).toBe("nvidia-nim");
    expect(r.model).toBe("qwen/qwen3.5-397b-a17b");
    // Same for all legacy models
    const r2 = chatRequestFor("x-ai/grok-4.3");
    expect(r2.provider).toBe("nvidia-nim");
    expect(r2.model).toBe("nvidia/nemotron-3-ultra-550b-a55b");
  });

  it("auto-upgrades legacy models to NIM fallbacks when NVIDIA key is absent", () => {
    process.env["OPENROUTER_API_KEY"] = "or-test";
    // DB has old qwen/qwen3.7-plus → upgrades to NIM id → falls back to OpenRouter
    // equivalent (which may be different from the original if the fallback map differs)
    const r = chatRequestFor("qwen/qwen3.7-plus");
    expect(r.provider).toBe("openrouter");
    // The legacy model gets upgraded to NIM, then NIM falls back — the round-trip
    // should land on the same legacy model (fallback map is self-consistent)
    expect(r.model).toBe("qwen/qwen3.7-plus");
  });

  it("passes non-NIM, non-legacy models through to OpenRouter unchanged", () => {
    process.env["OPENROUTER_API_KEY"] = "or-test";
    const r = chatRequestFor("openai/gpt-4o");
    expect(r.provider).toBe("openrouter");
    expect(r.model).toBe("openai/gpt-4o");
    expect(r.headers["Authorization"]).toBe("Bearer or-test");
  });

  it("throws a clear error when no provider key exists at all", () => {
    expect(() => chatRequestFor("x-ai/grok-4.3")).toThrow("OPENROUTER_API_KEY");
  });
});

describe("NIM auth circuit-breaker — a bad NVIDIA key can never take the swarm down", () => {
  it("trips on 401/403 and reroutes NIM models to OpenRouter despite the key being set", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-revoked";
    process.env["OPENROUTER_API_KEY"] = "or-test";
    // Before the breaker trips: routes to NIM.
    expect(chatRequestFor("qwen/qwen3.5-397b-a17b").provider).toBe("nvidia-nim");
    // Observed live 2026-06-10: integrate.api.nvidia.com → 403 Authorization failed.
    reportNimHttpFailure(403);
    expect(nimHealthy()).toBe(false);
    const r = chatRequestFor("qwen/qwen3.5-397b-a17b");
    expect(r.provider).toBe("openrouter");
    expect(r.model).toBe(NIM_MODEL_FALLBACKS["qwen/qwen3.5-397b-a17b"]);
  });

  it("does NOT trip on transient statuses (429/500) — only auth failures", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-good";
    process.env["OPENROUTER_API_KEY"] = "or-test";
    reportNimHttpFailure(429);
    reportNimHttpFailure(500);
    expect(nimHealthy()).toBe(true);
    expect(chatRequestFor("nvidia/nemotron-3-ultra-550b-a55b").provider).toBe("nvidia-nim");
  });

  it("recovers after reset (cooldown expiry) so a fixed key re-enables NIM without a restart", () => {
    process.env["NVIDIA_API_KEY"] = "nvapi-fixed";
    process.env["OPENROUTER_API_KEY"] = "or-test";
    reportNimHttpFailure(401);
    expect(chatRequestFor("deepseek-ai/deepseek-v4-flash").provider).toBe("openrouter");
    resetNimHealth(); // stands in for the 10-minute cooldown elapsing
    expect(chatRequestFor("deepseek-ai/deepseek-v4-flash").provider).toBe("nvidia-nim");
  });
});
