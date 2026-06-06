import { Router } from "express";
import { db } from "@workspace/db";
import { agentsTable, tasksTable, messagesTable, agentCommandsTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { runAgent, getOrCreateSession, dispatchCommand, startCommandProcessor, clearSession, clearAllSessions } from "../lib/agent-executor.js";
import { getOpenClawConnector } from "../lib/openclaw-connector.js";

const router = Router();

let swarmPaused = false;
const startTime = Date.now();

// Start command processor
startCommandProcessor(5000);

// Health check
router.get("/status", async (req, res) => {
  try {
    const [agentStats] = await db.select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where status != 'idle')::int`,
    }).from(agentsTable);

    const [taskStats] = await db.select({
      running: sql<number>`count(*) filter (where status = 'running')::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
    }).from(tasksTable);

    res.json({
      paused: swarmPaused,
      activeAgents: agentStats?.active ?? 0,
      totalAgents: agentStats?.total ?? 0,
      runningTasks: taskStats?.running ?? 0,
      completedTasks: taskStats?.completed ?? 0,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      processor: "active",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get swarm status");
    res.status(500).json({ error: "Failed to get swarm status" });
  }
});

// Pause/Resume swarm
router.post("/pause", async (req, res) => {
  swarmPaused = true;
  await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.status, "thinking"));
  await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.status, "executing"));
  res.json({ paused: true });
});

router.post("/resume", async (req, res) => {
  swarmPaused = false;
  res.json({ paused: false });
});

// Direct agent execution
router.post("/agent/:agentId/execute", async (req, res) => {
  const agentId = parseInt(req.params.agentId);
  const { message } = req.body as { message: string };

  if (isNaN(agentId)) {
    return res.status(400).json({ error: "Invalid agent ID" });
  }
  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }
  if (swarmPaused) {
    return res.status(503).json({ error: "Swarm is paused" });
  }

  try {
    // Update agent status
    await db.update(agentsTable).set({ status: "thinking" }).where(eq(agentsTable.id, agentId));

    // Run agent
    const response = await runAgent(agentId, message);

    // Save to message history
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    await db.insert(messagesTable).values({
      channelId: 1,
      agentId,
      agentName: agent?.name || "Unknown",
      agentColor: agent?.color || "#ffffff",
      content: response,
      messageType: "agent",
    });

    // Update status back to idle
    await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.id, agentId));

    res.json({ agentId, response });
  } catch (err) {
    req.log.error({ err, agentId }, "Agent execution failed");
    await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.id, agentId));
    res.status(500).json({ error: String(err) });
  }
});

// Dispatch command to another agent (inter-agent communication)
router.post("/dispatch", async (req, res) => {
  const { fromAgentId, toAgentId, command, payload } = req.body as {
    fromAgentId: number;
    toAgentId: number;
    command: string;
    payload: string;
  };

  if (!fromAgentId || !toAgentId || !command) {
    return res.status(400).json({ error: "fromAgentId, toAgentId, and command are required" });
  }

  try {
    await dispatchCommand(fromAgentId, toAgentId, command, payload || "");
    res.json({ status: "queued", fromAgentId, toAgentId, command });
  } catch (err) {
    req.log.error({ err }, "Failed to dispatch command");
    res.status(500).json({ error: String(err) });
  }
});

// Get pending commands for an agent
router.get("/agent/:agentId/commands", async (req, res) => {
  const agentId = parseInt(req.params.agentId);
  if (isNaN(agentId)) {
    return res.status(400).json({ error: "Invalid agent ID" });
  }

  try {
    const commands = await db.select()
      .from(agentCommandsTable)
      .where(eq(agentCommandsTable.toAgentId, agentId))
      .orderBy(desc(agentCommandsTable.createdAt))
      .limit(20);
    res.json(commands);
  } catch (err) {
    req.log.error({ err }, "Failed to get commands");
    res.status(500).json({ error: String(err) });
  }
});

// BOS-OMEGA integration: route to external OpenClaw
router.post("/omega/chat", async (req, res) => {
  const { message, model } = req.body as { message: string; model?: string };
  
  const connector = getOpenClawConnector();
  if (!connector || !connector.isConnected()) {
    return res.status(503).json({ error: "BOS-OMEGA not connected" });
  }

  try {
    const response = await connector.chat(message, model);
    res.json({ response, source: "omega" });
  } catch (err) {
    req.log.error({ err }, "BOS-OMEGA chat failed");
    res.status(500).json({ error: String(err) });
  }
});

router.get("/omega/agents", async (req, res) => {
  const connector = getOpenClawConnector();
  if (!connector || !connector.isConnected()) {
    return res.status(503).json({ error: "BOS-OMEGA not connected" });
  }

  try {
    const agents = await connector.listAgents();
    res.json({ agents });
  } catch (err) {
    req.log.error({ err }, "Failed to list BOS-OMEGA agents");
    res.status(500).json({ error: String(err) });
  }
});

// Clear agent session (reset context)
router.post("/agent/:agentId/reset", async (req, res) => {
  const agentId = parseInt(req.params.agentId);
  if (isNaN(agentId)) {
    return res.status(400).json({ error: "Invalid agent ID" });
  }

  clearSession(agentId);
  res.json({ agentId, status: "session cleared" });
});

// Clear all sessions
router.post("/reset-all", async (req, res) => {
  clearAllSessions();
  res.json({ status: "all sessions cleared" });
});

export default router;
