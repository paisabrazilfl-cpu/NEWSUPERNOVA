# Verification Ledger & Verdict Format

Use this format for any build, test, change, deployment, or repo-modification report.

Evidence only.

If a claim has no observed command output, file diff, HTTP response, browser result, or tool result behind it, it must be marked:

```text
UNVERIFIED
NOT RUN
UNKNOWN

Never mark unobserved work as PASS.


---

Final Verdict Template

STATUS: PASS / FAIL / PARTIAL / BLOCKED / NOT VERIFIED

OBSERVED:
- <directly observed fact> — <source: command output / file diff / HTTP response / browser result>

CHANGED FILES:
- <path> — <what changed>
- <path> — <what changed>

COMMANDS RUN:
- <command> → <exit code / pass-fail summary / key output>
- <command> → <exit code / pass-fail summary / key output>

VERIFICATION:
- install:   PASS / FAIL / NOT RUN
- typecheck: PASS / FAIL / NOT RUN
- build:     PASS / FAIL / NOT RUN
- tests:     PASS / FAIL / NOT RUN
- browser:   PASS / FAIL / NOT RUN / N/A
- deploy:    PASS / FAIL / NOT RUN / N/A

FAILURES:
- <exact error text, verbatim>
- <exact error text, verbatim>

UNVERIFIED:
- <anything not directly proven in this session>
- <anything assumed but not checked>

NEXT REQUIRED FIX:
- <smallest correct next action>


---

Evidence Rules

1. PASS requires evidence.

   Valid evidence:
   - command output
   - exit code
   - test count
   - build summary
   - HTTP status/body
   - Playwright/browser result
   - file diff
   - deployment log
   - runtime health check

2. "It should work" is forbidden.

   Use:
   - NOT RUN
   - UNVERIFIED
   - UNKNOWN

3. A green typecheck/build proves compilation only.

   It does NOT prove:
   - feature correctness
   - endpoint behavior
   - UI usability
   - deploy success
   - production health

4. Tests prove only what they tested.

   Always include:
   - command run
   - pass/fail
   - test count/summary if available

5. UI changes require browser validation.

   If Playwright/browser validation is unavailable, record:

     browser: NOT RUN — <exact reason>

6. Deployment success requires external verification.

   Valid deployment evidence:
   - Render deploy response
   - GitHub Actions success log
   - live endpoint returning expected status/body

7. Failures must be reported verbatim.

   Never convert:
   - failed tests
   - failed builds
   - missing env vars
   - missing tools
   - network errors
   - permission errors

   into success.

8. Ephemeral verification infrastructure is allowed only for verification.

   Example:
   - throwaway Postgres
   - temporary test server
   - temporary browser session

   It must be disclosed in COMMANDS RUN.


---

Repo Verification Commands

pnpm install --no-frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run test
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/openclaw run build


---

Browser Verification Commands

pnpm --filter @workspace/scripts run ui-smoke
pnpm --filter @workspace/scripts run visual-audit


---

Deployment Verification Commands

curl -i https://supernova.onrender.com/api/healthz


---

Minimal PASS Example

STATUS: PASS

OBSERVED:
- package manager is pnpm — observed pnpm-lock.yaml
- API tests passed — observed vitest output: 66/66 passing

CHANGED FILES:
- artifacts/api-server/src/routes/commands.ts — added command status update guard

COMMANDS RUN:
- pnpm run typecheck → exit 0
- pnpm --filter @workspace/api-server run test → exit 0, 66/66 tests passed
- pnpm --filter @workspace/api-server run build → exit 0

VERIFICATION:
- install:   NOT RUN
- typecheck: PASS
- build:     PASS
- tests:     PASS (66/66)
- browser:   N/A
- deploy:    NOT RUN

FAILURES:
- none observed

UNVERIFIED:
- production deployment not verified
- browser UI not checked because no UI files changed

NEXT REQUIRED FIX:
- none


---

Minimal PARTIAL Example

STATUS: PARTIAL

OBSERVED:
- API server build passed — observed build command exit 0
- frontend build failed — observed Vite error

CHANGED FILES:
- artifacts/openclaw/src/components/CommandBar.tsx — changed default mode to dispatch

COMMANDS RUN:
- pnpm run typecheck → exit 0
- PORT=3000 BASE_PATH=/ pnpm --filter @workspace/openclaw run build → exit 1

VERIFICATION:
- install:   NOT RUN
- typecheck: PASS
- build:     FAIL
- tests:     NOT RUN
- browser:   NOT RUN — frontend build failed
- deploy:    N/A

FAILURES:
- <paste exact Vite/TypeScript error here>

UNVERIFIED:
- UI behavior not verified
- route rendering not verified

NEXT REQUIRED FIX:
- fix frontend build error, rerun frontend build, then run browser validation


---

Minimal BLOCKED Example

STATUS: BLOCKED

OBSERVED:
- protected route requires DATABASE_URL — observed server startup error
- DATABASE_URL is not set in current environment

CHANGED FILES:
- none

COMMANDS RUN:
- pnpm --filter @workspace/api-server run build → exit 0
- node artifacts/api-server/dist/index.mjs → exit 1

VERIFICATION:
- install:   NOT RUN
- typecheck: NOT RUN
- build:     PASS
- tests:     NOT RUN
- browser:   NOT RUN — server did not boot
- deploy:    N/A

FAILURES:
- <paste exact DATABASE_URL/server error here>

UNVERIFIED:
- endpoint behavior
- UI behavior
- deployment behavior

NEXT REQUIRED FIX:
- provide DATABASE_URL or start throwaway Postgres for local verification


---

Verdict Rules

PASS:
- acceptance criteria met
- required verification passed
- no hidden blocker

FAIL:
- verification ran and failed

PARTIAL:
- some work completed
- some required verification failed or remains incomplete

BLOCKED:
- cannot proceed due to missing secret, permission, network, payment, destructive-action risk, or unavailable required system

NOT VERIFIED:
- code/text/spec produced, but no execution evidence exists


---

END OF VERIFICATION LEDGER