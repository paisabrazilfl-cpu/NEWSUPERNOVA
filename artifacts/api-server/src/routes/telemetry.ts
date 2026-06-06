import { Router } from "express";
import { db } from "@workspace/db";
import { agentsTable, monologueLinesTable, toolCallsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

router.get("/agents/:agentId/telemetry", async (req, res) => {
  const agentId = parseInt(req.params.agentId);
  if (isNaN(agentId)) return res.status(400).json({ error: "Invalid agent ID" });
  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const monologue = await db.select().from(monologueLinesTable)
      .where(eq(monologueLinesTable.agentId, agentId))
      .orderBy(desc(monologueLinesTable.timestamp))
      .limit(20);

    const toolCalls = await db.select().from(toolCallsTable)
      .where(eq(toolCallsTable.agentId, agentId))
      .orderBy(desc(toolCallsTable.startedAt))
      .limit(10);

    return res.json({
      agentId,
      monologue: monologue.reverse().map(m => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
      })),
      toolCalls: toolCalls.map(t => ({
        ...t,
        startedAt: t.startedAt.toISOString(),
        completedAt: t.completedAt?.toISOString() ?? null,
      })),
      contextUsed: agent.contextUsed,
      contextMax: agent.contextMax,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get telemetry");
    return res.status(500).json({ error: "Failed to get telemetry" });
  }
});

router.get("/agents/:agentId/tasks", async (req, res) => {
  const agentId = parseInt(req.params.agentId);
  if (isNaN(agentId)) return res.status(400).json({ error: "Invalid agent ID" });
  try {
    const { tasksTable: tbl } = await import("@workspace/db");
    const tasks = await db.select().from(tbl).where(eq(tbl.agentId, agentId));
    return res.json(tasks.map(t => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      completedAt: t.completedAt?.toISOString() ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to get agent tasks");
    return res.status(500).json({ error: "Failed to get agent tasks" });
  }
});

export default router;
