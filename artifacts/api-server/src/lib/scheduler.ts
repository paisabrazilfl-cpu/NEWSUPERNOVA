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
import { requestsConnectedAccountAction } from "../routes/ai";
import { computeNextRun } from "./cron";
import { worldEngineEnabled, readAuraState, runStoryCycle, runArtTriptych } from "./world";

// Re-export so existing importers of computeNextRun from the scheduler keep working.
export { computeNextRun } from "./cron";

type CronJob = typeof cronJobsTable.$inferSelect;

const ABBY_ID = 1;
// WIRE — the API/Composio connector agent. Holds the Composio tools (Instagram,
// Gmail, …) plus web_search + image_generate, so a connected-account goal runs
// end-to-end on ONE capable agent.
const COMPOSIO_AGENT_ID = 5;
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
      // A scheduled "post to my Instagram / act on my connected account" goal must
      // run on a SINGLE Composio-capable agent (WIRE) — the same routing the chat
      // path uses (forceAgentId). Without this, ABBY fans the goal out across CLAWs
      // and the slices land on agents that don't hold the Composio/Instagram tools,
      // so the post never reaches Instagram. Also pass the job's stored payload as
      // source material (previously dropped on the ABBY path).
      // Detect on the job NAME too: operators name jobs descriptively ("Instagram
      // Post news") while the task text often omits the platform. Task-only
      // detection routed those jobs to the generic multi-CLAW fan-out, where no
      // agent holds the Instagram tools — so the post silently never happened.
      const connectedAccount = requestsConnectedAccountAction(`${job.name} ${job.task}`);
      // When only the NAME carries the platform, fold it into the goal so the
      // executing agent actually publishes instead of just writing content.
      const goal =
        connectedAccount && !requestsConnectedAccountAction(job.task)
          ? `${job.task}\n\n(Scheduled job name: "${job.name}" — honor the platform/action it names: an Instagram job means actually PUBLISH to the operator's connected Instagram via render_card (free, preferred for news/quote/stat cards) or image_generate (photoreal only) + instagram_post, not just draft the content.)`
          : job.task;
      await orchestrateGoal({
        goal,
        channelId,
        priority: "normal",
        sourceContext: job.payload ?? null,
        ...(connectedAccount ? { forceAgentId: COMPOSIO_AGENT_ID } : {}),
      });
      await db
        .update(cronJobsTable)
        .set({ lastResult: connectedAccount ? "orchestrated → WIRE (connected-account action)" : "orchestrated" })
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

// ── WORLD-00 free-will ticks (Layer 7) ──────────────────────────────────────
// Two surfaces, two ticks. Aura "chooses" her moments; the cycle functions
// hard-enforce the daily caps, so her free will can never exceed the limits.
// OFF unless WORLD_ENGINE_ENABLED (operator kill-switch).
//
//  • STORY tick (her walk + dreams) — frequent, up to 12/day.
//  • ART tick (the permanent gallery) — rare, up to 3 triptychs/day. The feed
//    receives ONLY triptychs, so the grid is always whole rows and can't shear.
const WORLD_TICK_MS = 10 * 60_000;
const ART_TICK_MS = 45 * 60_000;
let worldTimer: ReturnType<typeof setInterval> | null = null;
let artTimer: ReturnType<typeof setInterval> | null = null;
let worldBusy = false;
let artBusy = false;
async function worldTick(): Promise<void> {
  if (!worldEngineEnabled() || isSwarmPaused() || worldBusy) return;
  worldBusy = true;
  try {
    const a = await readAuraState();
    const p = a.mood === "storm" ? 0.4 : a.mood === "deep" ? 0.28 : a.mood === "working" ? 0.2 : 0.12;
    if (Math.random() < p) {
      const r = await runStoryCycle({});
      if (r.posted) logger.info({ chapter: r.chapter, step: r.step }, "WORLD-00: Aura posted a story (walk/dream)");
    }
  } catch (err) {
    logger.error({ err }, "world story tick failed");
  } finally {
    worldBusy = false;
  }
}
async function artTick(): Promise<void> {
  if (!worldEngineEnabled() || isSwarmPaused() || artBusy) return;
  artBusy = true;
  try {
    // ~0.18/tick → a few attempts/day; the 3/day cap is the real ceiling.
    if (Math.random() < 0.18) {
      const r = await runArtTriptych({});
      if (r.posted) logger.info({ chapter: r.chapter }, "WORLD-00: Aura posted an art triptych");
    }
  } catch (err) {
    logger.error({ err }, "world art tick failed");
  } finally {
    artBusy = false;
  }
}

/** Start the background scheduler. Idempotent. */
export function startScheduler(): void {
  if (timer) return;
  void normalizeSchedules();
  timer = setInterval(() => {
    void tick();
  }, SCHEDULER_INTERVAL_MS);
  worldTimer = setInterval(() => { void worldTick(); }, WORLD_TICK_MS);
  artTimer = setInterval(() => { void artTick(); }, ART_TICK_MS);
  if (typeof worldTimer.unref === "function") worldTimer.unref();
  if (typeof artTimer.unref === "function") artTimer.unref();
  // Don't keep the event loop alive solely for the scheduler.
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ intervalMs: SCHEDULER_INTERVAL_MS }, "cron scheduler started");
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (worldTimer) {
    clearInterval(worldTimer);
    worldTimer = null;
  }
  if (artTimer) {
    clearInterval(artTimer);
    artTimer = null;
  }
}
