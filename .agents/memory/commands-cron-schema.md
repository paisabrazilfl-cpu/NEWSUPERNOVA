---
name: Commands & Cron API
description: agent_commands and cron_jobs DB tables + REST API + frontend integration
---

# ABBY Command & Cron System

## DB Tables (lib/db/src/schema/commands.ts)
- `agent_commands` — fromAgentId, toAgentId (nullable=broadcast), command, payload, priority (low/normal/high/urgent), status (queued/running/done/failed), result, createdAt, completedAt
- `cron_jobs` — agentId, name, schedule (cron expression), task, payload, enabled, lastRunAt, nextRunAt, runCount, lastResult, createdAt

## API Routes (artifacts/api-server/src/routes/commands.ts)
All mounted at root (no prefix) in routes/index.ts:
- `GET /api/commands[?agentId=N&limit=50]` — list commands
- `POST /api/commands` — ABBY issues command (body: {command, toAgentId?, payload?, priority?}); omit toAgentId to broadcast to all non-ABBY agents
- `PATCH /api/commands/:id` — update status/result
- `GET /api/cron` — list cron jobs
- `POST /api/cron` — create cron job (body: {agentId, name, schedule, task, payload?})
- `PATCH /api/cron/:id` — update job (enabled, name, schedule, task, payload)
- `DELETE /api/cron/:id` — delete job
- `POST /api/cron/:id/trigger` — manual trigger (creates a command immediately)

## Important constants
- `ABBY_ID = 1` — hardcoded as the sender for all commands (fromAgentId)

## Frontend
- `/cron` page — ABBY Cron Scheduler with stats, job cards, trigger/pause/delete
- CommandBar now has two tabs: CHAT (existing) and ABBY COMMAND (new, purple theme)
- ABBY COMMAND tab: target picker (all or specific agent), priority selector (low/normal/high/urgent), command input (font-mono, purple), optional payload, preset commands dropdown

**Why:** User requested ABBY be able to talk to all agents, give orders, and set up cron jobs.

**How to apply:** When adding new command types, add presets to COMMAND_PRESETS in CommandBar.tsx. When adding new cron schedule types, update computeNextRun() in commands.ts.
