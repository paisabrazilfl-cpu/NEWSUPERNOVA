# Handoff — 2026-06-11 · solve loop, solution gate, twin-sync receiver

**Branch:** `claude/awesome-babbage-sc8if0` (pushed, NOT merged to `main`, nothing deployed).
**Verification state at handoff:** `pnpm run typecheck` PASS · API build PASS · vitest **221/221 PASS** · browser: NOT RUN (no UI changes) · live runtime against Render: NOT RUN.

---

## 1. What was built this session (all on the branch above)

### a) Bounded solve loop + solution gate (`artifacts/api-server/src/orchestrator.ts`)
The final output of `orchestrateGoal` must BE a solution to the operator's input.

- **Coordinator solve loop:** after round 1, ABBY re-judges CLAW results against the
  goal and dispatches corrective rounds until the review returns `[]` (solved).
- **Solution gate:** after synthesis, a strict verifier judges whether the briefing
  *solves* the input (status reports / partials don't count). Failing verdicts emit
  corrective directives → dispatch → re-synthesize → re-verify.
- **Budget:** `MAX_SOLVE_CYCLES` (default 4) = TOTAL dispatch rounds including the
  first — i.e. max spend 4× one single run. One shared pool for both loops
  (`solveRoundsUsed`). Env-tunable, documented in `.env.example`.
- **Honesty:** if the budget runs out unsolved, the briefing gets an explicit
  `⚠️ SOLUTION GATE — NOT FULLY SOLVED` note. Never fakes success.
- **Safety:** both loops are skipped for `forceAgentId` runs (single-shot
  connected-account actions, e.g. Instagram posts, must not repeat side effects).
- `parseSolutionVerdict` is regex-hardened and fails OPEN on unparseable judge
  output (logged) so a flaky judge can't burn the budget.
- Tests: `orchestrator.solve.test.ts` (10 tests).

### b) Twin-sync receiver + anti-echo hardening
- **New route** `POST /api/external/v1/twin-lessons` (`routes/external.ts`), behind
  the existing `OPENCLAW_API_KEY` bearer auth. Ingests a twin's lessons into
  `agent_memory` under VAULT (agent 4), **quarantined**: tagged `from-twin,proposed`,
  the teacher's `self-learned` tag stripped, embedded for semantic search,
  idempotent via `src:<sourceId>` tag markers. Replies `{ingested, skipped}`.
- **Anti-echo:** `collectVerifiedLessons` (`lib/twinSync.ts`) now excludes
  `from-twin` rows; `quarantineTags()` strips inherited trust/src markers. A
  received lesson can never be re-exported as if verified locally.
- `TWIN_*` env vars documented in `.env.example`.
- Tests: `twinSync.test.ts` (8 tests).

### c) Commits on the branch
- `621ba2e` solve loop + solution gate
- `0244c6f` budget capped at 4× one single run (shared pool)
- `835e71c` twin-lessons receiver + anti-echo + env docs + tests
- `7029cb0` comment correction: T800 is a separate repo

---

## 2. Ground truth about AURA ⇄ T800 (verified this session — do not re-assume)

- **T800 is a SEPARATE repository:** <https://github.com/paisabrazilfl-cpu/T800-AURA>.
  It is NOT a second deployment of this codebase. (An earlier session comment
  implied otherwise; corrected in `7029cb0`.)
- **Teacher side (this repo): real.** `lib/twinSync.ts` `teachTwin()` fires after the
  nightly self-learning cron (matched on job name `/self-learning/i` in
  `lib/scheduler.ts`), pushing verified lessons (last 6h, tag `self-learned`,
  max 200) to `${TWIN_API_URL}/api/external/v1/twin-lessons`.
- **Learner side in T800: UNVERIFIED / probably missing.** No session has ever
  inspected the T800 repo. Until T800 implements the receiver, enabling sync will
  log `twin sync: HTTP 404` and teach nothing. The pre-existing `main` commit
  "one-way twin-teach to T800" only ever built the SENDING side.
- The receiver added to NEWSUPERNOVA is AURA's own inbound ear (lets a twin teach
  AURA back); it does not help T800 receive.

## 3. Next steps (in order)

1. **Merge the branch** into `main` per repo workflow (verify first; merging
   deploys via GitHub Actions → Render). Re-run typecheck + build + tests before
   merging. Note: solve loop increases per-goal LLM/tool spend up to 4×; set
   `MAX_SOLVE_CYCLES=2` on Render if cost bites.
2. **Implement the receiver in T800-AURA** (separate session scoped to that repo).
   Contract (reference implementation: `routes/external.ts` route + `lib/twinSync.ts`
   on this branch):
   - `POST /api/external/v1/twin-lessons`, `Authorization: Bearer <T800's own key>`
   - Body: `{"source": "NEWSUPERNOVA", "lessons": [{"sourceId": "aura:<id>", "key", "content", "tags", "agentName"}]}`
   - Store quarantined (`from-twin,proposed`, strip `self-learned`), dedupe on
     `src:<sourceId>`, reply `{"ingested": n, "skipped": n}`.
   - First verify what T800's stack actually is — do not assume it mirrors this repo.
3. **Enable sync** (after both deploys): on AURA's Render service set
   `TWIN_SYNC_ENABLED=true`, `TWIN_API_URL=<T800 base URL>`,
   `TWIN_API_KEY=<T800's OPENCLAW_API_KEY>`. Proof of life: the nightly cron job's
   `last_result` shows `twin sync: sent N, ingested N`.
4. **Runtime verification (still owed):** nothing from this session has been
   observed running live — confirm post-deploy that (a) a goal run shows solve-cycle
   messages in the feed, (b) `agent_memory` accumulates `lesson,self-learned` rows,
   (c) the twin push lands.

## 4. Also discussed (no code written)

- **Vapi voice control:** plug-and-play via Vapi "Custom LLM" → base URL
  `https://newsupernova.onrender.com/api/external/v1` (OpenAI-compatible, SSE streaming
  already supported), model = agent name (`abby`, …), bearer = `OPENCLAW_API_KEY`.
  Set `OPENCLAW_API_KEY` on Render first (auth is OPEN when unset). Watch Render
  cold-start latency; add a brevity system prompt in Vapi. Voice→actions would need
  Vapi tool-call webhooks onto `/tasks` / `/swarm` (not built).
- **Self-learning: verified real in code** (4 layers): `[SELF-LEARN]` failure nudge in
  `executeAgentCommand`, SELF-LEARN doctrine in every CLAW system prompt
  (`routes/ai.ts:112`), durable shared memory (`memory_write`/`memory_search`,
  Postgres + embeddings + optional Pinecone), nightly self-learning cron seeded in
  `migrate.ts` (04/05/06 UTC). Retrieval-based learning, not weight training; lesson
  quality is model behavior; semantic retrieval needs `EMBEDDINGS_API_KEY`.
