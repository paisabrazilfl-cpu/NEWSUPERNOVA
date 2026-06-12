/**
 * Vapi voice tool-server contract — the operator can literally phone the swarm.
 * Pins the tolerant parsing of Vapi's tool-call webhook payload (documented
 * shape + OpenAI-shaped variants) and the voice-friendly result formatting, so
 * a Vapi payload change or a markdown-heavy briefing can't silently break the
 * phone path.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

import { parseVapiToolCalls, voiceify } from "./routes/external";

describe("parseVapiToolCalls — tolerant across Vapi payload shapes", () => {
  it("parses the documented shape: toolCallList[{id, name, arguments}]", () => {
    const calls = parseVapiToolCalls({
      message: {
        type: "tool-calls",
        toolCallList: [{ id: "call_1", name: "dispatch_task", arguments: { task: "scrape competitor pricing" } }],
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ id: "call_1", name: "dispatch_task", args: { task: "scrape competitor pricing" } });
  });

  it("parses the OpenAI-shaped variant: function.name + JSON-string arguments", () => {
    const calls = parseVapiToolCalls({
      message: {
        type: "tool-calls",
        toolCallList: [{ id: "call_2", function: { name: "check_status", arguments: '{"verbose": true}' } }],
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("check_status");
    expect(calls[0]!.args).toEqual({ verbose: true });
  });

  it("falls back to the toolCalls key when toolCallList is absent", () => {
    const calls = parseVapiToolCalls({
      message: { type: "tool-calls", toolCalls: [{ id: "c3", name: "get_last_result", arguments: {} }] },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("get_last_result");
  });

  it("returns [] for non-tool-call server messages (status updates, end-of-call reports)", () => {
    expect(parseVapiToolCalls({ message: { type: "status-update", status: "in-progress" } })).toEqual([]);
    expect(parseVapiToolCalls({ message: { type: "end-of-call-report" } })).toEqual([]);
    expect(parseVapiToolCalls({})).toEqual([]);
    expect(parseVapiToolCalls(null)).toEqual([]);
  });

  it("skips malformed entries (missing id/name, broken argument JSON) without throwing", () => {
    const calls = parseVapiToolCalls({
      message: {
        type: "tool-calls",
        toolCallList: [
          { id: "", name: "dispatch_task", arguments: {} },
          { id: "ok", name: "dispatch_task", arguments: "{not json" },
          "garbage",
          null,
        ],
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ id: "ok", name: "dispatch_task", args: {} });
  });
});

describe("voiceify — results must read naturally when spoken", () => {
  it("strips markdown headers, emphasis, links and collapses whitespace", () => {
    const spoken = voiceify("## Result\n\n**Found** the [pricing page](https://x.com/p).\n\n- item one");
    expect(spoken).not.toContain("#");
    expect(spoken).not.toContain("**");
    expect(spoken).not.toContain("](");
    expect(spoken).toContain("Found the pricing page");
  });

  it("replaces code blocks instead of reading them aloud", () => {
    const spoken = voiceify("Run this:\n```js\nconsole.log(1)\n```\nthen retry.");
    expect(spoken).toContain("(code omitted)");
    expect(spoken).not.toContain("console.log");
  });

  it("caps length for voice delivery", () => {
    expect(voiceify("word ".repeat(2000)).length).toBeLessThanOrEqual(1200);
  });
});

import { extractVapiCallId, sanitizeOpenAiMessages } from "./routes/external";

describe("extractVapiCallId — voice mode detection on custom-LLM requests and webhook events", () => {
  it("pulls call.id from a Vapi custom-LLM body", () => {
    expect(extractVapiCallId({ model: "abby", messages: [], call: { id: "call-abc-123" } })).toBe("call-abc-123");
  });

  it("returns null when there is no live call (plain OpenAI-compatible caller)", () => {
    expect(extractVapiCallId({ model: "abby", messages: [] })).toBeNull();
    expect(extractVapiCallId({ call: { id: "  " } })).toBeNull();
    expect(extractVapiCallId(null)).toBeNull();
  });
});

describe("sanitizeOpenAiMessages — Vapi transcripts become provider-safe history", () => {
  it("keeps valid roles, coerces null content, drops empty assistant filler and junk roles", () => {
    const out = sanitizeOpenAiMessages([
      { role: "system", content: "be brief" },
      { role: "user", content: "hello" },
      { role: "assistant", content: null },                       // Vapi filler → dropped
      { role: "assistant", content: "Hi. What do you need?" },
      { role: "metadata", content: "internal" },                  // unknown role → dropped
      { role: "tool", content: "result", tool_call_id: "tc_1" },  // valid tool msg → kept
      { role: "tool", content: "orphan" },                        // no tool_call_id → dropped
    ]);
    expect(out).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "Hi. What do you need?" },
      { role: "tool", content: "result", tool_call_id: "tc_1" },
    ]);
  });

  it("preserves assistant tool_calls turns even with empty content", () => {
    const toolCalls = [{ id: "tc_9", type: "function", function: { name: "dispatch_task", arguments: "{}" } }];
    const out = sanitizeOpenAiMessages([{ role: "assistant", content: null, tool_calls: toolCalls }]);
    expect(out).toEqual([{ role: "assistant", content: "", tool_calls: toolCalls }]);
  });
});
