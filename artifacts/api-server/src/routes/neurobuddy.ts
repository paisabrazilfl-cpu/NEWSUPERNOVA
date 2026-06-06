import { Router } from "express";
import { db } from "@workspace/db";
import { messagesTable } from "@workspace/db";

const router = Router();
const NB_BASE = "https://neurobuddy-wg8b.onrender.com/api/external/v1";

const NB_PERSONAS = [
  { id: "neuro-buddy", name: "NEURO-BUDDY", description: "Core NeuroBuddy intelligence" },
  { id: "bos-omega",  name: "BOS-OMEGA",   description: "Boss-level omega directive system" },
  { id: "machiavel",  name: "MACHIAVEL",   description: "Strategic political intelligence" },
  { id: "jung",       name: "JUNG",        description: "Jungian archetype analyst" },
  { id: "kant",       name: "KANT",        description: "Kantian ethics & categorical imperatives" },
  { id: "lacan",      name: "LACAN",       description: "Lacanian psychoanalytic lens" },
];

function nbHeaders() {
  const key = process.env["NEUROBUDDY_API_KEY"];
  if (!key) throw new Error("NEUROBUDDY_API_KEY is not set");
  return {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

// GET /api/neurobuddy/models
router.get("/neurobuddy/models", (_req, res) => {
  res.json({ models: NB_PERSONAS });
});

// POST /api/neurobuddy/chat  — SSE streaming to a NeuroBuddy persona
// Body: { message: string, persona?: string, channelId?: number }
router.post("/neurobuddy/chat", async (req, res) => {
  const { message, persona = "bos-omega", channelId } = req.body ?? {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" }); return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  let fullResponse = "";

  try {
    const nbRes = await fetch(`${NB_BASE}/chat/completions`, {
      method: "POST",
      headers: nbHeaders(),
      body: JSON.stringify({
        model: persona,
        stream: true,
        messages: [{ role: "user", content: message }],
      }),
    });

    if (!nbRes.ok) {
      const errText = await nbRes.text();
      sendEvent({ error: `NeuroBuddy error ${nbRes.status}: ${errText.slice(0, 200)}` });
      sendEvent({ done: true });
      res.end(); return;
    }

    const decoder = new TextDecoder();
    const reader = nbRes.body?.getReader();
    if (!reader) {
      sendEvent({ error: "No response body from NeuroBuddy" });
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
          if (token) { fullResponse += token; sendEvent({ token }); }
        } catch { /* skip */ }
      }
    }

    if (fullResponse.trim() && channelId && typeof channelId === "number") {
      await db.insert(messagesTable).values({
        channelId,
        agentId: null,
        agentName: `NB:${persona.toUpperCase()}`,
        agentColor: "#ff2d78",
        content: fullResponse.trim(),
        messageType: "agent",
        metadata: JSON.stringify({ source: "neurobuddy", persona }),
      });
    }

    sendEvent({ done: true, persona });
  } catch (err) {
    req.log.error({ err }, "NeuroBuddy chat error");
    sendEvent({ error: String(err) });
    sendEvent({ done: true });
  }

  res.end();
});

// POST /api/neurobuddy/complete  — non-streaming
// Body: { message: string, persona?: string }
router.post("/neurobuddy/complete", async (req, res) => {
  const { message, persona = "bos-omega" } = req.body ?? {};
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" }); return;
  }
  try {
    const r = await fetch(`${NB_BASE}/chat/completions`, {
      method: "POST",
      headers: nbHeaders(),
      body: JSON.stringify({
        model: persona,
        messages: [{ role: "user", content: message }],
      }),
    });
    const data = await r.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    res.json({ content, persona });
  } catch (err) {
    req.log.error({ err }, "NeuroBuddy complete error");
    res.status(500).json({ error: String(err) });
  }
});

export default router;
