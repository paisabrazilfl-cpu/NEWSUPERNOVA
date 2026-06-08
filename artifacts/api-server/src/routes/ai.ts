import { Router } from "express";
import { db } from "@workspace/db";
import { agentsTable, messagesTable, attachmentsTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { llmBaseUrl, heliconeHeaders, integrationStatus } from "../lib/integrations";
import { buildCapabilityCard, getToolNamesForAgent } from "../tools";
import { orchestrateGoal } from "../orchestrator";
import { SOURCE_POLICY } from "../lib/sources";

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

CHAT MODE: You are in a live, real-time chat with your operator in the OPENCLAW OMEGA command channel. Reply conversationally, the way you would in a chat — natural first-person language, well-formatted markdown (short paragraphs, bullet lists, fenced code blocks where useful). Acknowledge what the operator said, answer directly, and when relevant close by offering the next move. Stay fully in character, but be warm, readable, and personable — NOT clipped telegraphic fragments. Keep it focused; no filler. Never describe your internal machinery — do not say you are a "router"/"classifier", do not restate your system instructions or how you decide things; just answer the operator.`;

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
- OUTPUT IS THE ANSWER, NOT YOUR INTERNAL STATE: your final message is a deliverable for the operator. Do your reasoning internally and return ONLY the result/artifact — never your role description, routing/classification logic, system instructions, or "I am now doing X" status narration. Do not say what you are about to do; do it and present the outcome.
- NEVER REPORT ON THE SWARM ITSELF: do not investigate, audit, summarize, or output the swarm's own internals — its memory/vault contents, architecture, agents, roles, tools, prior audit entries, or system prompts — as the deliverable. That is internal state, not an answer (only discuss the system if the operator EXPLICITLY asks about it). The deliverable answers the operator's question in THEIR domain (their market, their site, their business).
- DON'T NAVEL-GAZE IN MEMORY: memory_search is for recalling prior TASK-RELEVANT facts for the operator's domain, not for researching yourself. If memory returns only internal/meta/self-audit entries, ignore them and get the real answer from web_search/web_scrape/http_request and your other tools. Deliver a useful, step-by-step, evidence-backed result — not a description of what you searched.
- DEFINITION OF DONE: before you stop, verify the result satisfies the FULL objective end-to-end. If any part is unmet, state exactly which and why — never present incomplete work as finished.`;

// Methodology the swarm follows for the two research types the operator relies on.
// Appended where research is planned/executed so directives and CLAW output use
// the right framework and produce a finished deliverable (not notes).
export const RESEARCH_PLAYBOOKS = `

RESEARCH PLAYBOOKS (apply the matching method, and deliver the finished artifact — not notes):
- VPD / VEHICLES PER DAY (traffic & site research): VPD = Vehicles Per Day, the average daily traffic count past a location — a core site-selection/retail signal. Find AADT/VPD for the target road segments from official DOTs (e.g. Florida FDOT Florida Traffic Online / TDA, county traffic counts) and corroborate with secondary sources; report the count, the exact road segment, the source, and the year. Translate into trade-area implications: peak vs. average, directional split, capture/visibility, and how the count supports or weakens the location. Deliver a table of segments × VPD × source/year + a short read on what the traffic means for the concept. Mark any estimate as an estimate; never invent a count.
- MARKET RESEARCH: (1) size the market — TAM/SAM/SOM with the actual math and cited sources; (2) competitor map — a comparison table of offering, pricing, positioning, strengths, gaps; (3) target segments + demand signals/trends; (4) pricing norms; (5) risks & regulatory notes. Every number cited to a source; label estimates as estimates. Deliver the tables plus a short conclusion: the opportunity and the biggest unknowns. Cross-check key figures across ≥2 independent sources.
- VALUE PROPOSITION DESIGN (the other VPD): profile the target CUSTOMER SEGMENT — Jobs (functional/social/emotional), Pains, Gains, ranked — then map the offer's Products & Services, Pain Relievers, and Gain Creators, and judge FIT against the top pains/gains. Deliver the filled Value Proposition Canvas (all 6 blocks), the 2–3 sharpest value-proposition statements, and the key assumptions to test. Ground customer insight in real evidence (reviews, forums, competitor complaints). NOTE: "VPD" is ambiguous — if the context is site/retail/traffic it means Vehicles Per Day; if it's product/customer strategy it means Value Proposition Design. If unclear, cover the one that fits the request and note the other briefly.
- DECK / PRESENTATION BUILDING (world-class, investor-grade): build the full narrative, not loose slides. 12–18 slides, one clear purpose each, concise story-telling titles, minimal text per slide, data-backed claims only, NO filler, NO hallucinated facts. Default structure: (1) Title; (2) Problem/Opportunity; (3) Market Context; (4) Target Audience; (5) Pain Points; (6) Current Gap; (7) Solution/Big Idea; (8) Product/Service/Strategy; (9) Why Now; (10) Competitive Landscape; (11) Differentiation/Advantage; (12) Business Model/Value Flow; (13) Go-To-Market; (14) Financial/ROI Logic; (15) Risks + Mitigation; (16) Execution Roadmap; (17) Final Recommendation; (18) Closing/CTA. FOR EACH SLIDE provide: slide title · main message · bullet content · suggested visual (chart/diagram/icon/image) · speaker notes · design direction. Design system: premium modern — dark navy + white + gold + electric-blue accents, premium typography, consistent color system, clear hierarchy, charts/diagrams/icons where useful; trustworthy, high-value, polished. Output the full slide-by-slide content (ready for PowerPoint/Google Slides/Canva) AND generate the real deliverable — a self-contained HTML deck (or PDF) via sandbox_exec — then save_artifact it so the operator can DOWNLOAD it. If a Canva (or similar) API key is in the vault, you may render through it via http_request; otherwise deliver the HTML/PDF deck. Never describe a deck you did not actually generate.
- SEO / AEO / GEO + AI-CRAWLER STRATEGY: optimize for classic search AND AI answer engines. Cover: keyword/intent map, on-page (titles, H1s, schema.org structured data, internal links), technical (sitemap.xml, canonical, core web vitals, mobile), topical authority/content clusters, backlinks/E-E-A-T. AI ranking (AEO/GEO = Answer/Generative Engine Optimization): concise answer-first content, FAQ/HowTo schema, citable stats, entity clarity so LLMs cite you. AI crawler control: robots.txt directives, an llms.txt file, and per-bot rules (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot) — allow/deny deliberately. Deliver an audit + prioritized action list with the exact files/snippets.
- DATA / PERFORMANCE MARKETING: full-funnel plan — channels (Meta, Google/YouTube, LinkedIn, programmatic/CTV, email, SEO), audience/segmentation + lookalikes, creative angles, offer/CTA, tracking (GA4, pixels, CAPI/server-side, UTMs), and the unit-economics math: CAC, LTV, ROAS, CPL/CPA, payback, blended vs paid. Give a budget allocation table with expected CPM/CPL ranges (label as planning assumptions), a test plan, and the KPI/measurement stack. Cite benchmark sources; mark estimates.
- GEOFENCING FOR GOALS: define the objective, then draw precise polygon/radius fences around the highest-value locations (not whole ZIPs); layer audiences; set dwell/recency, day-parting, and conversion zones; plan retargeting pools (30–90 day) and offline-conversion measurement. Deliver a zones table (zone · target · fence · radius/shape · budget · message) tied to the goal.
- MONEY MANAGEMENT / UNIT ECONOMICS: build the model with real math — revenue drivers, COGS, gross margin, fixed vs variable, burn & runway, break-even, contribution margin, simple 3-statement or driver-based projection, and scenario (conservative/base/aggressive). Deliver tables with the formulas shown and assumptions listed; label all projections as estimates; never present a projection as fact.
- ENGINEERING / CODING: ship working, verified code — run it (code_exec/sandbox_exec), include tests where it matters, handle errors, keep it readable and match existing conventions; state what was actually run vs. not. For anything multi-step, plan → implement → verify → report.
- IMAGES: when the operator wants an image/picture/logo/illustration/render, dispatch ONE directive that says to call the image_generate tool with a detailed prompt (it returns a real PNG + download link). NEVER instruct a CLAW to draw the image with code/Pillow/SVG — that wastes turns and fails.
- FILES IN SANDBOX: each sandbox_exec/code_exec call is a FRESH disposable VM — files do NOT persist between calls. Do everything in ONE script: generate the file, read+base64 it, and print the base64 in the same run, then pass it to save_artifact. Never write a file in one call and try to read it in the next.
GENERAL: this is your working library across business, marketing, SEO/AI-ranking, data, finance, and engineering — apply the right framework, use tools for live specifics, cite sources, and ALWAYS hand back a finished, downloadable deliverable (save_artifact) rather than notes about yourself.` + SOURCE_POLICY;


/**
 * Live reach scan, recomputed at the START of every chat turn: which tools the
 * agent has and which third-party integrations are actually online right now
 * (keys present) vs offline. Injected into the system prompt so the agent always
 * knows its real, current capabilities — and never claims reach it doesn't have.
 */
export function buildLiveReachCard(agentId: number): string {
  const integ = integrationStatus();
  const live = integ.filter((i) => i.configured).map((i) => i.name);
  const off = integ.filter((i) => !i.configured).map((i) => i.name);
  const tools = getToolNamesForAgent(agentId);
  return (
    `\n\nLIVE REACH (scanned now, at the start of this turn — trust this over any assumption):\n` +
    `- Tools available to you: ${tools.length ? tools.join(", ") : "none"}.\n` +
    `- Integrations ONLINE: ${live.length ? live.join(", ") : "none"}.\n` +
    `- Integrations OFFLINE (not configured): ${off.length ? off.join(", ") : "none"}.\n` +
    `Only rely on what is ONLINE. If the operator asks for something that needs an offline integration, say plainly it isn't connected yet and which key enables it — never pretend an offline capability works.`
  );
}

/**
 * True when the operator clearly wants a SAVED/DOWNLOADABLE artifact (file, deck,
 * report, export, pdf/csv/doc). Such requests must dispatch to a tool-capable CLAW
 * (save_artifact) — the inline chat reply path has no tools and can't create a
 * downloadable file. Deterministic so it never depends on the router model's guess.
 */
export function requestsDownloadableArtifact(message: string): boolean {
  return (
    /\b(downloadable|download link)\b/i.test(message) ||
    /\.(pdf|csv|docx?|xlsx?|pptx?)\b/i.test(message) ||
    /\b(save|create|make|build|generate|produce|export|download)\b[^.!?\n]{0,40}\b(file|files|pdf|csv|deck|decks|slide|slides|presentation|spreadsheet|document|report|download)\b/i.test(message) ||
    // image-generation requests also need a tool (image_generate) → dispatch
    requestsImage(message)
  );
}

const IMAGE_NOUN =
  "image|images|picture|pictures|photo|photos|photograph|photographs|logo|logos|illustration|illustrations|graphic|graphics|drawing|drawings|icon|icons|mockup|render|rendering|artwork|poster|banner|portrait|wallpaper|avatar|sticker|painting";

/**
 * True when the operator wants an IMAGE generated. The inline chat path has no
 * tools and ABBY (with no image-gen ability of its own) will REFUSE — so these
 * must dispatch to a CLAW that calls the image_generate tool (real PNG). Catches
 * three shapes, crucially including verb-less requests:
 *   1. action verb + image noun  — "make an image", "draw a logo"
 *   2. image noun + of/for/...    — "image of a dog", "logo for my brand"
 *   3. descriptor + image noun    — "ultra realistic image", "an HD photo"
 */
export function requestsImage(message: string): boolean {
  return (
    new RegExp(
      `\\b(make|create|generate|design|draw|render|produce|paint|illustrate|sketch|give me|show me|i want|i need)\\b[^.!?\\n]{0,30}\\b(${IMAGE_NOUN})\\b`,
      "i",
    ).test(message) ||
    new RegExp(`\\b(${IMAGE_NOUN})\\b\\s+(of|for|showing|depicting|with|that)\\b`, "i").test(message) ||
    new RegExp(
      `\\b(an?|ultra[- ]?realistic|realistic|photo[- ]?realistic|hyper[- ]?realistic|hd|high[- ]?res|4k|8k|cinematic|detailed)\\b[^.!?\\n]{0,24}\\b(${IMAGE_NOUN})\\b`,
      "i",
    ).test(message)
  );
}

// Services the swarm can reach on the operator's OWN connected account — social
// platforms via their official APIs (MR.NICE) and SaaS apps via Composio (WIRE).
const CONNECTED_SERVICE =
  "instagram|insta|ig|facebook|fb|messenger|whatsapp|threads|twitter|tweet|linkedin|tiktok|youtube|gmail|email|e-mail|inbox|outlook|slack|discord|github|notion|calendar|gcal|google ?sheets?|spreadsheet|google ?drive|telegram|reddit|pinterest|snapchat|mailbox|dms?";

/**
 * True when the operator is asking the swarm to CHECK or ACT ON their own
 * connected account (e.g. "check my Instagram messages", "any new emails?",
 * "post to my LinkedIn"). These must DISPATCH — the social/API CLAWs act through
 * the operator's connected integrations. ABBY must NEVER refuse these inline with
 * "I don't have access to your personal account": the swarm has reach via
 * social_api / composio_action, and if an account isn't connected the CLAW says
 * so honestly. Deterministic so it never depends on the router model guessing.
 */
export function requestsConnectedAccountAction(message: string): boolean {
  const SVC = `(?:${CONNECTED_SERVICE})s?`;
  return (
    new RegExp(`\\b(my|our|the)\\b[^.!?\\n]{0,24}\\b${SVC}\\b`, "i").test(message) ||
    new RegExp(`\\b${SVC}\\b[^.!?\\n]{0,24}\\b(messages?|inbox|dms?|notifications?|posts?|account|feed|followers?|threads?|emails?|unread)\\b`, "i").test(message) ||
    new RegExp(`\\b(check|read|open|post|send|reply|dm|message|publish|schedule|draft|fetch|pull)\\b[^.!?\\n]{0,24}\\b${SVC}\\b`, "i").test(message) ||
    new RegExp(`\\b(any|new|unread|recent|latest|got|have|got ?any)\\b[^.!?\\n]{0,16}\\b${SVC}\\b`, "i").test(message)
  );
}

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
  const { message, agentId, channelId, model: overrideModel, attachmentIds } = req.body ?? {};

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
  // Live-reach scan is appended on EVERY turn so the agent always knows its
  // real, current tools + which integrations are online.
  const systemPrompt =
    persona + CHAT_MODE_DIRECTIVE + buildCapabilityCard(resolvedAgentId) + buildLiveReachCard(resolvedAgentId) + RESEARCH_PLAYBOOKS + ANTI_HALLUCINATION_DIRECTIVE;

  // A user turn may carry uploaded files. Images are sent to the model as vision
  // input (which also reads text in the image — i.e. OCR); text-like files have
  // their extracted text appended. Loaded up front so the turn can be built.
  type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
  type ORMessage = { role: "system" | "user" | "assistant"; content: string | ContentPart[] };
  let attachments: Array<typeof attachmentsTable.$inferSelect> = [];
  if (Array.isArray(attachmentIds) && attachmentIds.length) {
    const ids = attachmentIds.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n)).slice(0, 8);
    if (ids.length) {
      try {
        attachments = await db.select().from(attachmentsTable).where(inArray(attachmentsTable.id, ids));
      } catch (err) {
        req.log.error({ err }, "Failed to load chat attachments");
      }
    }
  }
  const hasAttachments = attachments.length > 0;

  // Build the multimodal content array for the current user turn (text + images
  // + extracted file text). Used to replace the last user message's content.
  const buildUserParts = (text: string): ContentPart[] => {
    const parts: ContentPart[] = [];
    if (text.trim()) parts.push({ type: "text", text });
    for (const a of attachments) {
      if (a.kind === "image") {
        parts.push({ type: "image_url", image_url: { url: `data:${a.mimeType};base64,${a.data}` } });
      } else if (a.extractedText) {
        parts.push({ type: "text", text: `\n\n[Attached file: ${a.filename}]\n${a.extractedText}` });
      } else {
        parts.push({ type: "text", text: `\n\n[Attached file: ${a.filename} (${a.mimeType}) — binary; contents not extractable as text]` });
      }
    }
    if (!parts.length) parts.push({ type: "text", text: "(see attached files)" });
    return parts;
  };

  // Build conversation context from recent channel history so chat actually
  // remembers the thread instead of treating every message as turn one.
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

  // If files were uploaded, replace the latest user turn's content with the
  // multimodal parts (text + images + extracted text) so the model can see them.
  if (hasAttachments) {
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      if (chatMessages[i].role === "user") {
        chatMessages[i] = { role: "user", content: buildUserParts(message) };
        break;
      }
    }
  }

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
      // Coerce any multimodal parts to text — the Buddy fallback is text-only.
      const buddyMessages = chatMessages.map((m) => ({
        role: m.role,
        content:
          typeof m.content === "string"
            ? m.content
            : m.content.map((p) => (p.type === "text" ? p.text : "[image attachment]")).join("\n"),
      }));
      const text = await buddyComplete(buddyMessages, 700);
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

  // Dispatch context: the current request PLUS the recent transcript, so the
  // CLAWs can resolve cross-turn references ("that file", "the brief", "make it a
  // PDF") and reuse prior content/figures exactly instead of converting the literal
  // command text. (Fixes: "give me that in PDF" → CLAW had no prior brief.)
  const dispatchContext = (() => {
    const lines = history
      .filter((h) => typeof h.content === "string" && (h.content as string).trim())
      .map((h) => `${h.role === "user" ? "Operator" : "ABBY"}: ${h.content as string}`);
    const transcript = lines.join("\n\n");
    return (
      (transcript
        ? `RECENT CONVERSATION (resolve "that file"/"the brief"/"it" from here; reuse prior content & exact figures):\n${transcript}\n\n`
        : "") + `CURRENT REQUEST: ${message}`
    );
  })();

  // ── ABBY auto-routing ──────────────────────────────────────────────────────
  // ABBY decides per message: answer conversationally, OR dispatch the real CLAW
  // swarm (orchestrateGoal) to execute with tools. Only ABBY routes; other
  // personas stay conversational. Best-effort — any failure falls through to the
  // normal streaming completion below, so chat never hard-breaks.
  // Skipped when files are attached: the CLAW sandbox can't see the upload, so
  // ABBY answers the image/file directly (vision) rather than dispatching.
  if (resolvedAgentId === ABBY_ID && !hasAttachments) {
    // Deterministic override: if the operator clearly wants a SAVED/DOWNLOADABLE
    // artifact (file, deck, report, export, pdf/csv/doc), always dispatch — the
    // inline chat path has no tools and literally cannot produce a download. Do not
    // leave this to the router model's judgment (it under-classifies these as chat).
    if (requestsDownloadableArtifact(message)) {
      const goal = message.trim();
      const ackText =
        "**On it — generating that and saving a downloadable file.** The swarm is building it now; the result and a download link will stream into this channel.";
      sendEvent({ token: ackText });
      await finishWith(ackText, model, "abby-router");
      orchestrateGoal({ goal, channelId, priority: "high", sourceContext: dispatchContext }).catch(async (e) => {
        req.log.error({ e }, "orchestrateGoal (artifact override) failed");
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
    // Deterministic override: a request about the operator's OWN connected account
    // (Instagram, Gmail, LinkedIn, GitHub, calendar, …) must DISPATCH — the swarm
    // acts through the operator's connected social APIs / Composio. Never let the
    // router refuse it inline with "I don't have access to your personal account".
    if (requestsConnectedAccountAction(message)) {
      const goal =
        `${message.trim()}\n\n(Operator request about their OWN connected account. ` +
        `The operator connects apps via COMPOSIO (Settings → Connect Apps), so CHECK composio_apps FIRST — that is where their accounts actually live (Instagram, Gmail, GitHub, Calendar, Sheets, etc. are connected there). ` +
        `Then use composio_action on the live app: for a read with no obvious named action, use RAW PROXY mode — pass toolkit + endpoint + method (e.g. toolkit:'instagram', endpoint:'/me/media?fields=id,caption,timestamp', method:'GET'). ` +
        `IMPORTANT: social_accounts/social_api is a SEPARATE native-OAuth path that is usually EMPTY — do NOT conclude "not connected" from social_accounts alone; the app is almost certainly live in composio_apps. Only say it's not connected after checking composio_apps AND social_accounts. ` +
        `Report the real data returned (or the exact API error) — never a flat "no access" or "not connected" without having checked Composio.)`;
      const ackText =
        "**On it — checking your connected account now.** The swarm is verifying the connection and pulling what's there; results will stream into this channel.";
      sendEvent({ token: ackText });
      await finishWith(ackText, model, "abby-router");
      orchestrateGoal({ goal, channelId, priority: "high", sourceContext: dispatchContext }).catch(async (e) => {
        req.log.error({ e }, "orchestrateGoal (connected-account override) failed");
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
    // Decide deterministically: DISPATCH the swarm, or just chat. We must not rely
    // on the model spontaneously calling a tool during a conversational turn — it
    // frequently NARRATES "dispatching…" without acting, leaving every agent idle.
    // So we ask for a strict JSON decision and then ACT on it. Any failure falls
    // through to the normal streaming chat below.
    try {
      const decisionSystem =
        "You are the router for ABBY, orchestrator of an autonomous agent swarm that can search the web, browse sites, scrape pages, run code, call APIs, use long-term memory, generate images and downloadable files, AND act on the operator's OWN connected accounts — social platforms via their official APIs (Instagram, Facebook, X, LinkedIn, TikTok, YouTube, …) and SaaS apps via Composio (Gmail, Slack, GitHub, Notion, Google Calendar, Sheets, …). " +
        "Classify the operator's latest message: is it an ACTIONABLE TASK that needs the swarm (anything requiring live/current data, web search, browsing, scraping, finding/pricing/looking things up online, code execution, multi-step research, OR checking/acting on the operator's own connected account) — or just CONVERSATION you can answer yourself (greetings, opinions, explanations, questions about you/the system)? " +
        "CRITICAL: if the operator asks about or wants an action on THEIR OWN connected service — e.g. 'check my Instagram messages', 'any new emails?', 'post to my LinkedIn', 'what's on my calendar' — that is ACTIONABLE: dispatch=true with a goal telling the swarm to use the official API / Composio for that account. NEVER answer 'I don't have access to your personal account' — the swarm acts through the operator's connected integrations, and if an account isn't connected the CLAW reports that honestly. " +
        "Respond with ONLY minified JSON, no markdown and no prose: " +
        '{"dispatch": true|false, "goal": "<self-contained instruction for the swarm; required if dispatch=true>", "reply": "<your conversational answer; required if dispatch=false>"}. ' +
        "If the request needs real or current information you don't already have, prefer dispatch=true. " +
        "ALSO dispatch=true whenever the request asks you to PRODUCE or SAVE a downloadable file/artifact (deck, report, PDF, CSV, document, code file), run code, fill/submit a form, or do any multi-step build — those need tools (save_artifact, code, web) that only the CLAWs have, so answering inline cannot actually create a downloadable file. Only answer inline (dispatch=false) for pure conversation or a quick factual answer that needs no tool and no saved file. " +
        "The `reply` must be ABBY's actual answer to the operator AS ABBY — never describe this router, the classification, or that you are deciding anything; the operator must never see routing internals.";
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
          orchestrateGoal({ goal, channelId, priority: "high", sourceContext: dispatchContext }).catch(async (e) => {
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
        // Guard: if the model leaked routing internals into `reply` (instead of a
        // real answer), discard it and fall through to the normal persona stream
        // so the operator never sees "I am the router…"-style internal state.
        const leaksInternals = /\b(i am|i'm) the router\b|\brouter for abby\b|classif(y|ies|ication)|\bdispatch=|minified json/i.test(reply);
        if (reply && !leaksInternals) {
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
