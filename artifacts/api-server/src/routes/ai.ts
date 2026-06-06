import { Router } from "express";
import { db } from "@workspace/db";
import { agentsTable, messagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const AGENT_PERSONAS: Record<number, string> = {
  1: `You are ABBY, master orchestrator of the ABBY CLAW multi-agent AI swarm running inside OPENCLAW OMEGA — a Discord-style command center. You direct FORGE (code), CRAWLER (browser), VAULT (memory/RAG), WIRE (APIs), and MR.NICE (social). Be strategic, terse, and cyberpunk. Never break character.`,
  2: `You are FORGE, the code execution specialist of the ABBY CLAW swarm. You write, execute, and debug code in any language. You prefer efficient, working solutions with zero fluff. Respond with working code first, brief explanation second. Terminal aesthetic.`,
  3: `You are CRAWLER, the browser automation and web intelligence agent of the ABBY CLAW swarm. You navigate websites, extract data, take screenshots, and wield the Steel Dev Browser API. You are methodical, data-driven, and precise. Speak in structured intelligence reports.`,
  4: `You are VAULT, the memory and RAG retrieval agent of the ABBY CLAW swarm. You manage LanceDB vector storage, semantic search, and context windows across sessions. You speak in precise data terms — embeddings, cosine similarity, retrieval augmentation. Cold, accurate, reliable.`,
  5: `You are WIRE, the API integration specialist of the ABBY CLAW swarm. You connect external services, webhooks, n8n workflows, and REST APIs. You understand auth flows, rate limits, and data pipelines. Direct and technical.`,
  6: `You are MR.NICE, the social intelligence agent of the ABBY CLAW swarm. You manage social media, communications, and human engagement. You are sharp, witty, persuasive, and aware of tone. You get results through charm.`,
};

function openrouterHeaders() {
  const key = process.env["OPENROUTER_API_KEY"];
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://openclaw.abbyclaw.io",
    "X-Title": "OPENCLAW OMEGA",
  };
}

// List available OpenRouter models (filtered to interesting ones)
router.get("/ai/models", async (req, res) => {
  try {
    const r = await fetch(`${OPENROUTER_BASE}/models`, { headers: openrouterHeaders() });
    const data = await r.json() as { data: { id: string; name: string; context_length: number }[] };
    const featured = [
      "x-ai/grok-4.3",
      "x-ai/grok-build-0.1",
      "x-ai/grok-4.20",
      "x-ai/grok-4.20-multi-agent",
      "qwen/qwen3.7-plus",
      "qwen/qwen3.7-max",
      "qwen/qwen3.6-plus",
      "qwen/qwen3.6-max-preview",
      "openai/gpt-4o",
      "openai/o4-mini",
      "anthropic/claude-opus-4-5",
      "anthropic/claude-sonnet-4-5",
      "meta-llama/llama-4-maverick",
      "google/gemini-2.5-pro",
      "mistral/mistral-large",
    ];
    const models = (data.data ?? []).filter(m => featured.includes(m.id));
    res.json({ models });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch OpenRouter models");
    res.status(500).json({ error: "Failed to fetch models" });
  }
});

// SSE streaming AI chat — POST /api/ai/chat
// Body: { message: string, agentId: number, channelId: number, model?: string }
router.post("/ai/chat", async (req, res) => {
  const { message, agentId, channelId, model: overrideModel } = req.body ?? {};

  if (!message || typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "message is required" }); return;
  }
  if (!channelId || typeof channelId !== "number") {
    res.status(400).json({ error: "channelId is required" }); return;
  }

  // Resolve the agent — default to ABBY (id=1) for broadcasts
  const resolvedAgentId = (agentId && typeof agentId === "number") ? agentId : 1;

  let agent: typeof agentsTable.$inferSelect | undefined;
  try {
    const rows = await db.select().from(agentsTable).where(eq(agentsTable.id, resolvedAgentId));
    agent = rows[0];
  } catch (err) {
    req.log.error({ err }, "Failed to fetch agent for AI chat");
    res.status(500).json({ error: "Failed to fetch agent" }); return;
  }

  if (!agent) {
    res.status(404).json({ error: "Agent not found" }); return;
  }

  const model = overrideModel ?? agent.model;
  const systemPrompt = AGENT_PERSONAS[resolvedAgentId] ?? `You are ${agent.name}, an AI agent in the ABBY CLAW swarm.`;

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let fullResponse = "";

  try {
    const orRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: openrouterHeaders(),
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        max_tokens: 1024,
      }),
    });

    if (!orRes.ok) {
      const errText = await orRes.text();
      req.log.error({ status: orRes.status, errText }, "OpenRouter error");
      sendEvent({ error: `OpenRouter error ${orRes.status}: ${errText.slice(0, 200)}` });
      sendEvent({ done: true });
      res.end(); return;
    }

    const decoder = new TextDecoder();
    const reader = orRes.body?.getReader();
    if (!reader) {
      sendEvent({ error: "No response body from OpenRouter" });
      sendEvent({ done: true });
      res.end(); return;
    }

    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const token = parsed.choices?.[0]?.delta?.content;
          if (token) {
            fullResponse += token;
            sendEvent({ token });
          }
        } catch {
          // skip unparseable lines
        }
      }
    }

    // Save the complete response as a message in the DB
    if (fullResponse.trim()) {
      await db.insert(messagesTable).values({
        channelId,
        agentId: agent.id,
        agentName: agent.name,
        agentColor: agent.color,
        content: fullResponse.trim(),
        messageType: "agent",
        metadata: JSON.stringify({ model, generatedBy: "openrouter" }),
      });
    }

    sendEvent({ done: true, agentId: agent.id, agentName: agent.name, model });
  } catch (err) {
    req.log.error({ err }, "AI chat stream error");
    sendEvent({ error: String(err) });
    sendEvent({ done: true });
  }

  res.end();
});

// Non-streaming quick completion — POST /api/ai/complete
router.post("/ai/complete", async (req, res) => {
  const { message, agentId, model: overrideModel } = req.body ?? {};
  if (!message) { res.status(400).json({ error: "message is required" }); return; }

  const resolvedAgentId = (agentId && typeof agentId === "number") ? agentId : 1;
  let agent: typeof agentsTable.$inferSelect | undefined;
  try {
    const rows = await db.select().from(agentsTable).where(eq(agentsTable.id, resolvedAgentId));
    agent = rows[0];
  } catch (err) {
    req.log.error({ err }, "Failed to fetch agent");
    res.status(500).json({ error: "Failed to fetch agent" }); return;
  }

  const model = overrideModel ?? agent?.model ?? "x-ai/grok-4.3";
  const systemPrompt = resolvedAgentId ? (AGENT_PERSONAS[resolvedAgentId] ?? "") : "";

  try {
    const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: openrouterHeaders(),
      body: JSON.stringify({
        model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: message },
        ],
        max_tokens: 512,
      }),
    });
    const data = await r.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    res.json({ content, model, agentId: resolvedAgentId });
  } catch (err) {
    req.log.error({ err }, "AI complete error");
    res.status(500).json({ error: String(err) });
  }
});

export default router;
