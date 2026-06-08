/**
 * OPENCLAW OMEGA — Cron scheduler.
 *
 * Makes scheduled work ACTUALLY run. Previously cron jobs were stored in the DB
 * with a `next_run_at` timestamp that nothing ever read, and the manual trigger
 * only inserted an orphan "queued" command that no executor picked up. This
 * module adds a real polling loop that finds due jobs and executes them end to
 * end through the same agent machinery the operator uses.
 */

import { db } from "@workspace/db";
import { cronJobsTable, agentsTable, agentCommandsTable } from "@workspace/db";
import { and, eq, lte, isNotNull } from "drizzle-orm";
import { logger } from "./logger";
import { executeAgentCommand, orchestrateGoal } from "../orchestrator";
import { isSwarmPaused } from "../routes/swarm";
import { computeNextRun } from "./cron";

// Re-export so existing importers of computeNextRun from the scheduler keep working.
export { computeNextRun } from "./cron";

type CronJob = typeof cronJobsTable.$inferSelect;

const ABBY_ID = 1;
const DEFAULT_CHANNEL_ID = 1;
const SCHEDULER_INTERVAL_MS = 30_000;

/**
 * Execute one cron job for real. Bookkeeping (last_run_at / run_count /
 * next_run_at) is written up front so a slow run can't be double-fired by the
 * next tick. ABBY jobs orchestrate a goal across the swarm; agent-targeted jobs
 * run that single CLAW's autonomous loop. Never throws.
 */
export async function runCronJob(job: CronJob, channelId = DEFAULT_CHANNEL_ID): Promise<void> {
  await db
    .update(cronJobsTable)
    .set({ lastRunAt: new Date(), runCount: job.runCount + 1, nextRunAt: computeNextRun(job.schedule) })
    .where(eq(cronJobsTable.id, job.id))
    .catch((err) => logger.error({ err, jobId: job.id }, "scheduler: bookkeeping update failed"));

  try {
    if (job.agentId === ABBY_ID) {
      await orchestrateGoal({ goal: job.task, channelId, priority: "normal" });
      await db
        .update(cronJobsTable)
        .set({ lastResult: "orchestrated" })
        .where(eq(cronJobsTable.id, job.id));
      return;
    }

    const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, job.agentId));
    if (!agent) {
      await db
        .update(cronJobsTable)
        .set({ lastResult: `error: target agent #${job.agentId} not found` })
        .where(eq(cronJobsTable.id, job.id));
      return;
    }

    const [cmd] = await db
      .insert(agentCommandsTable)
      .values({
        fromAgentId: ABBY_ID,
        toAgentId: agent.id,
        command: job.task,
        payload: job.payload ?? null,
        priority: "high",
        status: "queued",
      })
      .returning();

    const result = await executeAgentCommand({
      commandId: cmd.id,
      agent,
      command: job.task,
      payload: job.payload ?? null,
      channelId,
    });
    await db
      .update(cronJobsTable)
      .set({ lastResult: result.slice(0, 2000) })
      .where(eq(cronJobsTable.id, job.id));
  } catch (err) {
    logger.error({ err, jobId: job.id }, "scheduler: cron job failed");
    await db
      .update(cronJobsTable)
      .set({ lastResult: `error: ${String(err).slice(0, 500)}` })
      .where(eq(cronJobsTable.id, job.id))
      .catch(() => {});
  }
}

// In-flight job ids, so a long-running job isn't re-dispatched by later ticks.
const inFlight = new Set<number>();
let timer: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  if (isSwarmPaused()) return;
  let due: CronJob[];
  try {
    due = await db
      .select()
      .from(cronJobsTable)
      .where(
        and(
          eq(cronJobsTable.enabled, true),
          isNotNull(cronJobsTable.nextRunAt),
          lte(cronJobsTable.nextRunAt, new Date()),
        ),
      );
  } catch (err) {
    logger.error({ err }, "scheduler: failed to query due jobs");
    return;
  }
  for (const job of due) {
    if (inFlight.has(job.id)) continue;
    inFlight.add(job.id);
    void runCronJob(job).finally(() => inFlight.delete(job.id));
  }
}

/**
 * Recompute next-run for every enabled job on boot, so a deploy immediately
 * corrects any jobs whose nextRunAt was set by the OLD broken calculator (e.g.
 * a daily "0 0 * * *" job stuck firing every 5 min snaps back to next midnight).
 */
async function normalizeSchedules(): Promise<void> {
  try {
    const jobs = await db.select().from(cronJobsTable).where(eq(cronJobsTable.enabled, true));
    for (const j of jobs) {
      await db
        .update(cronJobsTable)
        .set({ nextRunAt: computeNextRun(j.schedule) })
        .where(eq(cronJobsTable.id, j.id))
        .catch(() => {});
    }
    if (jobs.length) logger.info({ count: jobs.length }, "scheduler: normalized next-run times to the corrected cron calculator");
  } catch (err) {
    logger.error({ err }, "scheduler: normalizeSchedules failed");
  }
}

/** Start the background scheduler. Idempotent. */
export function startScheduler(): void {
  if (timer) return;
  void normalizeSchedules();
  timer = setInterval(() => {
    void tick();
  }, SCHEDULER_INTERVAL_MS);
  // Don't keep the event loop alive solely for the scheduler.
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ intervalMs: SCHEDULER_INTERVAL_MS }, "cron scheduler started");
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
