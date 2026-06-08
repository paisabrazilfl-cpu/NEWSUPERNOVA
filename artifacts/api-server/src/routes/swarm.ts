import { Router } from "express";
import { db } from "@workspace/db";
import { agentsTable, tasksTable, messagesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

let swarmPaused = false;
const startTime = Date.now();

export function isSwarmPaused(): boolean {
  return swarmPaused;
}

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

    const [msgStats] = await db.select({
      total: sql<number>`count(*)::int`,
    }).from(messagesTable);

    res.json({
      paused: swarmPaused,
      activeAgents: agentStats?.active ?? 0,
      totalAgents: agentStats?.total ?? 0,
      runningTasks: taskStats?.running ?? 0,
      completedTasks: taskStats?.completed ?? 0,
      totalMessages: msgStats?.total ?? 0,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get swarm status");
    res.status(500).json({ error: "Failed to get swarm status" });
  }
});

router.post("/pause", async (req, res) => {
  try {
    swarmPaused = true;
    await db.update(agentsTable)
      .set({ status: "idle" })
      .where(eq(agentsTable.status, "thinking"));
    await db.update(agentsTable)
      .set({ status: "idle" })
      .where(eq(agentsTable.status, "executing"));

    const [agentStats] = await db.select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where status != 'idle')::int`,
    }).from(agentsTable);

    const [taskStats] = await db.select({
      running: sql<number>`count(*) filter (where status = 'running')::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
    }).from(tasksTable);

    const [msgStats] = await db.select({ total: sql<number>`count(*)::int` }).from(messagesTable);

    res.json({
      paused: swarmPaused,
      activeAgents: agentStats?.active ?? 0,
      totalAgents: agentStats?.total ?? 0,
      runningTasks: taskStats?.running ?? 0,
      completedTasks: taskStats?.completed ?? 0,
      totalMessages: msgStats?.total ?? 0,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to pause swarm");
    res.status(500).json({ error: "Failed to pause swarm" });
  }
});

router.post("/resume", async (req, res) => {
  try {
    swarmPaused = false;

    const [agentStats] = await db.select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where status != 'idle')::int`,
    }).from(agentsTable);

    const [taskStats] = await db.select({
      running: sql<number>`count(*) filter (where status = 'running')::int`,
      completed: sql<number>`count(*) filter (where status = 'completed')::int`,
    }).from(tasksTable);

    const [msgStats] = await db.select({ total: sql<number>`count(*)::int` }).from(messagesTable);

    res.json({
      paused: swarmPaused,
      activeAgents: agentStats?.active ?? 0,
      totalAgents: agentStats?.total ?? 0,
      runningTasks: taskStats?.running ?? 0,
      completedTasks: taskStats?.completed ?? 0,
      totalMessages: msgStats?.total ?? 0,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to resume swarm");
    res.status(500).json({ error: "Failed to resume swarm" });
  }
});

export default router;
