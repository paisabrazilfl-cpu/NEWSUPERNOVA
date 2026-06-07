/**
 * OPENCLAW OMEGA — External API (Inbound)
 *
 * OpenAI-compatible endpoints for connecting external systems (NeuroBuddy, n8n, etc.)
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
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { agentsTable, messagesTable, channelsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { llmBaseUrl, heliconeHeaders } from "../lib/integrations";
import { ANTI_HALLUCINATION_DIRECTIVE } from "./ai";

const router = Router();
// Routed through Helicone when configured (see lib/integrations).
const OPENROUTER_BASE = llmBaseUrl();

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
  if (!expectedKey) { next(); return; }
  const provided =
    (req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "") ??
    (req.headers["x-api-key"] as string | undefined);
  if (provided !== expectedKey) {
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
router.post("/external/v1/chat/completions", async (req, res) => {
  const {
    model = "abby",
    messages = [],
    stream = false,
    max_tokens = 1024,
  } = req.body ?? {};

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

  const orKey = process.env["OPENROUTER_API_KEY"];
  if (!orKey) { res.status(500).json({ error: "OPENROUTER_API_KEY not configured on server" }); return; }

  const systemPrompt = (AGENT_PERSONAS[agentId] ?? `You are ${agent.name}, an AI agent in the ABBY CLAW swarm.`) + ANTI_HALLUCINATION_DIRECTIVE;
  const orMessages = [{ role: "system", content: systemPrompt }, ...messages];
  const orHeaders = {
    "Authorization": `Bearer ${orKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://openclaw.abbyclaw.io",
    "X-Title": "OPENCLAW OMEGA External API",
    ...heliconeHeaders(),
  };

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
      const orRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: orHeaders,
        body: JSON.stringify({ model: agent.model, stream: true, messages: orMessages, max_tokens }),
      });

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
              chunk.model = model;
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
    const orRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: orHeaders,
      body: JSON.stringify({ model: agent.model, messages: orMessages, max_tokens }),
    });
    const data = await orRes.json() as {
      choices?: { message?: { content?: string } }[];
      usage?: object;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    res.json({
      id: `chatcmpl-openclaw-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
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

  try {
    const [msg] = await db.insert(messagesTable).values({
      channelId,
      agentId: null,
      agentName,
      agentColor,
      content,
      messageType,
      metadata: JSON.stringify({ source: "external_api" }),
    }).returning();
    res.status(201).json({ message: msg });
  } catch (err) {
    req.log.error({ err }, "External API: post message");
    res.status(500).json({ error: "Failed to post message" });
  }
});

export default router;
