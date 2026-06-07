# Changelog

All notable changes to **BOS-AURA / OPENCLAW OMEGA**.

Convention: every push records the **date** and **what was done**. When a new
branch is created, it gets its own dated section here.

---

## 2026-06-07 — branch `claude/clever-allen-cEtpo`

### Third-party integrations wired (env-driven, no hardcoded secrets)
- **Helicone** — all OpenRouter LLM traffic transparently proxied for observability.
- **Tavily + Exa** — added as web-search providers; `web_search` now fails over
  Tavily → Exa → Firecrawl.
- **Inngest** — emits `swarm/goal.received|completed|failed` lifecycle events.
- **LangSmith** — traces orchestration LLM runs.
- **E2B** — `cloud_code_exec` tool runs code in an isolated cloud sandbox.
- **Buddy AI** — OpenAI-compatible **fallback LLM** for the orchestrator when the
  primary OpenRouter call fails.
- **Composio** — `composio_action` tool (Gmail/Slack/GitHub/Notion/…), gated by
  `ALLOW_COMPOSIO_EXECUTE` (off by default).
- New `GET /api/integrations` status route + startup log (booleans only).

### Agents made genuinely real (closing "dress-up" gaps)
- **Semantic memory (VAULT)** — `memory_search` now does real embedding +
  cosine-similarity retrieval (`EMBEDDINGS_API_KEY`), with keyword fallback;
  `agent_memory` gains an `embedding` column.
- **Live cron scheduler** — background loop actually executes due jobs end-to-end
  (previously stored but never run); manual trigger now executes too.
- **Parallel swarm** — directives dispatch concurrently instead of sequentially.

### UI/UX pass (make it friendly & proper)
- **Navigation rail** redesigned: was icon-only with no labels — now branded
  ("OPENCLAW") with visible text labels under every icon, accessible tooltips,
  clearer active state, and a readable swarm status (ACTIVE/PAUSED, not just a dot).
- **Command bar**: replaced fake/non-existent command presets (`memory_lancedb:`,
  `n8n_trigger:`, `firecrawl:`, `exec:`…) with real natural-language goals the
  swarm actually executes; fixed the misleading command-tab placeholder.

### UI/UX Phase 0 — make it honest + stop the bleeding
- **0a. Fix live 402**: OpenRouter failures (e.g. out-of-credits) in `/ai/chat` and
  `/ai/complete` now fall back to Buddy AI instead of surfacing a raw error;
  default `max_tokens` lowered; clearer error hint.
- **0b. Real cron UI**: `cron.tsx` was 100% hardcoded mock data — now wired to the
  live `/api/cron` endpoints (list/create/toggle/trigger/delete) with loading,
  empty, error states and toast feedback. It drives the real scheduler.
- **0c.** Removed the dead HITL "Authorize/Deny" buttons (no backend; they did nothing).
- **0d.** Surfaced `/api/integrations` as a real status panel in Settings.

### Notes
- The GO/HOLD/ABORT policy/approval gate was prototyped and then **removed at the
  operator's request** — no risk-tiered governance ships.
- Env plumbing for all of the above added to `.env.example`, `render.yaml`, and
  the Render env-setter; `.env*` is git-ignored.
