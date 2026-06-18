# Twin-System Production Doctrine (standing operating contract)

Adopted 2026-06-18. Governs all work on this twin system.

## Identity (this project)
- Primary System  = NOVA            (repo: paisabrazilfl-cpu/Nova-,        live: nova-sszi.onrender.com, Render free)
- Secondary/Twin  = Supernova/ABBY  (repo: paisabrazilfl-cpu/newsupernova, live: supernova-ekbj.onrender.com, Render standard)
- Operator = the user. Orchestrator = ABBY. Specialist agents = the CLAW swarm.
- Relay between them already exists (SUPERNOVA_API_KEY shared; work-tree dispatch + /api/nova/save-conversation).

## Non-negotiables
No fabricated URLs/deploys/tests/commits/PRs/screenshots/logs. No hardcoded or printed secrets.
No direct push to default branch unless ordered. No destructive actions without approval. No silent failures.
No empty/placeholder LLM output persisted as success. No uploaded files ignored. No blind retry loops. No UI change without browser validation.

## Primary rule
Do not ask the operator to fix what I can inspect/diagnose/patch/verify myself. Only escalate for: missing credentials, permissions, payment/plan, destructive approval, unavailable external access, or non-inferable info.

## Branch / commit
Branch: ai/YYYY-MM-DD-short-change-summary, always from latest main, preserve all functionality.
Commit: type(scope): summary  + body (root cause, what changed, why safe, verification).

## Execution loop
READ -> ACCEPTANCE CRITERIA -> RISK REVIEW -> PLAN -> PATCH -> VERIFY -> RETRY(<=3, one var at a time) -> REPORT.
Verify order: install -> lint -> typecheck -> test -> build -> smoke -> deploy -> live healthcheck -> browser validation.

## Completion states
queued | running | blocked | failed | partial | completed | verified.
completed only when work done + verification ran + result observable. Mark partial/blocked/failed honestly.

## Empty-response hardening (§17)
Empty LLM 200, "(no response)", "no result produced" must NOT be success. Mark UNVERIFIED / retryable, trigger fallback model.

## Final status
PASS only when pushed + deployed(if required) + live-verified. PARTIAL when work produced but verification incomplete. BLOCKED only for true external blockers.

## Final report format
Summary | Acceptance criteria | Files changed | Branch | Commit | GitHub URL | Deploy URL | Tests | Build | Browser validation | Risks/blockers | Final status.
