import { Router } from "express";
import { db } from "@workspace/db";
import { agentCommandsTable, cronJobsTable, agentsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { executeAgentCommand, orchestrateGoal } from "../orchestrator";
import { isSwarmPaused } from "./swarm";
import { computeNextRun, runCronJob } from "../lib/scheduler";

const router = Router();

const ABBY_ID = 1;
const DEFAULT_CHANNEL_ID = 1;

function fmt(cmd: typeof agentCommandsTable.$inferSelect) {
  return {
    ...cmd,
    createdAt: cmd.createdAt.toISOString(),
    completedAt: cmd.completedAt?.toISOString() ?? null,
  };
}
function fmtCron(j: typeof cronJobsTable.$inferSelect) {
  return {
    ...j,
    createdAt: j.createdAt.toISOString(),
    lastRunAt: j.lastRunAt?.toISOString() ?? null,
    nextRunAt: j.nextRunAt?.toISOString() ?? null,
  };
}

// List all commands (or filter by agent)
router.get("/commands", async (req, res) => {
  try {
    const { agentId, limit = "50" } = req.query as Record<string, string>;
    // Bound the limit (avoid NaN → DB error and unbounded scans).
    const lim = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
    const aid = Number.parseInt(agentId ?? "", 10);
    const rows = Number.isFinite(aid)
      ? await db.select().from(agentCommandsTable)
          .where(eq(agentCommandsTable.toAgentId, aid))
          .orderBy(desc(agentCommandsTable.createdAt)).limit(lim)
      : await db.select().from(agentCommandsTable)
          .orderBy(desc(agentCommandsTable.createdAt)).limit(lim);
    res.json(rows.map(fmt));
  } catch (err) {
    req.log.error({ err }, "Failed to list commands");
    res.status(500).json({ error: "Failed to list commands" });
  }
});

// ABBY issues a command. Targeted → that CLAW actually executes it. Broadcast
// (no toAgentId) → ABBY decomposes the goal and dispatches real directives.
// Execution runs in the background; the dashboard fills in as agents report.
router.post("/commands", async (req, res) => {
  const { toAgentId, command, payload, priority = "normal", channelId } = req.body as {
    toAgentId?: number;
    command: string;
    payload?: string;
    priority?: string;
    channelId?: number;
  };

  if (!command?.trim()) {
    res.status(400).json({ error: "command is required" });
    return;
  }

  const targetChannelId = Number(channelId) > 0 ? Number(channelId) : DEFAULT_CHANNEL_ID;

  try {
    // ── Targeted: one CLAW executes the literal command for real ──
    if (toAgentId) {
      const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, toAgentId));
      if (!agent) {
        res.status(404).json({ error: "Target agent not found" });
        return;
      }

      const [cmd] = await db.insert(agentCommandsTable).values({
        fromAgentId: ABBY_ID,
        toAgentId: agent.id,
        command,
        payload: payload ?? null,
        priority,
        status: "queued",
      }).returning();

      if (!isSwarmPaused()) {
        void executeAgentCommand({
          commandId: cmd.id,
          agent,
          command,
          payload: payload ?? null,
          channelId: targetChannelId,
        }).catch(err => req.log.error({ err }, "executeAgentCommand crashed"));
      }

      res.status(201).json([fmt(cmd)]);
      return;
    }

    // ── Broadcast: treat the command as a goal for ABBY to orchestrate ──
    void orchestrateGoal({
      goal: command,
      channelId: targetChannelId,
      priority,
      sourceContext: payload ?? null,
    }).catch(err => req.log.error({ err }, "orchestrateGoal crashed"));

    res.status(202).json({ orchestrating: true, goal: command });
  } catch (err) {
    req.log.error({ err }, "Failed to create command");
    res.status(500).json({ error: "Failed to create command" });
  }
});

// Update command status
router.patch("/commands/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const { status, result } = req.body as { status?: string; result?: string };
  try {
    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (result !== undefined) updates.result = result;
    if (status === "done" || status === "failed") updates.completedAt = new Date();
    const [cmd] = await db.update(agentCommandsTable).set(updates)
      .where(eq(agentCommandsTable.id, id)).returning();
    if (!cmd) {
      res.status(404).json({ error: "Command not found" });
      return;
    }
    res.json(fmt(cmd));
  } catch (err) {
    req.log.error({ err }, "Failed to update command");
    res.status(500).json({ error: "Failed to update command" });
  }
});

// ── Cron Jobs ────────────────────────────────────────────────────────────────

router.get("/cron", async (req, res) => {
  try {
    const rows = await db.select().from(cronJobsTable)
      .orderBy(desc(cronJobsTable.createdAt));
    res.json(rows.map(fmtCron));
  } catch (err) {
    req.log.error({ err }, "Failed to list cron jobs");
    res.status(500).json({ error: "Failed to list cron jobs" });
  }
});

router.post("/cron", async (req, res) => {
  const { agentId, name, schedule, task, payload } = req.body as {
    agentId: number;
    name: string;
    schedule: string;
    task: string;
    payload?: string;
  };

  if (!agentId || !name?.trim() || !schedule?.trim() || !task?.trim()) {
    res.status(400).json({ error: "agentId, name, schedule, task are required" });
    return;
  }

  try {
    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const nextRunAt = computeNextRun(schedule);
    const [job] = await db.insert(cronJobsTable).values({
      agentId,
      name,
      schedule,
      task,
      payload: payload ?? null,
      enabled: true,
      nextRunAt,
    }).returning();
    res.status(201).json(fmtCron(job));
  } catch (err) {
    req.log.error({ err }, "Failed to create cron job");
    res.status(500).json({ error: "Failed to create cron job" });
  }
});

router.patch("/cron/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const { enabled, name, schedule, task, payload } = req.body as {
    enabled?: boolean;
    name?: string;
    schedule?: string;
    task?: string;
    payload?: string;
  };

  try {
    const updates: Record<string, unknown> = {};
    if (enabled !== undefined) updates.enabled = enabled;
    if (name !== undefined) updates.name = name;
    if (task !== undefined) updates.task = task;
    if (payload !== undefined) updates.payload = payload;
    if (schedule !== undefined) {
      updates.schedule = schedule;
      updates.nextRunAt = computeNextRun(schedule);
    }
    const [job] = await db.update(cronJobsTable).set(updates)
      .where(eq(cronJobsTable.id, id)).returning();
    if (!job) {
      res.status(404).json({ error: "Cron job not found" });
      return;
    }
    res.json(fmtCron(job));
  } catch (err) {
    req.log.error({ err }, "Failed to update cron job");
    res.status(500).json({ error: "Failed to update cron job" });
  }
});

router.delete("/cron/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  try {
    await db.delete(cronJobsTable).where(eq(cronJobsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete cron job");
    res.status(500).json({ error: "Failed to delete cron job" });
  }
});

// Manually trigger a cron job (creates a command immediately)
router.post("/cron/:id/trigger", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  try {
    const [job] = await db.select().from(cronJobsTable).where(eq(cronJobsTable.id, id));
    if (!job) {
      res.status(404).json({ error: "Cron job not found" });
      return;
    }

    // Actually execute the job (in the background) instead of inserting an
    // orphan queued command. runCronJob handles bookkeeping + execution.
    void runCronJob(job, DEFAULT_CHANNEL_ID).catch((err) =>
      req.log.error({ err, jobId: job.id }, "cron job execution failed"),
    );

    res.status(202).json({ triggered: true, jobId: job.id });
  } catch (err) {
    req.log.error({ err }, "Failed to trigger cron job");
    res.status(500).json({ error: "Failed to trigger cron job" });
  }
});

export default router;
