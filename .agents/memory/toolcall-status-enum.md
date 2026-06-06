---
name: tool-call status enum
description: The allowed status values for the tool_calls table / telemetry are fixed by the OpenAPI spec.
---

# tool_calls.status enum

The `tool_calls` status field is typed by the OpenAPI spec as exactly:
`pending | running | success | error`. The generated TS client narrows to this
union, so the frontend (e.g. AgentInspector execution matrix) only renders those.

**Rule:** server code that writes tool-call rows must use `success`/`error` on
completion — never `done`/`failed`. (`done`/`failed` belong to the separate
agent_commands / tasks status conventions, which are NOT the tool-call enum.)

**Why:** writing `done`/`failed` to tool_calls produced TS2367 "no overlap"
errors in the frontend and silently broke the inspector's status icons (no
green/red shown) because the union didn't include those values.

**How to apply:** when adding/altering tool-call persistence in
`artifacts/api-server/src/orchestrator.ts` (or any tool runner), map ok→`success`,
fail→`error`. If you need a new status, change the OpenAPI spec first and rerun
`pnpm --filter @workspace/api-spec run codegen`.
