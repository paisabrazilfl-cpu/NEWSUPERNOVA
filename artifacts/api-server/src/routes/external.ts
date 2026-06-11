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
 *   POST /api/external/v1/twin-lessons          — quarantined ingest of a twin swarm's verified lessons
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { agentsTable, messagesTable, channelsTable, agentMemoryTable } from "@workspace/db";
import { eq, desc, like } from "drizzle-orm";
import { llmFetch } from "../lib/integrations";
import { timingSafeStrEqual } from "../lib/auth";
import { embed } from "../lib/embeddings";
import { quarantineTags } from "../lib/twinSync";
import { ANTI_HALLUCINATION_DIRECTIVE, ABBY_DEFAULT_MODEL } from "./ai";

const router = Router();

// VAULT — the memory/RAG agent; inbound twin lessons are filed under it.
const VAULT_AGENT_ID = 4;

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

  // Provider routing (NVIDIA NIM vs OpenRouter) + fallback model remapping.
  // llmFetch (used below) also carries the NIM auth circuit-breaker.
  const agentModel = agent.model ?? ABBY_DEFAULT_MODEL;

  const systemPrompt = (AGENT_PERSONAS[agentId] ?? `You are ${agent.name}, an AI agent in the ABBY CLAW swarm.`) + ANTI_HALLUCINATION_DIRECTIVE;
  const orMessages = [{ role: "system", content: systemPrompt }, ...messages];

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
      const { r: orRes } = await llmFetch(agentModel, { stream: true, messages: orMessages, max_tokens });

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
    const { r: orRes } = await llmFetch(agentModel, { messages: orMessages, max_tokens });
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

// ─── POST /api/external/v1/twin-lessons ──────────────────────────────────────
// Learner side of the twin teaching sync (lib/twinSync.ts is the teacher side).
// The sibling swarm (AURA ⇄ T800 — same codebase, two deployments) pushes its
// nightly VERIFIED lessons here. They are stored QUARANTINED: tagged
// "from-twin,proposed" with the teacher's "self-learned" tag stripped, so a
// twin lesson is visible to this swarm's agents via memory_search but is never
// auto-trusted and can never be re-exported as if verified here (no echo loop).
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

export default router;
