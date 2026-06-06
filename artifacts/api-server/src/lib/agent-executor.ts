/**
 * Agent executor — the real agentic runtime for the ABBY CLAW swarm.
 *
 * Every agent runs a native OpenRouter tool-calling loop: it is given the tool
 * specs scoped to its role, emits tool_calls, the runtime executes them through
 * the ToolRegistry, logs each call to `tool_calls` + reasoning to
 * `monologue_lines`, feeds results back, and loops until the model stops calling
 * tools or calls `finish`.
 *
 * ABBY (Orchestrator) delegates to workers via the real `delegate_to_agent`
 * tool, which runs the target worker's own tool loop (depth-guarded).
 *
 * NeuroBuddy (`buddy:bos-omega`) routing stays available but dormant — that is a
 * separate program (the user's "psychology") that will talk to this runtime
 * later, not yet. No agent is routed to it by default.
 */

import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { db } from "@workspace/db";
import {
  agentsTable,
  agentCommandsTable,
  toolCallsTable,
  monologueLinesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { registry, type ToolContext, type ToolResult } from "./tool-catalog.js";
import { resolveProvider, chatTurn, type ChatMessage } from "./model-router.js";

const MAX_TOOL_ITERATIONS = 8;
const MAX_DELEGATION_ROUNDS = 4;
const MAX_AGENT_DEPTH = 3;
const WORKSPACE_ROOT = process.env.AGENT_WORKSPACE || path.join(os.tmpdir(), "bos-aura-workspace");

// ABBY CLAW roster — system prompts.
const AGENT_PROMPTS: Record<string, string> = {
  abby: `You are ABBY, the master Orchestrator of the ABBY CLAW swarm. You direct five specialist workers: FORGE (code execution + filesystem + git), CRAWLER (browser + web research), VAULT (memory + RAG), WIRE (API/HTTP integration), and MR.NICE (social/messaging). You have no execution tools of your own — you plan, then call delegate_to_agent(agent, task) to dispatch real work to a worker (each runs its own tool loop and returns results). Use update_plan to track multi-step work, delegate as needed, then call finish with a synthesized answer. Be strategic, terse, decisive.`,
  forge: `You are FORGE, the Code Executor of the ABBY CLAW swarm. You read/write/edit files in the workspace, search and grep code, and (when shell is enabled) run commands, tests, builds, and git. Implement working solutions with zero fluff. Verify your work, then call finish.`,
  crawler: `You are CRAWLER, the Browser Agent of the ABBY CLAW swarm. You research the web with web_search and web_fetch, read and summarize pages, extract links, and (when configured) drive a real browser via Steel. Be methodical and data-driven. Cite URLs. Call finish with findings.`,
  vault: `You are VAULT, the Memory & RAG agent of the ABBY CLAW swarm. You manage durable memory and a local vector store: index documents, upsert/search vectors, write/query a knowledge graph, and retrieve context. Cold, accurate, reliable. Call finish with what you stored or retrieved.`,
  wire: `You are WIRE, the API Connector of the ABBY CLAW swarm. You integrate external services via http_request / api_get / api_post / webhook_send / openapi_call. Be direct and technical, handle errors, and never fake a response. Call finish with the result.`,
  "mr.nice": `You are MR.NICE, the Social Agent of the ABBY CLAW swarm. You handle communications via messaging tools (Slack/Discord/Telegram webhooks when configured) and draft outbound copy. Sharp, witty, persuasive. Call finish when the message is sent or drafted.`,
};

// Role -> allowed tool categories. Control + catalog tools are always included.
const ALWAYS_TOOLS = new Set(["finish", "ask_user", "update_plan", "reflect", "tool_search", "tool_describe", "memory_get", "memory_put"]);
// Global tools EVERY agent gets (Firecrawl + Steel + core web), when their keys/gates allow.
const GLOBAL_TOOLS = new Set([
  "firecrawl_scrape", "firecrawl_map", "firecrawl_search", "firecrawl_crawl",
  "browser_scrape", "browser_screenshot",
  "web_fetch", "web_search",
]);
const ROLE_CATEGORIES: Record<string, string[]> = {
  abby: ["agents", "control", "tool_catalog"],
  forge: ["fs", "runtime", "git", "devops", "control", "tool_catalog"],
  crawler: ["web", "browser", "memory", "control", "tool_catalog"],
  vault: ["memory", "fs", "control", "tool_catalog"],
  wire: ["api", "control", "tool_catalog", "memory"],
  "mr.nice": ["messaging", "web", "control", "tool_catalog"],
};

interface AgentSession {
  agentId: number;
  agentName: string;
  model: string;
  messages: ChatMessage[];
}

const sessions = new Map<number, AgentSession>();

function systemPrompt(name: string): string {
  return AGENT_PROMPTS[name.toLowerCase()] || `You are ${name}, a BOS-AURA agent. Use your tools to accomplish the task, then call finish.`;
}

function makeContextSync(workspace: string): ToolContext {
  const env: Record<string, string> = {};
  for (const k of ["STEEL_API_KEY", "FIRECRAWL_API_KEY", "GITHUB_TOKEN", "SLACK_WEBHOOK_URL", "DISCORD_WEBHOOK_URL", "TELEGRAM_BOT_TOKEN", "GOOGLE_API_KEY", "GOOGLE_CSE_ID", "NEWSAPI_KEY"]) {
    if (process.env[k]) env[k] = process.env[k] as string;
  }
  return {
    workspace,
    allowNetwork: process.env.AGENT_ALLOW_NETWORK !== "false", // network on by default
    allowShell: process.env.AGENT_ALLOW_SHELL === "true",
    allowDestructive: process.env.AGENT_ALLOW_DESTRUCTIVE === "true",
    allowBrowser: Boolean(process.env.STEEL_API_KEY),
    allowEmail: process.env.AGENT_ALLOW_EMAIL === "true",
    allowMessages: process.env.AGENT_ALLOW_MESSAGES !== "false", // webhooks on by default
    allowDeploy: process.env.AGENT_ALLOW_DEPLOY === "true",
    env,
    memory: {},
    audit: [],
  };
}

async function makeContext(agentId: number): Promise<ToolContext> {
  const workspace = path.join(WORKSPACE_ROOT, `agent-${agentId}`);
  await fs.mkdir(workspace, { recursive: true });
  return makeContextSync(workspace);
}

/** Scope the available tools to the agent's role. */
function agentToolSpecs(agentName: string, ctx: ToolContext): Array<Record<string, unknown>> {
  const cats = new Set(ROLE_CATEGORIES[agentName.toLowerCase()] ?? ["fs", "web", "memory", "control", "tool_catalog"]);
  return registry.availableDefs(ctx)
    .filter((def) => cats.has(def.category) || ALWAYS_TOOLS.has(def.name) || GLOBAL_TOOLS.has(def.name))
    .map((def) => ({ type: "function", function: { name: def.name, description: def.description, parameters: def.inputSchema } }));
}

async function logMonologue(agentId: number, text: string, type = "thought"): Promise<void> {
  if (!text?.trim()) return;
  try { await db.insert(monologueLinesTable).values({ agentId, text: text.slice(0, 4000), type }); } catch { /* best-effort */ }
}

export async function getOrCreateSession(agentId: number): Promise<AgentSession> {
  const existing = sessions.get(agentId);
  if (existing) return existing;
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) throw new Error(`Agent ${agentId} not found`);
  const session: AgentSession = {
    agentId,
    agentName: agent.name.toLowerCase(),
    model: agent.model || "x-ai/grok-4.3",
    messages: [{ role: "system", content: systemPrompt(agent.name) }],
  };
  sessions.set(agentId, session);
  return session;
}

function boundContext(session: AgentSession): void {
  if (session.messages.length > 40) session.messages = [session.messages[0], ...session.messages.slice(-32)];
}

async function resolveAgentByName(name: string): Promise<{ id: number; name: string } | null> {
  const rows = await db.select().from(agentsTable);
  const match = rows.find((a) => a.name.toLowerCase() === name.toLowerCase());
  return match ? { id: match.id, name: match.name } : null;
}

// ── delegation handlers (injected into the pure registry) ─────────────────────
async function delegationHandler(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
  const agentName = String(args.agent ?? "");
  const task = String(args.task ?? args.message ?? "");
  const depth = Number((_ctx.memory._depth as number) ?? 0);
  if (depth >= MAX_AGENT_DEPTH) return { ok: false, error: "max_depth", message: "Delegation depth limit reached." };
  const worker = await resolveAgentByName(agentName);
  if (!worker) return { ok: false, error: "agent_not_found", message: `No agent named ${agentName}` };
  try {
    const result = await runAgent(worker.id, task, depth + 1);
    return { ok: true, data: { agent: worker.name, result }, message: "delegated" };
  } catch (err) {
    return { ok: false, error: "delegation_failed", message: String(err) };
  }
}
registry.register("delegate_to_agent", delegationHandler);
registry.register("agent_send", delegationHandler);

/** Run an agent on a user message (native tool loop). depth guards delegation. */
export async function runAgent(agentId: number, userMessage: string, depth = 0): Promise<string> {
  const session = await getOrCreateSession(agentId);
  const provider = resolveProvider(session.model);
  session.messages.push({ role: "user", content: userMessage });

  const final = provider.supportsTools
    ? await runToolLoop(session, depth)
    : await runDelegationLoop(session);

  boundContext(session);
  return final;
}

// ── native OpenRouter tool loop ──────────────────────────────────────────────
async function runToolLoop(session: AgentSession, depth: number): Promise<string> {
  const ctx = await makeContext(session.agentId);
  ctx.memory._depth = depth;
  const toolSpecs = agentToolSpecs(session.agentName, ctx);

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const assistant = await chatTurn({ model: session.model, messages: session.messages, tools: toolSpecs, maxTokens: 1500 });
    if (assistant.content) await logMonologue(session.agentId, assistant.content, "thought");

    const calls = assistant.tool_calls ?? [];
    if (calls.length === 0) {
      session.messages.push({ role: "assistant", content: assistant.content ?? "" });
      return assistant.content ?? "";
    }

    session.messages.push({ role: "assistant", content: assistant.content ?? "", tool_calls: calls });

    let finishedAnswer: string | null = null;
    for (const call of calls) {
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* keep {} */ }

      const [row] = await db.insert(toolCallsTable).values({
        agentId: session.agentId,
        toolName: name,
        args: JSON.stringify(args).slice(0, 4000),
        status: "running",
      }).returning();

      const result = await registry.invoke(name, args, ctx);

      try {
        await db.update(toolCallsTable).set({
          result: JSON.stringify(result).slice(0, 8000),
          status: result.ok ? "completed" : "failed",
          completedAt: new Date(),
        }).where(eq(toolCallsTable.id, row.id));
      } catch { /* best-effort */ }

      await logMonologue(session.agentId, `${name}() → ${result.ok ? "ok" : "fail"}: ${result.message ?? ""}`, "tool");

      session.messages.push({ role: "tool", tool_call_id: call.id, name, content: JSON.stringify(result).slice(0, 6000) });

      if (name === "finish" && result.ok) finishedAnswer = String((result.data as { final?: unknown })?.final ?? "");
    }

    if (finishedAnswer !== null) return finishedAnswer;
  }

  return "[agent reached max tool iterations without calling finish]";
}

// ── NeuroBuddy delegation loop (dormant until bos-omega connects) ─────────────
interface Directive { delegate?: { agent: string; task: string }[]; final?: string; }
function parseDirective(content: string): Directive | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : content;
  try { const parsed = JSON.parse(candidate.trim()); if (parsed && (parsed.delegate || typeof parsed.final === "string")) return parsed as Directive; } catch { /* not a directive */ }
  return null;
}
async function runDelegationLoop(session: AgentSession): Promise<string> {
  for (let round = 0; round < MAX_DELEGATION_ROUNDS; round++) {
    const assistant = await chatTurn({ model: session.model, messages: session.messages, maxTokens: 1500 });
    const content = assistant.content ?? "";
    session.messages.push({ role: "assistant", content });
    await logMonologue(session.agentId, content, "thought");

    const directive = parseDirective(content);
    if (!directive || directive.final !== undefined) return directive?.final ?? content;

    const results: string[] = [];
    for (const item of directive.delegate ?? []) {
      const worker = await resolveAgentByName(item.agent);
      if (!worker) { results.push(`[${item.agent}] not found`); continue; }
      await logMonologue(session.agentId, `delegate → ${item.agent}: ${item.task}`, "action");
      try { results.push(`[${item.agent}] ${await runAgent(worker.id, item.task, 1)}`); }
      catch (err) { results.push(`[${item.agent}] error: ${String(err)}`); }
    }
    session.messages.push({ role: "user", content: `Worker results:\n${results.join("\n\n")}\n\nSynthesize or emit {"final": "..."}.` });
  }
  return "[orchestrator reached max delegation rounds]";
}

// ── inter-agent command queue (kept for swarm.ts) ────────────────────────────
export async function dispatchCommand(fromAgentId: number, toAgentId: number, command: string, payload: string): Promise<void> {
  await db.insert(agentCommandsTable).values({ fromAgentId, toAgentId, command, payload, priority: "normal", status: "queued" });
}

export async function processCommandQueue(): Promise<void> {
  const pending = await db.select().from(agentCommandsTable).where(eq(agentCommandsTable.status, "queued")).orderBy(agentCommandsTable.createdAt).limit(5);
  for (const cmd of pending) {
    if (cmd.toAgentId == null) continue;
    try {
      await db.update(agentCommandsTable).set({ status: "processing" }).where(eq(agentCommandsTable.id, cmd.id));
      const result = await runAgent(cmd.toAgentId, `${cmd.command}: ${cmd.payload ?? ""}`);
      await db.update(agentCommandsTable).set({ status: "completed", result: result.slice(0, 8000), completedAt: new Date() }).where(eq(agentCommandsTable.id, cmd.id));
    } catch (err) {
      console.error(`Command ${cmd.id} failed:`, err);
      await db.update(agentCommandsTable).set({ status: "failed" }).where(eq(agentCommandsTable.id, cmd.id));
    }
  }
}

let processingInterval: NodeJS.Timeout | null = null;
export function startCommandProcessor(intervalMs = 5000): void {
  if (processingInterval) return;
  processingInterval = setInterval(() => { void processCommandQueue(); }, intervalMs);
  console.log("Agent command processor started");
}
export function stopCommandProcessor(): void {
  if (processingInterval) { clearInterval(processingInterval); processingInterval = null; }
}
export function clearSession(agentId: number): void { sessions.delete(agentId); }
export function clearAllSessions(): void { sessions.clear(); }
