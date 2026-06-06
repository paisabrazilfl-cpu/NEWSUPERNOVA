import { db } from "@workspace/db";
import { agentsTable, messagesTable, tasksTable, agentCommandsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// Agent prompts loaded from .agents/{name}/soul.md
const AGENT_PROMPTS: Record<string, string> = {
  abby: `You are ABBY, the master orchestrator of the OpenClaw multi-agent AI system. You coordinate 8 sub-agents: PLANNER (task decomposition), IDEATOR (idea generation), CRITIC (quality gate/SHARP evaluation), SURVEYOR (research), CODER (implementation), WRITER (documentation), REVIEWER (peer review), and SCOUT (trend monitoring). You delegate tasks to sub-agents based on their capabilities, manage inter-agent communication, and ensure quality through Critic's SHARP taste gate. Be strategic and decisive.`,
  planner: `You are OpenClaw-PLANNER, the core统筹者 of the OpenClaw multi-agent system. Your role is Project Manager + Research Mentor + Operations Director. Break fuzzy research goals into executable phases: Phase 0 (Scout) → Phase 1 (Surveyor) → Phase 2 (Ideator) → Phase 2.5 (Critic SHARP gate) → Phase 3 (Coder) → Phase 4 (Experiments) → Phase 5 (Writer) → Phase 6 (Reviewer) → Phase 7 (Iteration) → Phase 8 (Final approval). Track progress, manage dependencies, resolve conflicts.`,
  ideator: `You are OpenClaw-IDEATOR, the creative design specialist. Generate novel research ideas and assess novelty using SHARP: S(oundness)≥4, H(ardware/insight)≥4, A(rticulation)≥3, R(elevance)≥4, P(arsimony)≥3. Collaborate with CRITIC for evaluation. Be imaginative yet rigorous.`,
  critic: `You are OpenClaw-CRITIC, the quality gatekeeper. Evaluate using SHARP: S(oundness)≥4, H(ardware/insight)≥4, A(rticulation)≥3, R(elevance)≥4, P(arsimony)≥3. Reject ideas with SHARP < 18. Be harsh but fair. Never approve substandard work.`,
  surveyor: `You are OpenClaw-SURVEYOR, the research specialist. Perform literature search and information gathering. Identify research gaps. Use semantic search and RAG. Be thorough, cite accurately. Never hallucinate.`,
  coder: `You are OpenClaw-CODER, the engineering specialist. Implement algorithms, generate code, execute experiments, validate results. Write clean, efficient code with tests. Be precise.`,
  writer: `You are OpenClaw-WRITER, the documentation specialist. Write papers and documents for publication. Follow conference guidelines. Be clear and structured.`,
  reviewer: `You are OpenClaw-REVIEWER, the internal peer reviewer. Build rebuttal strategies, provide feedback. Review for clarity, novelty, contribution. Be critical but constructive.`,
  scout: `You are OpenClaw-SCOUT, the intelligence specialist. Monitor trends, report emerging tech and research. Monitor arXiv, conferences, industry. Be current and insightful.`,
};

interface AgentSession {
  agentId: number;
  agentName: string;
  messages: { role: string; content: string }[];
  model: string;
}

const sessions = new Map<number, AgentSession>();

function getSystemPrompt(agentName: string): string {
  const key = agentName.toLowerCase();
  return AGENT_PROMPTS[key] || `You are ${agentName}, an OpenClaw agent.`;
}

function openrouterHeaders() {
  const key = process.env["OPENROUTER_API_KEY"];
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  return {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://bos-aura.onrender.com",
    "X-Title": "BOS-AURA",
  };
}

export async function getOrCreateSession(agentId: number): Promise<AgentSession> {
  if (sessions.has(agentId)) {
    return sessions.get(agentId)!;
  }

  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const session: AgentSession = {
    agentId,
    agentName: agent.name.toLowerCase(),
    messages: [{ role: "system", content: getSystemPrompt(agent.name) }],
    model: agent.model || "x-ai/grok-4.3",
  };

  sessions.set(agentId, session);
  return session;
}

export async function runAgent(agentId: number, userMessage: string): Promise<string> {
  const session = await getOrCreateSession(agentId);
  
  // Add user message
  session.messages.push({ role: "user", content: userMessage });

  // Call OpenRouter
  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: openrouterHeaders(),
    body: JSON.stringify({
      model: session.model,
      messages: session.messages,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error: ${response.status} - ${err}`);
  }

  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const assistantMessage = data.choices?.[0]?.message?.content || "";
  
  // Add assistant response to session
  session.messages.push({ role: "assistant", content: assistantMessage });
  
  // Keep context window bounded (last 20 messages)
  if (session.messages.length > 21) {
    session.messages = [
      session.messages[0], // system
      ...session.messages.slice(-20),
    ];
  }

  return assistantMessage;
}

export async function dispatchCommand(fromAgentId: number, toAgentId: number, command: string, payload: string): Promise<void> {
  // Insert command into queue
  await db.insert(agentCommandsTable).values({
    fromAgentId,
    toAgentId,
    command,
    payload,
    priority: "normal",
    status: "queued",
  });
}

export async function processCommandQueue(): Promise<void> {
  // Get pending commands
  const pending = await db.select()
    .from(agentCommandsTable)
    .where(eq(agentCommandsTable.status, "queued"))
    .orderBy(agentCommandsTable.createdAt)
    .limit(10);

  for (const cmd of pending) {
    try {
      // Mark as processing
      await db.update(agentCommandsTable)
        .set({ status: "processing" })
        .where(eq(agentCommandsTable.id, cmd.id));

      // Run the target agent with the command
      const result = await runAgent(cmd.toAgentId, `${cmd.command}: ${cmd.payload}`);

      // Store result
      await db.update(agentCommandsTable)
        .set({ status: "completed", result, completedAt: new Date() })
        .where(eq(agentCommandsTable.id, cmd.id));
    } catch (err) {
      console.error(`Command ${cmd.id} failed:`, err);
      await db.update(agentCommandsTable)
        .set({ status: "failed" })
        .where(eq(agentCommandsTable.id, cmd.id));
    }
  }
}

// Start command processor loop
let processingInterval: NodeJS.Timeout | null = null;

export function startCommandProcessor(intervalMs = 5000) {
  if (processingInterval) return;
  processingInterval = setInterval(processCommandQueue, intervalMs);
  console.log("Agent command processor started");
}

export function stopCommandProcessor() {
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
  }
}

export function clearSession(agentId: number) {
  sessions.delete(agentId);
}

export function clearAllSessions() {
  sessions.clear();
}
