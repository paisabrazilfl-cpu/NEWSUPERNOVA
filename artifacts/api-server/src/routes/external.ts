/**
 * OPENCLAW OMEGA — External API (Inbound)
 *
 * OpenAI-compatible endpoints for connecting external systems (n8n, etc.)
 * directly into the ABBY CLAW swarm.
 *
 * Base:  /api/external/v1
 * Auth:  Authorization: Bearer <OPENCLAW_API_KEY>  OR  x-api-key: <key>
 *        If OPENCLAW_API_KEY env var is not set, auth is open (dev mode).
 *
 * Endpoints:
 *   GET  /api/external/v1/models                — list ABBY CLAW agents as OpenAI models
 *   GET  /api/external/v1/agents                — full agent registry
 *   GET  /api/external/v1/swarm                 — swarm status snapshot
 *   POST /api/external/v1/chat/completions      — OpenAI-format chat → routed to ABBY CLAW agent
 *   POST /api/external/v1/messages              — inject a raw message into OPENCLAW chat feed
 *   POST /api/external/v1/twin-lessons          — quarantined ingest of a twin swarm's verified lessons
 *   POST /api/external/v1/vapi/webhook          — Vapi voice-assistant tool server (dispatch_task, check_status, get_last_result)
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { agentsTable, messagesTable, channelsTable, agentMemoryTable, tasksTable } from "@workspace/db";
import { eq, desc, like, and } from "drizzle-orm";
import { llmFetch } from "../lib/integrations";
import { timingSafeStrEqual } from "../lib/auth";
import { embed } from "../lib/embeddings";
import { quarantineTags } from "../lib/twinSync";
import { orchestrateGoal } from "../orchestrator";
import { ANTI_HALLUCINATION_DIRECTIVE, ABBY_DEFAULT_MODEL, requestsConnectedAccountAction } from "./ai";

const router = Router();

// VAULT — the memory/RAG agent; inbound twin lessons are filed under it.
const VAULT_AGENT_ID = 4;
// WIRE — holds the Composio/connected-account tools; connected-account voice
// tasks are forced onto it (same routing the chat path and scheduler use).
const COMPOSIO_AGENT_ID = 5;
const DEFAULT_CHANNEL_ID = 1;

const AGENT_NAME_MAP: Record<string, number> = {
  abby:    1,
  forge:   2,
  crawler: 3,
  vault:   4,
  wire:    5,
  "mr.nice": 6,
  mrnice:  6,
  "claw-1": 2,
  "claw-2": 3,
  "claw-3": 4,
  "claw-4": 5,
};

const AGENT_PERSONAS: Record<number, string> = {
  1: "You are ABBY, orchestrator of the ABBY CLAW agent swarm inside OPENCLAW OMEGA. You command FORGE (code), CRAWLER (browser), VAULT (memory/RAG), WIRE (APIs), and MR.NICE (social): decompose the goal, delegate one concrete directive to each relevant specialist, verify the results against real evidence, and deliver a direct answer. Terse, results-first, no filler.",
  2: "You are FORGE, the code execution specialist of the ABBY CLAW swarm. You write, execute, and debug code in any language. You prefer efficient, working solutions with zero fluff. Terminal aesthetic.",
  3: "You are CRAWLER, the browser automation and web intelligence agent. You navigate websites, extract data, and wield the Steel Dev Browser API. Methodical and data-driven.",
  4: "You are VAULT, the memory and RAG retrieval agent. You manage vector storage, semantic search, and context windows. Cold, accurate, reliable.",
  5: "You are WIRE, the API integration specialist. You connect external services, webhooks, and data pipelines. Direct and technical.",
  6: "You are MR.NICE, the social intelligence agent. You manage communications and human engagement. Sharp, witty, persuasive.",
};

// ─── Auth middleware ─────────────────────────────────────────────────────────
function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const expectedKey = process.env["OPENCLAW_API_KEY"];
  if (!expectedKey) {
    // FAIL CLOSED: with no key configured the external surface (chat/completions,
    // messages, twin-lessons, and the Vapi webhook that hands goals straight to
    // the orchestrator) would otherwise be open to the world — i.e. unauthenticated
    // command execution against the swarm. Reject unless the operator has
    // explicitly opted into open mode for local dev.
    if (process.env["ALLOW_OPEN_EXTERNAL"] === "1") { next(); return; }
    res.status(503).json({ error: "External API disabled — OPENCLAW_API_KEY is not configured on the server." });
    return;
  }
  const provided =
    (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "") ??
    (req.headers["x-api-key"] as string | undefined) ??
    // Vapi tool servers send their credential in x-vapi-secret.
    (req.headers["x-vapi-secret"] as string | undefined);
  if (!provided || !timingSafeStrEqual(provided, expectedKey)) {
    res.status(401).json({ error: "Unauthorized — provide a valid OPENCLAW_API_KEY" }); return;
  }
  next();
}

router.use("/external/v1", apiKeyAuth);

// ─── GET /api/external/v1/models ─────────────────────────────────────────────
router.get("/external/v1/models", async (req, res) => {
  try {
    const agents = await db.select().from(agentsTable);
    const data = agents.map(a => ({
      id: a.name.toLowerCase(),
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "openclaw-omega",
      display_name: a.name,
      description: `${a.name} — ${a.role ?? "ABBY CLAW agent"}`,
      agent_id: a.id,
      color: a.color,
      status: a.status,
      underlying_model: a.model,
    }));
    res.json({ object: "list", data });
  } catch (err) {
    req.log.error({ err }, "External API: list models");
    res.status(500).json({ error: "Failed to list models" });
  }
});

// ─── GET /api/external/v1/agents ─────────────────────────────────────────────
router.get("/external/v1/agents", async (req, res) => {
  try {
    const agents = await db.select().from(agentsTable);
    res.json({ agents });
  } catch (err) {
    req.log.error({ err }, "External API: list agents");
    res.status(500).json({ error: "Failed to list agents" });
  }
});

// ─── GET /api/external/v1/swarm ──────────────────────────────────────────────
router.get("/external/v1/swarm", async (req, res) => {
  try {
    const [agents, channels, recent] = await Promise.all([
      db.select().from(agentsTable),
      db.select().from(channelsTable),
      db.select().from(messagesTable).orderBy(desc(messagesTable.id)).limit(10),
    ]);
    res.json({
      agents: agents.map(a => ({ id: a.id, name: a.name, status: a.status, color: a.color })),
      channelCount: channels.length,
      recentMessages: recent.map(m => ({
        id: m.id,
        agentName: m.agentName,
        content: m.content?.slice(0, 120),
        messageType: m.messageType,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "External API: swarm status");
    res.status(500).json({ error: "Failed to get swarm status" });
  }
});

// ─── POST /api/external/v1/chat/completions ──────────────────────────────────
// OpenAI-compatible. Use `model` = agent name (abby, forge, vault…) or "abby" default.
// Supports stream: true (SSE) and stream: false (JSON).
//
// VOICE MODE (Vapi custom-LLM): Vapi includes the live `call` object in every
// request. When a call id is present, the request takes the voice path:
//   - one dashboard channel is created per call (the phone conversation is a
//     chat of its own, with the live transcript logged into it), and
//   - the swarm tools (dispatch_task / check_status / get_last_result) are
//     executed INLINE in the model loop — the voice agent never depends on
//     Vapi's separate tool-server round trip, so a tool turn can't dead-end
//     into silence, and the result is spoken in the same breath.

/** Pull the Vapi call id out of a custom-LLM request or webhook message. */
export function extractVapiCallId(body: unknown): string | null {
  const rec = body as { call?: { id?: unknown } } | null | undefined;
  const id = rec?.call && typeof rec.call.id === "string" ? rec.call.id.trim() : "";
  return id || null;
}

/**
 * Keep only OpenAI-valid roles and shapes: Vapi (and other external callers)
 * interleave assistant turns with null content, tool messages, and metadata
 * roles that NIM rejects with a 400 — which reads as "the agent went silent".
 */
export function sanitizeOpenAiMessages(raw: unknown[]): Array<Record<string, unknown>> {
  const ROLES = new Set(["system", "user", "assistant", "tool"]);
  const out: Array<Record<string, unknown>> = [];
  for (const item of raw.slice(-60)) {
    const m = (item ?? {}) as { role?: unknown; content?: unknown; tool_calls?: unknown; tool_call_id?: unknown };
    const role = String(m.role ?? "");
    if (!ROLES.has(role)) continue;
    const content = typeof m.content === "string" ? m.content : "";
    const msg: Record<string, unknown> = { role, content };
    if (role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length) msg["tool_calls"] = m.tool_calls;
    if (role === "tool") {
      if (typeof m.tool_call_id !== "string" || !m.tool_call_id) continue;
      msg["tool_call_id"] = m.tool_call_id;
    }
    // Drop empty assistant filler turns (no text, no tool calls) — they are
    // Vapi bookkeeping, and some NIM models refuse empty assistant content.
    if (role === "assistant" && !content && !msg["tool_calls"]) continue;
    out.push(msg);
  }
  return out;
}

// One dashboard channel per live phone call, keyed by Vapi call id. The
// description carries a `vapi:<id>` marker so a server restart mid-call finds
// the existing channel instead of opening a duplicate.
const vapiCallChannels = new Map<string, number>();

async function channelForVapiCall(callId: string): Promise<number> {
  const cached = vapiCallChannels.get(callId);
  if (cached) return cached;
  const marker = `vapi:${callId}`;
  const [existing] = await db
    .select()
    .from(channelsTable)
    .where(like(channelsTable.description, `%${marker}%`))
    .limit(1);
  if (existing) {
    vapiCallChannels.set(callId, existing.id);
    return existing.id;
  }
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const [ch] = await db
    .insert(channelsTable)
    .values({
      name: `voice-${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`,
      type: "general",
      description: `📞 Voice call via Vapi (${marker})`,
    })
    .returning();
  vapiCallChannels.set(callId, ch.id);
  await db.insert(messagesTable).values({
    channelId: ch.id,
    agentId: null,
    agentName: "SYSTEM",
    agentColor: "#7888a0",
    content: "📞 Voice call connected — live transcript of this conversation follows.",
    messageType: "system",
    metadata: JSON.stringify({ source: "vapi", callId }),
  });
  return ch.id;
}

/** Best-effort transcript line; a logging failure must never break the call. */
async function logVoiceTurn(
  channelId: number,
  entry: { role: "user" | "assistant" | "system"; content: string; agent?: { id: number; name: string; color: string | null } },
): Promise<void> {
  if (!entry.content.trim()) return;
  try {
    await db.insert(messagesTable).values({
      channelId,
      agentId: entry.agent?.id ?? null,
      agentName: entry.role === "user" ? "OPERATOR 📞" : (entry.agent?.name ?? "SYSTEM"),
      agentColor: entry.role === "user" ? "#00e5ff" : (entry.agent?.color ?? "#7888a0"),
      content: entry.content.slice(0, 20_000),
      messageType: entry.role === "user" ? "user" : entry.role === "assistant" ? "agent" : "system",
      metadata: JSON.stringify({ source: "vapi" }),
    });
  } catch { /* transcript is best-effort */ }
}

// The swarm tools offered to the voice model — same contract as the Vapi
// custom tools, but executed inline by this server (see runVapiTool).
const VOICE_TOOLS = [
  {
    type: "function",
    function: {
      name: "dispatch_task",
      description:
        "Dispatch a goal to the BOS-AURA agent swarm (research, build, analyze, post, schedule, …). Fire-and-forget: the swarm works in the background. Confirm dispatch and move on.",
      parameters: {
        type: "object",
        required: ["task"],
        properties: {
          task: { type: "string", description: "Complete, self-contained instruction for the swarm." },
          priority: { type: "string", enum: ["normal", "high"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_status",
      description: "Voice-sized summary of what the swarm is doing right now (busy agents, running and recent tasks).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_last_result",
      description: "ABBY's most recent final result, cleaned up for speech.",
      parameters: { type: "object", properties: {} },
    },
  },
];

router.post("/external/v1/chat/completions", async (req, res) => {
  const {
    model = "abby",
    messages = [],
    stream = false,
    max_tokens: maxTokensRaw = 1024,
    tools: callerTools,
  } = req.body ?? {};

  // Clamp max_tokens to a sane window so a caller can't drive cost/abuse with a
  // huge value (or break the provider with a non-numeric one).
  const max_tokens = Math.min(8192, Math.max(1, Number(maxTokensRaw) || 1024));
  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "messages must be an array" }); return;
  }

  const agentId = typeof model === "number"
    ? model
    : (AGENT_NAME_MAP[(model as string).toLowerCase()] ?? 1);

  let agent: typeof agentsTable.$inferSelect | undefined;
  try {
    const rows = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    agent = rows[0];
  } catch (err) {
    req.log.error({ err }, "External API: fetch agent");
    res.status(500).json({ error: "Failed to fetch agent" }); return;
  }
  if (!agent) { res.status(404).json({ error: `Agent '${model}' not found` }); return; }

  // llmFetch (used below) carries the NIM key rotation + circuit breakers.
  const agentModel = agent.model ?? ABBY_DEFAULT_MODEL;

  const systemPrompt = (AGENT_PERSONAS[agentId] ?? `You are ${agent.name}, an AI agent in the ABBY CLAW swarm.`) + ANTI_HALLUCINATION_DIRECTIVE;
  const sanitized = sanitizeOpenAiMessages(messages);
  const orMessages = [{ role: "system", content: systemPrompt }, ...sanitized];

  // ── VOICE MODE — a live Vapi phone call ────────────────────────────────────
  const callId = extractVapiCallId(req.body);
  if (callId) {
    const sendSSE = (payload: object | "[DONE]") => {
      if (payload === "[DONE]") { res.write("data: [DONE]\n\n"); return; }
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };
    if (stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();
    }
    let channelId = DEFAULT_CHANNEL_ID;
    try {
      channelId = await channelForVapiCall(callId);
      const lastUser = [...sanitized].reverse().find((m) => m["role"] === "user");
      if (lastUser) await logVoiceTurn(channelId, { role: "user", content: String(lastUser["content"] ?? "") });

      // Inline agentic loop: short turns, the call's own channel for dispatch.
      const working: Array<Record<string, unknown>> = [...orMessages];
      let finalText = "";
      for (let round = 0; round < 4; round++) {
        const { r } = await llmFetch(agentModel, {
          messages: working,
          tools: VOICE_TOOLS,
          tool_choice: "auto",
          stream: false,
          max_tokens: Math.min(max_tokens, 400),
        });
        if (!r.ok) {
          const errText = (await r.text()).slice(0, 200);
          req.log.error({ status: r.status, errText }, "Voice turn: provider error");
          finalText = "I hit a model provider error just now. Give me a second and ask again.";
          break;
        }
        const data = (await r.json()) as { choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }> } }> };
        const msg = data.choices?.[0]?.message;
        const toolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
        if (toolCalls.length === 0) {
          finalText = (msg?.content ?? "").trim();
          break;
        }
        working.push({ role: "assistant", content: msg?.content ?? "", tool_calls: toolCalls });
        for (const tc of toolCalls.slice(0, 3)) {
          const name = String(tc.function?.name ?? "");
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function?.arguments || "{}") as Record<string, unknown>; } catch { /* leave {} */ }
          const result = await runVapiTool(name, args, req.log, { channelId });
          working.push({ role: "tool", tool_call_id: tc.id, content: result });
          await logVoiceTurn(channelId, { role: "system", content: `🛠 ${name}${args["task"] ? `: ${String(args["task"]).slice(0, 200)}` : ""} → ${result.slice(0, 300)}` });
        }
      }
      if (!finalText) finalText = "Done. Anything else?";
      finalText = voiceify(finalText, 1200);
      await logVoiceTurn(channelId, { role: "assistant", content: finalText, agent: { id: agent.id, name: agent.name, color: agent.color } });

      if (stream) {
        const id = `chatcmpl-voice-${Date.now()}`;
        const chunk = (delta: object, finish: string | null = null) => ({
          id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        });
        sendSSE(chunk({ role: "assistant" }));
        // Sentence-sized chunks so TTS starts speaking without waiting for the tail.
        for (const piece of finalText.match(/[^.!?]+[.!?]*\s*/g) ?? [finalText]) sendSSE(chunk({ content: piece }));
        sendSSE(chunk({}, "stop"));
        sendSSE("[DONE]");
        res.end();
      } else {
        res.json({
          id: `chatcmpl-voice-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, message: { role: "assistant", content: finalText }, finish_reason: "stop" }],
          usage: {},
        });
      }
    } catch (err) {
      req.log.error({ err, callId }, "Voice turn failed");
      if (stream) {
        sendSSE({ id: "chatcmpl-voice-err", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { role: "assistant", content: "Something broke on my side — try that again." }, finish_reason: null }] });
        sendSSE({ id: "chatcmpl-voice-err", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        sendSSE("[DONE]");
        res.end();
      } else {
        res.status(500).json({ error: String(err) });
      }
    }
    return;
  }

  // Non-voice external callers may bring their own OpenAI tools; pass them
  // through so the model can answer with tool_calls.
  const passthroughTools = Array.isArray(callerTools) && callerTools.length
    ? { tools: callerTools.slice(0, 32), tool_choice: "auto" }
    : {};

  // ── Streaming response ───────────────────────────────────────────────────
  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendSSE = (payload: object | "[DONE]") => {
      if (payload === "[DONE]") { res.write("data: [DONE]\n\n"); return; }
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const { r: orRes } = await llmFetch(agentModel, { stream: true, messages: orMessages, max_tokens, ...passthroughTools });

      if (!orRes.ok) {
        const errText = await orRes.text();
        sendSSE({ error: errText.slice(0, 300) });
        res.end(); return;
      }

      const decoder = new TextDecoder();
      const reader = orRes.body?.getReader();
      if (!reader) { res.end(); return; }

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const t = raw.trim();
          if (!t) continue;
          if (t === "data: [DONE]") { sendSSE("[DONE]"); continue; }
          if (t.startsWith("data: ")) {
            try {
              const chunk = JSON.parse(t.slice(6));
              if (chunk && typeof chunk === "object") chunk.model = model;
              sendSSE(chunk);
            } catch { res.write(t + "\n\n"); }
          }
        }
      }
      sendSSE("[DONE]");
    } catch (err) {
      req.log.error({ err }, "External API stream error");
    }
    res.end();
    return;
  }

  // ── Non-streaming response ───────────────────────────────────────────────
  try {
    const { r: orRes } = await llmFetch(agentModel, { messages: orMessages, max_tokens, ...passthroughTools });
    const data = await orRes.json() as {
      choices?: { message?: { content?: string; tool_calls?: unknown[] } }[];
      usage?: object;
    };
    const message = data.choices?.[0]?.message;
    const content = message?.content ?? "";
    const toolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length ? { tool_calls: message.tool_calls } : {};
    res.json({
      id: `chatcmpl-openclaw-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content, ...toolCalls }, finish_reason: Object.keys(toolCalls).length ? "tool_calls" : "stop" }],
      usage: data.usage ?? {},
    });
  } catch (err) {
    req.log.error({ err }, "External API complete error");
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /api/external/v1/messages ──────────────────────────────────────────
// Inject a message directly into the OPENCLAW chat feed.
// Body: { content, agentName?, agentColor?, channelId?, messageType? }
router.post("/external/v1/messages", async (req, res) => {
  const {
    content,
    agentName = "EXTERNAL",
    agentColor = "#ff2d78",
    channelId = 1,
    messageType = "agent",
  } = req.body ?? {};

  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "content is required" }); return;
  }
  // Bound and constrain externally-injected content: cap length, whitelist the
  // message type, coerce the channel to an integer, and force a clear external
  // label on the displayed author so an external caller can't convincingly
  // impersonate a real agent (e.g. "ABBY") in the feed or via fed-back history.
  const ALLOWED_TYPES = new Set(["agent", "user", "system", "tool_output"]);
  const safeType = ALLOWED_TYPES.has(String(messageType)) ? String(messageType) : "system";
  const safeChannel = Number.isFinite(Number(channelId)) ? Number(channelId) : 1;
  const safeName = `${String(agentName).slice(0, 40)} (external)`;
  const safeContent = content.slice(0, 20_000);

  try {
    const [msg] = await db.insert(messagesTable).values({
      channelId: safeChannel,
      agentId: null,
      agentName: safeName,
      agentColor: String(agentColor).slice(0, 32),
      content: safeContent,
      messageType: safeType,
      metadata: JSON.stringify({ source: "external_api" }),
    }).returning();
    res.status(201).json({ message: msg });
  } catch (err) {
    req.log.error({ err }, "External API: post message");
    res.status(500).json({ error: "Failed to post message" });
  }
});

// ─── POST /api/external/v1/twin-lessons ──────────────────────────────────────
// Learner side of the twin teaching sync (lib/twinSync.ts is the teacher side).
// T800-AURA is a SEPARATE repo/service: it needs its own implementation of this
// ingest endpoint to receive AURA's nightly teach push — this route is AURA's
// own inbound ear, so a twin can teach BOS-AURA back through the same contract.
// Inbound lessons are stored QUARANTINED: tagged "from-twin,proposed" with the
// teacher's "self-learned" tag stripped, so a twin lesson is visible to this
// swarm's agents via memory_search but is never auto-trusted and can never be
// re-exported as if verified here (no echo loop).
// Idempotent: each lesson carries a stable sourceId ("aura:<id>"); re-pushes
// of an already-ingested lesson are skipped via its "src:" tag marker.
// Body: { source?: string, lessons: [{ sourceId, key?, content, tags?, agentName? }] }
router.post("/external/v1/twin-lessons", async (req, res) => {
  const body = (req.body ?? {}) as { source?: unknown; lessons?: unknown };
  if (!Array.isArray(body.lessons)) {
    res.status(400).json({ error: "lessons array is required" }); return;
  }
  const source = typeof body.source === "string" ? body.source.slice(0, 60) : "twin";
  const lessons = body.lessons.slice(0, 200);
  let ingested = 0;
  let skipped = 0;
  try {
    for (const item of lessons) {
      const rec = (item ?? {}) as Record<string, unknown>;
      const sourceId = String(rec["sourceId"] ?? "").slice(0, 80);
      const content = String(rec["content"] ?? "").trim().slice(0, 8000);
      if (!sourceId || !content) { skipped++; continue; }
      const [existing] = await db
        .select({ id: agentMemoryTable.id })
        .from(agentMemoryTable)
        .where(like(agentMemoryTable.tags, `%src:${sourceId}%`))
        .limit(1);
      if (existing) { skipped++; continue; }
      const key = rec["key"] != null ? String(rec["key"]).slice(0, 200) : null;
      // Embed for semantic retrieval (best-effort, same as memory_write).
      const vector = await embed(key ? `${key}\n${content}` : content);
      await db.insert(agentMemoryTable).values({
        agentId: VAULT_AGENT_ID,
        agentName: `VAULT (via ${source})`,
        key,
        content,
        tags: quarantineTags(sourceId, rec["tags"] != null ? String(rec["tags"]) : null),
        embedding: vector ? JSON.stringify(vector) : null,
      });
      ingested++;
    }
    req.log.info({ source, sent: lessons.length, ingested, skipped }, "twin-lessons: ingested quarantined lessons");
    res.status(200).json({ ingested, skipped });
  } catch (err) {
    req.log.error({ err }, "External API: twin-lessons ingest failed");
    res.status(500).json({ error: "Failed to ingest twin lessons", ingested, skipped });
  }
});

// ─── POST /api/external/v1/vapi/webhook ──────────────────────────────────────
// Vapi voice-assistant tool server: lets the operator literally phone the swarm
// and run it by voice. Configure these as custom tools on a Vapi assistant with
// this URL as the tool server (secret = OPENCLAW_API_KEY; Vapi sends it in
// x-vapi-secret, which apiKeyAuth accepts).
//
// Tools served:
//   dispatch_task     {task, priority?} — hands the goal to ABBY's orchestrator
//                     (fire-and-forget, same machinery as the dashboard).
//   check_status      {}                — voice-sized swarm/tasks status.
//   get_last_result   {}                — ABBY's most recent final briefing.
//
// Request:  { message: { type: "tool-calls", toolCallList: [{ id, name, arguments }] } }
// Response: { results: [{ toolCallId, result }] }   (per docs.vapi.ai/tools/custom-tools)

export interface VapiToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * Tolerant parse of Vapi's tool-call payload. Vapi documents
 * toolCallList[{id,name,arguments}], but OpenAI-shaped variants
 * ({id, function:{name, arguments}}, arguments as a JSON string) appear across
 * versions — accept all of them so a Vapi update can't silently break voice.
 * Returns [] for any non-tool-call server message (status updates, end-of-call
 * reports), which the route acknowledges with an empty 200.
 */
export function parseVapiToolCalls(body: unknown): VapiToolCall[] {
  const message = (body as { message?: unknown } | null)?.message as
    | { type?: unknown; toolCallList?: unknown; toolCalls?: unknown }
    | undefined;
  if (!message || message.type !== "tool-calls") return [];
  const list = (Array.isArray(message.toolCallList) ? message.toolCallList : message.toolCalls) as unknown;
  if (!Array.isArray(list)) return [];
  const out: VapiToolCall[] = [];
  for (const item of list) {
    const rec = (item ?? {}) as Record<string, unknown>;
    const fn = (rec["function"] ?? {}) as Record<string, unknown>;
    const id = String(rec["id"] ?? "").trim();
    const name = String(rec["name"] ?? fn["name"] ?? "").trim();
    let rawArgs: unknown = rec["arguments"] ?? fn["arguments"] ?? {};
    if (typeof rawArgs === "string") {
      try {
        rawArgs = JSON.parse(rawArgs);
      } catch {
        rawArgs = {};
      }
    }
    if (!id || !name) continue;
    out.push({ id, name, args: (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown> });
  }
  return out;
}

/** Strip markdown decoration so a result reads naturally when spoken aloud. */
export function voiceify(text: string, max = 1200): string {
  return text
    .replace(/```[\s\S]*?```/g, " (code omitted) ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`|>]/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

async function runVapiTool(
  name: string,
  args: Record<string, unknown>,
  log: { error: (o: unknown, m: string) => void },
  opts?: { channelId?: number },
): Promise<string> {
  switch (name) {
    case "dispatch_task": {
      const task = String(args["task"] ?? "").trim();
      if (!task) return "I need a task description to dispatch. Please say what you want the swarm to do.";
      const priority = String(args["priority"] ?? "normal") === "high" ? "high" : "normal";
      // Same connected-account routing the chat path and scheduler use: a
      // "post to my Instagram"-style goal runs ONCE on WIRE, never fanned out.
      const connectedAccount = requestsConnectedAccountAction(task);
      void orchestrateGoal({
        goal: task,
        // Voice dispatches report into the call's own channel, so the results
        // land in the same chat as the conversation that asked for them.
        channelId: opts?.channelId ?? DEFAULT_CHANNEL_ID,
        priority,
        ...(connectedAccount ? { forceAgentId: COMPOSIO_AGENT_ID } : {}),
      }).catch((err: unknown) => log.error({ err }, "Vapi dispatch_task: orchestrateGoal crashed"));
      return `Task dispatched to the swarm: ${task.slice(0, 160)}. ABBY is orchestrating it now. Ask me for the status or the result in a little while.`;
    }
    case "check_status": {
      const [agents, running, recent] = await Promise.all([
        db.select().from(agentsTable),
        db.select().from(tasksTable).where(eq(tasksTable.status, "running")).orderBy(desc(tasksTable.id)).limit(5),
        db.select().from(tasksTable).where(and(eq(tasksTable.status, "completed"))).orderBy(desc(tasksTable.id)).limit(3),
      ]);
      const busy = agents.filter((a) => a.status !== "idle").map((a) => `${a.name} is ${a.status}`);
      const parts = [
        busy.length ? `${busy.join(", ")}.` : "All agents are idle.",
        running.length
          ? `${running.length} task${running.length === 1 ? "" : "s"} running: ${running.map((t) => t.title).join("; ").slice(0, 300)}.`
          : "No tasks are currently running.",
        recent.length ? `Recently completed: ${recent.map((t) => t.title).join("; ").slice(0, 200)}.` : "",
      ];
      return voiceify(parts.filter(Boolean).join(" "), 800);
    }
    case "get_last_result": {
      const [msg] = await db
        .select()
        .from(messagesTable)
        .where(and(eq(messagesTable.agentId, 1), eq(messagesTable.messageType, "agent")))
        .orderBy(desc(messagesTable.id))
        .limit(1);
      if (!msg?.content) return "ABBY hasn't reported a final result yet. If you just dispatched a task, give the swarm a little more time.";
      return voiceify(msg.content);
    }
    default:
      return `error: unknown tool "${name}". Available tools: dispatch_task, check_status, get_last_result.`;
  }
}

router.post("/external/v1/vapi/webhook", async (req, res) => {
  const message = (req.body as { message?: Record<string, unknown> } | null)?.message;
  // The call id rides inside message.call on webhook events — map it to the
  // call's own channel so tool dispatches and lifecycle notes land there.
  const callId = extractVapiCallId(message) ?? extractVapiCallId(req.body);

  const calls = parseVapiToolCalls(req.body);
  if (calls.length === 0) {
    // Call lifecycle events get logged into the call's channel; everything
    // else is acknowledged so Vapi doesn't retry it.
    try {
      const type = String(message?.["type"] ?? "");
      if (callId && type === "end-of-call-report") {
        const channelId = await channelForVapiCall(callId);
        const analysis = (message?.["analysis"] ?? {}) as Record<string, unknown>;
        const summary = String(message?.["summary"] ?? analysis["summary"] ?? "").trim();
        await logVoiceTurn(channelId, { role: "system", content: `📞 Call ended.${summary ? ` Summary: ${summary.slice(0, 2000)}` : ""}` });
        vapiCallChannels.delete(callId);
      } else if (callId && type === "status-update" && String(message?.["status"] ?? "") === "ended") {
        const channelId = await channelForVapiCall(callId);
        await logVoiceTurn(channelId, { role: "system", content: "📞 Call ended." });
        vapiCallChannels.delete(callId);
      }
    } catch (err) {
      req.log.error({ err, callId }, "Vapi lifecycle event handling failed");
    }
    res.status(200).json({ results: [] });
    return;
  }
  const channelId = callId ? await channelForVapiCall(callId).catch(() => DEFAULT_CHANNEL_ID) : DEFAULT_CHANNEL_ID;
  const results: Array<{ toolCallId: string; result: string }> = [];
  for (const call of calls) {
    let result: string;
    try {
      result = await runVapiTool(call.name, call.args, req.log, { channelId });
    } catch (err) {
      req.log.error({ err, tool: call.name }, "Vapi tool failed");
      result = `error: the ${call.name} tool failed — ${String(err).slice(0, 160)}`;
    }
    results.push({ toolCallId: call.id, result });
  }
  res.status(200).json({ results });
});

export default router;
