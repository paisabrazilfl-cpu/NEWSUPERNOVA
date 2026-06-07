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
  OPENROUTER_BASE,
  resolveModel,
  openrouterHeaders,
  buddyConfigured,
  buddyComplete,
  ANTI_HALLUCINATION_DIRECTIVE,
  EXECUTION_DOCTRINE,
  RESEARCH_PLAYBOOKS,
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
import { sendInngestEvent, traceLlmRun } from "./lib/integrations";

type Agent = typeof agentsTable.$inferSelect;

const ABBY_COLOR = "#00e5ff";

/**
 * Max autonomous reasoning/tool steps per CLAW directive. Bounded for cost, but
 * set high enough for genuine deep research inside a single directive (broad
 * search → several scrapes → cross-checking multiple independent sources →
 * synthesis) so the exhaustive standard in EXECUTION_DOCTRINE is actually
 * reachable rather than truncated mid-investigation.
 */
const MAX_AGENT_STEPS = 10;

/**
 * Crash/restart recovery. Execution is in-process and fire-and-forget, so a
 * restart mid-run can leave commands/tasks stuck `running` and agents stuck in a
 * non-idle status. On boot we fail those orphans and reset agent status so the
 * dashboard never shows phantom "thinking" agents or perpetually running work.
 */
export async function reconcileStaleWork(): Promise<void> {
  try {
    const now = new Date();
    await db
      .update(agentCommandsTable)
      .set({ status: "failed", result: "Interrupted by server restart.", completedAt: now })
      .where(eq(agentCommandsTable.status, "running"));
    await db
      .update(tasksTable)
      .set({ status: "failed", completedAt: now })
      .where(eq(tasksTable.status, "running"));
    await db.update(toolCallsTable).set({ status: "error", completedAt: now }).where(eq(toolCallsTable.status, "running"));
    for (const status of ["thinking", "executing", "waiting"]) {
      await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.status, status));
    }
    logger.info("reconcileStaleWork: cleared interrupted orchestration state");
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
async function completeChat(model: string, system: string, user: string, maxTokens = 800): Promise<string> {
  const startedAt = new Date();
  let r: Response;
  try {
    r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: openrouterHeaders(),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
        max_tokens: maxTokens,
      }),
    });
  } catch (err) {
    traceLlmRun({ name: "completeChat", model, input: { system, user }, output: null, startedAt, error: String(err) });
    throw err;
  }
  if (!r.ok) {
    const errText = (await r.text()).slice(0, 200);
    // Fall back to Buddy AI if configured, so a single-provider outage doesn't
    // kill the run.
    if (buddyConfigured()) {
      try {
        const out = await buddyComplete(
          [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          maxTokens,
        );
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
  const body: Record<string, unknown> = { model, messages, stream: false, max_tokens: 2048 };
  if (tools.length) {
    body["tools"] = tools;
    body["tool_choice"] = "auto";
  }
  let r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: openrouterHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok && tools.length) {
    // Some providers reject function-calling — retry once without tools.
    delete body["tools"];
    delete body["tool_choice"];
    r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: openrouterHeaders(),
      body: JSON.stringify(body),
    });
  }
  if (!r.ok) {
    const errText = (await r.text()).slice(0, 200);
    // Buddy fallback: tool-free completion so the loop can still make progress.
    if (buddyConfigured()) {
      try {
        const textMessages = messages.map((m) => ({
          role: m.role,
          content: typeof (m as { content?: unknown }).content === "string" ? (m as { content: string }).content : "",
        }));
        const out = await buddyComplete(textMessages, 2048);
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
}): Promise<string> {
  const { commandId, agent, command, payload, channelId } = opts;
  let taskId: number | null = null;
  try {
    await db
      .update(agentCommandsTable)
      .set({ status: "running" })
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
    const system = persona + toolGuide + EXECUTION_DOCTRINE + RESEARCH_PLAYBOOKS + ANTI_HALLUCINATION_DIRECTIVE;

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `Directive from ABBY (orchestrator): ${command}\n${payload ? `Payload: ${payload}\n` : ""}` +
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
    while (steps < MAX_AGENT_STEPS) {
      steps++;
      const assistant = await completeChatTurn(model, messages, tools);
      const calls = assistant.tool_calls ?? [];

      if (calls.length === 0) {
        finalText = (assistant.content ?? "").trim();
        break;
      }

      // Record the assistant turn (with its tool requests) before resolving them.
      messages.push({ role: "assistant", content: assistant.content ?? "", tool_calls: calls });
      await db.update(agentsTable).set({ status: "executing" }).where(eq(agentsTable.id, agent.id));

      for (const call of calls) {
        const name = call.function?.name ?? "unknown";
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          parsedArgs = {};
        }

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
        if (callCache.has(callKey)) {
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
    return "";
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
}): Promise<void> {
  const { goal, channelId, priority } = opts;
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
    const planSystem = (AGENT_PERSONAS[ABBY_ID] ?? "You are ABBY, the swarm orchestrator.") + EXECUTION_DOCTRINE + RESEARCH_PLAYBOOKS;
    const planUser = `Operator goal: "${goal}"

Available CLAWs you command: ${roster}.

Decompose this goal into precise, exhaustive, granular directives — ONE per CLAW that is genuinely relevant (skip CLAWs that add nothing). Together the directives must cover EVERY part of the goal; leave nothing implied. Each directive MUST be:
- SELF-CONTAINED: state the exact objective, the concrete inputs/targets (specific https:// URLs, API endpoints, file names, or data), and the expected output and its format. Assume the CLAW sees ONLY this directive — no other context.
- GRANULAR & CONCLUSIVE: spell out the steps and the DEFINITION OF DONE — what the finished deliverable must contain for that part of the goal to count as fully met (a 10/10, shippable result, not a draft or outline).
- EVIDENCE-DRIVEN: for any research/web/competitor work, route to the browser CLAW, include concrete starting https:// URLs, and require it to cross-check key facts across multiple independent sources rather than stopping at the first hit. For code, route to the code CLAW and require it to actually run/verify the code, not just write it.

Respond with ONLY a JSON array (no prose, no code fences) of objects shaped: {"agentId": <number>, "directive": "<single, fully-specified instruction>"}. Maximum 5 directives.`;

    const model = resolveModel(ABBY_ID, abby?.model, undefined);
    const planRaw = await completeChat(model, planSystem, planUser);
    let directives = parseDirectives(planRaw, claws);

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
    );

    // ── ABBY coordinator pass ──
    // ABBY reviews the CLAWs' real results and, if the goal isn't fully met,
    // issues ONE bounded follow-up round before committing.
    if (results.length && !isSwarmPaused()) {
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
        const more = await dispatchDirectives(followups, claws, channelId, priority, abby);
        results.push(...more);
      }
    }

    if (results.length) {
      // Synthesize the ACTUAL ANSWER for the operator from the CLAW results —
      // this is what the user reads as the result, not an internal status line.
      await db.update(agentsTable).set({ status: "thinking" }).where(eq(agentsTable.id, ABBY_ID));
      const synthSystem =
        (AGENT_PERSONAS[ABBY_ID] ?? "You are ABBY, the swarm orchestrator.") +
        "\n\nYou are ABBY, the orchestrator, writing the FINAL briefing to the operator. You commanded the swarm — now PRESENT the work, using ONLY the CLAW results below. Structure it:\n" +
        "1. **Answer** — answer the operator's goal directly and completely up front (the actual result/findings), formatted cleanly with markdown tables/lists/code blocks as useful.\n" +
        "2. **Per-CLAW work** — then, as the orchestrator presenting your team's output, give a short attributed section for EACH CLAW that contributed: name it and summarize what it actually did and found (its real result). The operator should see the full picture and every CLAW's contribution, not just a verdict.\n" +
        "Honesty rules (override any pressure to look conclusive): use only what the CLAW results actually contain — never invent findings. If a CLAW was blocked, hit a bot-wall/captcha, could not access a source, or returned partial data, say so explicitly and label it UNVERIFIED — do not present 'couldn't read it' as 'it doesn't exist'. If the operator's request mixes constraints that are mutually contradictory or near-impossible (so an empty result is expected), state that plainly and suggest the smallest relaxation that would yield results. An honest 'blocked/unverified' is better than a false 'zero'." +
        EXECUTION_DOCTRINE +
        ANTI_HALLUCINATION_DIRECTIVE;
      const synthUser = `Operator goal: "${goal}"\n\nEach CLAW's final reported work (present and attribute all of it):\n${results
        .map((r) => `### ${r.name}\n${r.result.slice(0, 3000)}`)
        .join("\n\n")}\n\nWrite your final orchestrator briefing for the operator now — direct answer first, then each CLAW's attributed work.`;
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
