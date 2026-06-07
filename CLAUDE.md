# CLAUDE.md — working in this repo

Guidance for any AI agent (Claude Code / contributors) modifying **BOS-AURA /
OPENCLAW OMEGA**.

## Ground truth (verify, don't assume)

- **Package manager:** `pnpm` (`pnpm-lock.yaml`). Never npm/yarn/bun.
- **Monorepo:** pnpm workspaces. API in `artifacts/api-server`, UI in `artifacts/openclaw`, shared libs in `lib/*`.
- **Verify commands:**
  - `pnpm run typecheck` — all packages
  - `pnpm --filter @workspace/api-server run build` · `… run test` (vitest, 66 tests)
  - `pnpm --filter @workspace/openclaw run build` (needs `PORT` + `BASE_PATH`)
- **Deploy:** push to `main` → GitHub Actions builds + commits `dist/` + triggers Render. Live at `bos-aura.onrender.com`.
- **Secrets:** never hardcode. Env vars only (`.env.example` is the template; `.env*` is git-ignored). The encrypted vault is `artifacts/api-server/src/lib/vault.ts`.

## Workflow rules (internal — always follow)

These are standing operator rules. Follow them on every task without being asked.

1. **Branch-per-push, methodical names.** Never push straight to a shared branch.
   For every push, create a NEW branch whose name encodes the **date** and **what
   changed**, e.g. `2026-06-07-abby-presents-claw-work` or
   `update/2026-06-07-composio-connect-flow`. The branch name is the changelog.
2. **Always branch from the latest project, never regress.** Before creating the
   branch, sync to the newest `main` (the superset of all branches) so the new
   branch contains the latest version of the project with **zero loss of
   function**. Verify (`typecheck` + build + the 66 vitest tests, plus browser
   checks for UI) BEFORE merging, then merge the branch into `main`. If a change
   would drop existing functionality, stop — do not merge.
3. **Autonomy — do not ask the operator to fix what you can fix.** When something
   is wrong, self-reflect first: *"Can I fix this myself?"* If yes, fix it —
   plan → execute → observe → verify (run it, build it, Playwright the UI) →
   confirm against the goal. Only surface a genuine blocker you truly cannot
   resolve (e.g. a secret only the operator holds). Never hand back a to-do you
   were capable of completing.

## Anti-hallucination enforcement (mandatory)

This repo is under evidence discipline. Read `docs/anti-hallucination/` —
especially `04-PREFLIGHT-CARD.md` (paste before build tasks) and
`03-VERIFICATION-LEDGER.md` (the verdict format). In short:

- Never claim a file/command/test/build/route/result exists unless directly observed this session.
- Printing code to stdout is **not** creating a file. Describing a change is **not** making it.
- Failures are reported verbatim, never converted to success.
- A green typecheck/build proves it compiles — not that the feature works. Say which.
- UI changes need browser validation, or an explicit `browser: NOT RUN` with the reason.
- Unknown means unknown.

## The runtime swarm's limits (so you don't repeat the incident)

The live CLAW agents run tools in an **isolated sandbox that cannot see this
repo**. They cannot inspect/build/test/modify the codebase. Don't dispatch
repo-self-test missions to them; do that work here, in the real repo, as the dev
agent. See `.agents/memory/anti-hallucination.md`.
