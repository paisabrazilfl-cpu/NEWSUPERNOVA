---
name: Swarm activation UX
description: Why the swarm can look "dead" even though orchestration works, and the default that fixes it
---

# Swarm activation is gated behind the CommandBar global action

The backend orchestration (`orchestrateGoal` → ABBY decomposes a goal into per-CLAW
directives → each CLAW runs an autonomous tool loop) is fully real and works. Agents
only appear idle because the system is **pull-based**: nothing runs until a goal is
POSTed to `/api/commands` (broadcast, no `toAgentId`).

**Why users think "the swarm doesn't work":** the CommandBar global send has two
actions — `chat` (streams a single ABBY reply, no swarm) and `dispatch` (fires the
orchestrator so the whole swarm collaborates). The default is now `dispatch` so a
plain global message activates the swarm. If this ever regresses to `chat`, the app
will look dead again even though the backend is healthy.

**How to apply:** When debugging "swarm not doing anything", first confirm backend
works by `curl -X POST /api/commands -d '{"command":"..."}'` and watching
`/api/agents` statuses change — don't assume the orchestrator is broken. The fix is
almost always a UI/trigger issue, not the engine.
