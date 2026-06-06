import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, insertTaskSchema } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const VALID_TASK_STATUSES = ["queued", "running", "paused", "completed", "failed"] as const;

router.get("/", async (req, res) => {
  try {
    const tasks = await db.select().from(tasksTable).orderBy(tasksTable.id);
    res.json(tasks.map(t => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
      completedAt: t.completedAt?.toISOString() ?? null,
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list tasks");
    res.status(500).json({ error: "Failed to list tasks" });
  }
});

router.post("/", async (req, res) => {
  const parse = insertTaskSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid task data" });
  try {
    const [task] = await db.insert(tasksTable).values(parse.data).returning();
    return res.status(201).json({
      ...task,
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create task");
    return res.status(500).json({ error: "Failed to create task" });
  }
});

router.patch("/:taskId", async (req, res) => {
  const taskId = parseInt(req.params.taskId);
  if (isNaN(taskId)) return res.status(400).json({ error: "Invalid task ID" });
  const { status, progress, agentId } = req.body as {
    status?: string;
    progress?: number;
    agentId?: number;
  };
  if (status && !VALID_TASK_STATUSES.includes(status as typeof VALID_TASK_STATUSES[number])) {
    return res.status(400).json({ error: "Invalid status" });
  }
  const updates: Record<string, unknown> = {};
  if (status) updates.status = status;
  if (progress !== undefined) updates.progress = Math.min(100, Math.max(0, progress));
  if (agentId !== undefined) updates.agentId = agentId;
  if (status === "completed") updates.completedAt = new Date();
  try {
    const [task] = await db.update(tasksTable).set(updates).where(eq(tasksTable.id, taskId)).returning();
    if (!task) return res.status(404).json({ error: "Task not found" });
    return res.json({
      ...task,
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to update task");
    return res.status(500).json({ error: "Failed to update task" });
  }
});

export default router;
