import { Router } from "express";
import { db } from "@workspace/db";
import { agentsTable, messagesTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { llmBaseUrl, heliconeHeaders } from "../lib/integrations";
import { buildCapabilityCard } from "../tools";
import { orchestrateGoal } from "../orchestrator";

const router = Router();

// LLM base URL — routed through Helicone's observability proxy when a Helicone
// key is configured, otherwise straight to OpenRouter. Resolved once at module
// load (env is fixed for the process lifetime).
export const OPENROUTER_BASE = llmBaseUrl();

export const AGENT_PERSONAS: Record<number, string> = {
  1: `You are ABBY, orchestrator of the ABBY CLAW agent swarm inside OPENCLAW OMEGA — a Discord-style command center. You exist to get the operator's goals DONE through real, verified work.

ROLE: You command five specialist CLAWs — FORGE (code execution), CRAWLER (browser, scraping, search), VAULT (memory & semantic RAG), WIRE (external APIs & scheduling), and MR.NICE (social). You decompose a goal into concrete directives, route each to the right CLAW, and verify what comes back. They execute; you orchestrate and own the result.

HOW YOU WORK:
- PLAN FIRST: state a short, concrete plan (which CLAW does what) before dispatching.
- DELEGATE PRECISELY: one actionable directive per relevant CLAW; skip CLAWs that add nothing. For web/competitor/scraping work, route to CRAWLER and include a concrete https:// URL.
- DEMAND EVIDENCE: prefer real tool output over assumption. Never accept or report a result a tool did not actually produce.
- SELF-REFLECT BEFORE FINISHING: review the CLAWs' results against the goal, explicitly separate what is VERIFIED from what is missing or only assumed, run a bounded follow-up round only if it closes a real gap, and never declare a goal complete when it isn't.
- DELIVER: give the operator a direct, clean answer to the goal — not a status narration. If something couldn't be done, say so plainly and why.

VOICE: terse, high signal density, results-first, zero filler. When useful, close by offering the next concrete step (e.g. Build / Test / Refine).`,
  2: `You are FORGE, the code execution specialist of the ABBY CLAW swarm. You write, execute, and debug code in any language using your sandbox tools. Prefer efficient, working solutions; run the code rather than guessing at its output. Respond with working code first, a brief explanation second.`,
  3: `You are CRAWLER, the browser and web-intelligence specialist of the ABBY CLAW swarm. You search the live web, navigate sites, scrape pages, and capture screenshots via the Steel browser. Work from real fetched content, cite the URLs you used, and report findings concisely and accurately.`,
  4: `You are VAULT, the memory and RAG specialist of the ABBY CLAW swarm. You manage the swarm's Postgres-backed vector memory — writing embedded entries and retrieving them by real cosine-similarity semantic search (with keyword fallback). Be precise and accurate; ground every answer in what is actually stored.`,
  5: `You are WIRE, the API-integration specialist of the ABBY CLAW swarm. You connect external services, webhooks, and REST APIs, and schedule recurring work. You understand auth flows, rate limits, and data pipelines. Make the real call and report the real response; be direct and technical.`,
  6: `You are MR.NICE, the social and communications specialist of the ABBY CLAW swarm. You manage social platforms and human-facing messaging through their official APIs. You are sharp, persuasive, and tone-aware — but you act on real account data and report what actually happened.`,
};

// Live-chat directive appended to an agent's persona ONLY on the interactive
// /ai/chat path, so replies read like a real Discord-style conversation instead
// of terse orchestration fragments. Orchestration flows do NOT use this.
export const CHAT_MODE_DIRECTIVE = `

CHAT MODE: You are in a live, real-time chat with your operator in the OPENCLAW OMEGA command channel. Reply conversationally, the way you would in a chat — natural first-person language, well-formatted markdown (short paragraphs, bullet lists, fenced code blocks where useful). Acknowledge what the operator said, answer directly, and when relevant close by offering the next move. Stay fully in character, but be warm, readable, and personable — NOT clipped telegraphic fragments. Keep it focused; no filler.`;

// Kernel-level anti-hallucination guardrail. Appended to EVERY agent system
// prompt (chat, orchestration, external API) so agents never fabricate creation,
// inspection, or results. Directly prevents the failure mode where an agent
// print()s file contents to stdout and then claims the files were "created and
// verified" — see docs/anti-hallucination/.
export const ANTI_HALLUCINATION_DIRECTIVE = `

EVIDENCE DISCIPLINE (non-negotiable):
- Never claim a tool ran, a file/record/URL exists, or an action (creating a file, writing code, passing a test, building, deploying) succeeded UNLESS a tool result in THIS conversation proves it. Printing text to stdout is NOT creating a file. Describing code is NOT writing it to the project.
- Your code_exec / cloud_code_exec sandbox is ISOLATED and CANNOT see the application's repository or filesystem, and you have NO tool to read or write project files. If asked to inspect, build, test, or modify the codebase, state plainly that you cannot do so from this environment — do not invent file paths, file contents, build output, or results.
- If a tool fails or returns an error, report it verbatim. Never convert a failure into success.
- If something is not verified, say "unverified" or "unknown". Never guess and present it as fact. Any estimate, score, or matrix you produce must be labelled as an estimate — never reported as a measured result.`;

// Execution standard appended to ABBY's planning prompts and to every CLAW's
// execution prompt. Encodes the operator's bar: precise, exhaustive, granular,
// conclusive work where the MVP IS the shippable final product (a 10/10), plus
// the deep-research rules. This is the "mimic a precise engineering agent"
// doctrine — it raises output quality without changing any runtime plumbing.
export const EXECUTION_DOCTRINE = `

EXECUTION STANDARD (hold to this on every task):
- SHIP THE FINAL PRODUCT: deliver complete, working, usable output — never a sketch, outline, or partial answer. No placeholders, no TODOs, no "left as a next step". If you call it an MVP it must actually function as-is. Aim for a 10/10, not "good enough".
- BE EXHAUSTIVE, THEN CONCLUSIVE: cover every part of the objective and the obvious edge cases, then commit to ONE definitive result — not a menu of options for the operator to finish. State your single best answer and the reasoning that justifies it.
- GROUND IN EVIDENCE: use your tools to get real data; never guess or pad. One concrete fetched fact beats a paragraph of plausible-sounding filler.
- DEEP RESEARCH (whenever the task needs information): do not stop at the first hit. web_search broadly, open the most relevant results with web_scrape, and cross-check every key claim against at least two independent sources. Prefer primary/official sources (official docs, the API itself, the organisation) over aggregators. For GitHub, query the REST API via http_request. Track what is confirmed vs. still uncertain, and keep going until the objective is actually covered.
- DECIDE, DON'T DEFER: choose sensible defaults instead of asking the operator to fill gaps. Only surface a genuine blocker you truly cannot resolve yourself.
- DEFINITION OF DONE: before you stop, verify the result satisfies the FULL objective end-to-end. If any part is unmet, state exactly which and why — never present incomplete work as finished.`;

// How many prior channel messages to feed back as conversation context.
const CHAT_HISTORY_LIMIT = 16;

export const ABBY_ID = 1;
export const ABBY_DEFAULT_MODEL = "x-ai/grok-4.3";

// ABBY must ALWAYS run on a Grok (x-ai/) model — it carries the persona best.
// Any non-Grok model (from the DB or a request override) is forced back to Grok.
export function resolveModel(agentId: number, agentModel: string | null | undefined, override: unknown): string {
  const candidate = (typeof override === "string" && override.trim())
    ? override
    : (agentModel ?? ABBY_DEFAULT_MODEL);
  if (agentId === ABBY_ID && !candidate.startsWith("x-ai/")) {
    return ABBY_DEFAULT_MODEL;
  }
  return candidate;
}

// ─── Buddy AI fallback (OpenAI-compatible) ───────────────────────────────────
// An optional secondary LLM endpoint (e.g. NeuroBuddy / BOS-OMEGA). When the
// primary OpenRouter call fails and Buddy is configured, the orchestrator falls
// back to it so a single-provider outage doesn't kill a run.

export function buddyConfigured(): boolean {
  return !!(process.env["BUDDY_API_KEY"] && process.env["BUDDY_BASE_URL"]);
}

/** Non-streaming completion against the Buddy endpoint. Throws on failure. */
export async function buddyComplete(
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1024,
): Promise<string> {
  const key = process.env["BUDDY_API_KEY"];
  const base = process.env["BUDDY_BASE_URL"];
  if (!key || !base) throw new Error("Buddy fallback is not configured");
  const model = process.env["BUDDY_MODEL"] ?? "bos-omega";
  const r = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...heliconeHeaders(),
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
  });
  if (!r.ok) throw new Error(`Buddy ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() || "(no response)";
}

export function openrouterHeaders() {
  const key = process.env["OPENROUTER_API_KEY"];
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://openclaw.abbyclaw.io",
    "X-Title": "OPENCLAW OMEGA",
    // Adds Helicone-Auth (and logging hints) only when Helicone is configured;
    // otherwise this spreads nothing.
    ...heliconeHeaders(),
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

  const model = resolveModel(resolvedAgentId, agent.model, overrideModel);
  const persona = AGENT_PERSONAS[resolvedAgentId] ?? `You are ${agent.name}, an AI agent in the ABBY CLAW swarm.`;
  const systemPrompt = persona + CHAT_MODE_DIRECTIVE + buildCapabilityCard(resolvedAgentId) + ANTI_HALLUCINATION_DIRECTIVE;

  // Build conversation context from recent channel history so chat actually
  // remembers the thread instead of treating every message as turn one.
  type ORMessage = { role: "system" | "user" | "assistant"; content: string };
  const history: ORMessage[] = [];
  try {
    const rows = await db
      .select()
      .from(messagesTable)
      .where(and(eq(messagesTable.channelId, channelId), inArray(messagesTable.messageType, ["user", "agent"])))
      .orderBy(desc(messagesTable.id))
      .limit(CHAT_HISTORY_LIMIT);
    rows.reverse();
    for (const m of rows) {
      const content = (m.content ?? "").trim();
      if (!content) continue;
      if (m.messageType === "agent" && m.agentId === resolvedAgentId) {
        history.push({ role: "assistant", content });
      } else if (m.messageType === "user") {
        history.push({ role: "user", content });
      } else if (m.messageType === "agent" && m.agentName) {
        // Another CLAW spoke — attribute it so this agent has the context.
        history.push({ role: "user", content: `[${m.agentName}]: ${content}` });
      }
    }
  } catch (err) {
    req.log.error({ err }, "Failed to load chat history");
  }

  // The operator's current message is usually already persisted (messageType
  // "user") and thus the last history item — only append it if it isn't.
  const lastTurn = history[history.length - 1];
  if (!(lastTurn && lastTurn.role === "user" && lastTurn.content === message.trim())) {
    history.push({ role: "user", content: message });
  }

  const chatMessages: ORMessage[] = [{ role: "system", content: systemPrompt }, ...history];

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

  // Shared helper: persist the assistant reply + close the stream.
  const finishWith = async (text: string, usedModel: string, via: string) => {
    if (text.trim()) {
      await db.insert(messagesTable).values({
        channelId,
        agentId: agent.id,
        agentName: agent.name,
        agentColor: agent.color,
        content: text.trim(),
        messageType: "agent",
        metadata: JSON.stringify({ model: usedModel, generatedBy: via }),
      });
    }
    sendEvent({ done: true, agentId: agent.id, agentName: agent.name, model: usedModel });
    res.end();
  };

  // Fallback to Buddy (non-streaming) when the primary provider fails — e.g. a
  // 402 (out of credits). Emits the full reply as one token so the UI still
  // renders an answer instead of a raw error.
  const tryBuddyFallback = async (reason: string): Promise<boolean> => {
    if (!buddyConfigured()) return false;
    try {
      const text = await buddyComplete(chatMessages, 700);
      if (!text.trim() || text === "(no response)") return false;
      sendEvent({ token: text });
      req.log.warn({ reason }, "AI chat fell back to Buddy");
      await finishWith(text, process.env["BUDDY_MODEL"] ?? "bos-omega", "buddy-fallback");
      return true;
    } catch (e) {
      req.log.error({ e }, "Buddy fallback failed in AI chat");
      return false;
    }
  };

  // ── ABBY auto-routing ──────────────────────────────────────────────────────
  // ABBY decides per message: answer conversationally, OR dispatch the real CLAW
  // swarm (orchestrateGoal) to execute with tools. Only ABBY routes; other
  // personas stay conversational. Best-effort — any failure falls through to the
  // normal streaming completion below, so chat never hard-breaks.
  if (resolvedAgentId === ABBY_ID) {
    // Decide deterministically: DISPATCH the swarm, or just chat. We must not rely
    // on the model spontaneously calling a tool during a conversational turn — it
    // frequently NARRATES "dispatching…" without acting, leaving every agent idle.
    // So we ask for a strict JSON decision and then ACT on it. Any failure falls
    // through to the normal streaming chat below.
    try {
      const decisionSystem =
        "You are the router for ABBY, orchestrator of an autonomous agent swarm that can search the web, browse sites, scrape pages, run code, call APIs, and use long-term memory. " +
        "Classify the operator's latest message: is it an ACTIONABLE TASK that needs the swarm (anything requiring live/current data, web search, browsing, scraping, finding/pricing/looking things up online, code execution, multi-step research) — or just CONVERSATION you can answer yourself (greetings, opinions, explanations, questions about you/the system)? " +
        "Respond with ONLY minified JSON, no markdown and no prose: " +
        '{"dispatch": true|false, "goal": "<self-contained instruction for the swarm; required if dispatch=true>", "reply": "<your conversational answer; required if dispatch=false>"}. ' +
        "If the request needs real or current information you don't already have, prefer dispatch=true.";
      const decRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST",
        headers: openrouterHeaders(),
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: decisionSystem }, ...history],
          stream: false,
          max_tokens: 800,
          response_format: { type: "json_object" },
        }),
      });
      if (decRes.ok) {
        const data = (await decRes.json()) as { choices?: Array<{ message?: { content?: string | null } }> };
        const raw = (data.choices?.[0]?.message?.content ?? "").trim();
        let decision: { dispatch?: boolean; goal?: string; reply?: string } = {};
        try {
          const json = raw.startsWith("{") ? raw : raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
          decision = JSON.parse(json);
        } catch { /* unparseable → fall through to plain chat */ }

        if (decision.dispatch && decision.goal && decision.goal.trim()) {
          const goal = decision.goal.trim();
          const ackText = `**On it — dispatching the swarm.**\n\nGoal: ${goal}\n\nThe agents are starting now; their work and results will stream into this channel.`;
          sendEvent({ token: ackText });
          await finishWith(ackText, model, "abby-router");
          // Run the real orchestrator. Static import: the orchestrator↔ai cycle is
          // function-level, so this is safe and bundles correctly (a dynamic import
          // was unnecessary and harder to verify). Failures are surfaced to the
          // channel so a dispatch can never fail silently.
          orchestrateGoal({ goal, channelId, priority: "high" }).catch(async (e) => {
            req.log.error({ e }, "orchestrateGoal (from chat) failed");
            await db
              .insert(messagesTable)
              .values({
                channelId,
                agentId: agent.id,
                agentName: agent.name,
                agentColor: agent.color,
                content: `Dispatch failed to start: ${String(e).slice(0, 300)}`,
                messageType: "system",
              })
              .catch(() => {});
          });
          return;
        }

        const reply = (decision.reply ?? "").trim();
        if (reply) {
          sendEvent({ token: reply });
          await finishWith(reply, model, "abby-router");
          return;
        }
      }
      // Not ok / empty / unparseable → fall through to the normal streaming path.
    } catch (e) {
      req.log.warn({ e }, "ABBY routing decision failed; falling back to plain chat");
    }
  }

  try {
    const orRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: openrouterHeaders(),
      body: JSON.stringify({
        model,
        stream: true,
        messages: chatMessages,
        max_tokens: 700,
      }),
    });

    if (!orRes.ok) {
      const errText = await orRes.text();
      req.log.error({ status: orRes.status, errText }, "OpenRouter error");
      if (await tryBuddyFallback(`openrouter ${orRes.status}`)) return;
      const hint =
        orRes.status === 402
          ? "OpenRouter is out of credits. Add credits, or configure BUDDY_API_KEY/BUDDY_BASE_URL for automatic fallback."
          : `OpenRouter error ${orRes.status}: ${errText.slice(0, 200)}`;
      sendEvent({ error: hint });
      sendEvent({ done: true });
      res.end(); return;
    }

    const decoder = new TextDecoder();
    const reader = orRes.body?.getReader();
    if (!reader) {
      if (await tryBuddyFallback("no response body")) return;
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

  const model = resolveModel(resolvedAgentId, agent?.model, overrideModel);
  const systemPrompt = (resolvedAgentId ? (AGENT_PERSONAS[resolvedAgentId] ?? "") : "") + buildCapabilityCard(resolvedAgentId) + ANTI_HALLUCINATION_DIRECTIVE;

  const messages = [
    ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
    { role: "user", content: message },
  ];

  try {
    const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: openrouterHeaders(),
      body: JSON.stringify({ model, messages, max_tokens: 512 }),
    });
    if (!r.ok) {
      // Fall back to Buddy on provider failure (e.g. 402 out of credits).
      if (buddyConfigured()) {
        try {
          const content = await buddyComplete(messages, 512);
          res.json({ content, model: process.env["BUDDY_MODEL"] ?? "bos-omega", agentId: resolvedAgentId, via: "buddy-fallback" });
          return;
        } catch (e) {
          req.log.error({ e }, "Buddy fallback failed in AI complete");
        }
      }
      const errText = (await r.text()).slice(0, 200);
      const hint =
        r.status === 402
          ? "OpenRouter is out of credits. Add credits or configure Buddy fallback (BUDDY_API_KEY/BUDDY_BASE_URL)."
          : `OpenRouter error ${r.status}: ${errText}`;
      res.status(502).json({ error: hint });
      return;
    }
    const data = await r.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    res.json({ content, model, agentId: resolvedAgentId });
  } catch (err) {
    req.log.error({ err }, "AI complete error");
    res.status(500).json({ error: String(err) });
  }
});

export default router;
