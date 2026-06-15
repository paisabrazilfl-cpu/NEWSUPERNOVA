/**
 * Raw tool-token rescue — observed live 2026-06-12: a Kimi-family model
 * emitted its native tool-call markup as PLAIN TEXT (the provider failed to
 * parse it into tool_calls). The markup rendered raw in the operator's chat,
 * and the action it described never executed. These tests pin both halves of
 * the fix: rescue the calls, strip the noise.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

import { rescueRawToolCalls, rescuePlainJsonToolCalls, stripToolTokenNoise } from "./routes/ai";

const LIVE_LEAK =
  'Deploying now.<|tool_calls_section_begin|><|tool_call_begin|>functions.code_exec:0' +
  '<|tool_call_argument_begin|>{"code":"cd /workspace/osint-hub\\necho \'Deploying fixed build to Render...\'"}' +
  "<|tool_call_end|><|tool_calls_section_end|>";

describe("rescueRawToolCalls — recover tool calls the provider failed to parse", () => {
  it("rescues the live-observed Kimi leak into a real, executable tool call", () => {
    const { clean, calls } = rescueRawToolCalls(LIVE_LEAK);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("code_exec");
    expect(JSON.parse(calls[0]!.arguments)).toHaveProperty("code");
    expect(clean).toBe("Deploying now.");
    expect(clean).not.toContain("<|tool_call");
  });

  it("does not rescue malformed (non-JSON) arguments — strips them as noise instead", () => {
    const { clean, calls } = rescueRawToolCalls(
      "ok<|tool_call_begin|>functions.code_exec:0<|tool_call_argument_begin|>{broken json<|tool_call_end|>",
    );
    expect(calls).toHaveLength(0);
    expect(clean).toBe("ok");
  });

  it("leaves ordinary text untouched (fast path)", () => {
    const { clean, calls } = rescueRawToolCalls("All quiet. What do you need?");
    expect(calls).toHaveLength(0);
    expect(clean).toBe("All quiet. What do you need?");
  });
});

describe("rescuePlainJsonToolCalls — recover bare-JSON tool calls emitted as text", () => {
  const KNOWN = ["http_request", "render_card", "web_search", "image_generate"];

  it("rescues the live-observed bare-JSON call into an executable tool call", () => {
    const { clean, calls } = rescuePlainJsonToolCalls(
      'Let me fetch that. {"name": "http_request", "parameters": {"url":"https://example.com","method":"GET","headers":{}}}',
      KNOWN,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("http_request");
    expect(JSON.parse(calls[0]!.arguments)).toMatchObject({ url: "https://example.com", method: "GET" });
    expect(clean).toBe("Let me fetch that.");
  });

  it("accepts a ```json fenced block and the `arguments` key spelling", () => {
    const { calls } = rescuePlainJsonToolCalls(
      '```json\n{"name":"render_card","arguments":{"title":"Hi"}}\n```',
      KNOWN,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("render_card");
    expect(JSON.parse(calls[0]!.arguments)).toMatchObject({ title: "Hi" });
  });

  it("tolerates a truncated tail (missing closing brace)", () => {
    const { calls } = rescuePlainJsonToolCalls(
      '{"name": "web_search", "parameters": {"query": "husky in the snow"}',
      KNOWN,
    );
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]!.arguments)).toMatchObject({ query: "husky in the snow" });
  });

  it("ignores JSON whose name is NOT a known tool (no false positives)", () => {
    const { clean, calls } = rescuePlainJsonToolCalls(
      'Here is the config: {"name":"production","parameters":{"region":"us"}}',
      KNOWN,
    );
    expect(calls).toHaveLength(0);
    expect(clean).toContain("production");
  });

  it("leaves ordinary text untouched (fast path)", () => {
    const { clean, calls } = rescuePlainJsonToolCalls("All done — here is your answer.", KNOWN);
    expect(calls).toHaveLength(0);
    expect(clean).toBe("All done — here is your answer.");
  });
});

describe("stripToolTokenNoise — the markup never reaches the operator", () => {
  it("removes a full section, stray markers, and collapses leftover spacing", () => {
    expect(stripToolTokenNoise(LIVE_LEAK)).toBe("Deploying now.");
    expect(stripToolTokenNoise("a <|tool_calls_section_end|> b")).toBe("a b");
    expect(stripToolTokenNoise("plain text")).toBe("plain text");
  });
});
