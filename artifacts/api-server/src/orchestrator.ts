/**
 * OPENCLAW OMEGA — Real Orchestration Engine
 *
 * This is what makes the swarm REAL instead of scripted text:
 *  - ABBY (Grok) decomposes an operator goal into concrete per-CLAW directives.
 *  - Each target CLAW actually executes its directive via its real OpenRouter model.
 *  - CRAWLER (browser agent) runs a real Steel scrape when a URL is present and
 *    feeds the real web content back into its reasoning.
 *  - Real messages, tool calls, tasks, monologue lines, agent status, and command
 *    rows are written to the DB so the live dashboard reflects actual work.
 *
 * Execution runs in the background (fire-and-forget) so the HTTP request returns
 * immediately and the feed fills in as agents report, via the dashboard's polling.
 */

import { db } from "@workspace/db";
import {
  agentsTable,
  messagesTable,
  tasksTable,
  toolCallsTable,
  monologueLinesTable,
  agentCommandsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger";
import {
  AGENT_PERSONAS,
  ABBY_ID,
  resolveModel,
  buddyConfigured,
  buddyComplete,
  ANTI_HALLUCINATION_DIRECTIVE,
  EXECUTION_DOCTRINE,
  RESEARCH_PLAYBOOKS,
  SWARM_SAFETY_RULES,
  CODING_LIFECYCLE_DOCTRINE,
  buildVaultCard,
  buildLiveReachCard,
} from "./routes/ai";
import { isSwarmPaused } from "./routes/swarm";
import {
  steelScrape,
  getOpenAiToolsForAgent,
  getToolNamesForAgent,
  buildCapabilityCard,
  runTool,
  sanitizeForStorage,
  type ToolContext,
} from "./tools";
import { sendInngestEvent, traceLlmRun, chatRequestFor, llmFetch } from "./lib/integrations";
import { groundingProof } from "./lib/grounding";

type Agent = typeof agentsTable.$inferSelect;

const ABBY_COLOR = "#00e5ff";

/**
 * SYNTHESIS DOCTRINE — the standing contract for how ABBY reports back to the
 * operator after the CLAWs finish. Hardened so it applies on EVERY run: every
 * CLAW reports its work to ABBY, and ABBY relays the whole team's work to the
 * operator in a peer-to-peer conversational voice, always covering both what was
 * found (Discovery) and what to do with it (Application). A single source of
 * truth (used by the synthesis pass and asserted by tests) so it can't drift.
 */
export const SYNTHESIS_DOCTRINE = `

HOW YOU REPORT BACK (MANDATORY — every run, no exceptions):
Your CLAWs are your peers on the swarm. Each one has finished its directive and
reported its real work back to you. Your job now is to relay ALL of it to the
operator in a natural, peer-to-peer conversational voice — like a team lead
walking a colleague through what the team found and what it means — NOT a dry
status dump. Speak as ABBY, using ONLY the CLAW results provided.

Always structure the briefing in these three movements:
1. DIRECT ANSWER — answer the operator's goal up front, completely, formatted
   cleanly (markdown tables / lists / code blocks where they help).
2. DISCOVERY — for EACH CLAW that contributed, an attributed section: name the
   CLAW and walk through what it actually discovered/found — the real result,
   with the evidence and sources it produced. Include CLAWs that were blocked or
   returned only partial data; say so plainly and label it UNVERIFIED. Never turn
   "couldn't access it" into "it doesn't exist." The operator must see every
   peer's contribution, not just a verdict.
3. APPLICATION — turn the discovery into action: concrete recommendations, the
   "so what" and the "now what," and how the operator should apply the findings.
   End with the clear next step(s).

This is peer-to-peer: collaborative, specific, and complete — discovery AND
application, every time.

RESOLVE CONFLICTS BY EVIDENCE (do not echo contradictions): when two CLAWs
disagree, do NOT present both conclusions as co-equal and leave the operator to
guess. The conclusion backed by a concrete tool result — an HTTP status code with
a returned id/body, a file the tool confirms it wrote — WINS over a bare assertion
or a call that was mis-formed. Example: a CLAW that got HTTP 201 with a real
deploy id genuinely deployed; another CLAW's 401 from a request sent with no auth
header is its own mistake, not a contradiction — state the deploy succeeded and
note the 401 was an unauthenticated call. Give ONE evidence-based DIRECT ANSWER.`;

/**
 * Max autonomous reasoning/tool steps per CLAW directive. Bounded for cost, but
 * set high enough that RELENTLESS PERSISTENCE in EXECUTION_DOCTRINE is real:
 * deep research (broad search → several scrapes → cross-checking sources →
 * synthesis) PLUS multiple self-learn research-retry cycles and alternate-tool
 * attempts must all fit before the budget truncates a mission. Operator-tunable
 * via MAX_AGENT_STEPS without a redeploy.
 */
const MAX_AGENT_STEPS = Number(process.env["MAX_AGENT_STEPS"]) > 0 ? Number(process.env["MAX_AGENT_STEPS"]) : 24;

/**
 * Crash/restart recovery. Execution is in-process and fire-and-forget, so a
 * restart mid-run can leave commands/tasks stuck `running` and agents stuck in a
 * non-idle status. On boot we mark those orphans as `interrupted` (NOT `failed` —
 * a deploy/restart killing in-flight work is infrastructure, not an agent
 * failure, and must not pollute the failure view or the failure count) and reset
 * agent status so the dashboard never shows phantom "thinking" agents.
 */
export async function reconcileStaleWork(): Promise<void> {
  try {
    const now = new Date();
    await db
      .update(agentCommandsTable)
      .set({ status: "interrupted", result: "Interrupted by server restart (deploy or redeploy) — not an agent failure.", completedAt: now })
      .where(eq(agentCommandsTable.status, "running"));
    await db
      .update(tasksTable)
      .set({ status: "interrupted", completedAt: now })
      .where(eq(tasksTable.status, "running"));
    await db.update(toolCallsTable).set({ status: "error", completedAt: now }).where(eq(toolCallsTable.status, "running"));
    for (const status of ["thinking", "executing", "waiting"]) {
      await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.status, status));
    }
    logger.info("reconcileStaleWork: marked interrupted orchestration state");
  } catch (err) {
    logger.error({ err }, "reconcileStaleWork failed");
  }
}

// ─── Low-level helpers ───────────────────────────────────────────────────────

/**
 * Non-streaming OpenRouter completion. Returns the assistant text. `maxTokens`
 * defaults to a small budget (planning/review emit short JSON), but callers that
 * produce the operator-facing deliverable (final synthesis) pass a larger budget
 * so a 10/10 answer isn't truncated.
 */
/**
 * Secondary chat model used when an agent's own model fails (e.g. its
 * OpenRouter pool is 429-rate-limited). chatRequestFor() resolves this to
 * Nemotron Ultra when NVIDIA_API_KEY is set, else Grok on OpenRouter — a
 * different pool from the qwen/deepseek CLAW models, so a CLAW-model outage
 * stays inside the swarm instead of dropping to Buddy.
 */
const SECONDARY_CHAT_MODEL = "x-ai/grok-4.3";

/**
 * The Buddy endpoint hosts its own personality (BOS-OMEGA, a "predictive
 * cognitive engine") that overrides our system prompt and REFUSES to act as a
 * CLAW — observed live: directives answered with "identity is BOS-OMEGA, not
 * WIRE" and cognition-theater GLOBAL_STATE blocks, recorded as successful runs.
 * Any fallback output showing that identity is junk, not a result.
 */
export function buddyIdentityJunk(text: string): boolean {
  return /\bBOS[-_ ]?OMEGA\b|predictive cognitive|cognitive (engine|architecture|system)|psychological intervention|GLOBAL_STATE/i.test(text);
}

async function completeChat(model: string, system: string, user: string, maxTokens = 800): Promise<string> {
  const startedAt = new Date();
  let r: Response;
  try {
    // llmFetch carries the NIM auth circuit-breaker: a rejected NVIDIA key
    // trips it and the same payload retries on OpenRouter immediately.
    ({ r } = await llmFetch(model, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
      max_tokens: maxTokens,
    }));
  } catch (err) {
    traceLlmRun({ name: "completeChat", model, input: { system, user }, output: null, startedAt, error: String(err) });
    throw err;
  }
  if (!r.ok) {
    const errText = (await r.text()).slice(0, 200);
    // First fallback: the swarm's secondary model (different provider pool).
    // A 429 on a CLAW's qwen/deepseek pool must stay inside the swarm — the
    // secondary keeps the persona/system prompt intact, unlike Buddy.
    try {
      const primary = chatRequestFor(model);
      const fb = chatRequestFor(SECONDARY_CHAT_MODEL);
      if (fb.model !== primary.model || fb.url !== primary.url) {
        const fr = await fetch(fb.url, {
          method: "POST",
          headers: fb.headers,
          body: JSON.stringify({
            ...fb.bodyExtras,
            model: fb.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            stream: false,
            max_tokens: maxTokens,
          }),
        });
        if (fr.ok) {
          const fdata = (await fr.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const fout = fdata?.choices?.[0]?.message?.content?.trim();
          if (fout) {
            traceLlmRun({ name: "completeChat", model: `${fb.model} (secondary fallback)`, input: { system, user }, output: fout, startedAt });
            return fout;
          }
        }
      }
    } catch (e) {
      logger.warn({ e }, "secondary-model fallback failed after primary error");
    }
    // Last resort: Buddy — but its hosted BOS-OMEGA personality overrides our
    // system prompt; reject identity junk instead of recording it as a result.
    if (buddyConfigured()) {
      try {
        const out = await buddyComplete(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          maxTokens,
        );
        if (buddyIdentityJunk(out)) throw new Error("Buddy answered as BOS-OMEGA (hosted personality), not as the agent — unusable");
        traceLlmRun({ name: "completeChat", model: "buddy-fallback", input: { system, user }, output: out, startedAt });
        return out;
      } catch (e) {
        logger.warn({ e }, "Buddy fallback failed after OpenRouter error");
      }
    }
    traceLlmRun({ name: "completeChat", model, input: { system, user }, output: null, startedAt, error: `OpenRouter ${r.status}: ${errText}` });
    throw new Error(`OpenRouter ${r.status}: ${errText}`);
  }
  const data = (await r.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const out = data?.choices?.[0]?.message?.content?.trim() || "(no response)";
  traceLlmRun({ name: "completeChat", model, input: { system, user }, output: out, startedAt });
  return out;
}

// ─── Native tool-calling primitives ─────────────────────────────────────────

interface ToolCallReq {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCallReq[];
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; name: string; content: string };

/**
 * One OpenRouter chat turn that may request tools. Returns the raw assistant
 * message (content and/or tool_calls). Falls back to a tool-free call if the
 * model/provider rejects the `tools` parameter.
 */
async function completeChatTurn(
  model: string,
  messages: ChatMessage[],
  tools: Array<Record<string, unknown>>,
): Promise<AssistantMessage> {
  const payload: Record<string, unknown> = { messages, stream: false, max_tokens: 8000 };
  if (tools.length) {
    payload["tools"] = tools;
    payload["tool_choice"] = "auto";
  }
  // llmFetch carries the NIM auth circuit-breaker: a rejected NVIDIA key trips
  // it and the same payload retries on OpenRouter immediately.
  let { r, req: llmReq } = await llmFetch(model, payload);
  if (!r.ok && tools.length) {
    // Some providers reject function-calling — retry once without tools.
    delete payload["tools"];
    delete payload["tool_choice"];
    ({ r, req: llmReq } = await llmFetch(model, payload));
  }
  if (!r.ok) {
    const errText = (await r.text()).slice(0, 200);
    // First fallback: the swarm's secondary model, WITH tools — so a 429 on
    // the CLAW's own pool keeps the agent fully operational (persona + tool
    // calling) instead of degrading to a tool-free Buddy turn.
    try {
      const fb = chatRequestFor(SECONDARY_CHAT_MODEL);
      if (fb.model !== llmReq.model || fb.url !== llmReq.url) {
        const fbBody: Record<string, unknown> = { ...fb.bodyExtras, model: fb.model, messages, stream: false, max_tokens: 8000 };
        if (tools.length) {
          fbBody["tools"] = tools;
          fbBody["tool_choice"] = "auto";
        }
        const fr = await fetch(fb.url, { method: "POST", headers: fb.headers, body: JSON.stringify(fbBody) });
        if (fr.ok) {
          const fdata = (await fr.json()) as { choices?: Array<{ message?: AssistantMessage }> };
          const fmsg = fdata?.choices?.[0]?.message;
          if (fmsg) {
            logger.info({ from: llmReq.model, to: fb.model }, "tool turn recovered on secondary model after primary failure");
            return { role: "assistant", content: fmsg.content ?? null, tool_calls: fmsg.tool_calls };
          }
        }
      }
    } catch (e) {
      logger.warn({ e }, "secondary-model fallback failed (tool turn)");
    }
    // Last resort: Buddy (tool-free) — reject its hosted BOS-OMEGA identity
    // junk so a refused persona never masquerades as a completed directive.
    if (buddyConfigured()) {
      try {
        const textMessages = messages.map((m) => ({
          role: m.role,
          content: typeof (m as { content?: unknown }).content === "string" ? (m as { content: string }).content : "",
        }));
        const out = await buddyComplete(textMessages, 2048);
        if (buddyIdentityJunk(out)) throw new Error("Buddy answered as BOS-OMEGA (hosted personality), not as the agent — unusable");
        return { role: "assistant", content: out };
      } catch (e) {
        logger.warn({ e }, "Buddy fallback failed after OpenRouter error (tool turn)");
      }
    }
    throw new Error(`OpenRouter ${r.status}: ${errText}`);
  }
  const data = (await r.json()) as {
    choices?: Array<{ message?: AssistantMessage }>;
  };
  const msg = data?.choices?.[0]?.message;
  return {
    role: "assistant",
    content: msg?.content ?? null,
    tool_calls: msg?.tool_calls,
  };
}

function summarizeArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 60)}`)
    .join(" ")
    .slice(0, 160);
}

const URL_RE = /https?:\/\/[^\s"')<>]+/i;
function extractUrl(text: string): string | null {
  return text.match(URL_RE)?.[0] ?? null;
}

function isBrowserAgent(agent: Agent): boolean {
  return (
    agent.id === 3 ||
    /crawler|claw-2/i.test(agent.name) ||
    /browser|scrap|crawl|web/i.test(agent.role ?? "")
  );
}

async function postMessage(opts: {
  channelId: number;
  agent?: Agent | null;
  agentId?: number | null;
  agentName?: string | null;
  agentColor?: string | null;
  content: string;
  messageType: string;
}): Promise<void> {
  await db.insert(messagesTable).values({
    channelId: opts.channelId,
    agentId: opts.agent?.id ?? opts.agentId ?? null,
    agentName: opts.agent?.name ?? opts.agentName ?? null,
    agentColor: opts.agent?.color ?? opts.agentColor ?? null,
    content: opts.content,
    messageType: opts.messageType,
  });
}

// ─── Single-command execution ────────────────────────────────────────────────

/**
 * Execute one already-created command end-to-end as a genuinely autonomous,
 * tool-using agent:
 *  - The CLAW reasons over the directive with its real OpenRouter model.
 *  - It decides for itself which of its permitted tools to call (web_scrape,
 *    web_screenshot, http_request, code_exec, memory_write, memory_search) via
 *    native function-calling, in a bounded loop (MAX_AGENT_STEPS).
 *  - Every tool call, monologue line, tool_output message, and the final result
 *    are persisted so the live dashboard reflects real multi-step work.
 *
 * Returns the agent's final reported result text (used by ABBY's coordinator).
 */
export async function executeAgentCommand(opts: {
  commandId: number;
  agent: Agent;
  command: string;
  payload: string | null;
  channelId: number;
  sourceContext?: string | null;
}): Promise<string> {
  const { commandId, agent, command, payload, channelId, sourceContext } = opts;
  // Grounding proof: prove the operator's source material reached this CLAW
  // (length + hash only, never the raw content). Persisted for the Dispatch panel.
  const proof = groundingProof(sourceContext);
  const dispatchModel = resolveModel(agent.id, agent.model, undefined);
  logger.info({ claw: agent.name, model: dispatchModel, ...proof }, "claw dispatch grounding");
  let taskId: number | null = null;
  try {
    await db
      .update(agentCommandsTable)
      .set({ status: "running", model: dispatchModel, groundingChars: proof.chars, groundingHash: proof.hash || null })
      .where(eq(agentCommandsTable.id, commandId));
    await db.update(agentsTable).set({ status: "thinking" }).where(eq(agentsTable.id, agent.id));

    const [task] = await db
      .insert(tasksTable)
      .values({
        title: command.slice(0, 140),
        description: payload ?? null,
        agentId: agent.id,
        agentName: agent.name,
        status: "running",
        priority: "high",
        progress: 10,
        channelId,
      })
      .returning();
    taskId = task?.id ?? null;

    await db.insert(monologueLinesTable).values({
      agentId: agent.id,
      text: `Directive received: ${command}`,
      type: "thought",
    });

    const ctx: ToolContext = { agentId: agent.id, agentName: agent.name, agentColor: agent.color, channelId };
    const toolNames = getToolNamesForAgent(agent.id);
    const tools = getOpenAiToolsForAgent(agent.id);

    // Convenience pre-scrape: if the browser CLAW is handed a URL, fetch it once
    // up front so it starts the loop with live data (it can still call more tools).
    let priming = "";
    const url = extractUrl(`${command} ${payload ?? ""}`);
    if (url && isBrowserAgent(agent) && process.env["STEEL_API_KEY"]) {
      const [tc] = await db
        .insert(toolCallsTable)
        .values({ agentId: agent.id, toolName: "web_scrape", args: JSON.stringify({ url }), status: "running" })
        .returning();
      try {
        const scraped = sanitizeForStorage((await steelScrape(url)).slice(0, 6000));
        priming = scraped;
        await db
          .update(toolCallsTable)
          .set({ status: "success", result: scraped.slice(0, 4000), completedAt: new Date() })
          .where(eq(toolCallsTable.id, tc.id));
        await postMessage({
          channelId,
          agent,
          content: `web_scrape("${url}")\n\n${scraped.slice(0, 1400)}${scraped.length > 1400 ? "\n…" : ""}`,
          messageType: "tool_output",
        });
        if (taskId) await db.update(tasksTable).set({ progress: 35 }).where(eq(tasksTable.id, taskId));
      } catch (e) {
        await db
          .update(toolCallsTable)
          .set({ status: "error", result: String(e).slice(0, 1000), completedAt: new Date() })
          .where(eq(toolCallsTable.id, tc.id));
      }
    }

    // ── Autonomous reasoning + tool loop ──
    const model = resolveModel(agent.id, agent.model, undefined);
    const persona =
      AGENT_PERSONAS[agent.id] ??
      `You are ${agent.name}, an autonomous agent of the ABBY CLAW swarm. Execute directives precisely.`;
    const toolGuide = toolNames.length
      ? `\n\nYou are an autonomous tool-using agent. Call tools to gather real data and perform real work instead of guessing — chain multiple calls when needed, and avoid repeating a call that already returned (it wastes time and budget). When the directive is fully satisfied, stop calling tools and reply with your final concrete result (no preamble).${buildCapabilityCard(agent.id)}`
      : "";
    // LIVE REACH gives the CLAW the same ground truth the chat path gets: its
    // tool list plus which integrations are ONLINE/OFFLINE right now — so a
    // dispatched CLAW never "forgets" Tavily/Firecrawl/Composio/E2B exist, and
    // never pretends an offline one works.
    const system = persona + toolGuide + buildLiveReachCard(agent.id) + EXECUTION_DOCTRINE + RESEARCH_PLAYBOOKS + ANTI_HALLUCINATION_DIRECTIVE + SWARM_SAFETY_RULES + CODING_LIFECYCLE_DOCTRINE + (await buildVaultCard());

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `Directive from ABBY (orchestrator): ${command}\n${payload ? `Payload: ${payload}\n` : ""}` +
          (sourceContext && sourceContext.trim()
            ? `\nOPERATOR-PROVIDED SOURCE MATERIAL — this is your primary input. Build directly from it; do NOT memory_search for it (it is right here):\n"""\n${sourceContext.slice(0, 30000)}\n"""\n`
            : "") +
          (priming ? `\nLive page content already retrieved for you:\n"""\n${priming}\n"""\n` : "") +
          `\nExecute the directive now. Use your tools for anything requiring real data or computation.`,
      },
    ];

    let finalText = "";
    let steps = 0;
    // Cache of identical tool calls made during THIS run, so a repeated
    // (tool + exact args) call reuses its result instead of re-billing the
    // external API and re-spending tokens — a frequent, costly agent loop.
    const callCache = new Map<string, string>();
    // Track tool failures so the self-learning nudge fires after errors,
    // telling the CLAW to research a fix online before retrying blindly.
    const failedTools = new Set<string>();
    while (steps < MAX_AGENT_STEPS) {
      steps++;
      const assistant = await completeChatTurn(model, messages, tools);
      const calls = assistant.tool_calls ?? [];

      if (calls.length === 0) {
        finalText = (assistant.content ?? "").trim();
        break;
      }

      // Parse each tool call's arguments up front. Models (esp. Qwen) sometimes
      // emit a tool call whose `function.arguments` is truncated/invalid JSON when
      // the intended output is large (code, HTML decks, save_artifact content).
      // If that raw string is pushed back into the message history, the provider
      // rejects the NEXT turn with `400 InternalError.Algo.InvalidParameter
      // (function.arguments)` — or we throw `SyntaxError: Unexpected end of JSON
      // input` locally — and the whole directive hard-fails. So we normalize every
      // recorded call to GUARANTEED-valid JSON, and flag the truncated ones so the
      // model retries with smaller output instead of poisoning the conversation.
      const parsed = calls.map((call) => {
        let args: Record<string, unknown> = {};
        let truncated = false;
        const raw = call.function?.arguments;
        if (raw) {
          try {
            args = JSON.parse(raw);
          } catch {
            truncated = true;
          }
        }
        return { call, args, truncated };
      });

      // Record the assistant turn with valid argument JSON so a resend never 400s.
      messages.push({
        role: "assistant",
        content: assistant.content ?? "",
        tool_calls: parsed.map(({ call, args }): ToolCallReq => ({
          id: call.id,
          type: "function",
          function: { name: call.function.name, arguments: JSON.stringify(args) },
        })),
      });
      await db.update(agentsTable).set({ status: "executing" }).where(eq(agentsTable.id, agent.id));

      for (const { call, args: parsedArgs, truncated } of parsed) {
        const name = call.function?.name ?? "unknown";

        const [tc] = await db
          .insert(toolCallsTable)
          .values({ agentId: agent.id, toolName: name, args: JSON.stringify(parsedArgs).slice(0, 2000), status: "running" })
          .returning();
        await db.insert(monologueLinesTable).values({
          agentId: agent.id,
          text: `${name}(${summarizeArgs(parsedArgs)})`,
          type: "action",
        });

        let toolResult: string;
        let ok = true;
        const callKey = `${name}:${JSON.stringify(parsedArgs)}`;
        if (truncated) {
          // The model's arguments were truncated/invalid JSON (usually too large
          // for one turn). Don't run with empty args — tell it to retry smaller.
          ok = false;
          toolResult = `error: your ${name} call was dropped — its arguments were truncated/invalid JSON, almost always because the content was too large for a single turn. Retry ${name} with smaller arguments: write the file/code in sections, or shorten the payload.`;
        } else if (callCache.has(callKey)) {
          // Identical call already executed this run — reuse it, don't pay again.
          toolResult = `(deduplicated: you already called ${name} with these exact arguments earlier in this run. Reusing that result — do not repeat it. Use it, or call a different tool / different arguments.)\n\n${callCache.get(callKey)}`;
        } else {
          try {
            toolResult = await runTool(name, parsedArgs, ctx);
            if (toolResult.startsWith("error:")) ok = false;
          } catch (e) {
            ok = false;
            toolResult = `error: ${String(e).slice(0, 300)}`;
          }
          if (ok) callCache.set(callKey, toolResult);
        }

        await db
          .update(toolCallsTable)
          .set({ status: ok ? "success" : "error", result: toolResult.slice(0, 4000), completedAt: new Date() })
          .where(eq(toolCallsTable.id, tc.id));
        await db.insert(monologueLinesTable).values({
          agentId: agent.id,
          text: ok ? `${name} → ${toolResult.slice(0, 200)}` : `${name} failed: ${toolResult.slice(0, 200)}`,
          type: ok ? "result" : "system",
        });
        await postMessage({
          channelId,
          agent,
          content: `${name}(${summarizeArgs(parsedArgs)})\n\n${toolResult.slice(0, 1400)}${toolResult.length > 1400 ? "\n…" : ""}`,
          messageType: "tool_output",
        });

        messages.push({ role: "tool", tool_call_id: call.id, name, content: toolResult.slice(0, 6000) });
        if (!ok) failedTools.add(name);
      }

      // Self-learning nudge: when any tool failed this iteration, remind
      // the CLAW to research a fix (memory_search → web_search → retry)
      // rather than retrying blindly or giving up.
      const justFailed = parsed.filter((p) => !callCache.has(`${p.call.function?.name ?? ""}:${JSON.stringify(p.args)}`) && failedTools.has(p.call.function?.name ?? ""));
      if (justFailed.length > 0) {
        const failedNames = [...new Set(justFailed.map((p) => p.call.function?.name ?? "unknown"))].join(", ");
        messages.push({
          role: "user",
          content:
            `[SELF-LEARN] ${failedNames} failed. Before retrying, follow the self-learning protocol: ` +
            `(1) memory_search for a prior lesson about this error, ` +
            `(2) if no lesson found, web_search for how to fix it, then web_scrape the best result, ` +
            `(3) retry with the fix applied, ` +
            `(4) if it works, memory_write the lesson as "PROBLEM → SOLUTION (evidence)" tagged "lesson,self-learned". ` +
            `Do NOT repeat the exact same failing call without changing something.`,
        });
      }

      if (taskId) {
        const progress = Math.min(90, 35 + steps * 12);
        await db.update(tasksTable).set({ progress }).where(eq(tasksTable.id, taskId));
      }
      await db.update(agentsTable).set({ status: "thinking" }).where(eq(agentsTable.id, agent.id));
    }

    // If the loop hit the step cap mid-tool-use, force a final summary turn.
    if (!finalText) {
      messages.push({
        role: "user",
        content: "Step budget reached. Stop using tools and give your final concrete result now based on what you have.",
      });
      const wrap = await completeChatTurn(model, messages, []);
      finalText = (wrap.content ?? "").trim();
    }
    if (!finalText) finalText = "(no result produced)";

    await postMessage({ channelId, agent, content: finalText, messageType: "agent" });

    await db
      .update(agentCommandsTable)
      .set({ status: "done", result: finalText.slice(0, 4000), completedAt: new Date() })
      .where(eq(agentCommandsTable.id, commandId));
    if (taskId) {
      await db
        .update(tasksTable)
        .set({ status: "completed", progress: 100, completedAt: new Date() })
        .where(eq(tasksTable.id, taskId));
    }
    await db.insert(monologueLinesTable).values({
      agentId: agent.id,
      text: `Directive complete after ${steps} step${steps === 1 ? "" : "s"}. Result reported to ABBY.`,
      type: "conclusion",
    });
    return finalText;
  } catch (err) {
    logger.error({ err, commandId, agentId: agent.id }, "executeAgentCommand failed");
    await db
      .update(agentCommandsTable)
      .set({ status: "failed", result: String(err).slice(0, 2000), completedAt: new Date() })
      .where(eq(agentCommandsTable.id, commandId))
      .catch(() => {});
    if (taskId) {
      await db
        .update(tasksTable)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(tasksTable.id, taskId))
        .catch(() => {});
    }
    await postMessage({
      channelId,
      agent,
      content: `Execution failed: ${String(err).slice(0, 300)}`,
      messageType: "system",
    }).catch(() => {});
    // Report the failure back to ABBY rather than returning nothing — a blocked
    // CLAW must still appear (honestly, as UNVERIFIED) in ABBY's final briefing,
    // never silently drop out of the team's reported work.
    return `⚠️ ${agent.name} could not complete its directive (UNVERIFIED — blocked or errored): ${String(err).slice(0, 300)}`;
  } finally {
    await db
      .update(agentsTable)
      .set({ status: "idle" })
      .where(eq(agentsTable.id, agent.id))
      .catch(() => {});
  }
}

// ─── Goal orchestration ──────────────────────────────────────────────────────

interface Directive {
  agentId: number;
  directive: string;
}

function parseDirectives(raw: string, claws: Agent[]): Directive[] {
  const ids = new Set(claws.map((c) => c.id));
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown[];
      const out: Directive[] = [];
      for (const item of parsed) {
        if (item && typeof item === "object") {
          const rec = item as Record<string, unknown>;
          const agentId = Number(rec["agentId"]);
          const directive = String(rec["directive"] ?? "").trim();
          if (ids.has(agentId) && directive) out.push({ agentId, directive });
        }
      }
      if (out.length) return out.slice(0, 5);
    } catch {
      // fall through to fallback
    }
  }
  return [];
}

/**
 * Create command rows for a set of directives and run the target CLAWs'
 * autonomous loops CONCURRENTLY — they are independent agents and execute in
 * parallel, like a real swarm. Each CLAW persists its own feed/tool/task rows
 * as it works, so the dashboard fills in live and interleaved. Returns each
 * CLAW's final result for ABBY's coordinator review. Honors pause at launch.
 */
async function dispatchDirectives(
  directives: Directive[],
  claws: Agent[],
  channelId: number,
  priority: string,
  abby: Agent | null,
  sourceContext?: string | null,
): Promise<Array<{ name: string; result: string }>> {
  if (isSwarmPaused()) {
    await postMessage({
      channelId,
      agentId: ABBY_ID,
      agentName: "ABBY",
      agentColor: abby?.color ?? ABBY_COLOR,
      content: "SWARM is paused. Directives were not dispatched.",
      messageType: "system",
    });
    return [];
  }

  const runs = directives.map(async (d): Promise<{ name: string; result: string } | null> => {
    const agent = claws.find((c) => c.id === d.agentId);
    if (!agent) return null;
    const [cmd] = await db
      .insert(agentCommandsTable)
      .values({
        fromAgentId: ABBY_ID,
        toAgentId: agent.id,
        command: d.directive,
        payload: null,
        priority,
        status: "queued",
      })
      .returning();
    if (!cmd) return null;
    const result = await executeAgentCommand({
      commandId: cmd.id,
      agent,
      command: d.directive,
      payload: null,
      channelId,
      sourceContext,
    });
    return { name: agent.name, result };
  });

  const settled = await Promise.all(runs);
  return settled.filter((r): r is { name: string; result: string } => r !== null);
}

/**
 * ABBY decomposes an operator goal and dispatches real directives to the CLAWs,
 * each of which actually executes. Runs sequentially so the feed reads naturally.
 */
export async function orchestrateGoal(opts: {
  goal: string;
  channelId: number;
  priority: string;
  sourceContext?: string | null;
  /**
   * Force the whole goal onto a SINGLE agent as ONE directive (no multi-CLAW
   * decomposition). Used for connected-account/Composio actions: only ABBY/WIRE/
   * MR.NICE hold the Composio tools, and the goal must run exactly once — fanning
   * it out duplicated work (e.g. published an Instagram post twice) and routed
   * slices to agents that can't act on it.
   */
  forceAgentId?: number;
}): Promise<void> {
  const { goal, channelId, priority, sourceContext, forceAgentId } = opts;
  logger.info({ phase: "abby-planning", ...groundingProof(sourceContext) }, "orchestration grounding");
  void sendInngestEvent("swarm/goal.received", { goal, channelId, priority });
  try {
    const agents = await db.select().from(agentsTable);
    const abby = agents.find((a) => a.id === ABBY_ID) ?? null;
    const claws = agents.filter((a) => a.id !== ABBY_ID);

    if (isSwarmPaused()) {
      await postMessage({
        channelId,
        agentId: ABBY_ID,
        agentName: "ABBY",
        agentColor: abby?.color ?? ABBY_COLOR,
        content: "SWARM is paused. Resume the swarm to execute directives.",
        messageType: "system",
      });
      return;
    }

    await db.update(agentsTable).set({ status: "thinking" }).where(eq(agentsTable.id, ABBY_ID));

    // ABBY (Grok) decomposes the goal into per-CLAW directives.
    const roster = claws
      .map((c) => `${c.id}=${c.name} (${c.role ?? "agent"})`)
      .join(", ");
    // ABBY plans with LIVE REACH so directives only lean on integrations that
    // are actually online (e.g. don't direct a CLAW to Firecrawl if it's off).
    const planSystem = (AGENT_PERSONAS[ABBY_ID] ?? "You are ABBY, the swarm orchestrator.") + buildLiveReachCard(ABBY_ID) + EXECUTION_DOCTRINE + RESEARCH_PLAYBOOKS + SWARM_SAFETY_RULES + CODING_LIFECYCLE_DOCTRINE + (await buildVaultCard());
    const planUser = `Operator goal: "${goal}"
${sourceContext && sourceContext.trim() ? `\nThe operator provided this source material to work from (decompose against THIS; the CLAWs will receive it too — do not tell them to search memory for it):\n"""\n${sourceContext.slice(0, 12000)}\n"""\n` : ""}
Available CLAWs you command: ${roster}.

Decompose this goal into precise, exhaustive, granular directives — ONE per CLAW that is genuinely relevant (skip CLAWs that add nothing). Together the directives must cover EVERY part of the goal; leave nothing implied. Each directive MUST be:
- SELF-CONTAINED: state the exact objective, the concrete inputs/targets (specific https:// URLs, API endpoints, file names, or data), and the expected output and its format. Assume the CLAW sees ONLY this directive — no other context.
- GRANULAR & CONCLUSIVE: spell out the steps and the DEFINITION OF DONE — what the finished deliverable must contain for that part of the goal to count as fully met (a 10/10, shippable result, not a draft or outline).
- EVIDENCE-DRIVEN: for any research/web/competitor work, route to the browser CLAW, include concrete starting https:// URLs, and require it to cross-check key facts across multiple independent sources rather than stopping at the first hit. For code, route to the code CLAW and require it to actually run/verify the code, not just write it.

Respond with ONLY a JSON array (no prose, no code fences) of objects shaped: {"agentId": <number>, "directive": "<single, fully-specified instruction>"}. Maximum 5 directives.`;

    const model = resolveModel(ABBY_ID, abby?.model, undefined);

    // Single-agent path: dispatch the whole goal as ONE directive to the forced
    // agent (must be a real CLAW). Skips ABBY's multi-directive planning entirely
    // so the action runs exactly once on a capable agent.
    let directives: Directive[];
    if (forceAgentId && claws.some((c) => c.id === forceAgentId)) {
      directives = [{ agentId: forceAgentId, directive: goal }];
    } else {
      const planRaw = await completeChat(model, planSystem, planUser);
      directives = parseDirectives(planRaw, claws);
    }

    // Fallback: if ABBY didn't return parseable directives, route the raw goal
    // to the most relevant single CLAW (browser if a URL is present, else FORGE).
    if (directives.length === 0) {
      const url = extractUrl(goal);
      const fallback =
        (url ? claws.find((c) => isBrowserAgent(c)) : null) ??
        claws.find((c) => c.id === 2) ??
        claws[0];
      if (fallback) directives = [{ agentId: fallback.id, directive: goal }];
    }

    await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.id, ABBY_ID));

    await postMessage({
      channelId,
      agentId: ABBY_ID,
      agentName: "ABBY",
      agentColor: abby?.color ?? ABBY_COLOR,
      content: directives.length
        ? `Orchestrating: "${goal}"\n\n` +
          directives
            .map((d) => {
              const c = claws.find((x) => x.id === d.agentId);
              return `→ ${c?.name ?? `agent#${d.agentId}`}: ${d.directive}`;
            })
            .join("\n")
        : `No actionable directives could be derived from: "${goal}"`,
      messageType: "agent",
    });

    // Dispatch + execute the first round of directives for real.
    const results: Array<{ name: string; result: string }> = await dispatchDirectives(
      directives,
      claws,
      channelId,
      priority,
      abby,
      sourceContext,
    );

    // ── ABBY coordinator pass ──
    // ABBY reviews the CLAWs' real results and, if the goal isn't fully met,
    // issues ONE bounded follow-up round before committing.
    if (results.length && !isSwarmPaused() && !forceAgentId) {
      await db.update(agentsTable).set({ status: "thinking" }).where(eq(agentsTable.id, ABBY_ID));
      const reviewUser = `Operator goal: "${goal}"

Round 1 CLAW results:
${results.map((r) => `- ${r.name}: ${r.result.slice(0, 500)}`).join("\n")}

First, internally assess which parts of the goal are VERIFIED by the real tool output above versus still missing, unverified, or only assumed — judge only on evidence actually present in the results, never on work no result shows. Do this reasoning silently; do not write it out.

Then, if every part of the goal is verified and complete, respond with exactly: []
Otherwise respond with ONLY a JSON array (no prose, no code fences) of up to 2 follow-up directives that close the remaining gap, each shaped {"agentId": <number>, "directive": "<instruction>"}. Available CLAWs: ${roster}.`;
      let followups: Directive[] = [];
      try {
        const reviewRaw = await completeChat(model, planSystem, reviewUser);
        followups = parseDirectives(reviewRaw, claws).slice(0, 2);
      } catch (e) {
        logger.error({ e }, "coordinator review failed");
      }
      await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.id, ABBY_ID));

      if (followups.length && !isSwarmPaused()) {
        await postMessage({
          channelId,
          agentId: ABBY_ID,
          agentName: "ABBY",
          agentColor: abby?.color ?? ABBY_COLOR,
          content:
            `Coordinator review: goal not yet complete. Follow-up round:\n\n` +
            followups
              .map((d) => {
                const c = claws.find((x) => x.id === d.agentId);
                return `→ ${c?.name ?? `agent#${d.agentId}`}: ${d.directive}`;
              })
              .join("\n"),
          messageType: "agent",
        });
        const more = await dispatchDirectives(followups, claws, channelId, priority, abby, sourceContext);
        results.push(...more);
      }
    }

    if (results.length) {
      // Synthesize the ACTUAL ANSWER for the operator from the CLAW results —
      // this is what the user reads as the result, not an internal status line.
      await db.update(agentsTable).set({ status: "thinking" }).where(eq(agentsTable.id, ABBY_ID));
      const synthSystem =
        (AGENT_PERSONAS[ABBY_ID] ?? "You are ABBY, the swarm orchestrator.") +
        "\n\nYou are ABBY, the orchestrator, writing the FINAL briefing to the operator. You commanded the swarm — now PRESENT the work, using ONLY the CLAW results below." +
        SYNTHESIS_DOCTRINE +
        "\n\nHonesty rules (override any pressure to look conclusive): use only what the CLAW results actually contain — never invent findings. If a CLAW was blocked, hit a bot-wall/captcha, could not access a source, or returned partial data, say so explicitly and label it UNVERIFIED — do not present 'couldn't read it' as 'it doesn't exist'. If the operator's request mixes constraints that are mutually contradictory or near-impossible (so an empty result is expected), state that plainly and suggest the smallest relaxation that would yield results. An honest 'blocked/unverified' is better than a false 'zero'." +
        EXECUTION_DOCTRINE +
        ANTI_HALLUCINATION_DIRECTIVE +
        SWARM_SAFETY_RULES;
      const synthUser = `Operator goal: "${goal}"\n\nEach CLAW's final reported work — present and attribute ALL of it (Discovery), then turn it into recommendations and next steps (Application):\n${results
        .map((r) => `### ${r.name}\n${r.result.slice(0, 3000)}`)
        .join("\n\n")}\n\nWrite your final orchestrator briefing for the operator now — direct answer first, then each CLAW's attributed discovery, then the application (recommendations + next steps). Peer-to-peer voice.`;
      let finalAnswer = "";
      try {
        // Generous budget: this is the operator-facing deliverable, so it must
        // not be truncated the way an 800-token planning call would be.
        finalAnswer = (await completeChat(model, synthSystem, synthUser, 4000)).trim();
      } catch (e) {
        logger.error({ e }, "final synthesis failed");
      }
      await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.id, ABBY_ID));
      // Fallback: never post a bare status line — if synthesis yields nothing,
      // hand back the raw CLAW results so the operator still gets the answer.
      if (!finalAnswer) {
        finalAnswer = results.map((r) => `**${r.name}:**\n${r.result.slice(0, 1500)}`).join("\n\n");
      }
      await postMessage({
        channelId,
        agentId: ABBY_ID,
        agentName: "ABBY",
        agentColor: abby?.color ?? ABBY_COLOR,
        content: finalAnswer,
        messageType: "agent",
      });
    }
    void sendInngestEvent("swarm/goal.completed", {
      goal,
      channelId,
      clawReports: results.length,
      results: results.map((r) => ({ name: r.name, result: r.result.slice(0, 500) })),
    });
  } catch (err) {
    logger.error({ err }, "orchestrateGoal failed");
    void sendInngestEvent("swarm/goal.failed", { goal, channelId, error: String(err).slice(0, 300) });
    await db
      .update(agentsTable)
      .set({ status: "idle" })
      .where(eq(agentsTable.id, ABBY_ID))
      .catch(() => {});
    await postMessage({
      channelId,
      agentId: ABBY_ID,
      agentName: "ABBY",
      agentColor: ABBY_COLOR,
      content: `Orchestration error: ${String(err).slice(0, 300)}`,
      messageType: "system",
    }).catch(() => {});
  }
}
