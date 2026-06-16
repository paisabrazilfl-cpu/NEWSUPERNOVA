# Changelog

All notable changes to **NEWSUPERNOVA / OPENCLAW OMEGA**.

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

### UI/UX Phase 1 — robustness
- Real error + empty states on Agents and Tasks (were blank on failure/empty).
- Toast feedback on vault store/delete; mounted the Sonner `<Toaster/>` (was never
  rendered, so sonner toasts now actually appear).

### UI/UX Phase 2 — responsive
- `AgentInspector` no longer fixed at 440px — full-width with a tap-to-dismiss
  backdrop on phones, side panel on larger screens.
- Tasks table scrolls horizontally on narrow screens instead of crushing.

### UI/UX Phase 3 — polish
- Rewrote the `404` page to match the dark theme (was a stray light-mode page).

### UI/UX — full redesign into a modern AI chat product
- **Theme**: replaced the thin neon cyberpunk theme with a calm, legible, professional
  dark palette (Inter + JetBrains Mono, softer radii, higher contrast), applied app-wide
  via the design tokens. Removed the busy grid background.
- **New chat experience (`/`)**: ChatGPT/Claude-style layout —
  - Conversation sidebar (new / rename / delete / active highlight), backed by real
    channel endpoints; collapses to a drawer on mobile.
  - Clean message thread: distinct user vs assistant styling, chronological, auto-scroll,
    word wrap, dependency-free markdown/code-block rendering with copy buttons.
  - Composer: auto-growing textarea, Enter to send / Shift+Enter newline, send + loading
    states, typing indicator, file-attach UI (stub — no upload backend yet, marked in code).
  - Top bar: conversation title, export to `.txt`/`.json`, mobile menu.
  - Empty/loading/error states throughout; accessible labels on all controls.
- **Backend (real)**: added `PATCH`/`DELETE /api/channels/:id` (rename + delete w/ message
  cascade) to power conversation management.
- The swarm dashboard moved to `/swarm`; all other pages preserved. Nav rail updated.

### Notes
- The GO/HOLD/ABORT policy/approval gate was prototyped and then **removed at the
  operator's request** — no risk-tiered governance ships.
- Env plumbing for all of the above added to `.env.example`, `render.yaml`, and
  the Render env-setter; `.env*` is git-ignored.

## 2026-06-07 — Anti-hallucination kernel + rule sets

Motivated by a real incident: a "self-test the build" directive made the runtime
swarm fabricate `src/runtime/*.ts` files (printed to stdout, never written) and
declare them "created and verified", plus a fake "92.3% satisfied" matrix.

- **Kernel fix:** `ANTI_HALLUCINATION_DIRECTIVE` (artifacts/api-server/src/routes/ai.ts)
  appended to every agent system prompt — chat, orchestrator, and external API.
  Agents must now state they cannot see/modify the repo from their sandbox and
  must never claim unproven creation/inspection/results.
- **Rule sets:** docs/anti-hallucination/ (index, execution rules, runtime/kernel
  rules, verification ledger + verdict format, pre-flight card).
- **Governance:** CLAUDE.md (dev agent) + .agents/memory/anti-hallucination.md.

## 2026-06-07 — Self-test harness + runtime self-check (+ real Playwright)

Implements the automatable subset of the self-test phases, for both layers.

- **Dev/CI harness** (`scripts/src/self-test.ts`): typecheck → api build → vitest
  → live endpoint checks → **Playwright UI smoke** (`ui-smoke.ts`, headless
  Chromium walks all 6 routes) → Verdict + Execution Trace (`.self-test/report.json`).
  CI workflow `.github/workflows/self-test.yml` (Postgres service, boots server,
  uploads evidence). Verified locally: STATUS PASS, 10/10 gates, UI 6/6.
- **Runtime self-check** (`GET /api/self-check`): proves only what the server can
  observe in-process — tool-registry integrity (13/13 wired), agent roster (6/6),
  SSRF guard (5/5 blocked), integrations status, DB reachability. Explicitly does
  NOT claim repo/build/UI (the agent sandbox can't see those). Exported `ssrfGuard`.
- First real browser validation in the project — closes the long-standing
  "browser: NOT RUN" gap.

## 2026-06-07 — E2B dev sandbox: the swarm gets a real computer

Turns the runtime swarm's "no"s into "yes"s, SAFELY (isolated VM, prod untouched).

- **`e2b` SDK** added (bundled into dist so it runs on Render with no node_modules).
- **`lib/sandbox.ts`** + tools:
  - `sandbox_exec` — run real shell (pnpm/tsc/vitest/node/curl/playwright/git) in a
    disposable, isolated E2B VM with no access to the prod server or its secrets.
  - `sandbox_repo_pr` — clone newsupernova into the VM, run a script to edit/test,
    commit, push a branch, and OPEN A PR. Scoped to the newsupernova repo only; the
    GitHub token is server-side and never exposed to the model.
- Assigned to ABBY, FORGE, WIRE.
- **Verified live, end-to-end**: sandbox_exec ran shell; sandbox_repo_pr cloned,
  edited, pushed a branch and opened a real PR; cleanup deleted the branch (204).
- Prod env set: SANDBOX_GITHUB_TOKEN, INNGEST_EVENT_KEY, BUDDY_* (all live-on).
