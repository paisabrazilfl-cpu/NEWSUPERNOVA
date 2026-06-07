# Anti-Hallucination Rule Sets ⚔️

A set of enforceable rules that keep any agent (the dev agent working on this
repo, **and** the runtime CLAW swarm) from inventing files, APIs, commands,
builds, tests, routes, results, or logs.

**Core principle:** *Evidence only.* If it wasn't directly observed in this
session, it is `UNVERIFIED`. Failure is never silently converted to success.

## The documents

| File | Audience | Use it when |
|---|---|---|
| [`01-EXECUTION-RULESET.md`](./01-EXECUTION-RULESET.md) | Dev agent (Claude Code / contributors) | Building or changing this repo. The full 12-rule contract. |
| [`02-AGENT-RUNTIME-RULES.md`](./02-AGENT-RUNTIME-RULES.md) | The runtime CLAW swarm (ABBY, FORGE, …) | Baked into the agent system prompts ("kernels"). Tool-use honesty. |
| [`03-VERIFICATION-LEDGER.md`](./03-VERIFICATION-LEDGER.md) | Anyone reporting a result | Recording evidence + the final PASS/FAIL/PARTIAL/BLOCKED verdict. |
| [`04-PREFLIGHT-CARD.md`](./04-PREFLIGHT-CARD.md) | Anyone | A 10-second condensed enforcement card / paste-in prompt. |

## This repo's ground truth (so nobody guesses)

- **Package manager:** `pnpm` (detected from `pnpm-lock.yaml`). Not npm/yarn/bun.
- **Verify commands:** `pnpm run typecheck` · `pnpm run build` · `pnpm --filter @workspace/api-server run test`
- **Real repo root:** the directory containing `pnpm-workspace.yaml`. Never substitute `/tmp` or a scratch project.
- **UI lives in** `artifacts/openclaw`; **API in** `artifacts/api-server`.

## Where these are enforced in code

The runtime rules in `02-AGENT-RUNTIME-RULES.md` are injected into the live agent
prompts via `ANTI_HALLUCINATION_DIRECTIVE` in
`artifacts/api-server/src/routes/ai.ts`, appended to the orchestrator and chat
system prompts. The dev-agent rules are surfaced in `/CLAUDE.md`.
