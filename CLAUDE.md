# CLAUDE.md — Working in This Repo

Guidance for AI agents and contributors modifying **NEWSUPERNOVA / OPENCLAW OMEGA**.

---

## Ground Truth

Verify from the repository before making assumptions.

### Package Manager

Use only:

```bash
pnpm

Do not use:

npm
yarn
bun


---

Repository Structure

This is a pnpm workspace monorepo.

artifacts/api-server   API server
artifacts/openclaw     Frontend app
lib/*                  Shared workspace libraries


---

Required Verification Commands

Full workspace typecheck

pnpm run typecheck

API server build

pnpm --filter @workspace/api-server run build

API server tests

pnpm --filter @workspace/api-server run test

Frontend build

PORT=10000 BASE_PATH=/ pnpm --filter @workspace/openclaw run build


---

Deployment Model

Production deployment is GitHub Actions → Render.

push to main
→ GitHub Actions builds
→ dist artifacts are committed
→ Render deploy is triggered

Live service:

https://supernova.onrender.com


---

Secrets Policy

Never hardcode secrets.

Allowed:

const apiKey = process.env.API_KEY;

Forbidden:

const apiKey = "real-secret-value";

Environment rules:

.env.example      template only
.env*             git-ignored

Encrypted vault:

artifacts/api-server/src/lib/vault.ts


---

Workflow Rules

1. Branch Per Push

Never push directly to a shared working branch.

Create a new branch for every meaningful change.

Branch names must include:

date + what changed

Examples:

git checkout main
git pull origin main
git checkout -b update/2026-06-13-command-cron-api

git checkout main
git pull origin main
git checkout -b 2026-06-13-fix-agent-status-reconciliation


---

2. Start From Latest Main

Before changing code:

git checkout main
git pull origin main

Then create the feature branch.

Do not regress existing functionality.

If a change removes or weakens existing behavior unintentionally:

STOP

Fix the regression before merge.


---

3. Fix What You Can Fix

When a problem is found:

read relevant files
understand current behavior
make focused change
run verification
report exact result

Do not hand back tasks that can be completed with available repo/tool access.

Only surface a blocker when it cannot be resolved from the current environment.


---

Anti-Hallucination Discipline

This repo requires evidence-based reporting.

Read:

docs/anti-hallucination/
docs/anti-hallucination/04-PREFLIGHT-CARD.md
docs/anti-hallucination/03-VERIFICATION-LEDGER.md

Rules:

Do not claim a file exists unless observed.

Do not claim a command ran unless it actually ran.

Do not claim tests passed unless test output proves it.

Do not claim a build passed unless build output proves it.

Do not claim a route works unless it was checked.

Do not claim deploy success unless deployment was verified.

Printing code to stdout is not creating a file.

Describing a change is not making a change.

A compile pass only proves compilation.

A test pass only proves the tested behavior.

Unknown means unknown.


Failure output must be reported truthfully.

Do not convert errors into success.


---

UI Validation

For UI changes, run browser validation when possible.

Recommended:

pnpm --filter @workspace/scripts run ui-smoke

For broader visual checks:

pnpm --filter @workspace/scripts run visual-audit

If browser validation is not run, report:

browser: NOT RUN — <reason>


---

Runtime Swarm Limits

The live CLAW agents execute inside an isolated sandbox.

They cannot be assumed to access this repository.

They cannot be assumed to:

inspect repo files
modify repo files
build the repo
test the repo
verify deployment

Do not dispatch repo self-test or repo modification work to the runtime swarm unless repo access is explicitly confirmed.

Repo engineering work must be performed in the real development environment.

Reference:

.agents/memory/anti-hallucination.md


---

Development Loop

Use this loop for code tasks:

1. Read relevant files
2. Define acceptance criteria
3. Identify risks
4. Make focused changes
5. Run relevant verification
6. Fix failures
7. Re-run verification
8. Report exact evidence


---

Definition of Done

A task is done only when:

code changed as intended
relevant checks passed or blockers are documented
UI validation ran when applicable
no known regression is hidden
final report states exactly what was verified


---

Final Report Format

Use:

Changed:
- ...

Verified:
- ...

Not Run:
- ...

Blocked:
- ...