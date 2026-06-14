# Execution Rule Set — Dev Agent

Binding rules for any AI agent modifying this repository.

---

## ANTI-HALLUCINATION EXECUTION RULES

```text
1. DIRECT OBSERVATION ONLY

   Never claim that a file, repo, command, dependency, API, route, build,
   test, feature, result, deployment, or UI state exists unless it was directly
   observed in the current session.

   If not observed, say:
   UNKNOWN
   NOT VERIFIED
   NOT RUN

2. PREFLIGHT BEFORE ACTION

   Before modifying or executing repo work, inspect the real working directory:

     pwd
     ls -la
     find . -maxdepth 2 -type f | sort
     cat package.json
     ls -la pnpm-lock.yaml package-lock.json yarn.lock bun.lock bun.lockb 2>/dev/null || true

   Then inspect the relevant source files before editing.

3. ACCEPTANCE CRITERIA FIRST

   Before execution, define what success requires.

   For code tasks, include:
   - files expected to change
   - behavior expected to exist
   - commands that must pass
   - UI/browser validation required or not required
   - deployment verification required or not required

4. USE THE REAL REPO ONLY

   Work only inside the confirmed target repository.

   Do not switch to:
   - /tmp
   - /workspace
   - random generated folders
   - mock apps
   - demo projects

   Exception:
   Ephemeral verification infrastructure is allowed only when explicitly tied to
   testing the real repo and must not replace repo execution.

5. PACKAGE MANAGER FROM LOCKFILE

   Determine package manager from lockfile:

     pnpm-lock.yaml      -> pnpm
     package-lock.json   -> npm
     yarn.lock           -> yarn
     bun.lock/bun.lockb  -> bun

   This repo uses:

     pnpm

   Never use npm, yarn, or bun in this repo unless the lockfile changes.

6. NO PLACEHOLDER WORK

   Do not create:
   - hello-world substitutes
   - unrelated demo folders
   - fake minimal apps
   - mock implementations
   - placeholder APIs
   - pretend build outputs

   unless the operator explicitly asks for a demo or scaffold.

7. NO SUCCESS WITHOUT VERIFICATION

   Success requires observed evidence.

   Required evidence may include:
   - changed files listed
   - exact commands run
   - command exit results
   - test/build/typecheck output
   - endpoint responses
   - Playwright/browser validation for UI changes
   - deployment health check if deployment was part of the task

8. FAILURE IS FAILURE

   If a command fails, times out, errors, or returns unexpected output,
   report it exactly.

   Never convert:
   - warnings into success
   - failed tests into acceptable success
   - missing tools into completed work
   - unverified assumptions into facts

9. UNKNOWN MEANS UNKNOWN

   If something was not inspected or verified, state:

     UNKNOWN
     NOT VERIFIED
     NOT RUN

   Never guess.

10. UI CHANGE RULE

   If frontend behavior, HTML, CSS, routing, layout, visual state, or browser
   interaction changes, run browser validation with Playwright or equivalent.

   If browser validation cannot run, report:

     browser: NOT RUN — <exact reason>

   Do not claim the UI works unless it was rendered and checked.

11. REPORT ONLY OBSERVED FACTS

   Final reports must use the verification-ledger format:

     Changed:
     - ...

     Commands Run:
     - ...

     Verified:
     - ...

     Failed:
     - ...

     Not Run:
     - ...

     Blocked:
     - ...

   Do not include unverified claims.

12. BLOCKERS STOP EXECUTION

   Stop and report the blocker if blocked by:
   - missing secrets
   - missing credentials
   - permission denial
   - payment/billing limits
   - unavailable network
   - destructive action risk
   - ambiguous target repo/account
   - command failure that repeats after one corrective attempt

13. DESTRUCTIVE CHANGE STOP RULE

   Stop before:
   - deleting files you did not create
   - overwriting unknown files
   - force pushing
   - pushing directly to main
   - removing large code blocks without proving they are obsolete
   - changing deployment or cron behavior without explicit task scope

14. BRANCH DISCIPLINE

   For pushed code work:

     git checkout main
     git pull origin main
     git checkout -b <date>-<what-changed>

   Branch name must encode:
   - date
   - purpose of change

   Never push directly to main unless explicitly instructed by the operator and
   repository policy allows it.

15. VERIFY BEFORE MERGE OR DEPLOY

   Before merge/deploy, run the relevant checks:

     pnpm run typecheck
     pnpm --filter @workspace/api-server run build
     pnpm --filter @workspace/api-server run test
     PORT=10000 BASE_PATH=/ pnpm --filter @workspace/openclaw run build

   UI changes require Playwright/browser validation.

16. BUILD IS NOT FEATURE PROOF

   A green typecheck/build proves only:
   - TypeScript compiled
   - bundling completed

   It does not prove:
   - feature correctness
   - UI usability
   - endpoint behavior
   - deployment success

17. TESTS ARE SCOPED EVIDENCE

   Passing tests prove only what those tests cover.

   Report test evidence precisely:
   - test command
   - pass/fail
   - count/summary if available

18. DEPLOYMENT TRUTH

   Deployment success requires external verification.

   Valid evidence:
   - deployment API response
   - Render/GitHub Actions success logs
   - live endpoint returning expected HTTP status/body

   A successful build is not a deployment.

19. TOOL OUTPUT IS GROUND TRUTH

   Tool output from this session overrides assumptions.

   If documentation, memory, or expectation conflicts with observed output,
   observed output wins.

20. FINAL VERDICT MUST BE HONEST

   Allowed verdicts:

     PASS
     FAIL
     BLOCKED
     PARTIAL
     NOT VERIFIED

   Forbidden verdicts:

     should work
     likely works
     probably fixed
     assumed complete