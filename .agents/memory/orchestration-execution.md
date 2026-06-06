---
name: orchestration execution model
description: How real agent orchestration runs and the invariant that keeps dashboard status honest
---

# Orchestration execution model

Agent commands execute **in-process, fire-and-forget**: `POST /api/commands` returns
immediately and a background `executeAgentCommand` / `orchestrateGoal` does the real
work (OpenRouter model call, optional Steel scrape, DB writes), surfaced via the
dashboard's polling.

## Invariant: boot-time reconciliation
Because execution is in-process, a crash/restart mid-run orphans rows. Any new
long-running execution path MUST be covered by `reconcileStaleWork()` (runs on boot
before `app.listen`): fail `running` commands/tasks/tool_calls and reset non-idle
agent status → `idle`.

**Why:** without it the dashboard shows phantom "thinking" agents and perpetually
`running` work after every restart (and Render redeploys restart often).
**How to apply:** when adding a new status a long-running path can leave behind,
add it to `reconcileStaleWork` so it's cleared on boot.

## Pause is authoritative mid-run
`isSwarmPaused()` (in-memory, resets on restart) is checked at orchestration start
AND before each directive dispatch in `orchestrateGoal`'s loop, so pausing after a
run starts halts remaining directives instead of only blocking new runs.

## Contract note
Broadcast `POST /commands` (no `toAgentId`) returns `202 {orchestrating:true}`, not
the created rows. Only caller is CommandBar, which checks `res.ok` and ignores the
body. This endpoint is not in the OpenAPI spec, so codegen won't catch drift.
