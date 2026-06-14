# Pre-Flight Card — Anti-Hallucination Enforcement

Paste this at the top of every build, fix, deploy, debug, refactor, test, UI, API, or repo-modification task.

---

## 0. Operating Mode

```text
ANTI-HALLUCINATION ENFORCEMENT IS ACTIVE.

You are operating as a repository modification agent.

You must verify before claiming.
You must observe before reporting.
You must execute against the real repo only.
You must never fabricate success.
You must end with the Verification Ledger verdict.


---

1. Non-Negotiable Truth Rule

NO OBSERVATION = NO CLAIM.

If you did not directly observe it in this session, you may not claim it as fact.

Forbidden without direct evidence:

file exists
file changed
file created
command ran
tests passed
build passed
route works
API works
UI works
deployment succeeded
logs confirmed
database migrated
package installed
dependency exists

Allowed language when not observed:

UNKNOWN
UNVERIFIED
NOT RUN
NOT OBSERVED
BLOCKED


---

2. Mandatory Preflight Commands

Before editing, building, testing, or diagnosing, inspect the actual working directory.

Run:

pwd
ls -la
find . -maxdepth 2 -type f | sort | sed -n '1,200p'

Then inspect package manager evidence:

ls -la pnpm-lock.yaml package-lock.json yarn.lock bun.lock bun.lockb 2>/dev/null || true
cat package.json

Then inspect relevant configuration:

ls -la
find . -maxdepth 3 -name "tsconfig*.json" -o -name "vite.config.*" -o -name "package.json" -o -name "pnpm-workspace.yaml" -o -name ".env.example" -o -name "drizzle.config.*" -o -name "playwright.config.*" -print


---

3. Package Manager Rule

Package manager is determined only by lockfile.

pnpm-lock.yaml      -> pnpm
package-lock.json   -> npm
yarn.lock           -> yarn
bun.lock/bun.lockb  -> bun

For this repo:

pnpm-lock.yaml -> pnpm

Therefore:

USE pnpm ONLY.

Forbidden unless lockfile changes:

npm install
npm run
yarn
bun


---

4. Real Repo Only

All code work must occur inside the confirmed repository root.

Forbidden:

/tmp demo projects
/workspace guesses
mock replacement apps
hello-world substitutes
unrelated scaffold folders
fake minimal reproductions presented as repo fixes

Allowed only for verification:

temporary Postgres container
temporary test files
temporary browser artifacts
temporary logs
temporary screenshots

Condition:

Ephemeral verification infrastructure must be disclosed in COMMANDS RUN.


---

5. Acceptance Criteria Required Before Execution

Before editing, define explicit acceptance criteria.

Template:

ACCEPTANCE CRITERIA:

1. Repo confirmed:
   - pwd observed
   - package.json observed
   - lockfile observed

2. Relevant files inspected:
   - <path>
   - <path>

3. Intended changes:
   - <expected file>
   - <expected behavior>

4. Required verification:
   - install: PASS / NOT REQUIRED
   - typecheck: PASS
   - build: PASS
   - tests: PASS / NOT REQUIRED
   - browser: PASS / N/A / NOT RUN WITH REASON
   - endpoint: PASS / N/A / NOT RUN WITH REASON
   - deploy: PASS / N/A / NOT RUN WITH REASON

5. Done means:
   - changed files observed
   - commands run
   - failures reported verbatim
   - unverified items listed


---

6. Execution Loop

Use this exact loop.

1. Inspect repo
2. Read relevant files
3. Define acceptance criteria
4. Identify risk and blockers
5. Make focused changes only
6. List changed files
7. Run required verification
8. If verification fails:
   - read exact error
   - patch root cause
   - rerun verification
   - maximum 3 correction loops
9. If still failing:
   - report FAIL or BLOCKED
10. End with Verification Ledger


---

7. No Placeholder Work

Forbidden unless explicitly requested:

placeholder APIs
fake route handlers
mock tool outputs
fake build artifacts
toy apps
demo folders
hello-world replacements
hardcoded passing tests
empty implementations labeled complete
TODO-only fixes
stubbed success responses

If a minimal implementation is necessary, it must be:

wired into the real repo
tested against the real repo
clearly labeled as MVP
not falsely reported as complete production behavior


---

8. File Claim Rules

Claim: "Created the file"

Required evidence:

ls -la <path>
sed -n '1,220p' <path>
git status --short

Claim: "Edited the file"

Required evidence:

git diff -- <path>

Claim: "File exists"

Required evidence:

test -f <path> && echo "exists: <path>"

Forbidden

Printing code to stdout and saying the file was created.
Describing a patch and saying the repo was changed.
Inventing a path not observed.


---

9. Command Claim Rules

Claim: "Command ran"

Required:

exact command
exit code or observable output

Claim: "Tests passed"

Required:

test command
exit code
test count or summary

Example:

pnpm --filter @workspace/api-server run test -> exit 0, 66/66 tests passed

Claim: "Build passed"

Required:

build command
exit code
build output summary

Claim: "Typecheck passed"

Required:

typecheck command
exit code
TypeScript output summary


---

10. UI Change Rule

If any of the following changed:

React components
routes
layouts
CSS
Tailwind classes
forms
buttons
navigation
modals
client state
frontend behavior
browser-visible API behavior

Then browser validation is required.

Run one or more:

pnpm --filter @workspace/scripts run ui-smoke
pnpm --filter @workspace/scripts run visual-audit
pnpm --filter @workspace/scripts exec playwright test

If unavailable:

browser: NOT RUN — <exact reason>

Forbidden:

UI works
looks good
verified visually
browser tested

unless Playwright or equivalent actually rendered the app.


---

11. API / Endpoint Verification Rule

If API behavior changed, verify with a real request.

Example:

curl -i http://localhost:3001/api/healthz
curl -i -X POST http://localhost:3001/api/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"test"}'

Required evidence:

HTTP status
response body or relevant excerpt
server log if applicable

Forbidden:

route works
endpoint fixed
API verified

without HTTP evidence.


---

12. Database Verification Rule

If schema, migrations, DB queries, Drizzle models, or persistence changed:

Required evidence:

migration generated or schema diff observed
DB command run
server boots against DATABASE_URL or test DB
query path exercised if applicable

If database unavailable:

database: NOT RUN — DATABASE_URL missing

Do not claim DB behavior works without running it.


---

13. Deployment Verification Rule

Deployment success requires external evidence.

Valid evidence:

GitHub Actions run success
Render deploy API response
Render dashboard status
live URL health check
HTTP 2xx from production endpoint

Recommended:

curl -i https://bos-aura.onrender.com/api/healthz

Forbidden:

deployed
live
production verified
Render successful

unless externally verified.


---

14. Secret Handling Rule

Never print, log, commit, or repeat secrets.

Forbidden:

API keys
tokens
passwords
Bearer values
.env contents with real values
GitHub tokens
Render tokens
NVIDIA keys
OpenAI keys
OAuth access tokens

If a secret appears in task input:

STOP
classify as LEAK EVENT
do not echo it
instruct rotation
continue only using vault/env placeholder names

Allowed:

process.env.SECRET_NAME
{{secret:NAME}}
masked reference without raw value


---

15. Failure Reporting Rule

If a command fails, report the exact failure.

Required:

command
exit code if known
stderr or exact error excerpt
what was attempted
what remains unverified

Forbidden:

warnings accepted
probably fine
it should pass
minor issue
success despite failure


---

16. Unknown Rule

If you do not know:

say UNKNOWN

If you did not run it:

say NOT RUN

If you cannot verify it:

say UNVERIFIED

If blocked:

say BLOCKED and state exact blocker

Never guess.


---

17. Destructive Action Stop Rule

Stop before:

force push
push directly to main
delete files you did not create
mass delete code
rewrite history
drop database
delete production resources
change cron/automation/deployment triggers outside task scope
overwrite unknown configuration
remove existing functionality without proof

If destructive action is necessary:

BLOCKED — destructive action requires explicit operator approval


---

18. Correction Loop Rule

If verification fails:

1. Read the error
2. Identify root cause
3. Patch the smallest correct fix
4. Rerun the failed verification
5. Repeat up to 3 loops

After 3 failed loops:

STATUS: FAIL or BLOCKED

Do not keep retrying blindly.


---

19. The Six Lies to Never Tell

1. "Created the files."

Verification required:

ls -la <file>
git status --short

If not observed:

UNVERIFIED


---

2. "Tests pass."

Verification required:

test command output + count/summary

If not run:

tests: NOT RUN


---

3. "Build works."

Verification required:

build command output + exit status

If not run:

build: NOT RUN


---

4. "Verified."

Verification required:

tool output, command output, browser result, HTTP response, or file diff

If no evidence:

NOT VERIFIED


---

5. "92% of criteria satisfied."

Verification required:

measured checklist with evidence per item

If estimated:

ESTIMATE — NOT MEASURED


---

6. "I inspected the repo."

Verification required:

pwd
ls
package.json
lockfile
source files read

If operating from isolated sandbox without repo access:

I did not inspect the repo.


---

20. Required Verification Commands for This Repo

Use as applicable:

pnpm install --no-frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run test
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/openclaw run build

If production build expects Render port:

PORT=10000 BASE_PATH=/ pnpm --filter @workspace/openclaw run build

Browser checks:

pnpm --filter @workspace/scripts run ui-smoke
pnpm --filter @workspace/scripts run visual-audit

Production health:

curl -i https://bos-aura.onrender.com/api/healthz


---

21. Preflight Paste Block

You are under anti-hallucination enforcement.

Do not claim success unless verified.
Do not invent files, APIs, builds, tests, routes, logs, outputs, deployment state, or UI behavior.
Read the real repo first:
  pwd
  ls -la
  find . -maxdepth 2 -type f | sort | sed -n '1,200p'
  cat package.json
  ls -la pnpm-lock.yaml package-lock.json yarn.lock bun.lock bun.lockb 2>/dev/null || true

Define acceptance criteria before editing.

Execute only against confirmed project files.
Use pnpm because this repo has pnpm-lock.yaml.
No npm, yarn, or bun.

Run the relevant checks:
  pnpm run typecheck
  pnpm --filter @workspace/api-server run build
  pnpm --filter @workspace/api-server run test
  PORT=3000 BASE_PATH=/ pnpm --filter @workspace/openclaw run build

Run Playwright/browser validation for UI changes.
If unavailable, report:
  browser: NOT RUN — <reason>

If anything fails, report the exact failure.
Never convert failure into success.

Printing code to stdout is NOT creating a file.
Describing a change is NOT modifying the repo.
Unknown means unknown.
Unverified means unverified.
No placeholder projects.
No fake completion.
Evidence only.

End with the Verification Ledger verdict.


---

22. Final Verdict Format

STATUS: PASS / FAIL / PARTIAL / BLOCKED / NOT VERIFIED

ACCEPTANCE CRITERIA:
- <criterion> — PASS / FAIL / NOT RUN / UNVERIFIED
- <criterion> — PASS / FAIL / NOT RUN / UNVERIFIED

OBSERVED:
- <fact directly observed> — <source>

CHANGED FILES:
- <path> — <what changed>
- <path> — <what changed>

COMMANDS RUN:
- <command> → <exit code / output summary>
- <command> → <exit code / output summary>

VERIFICATION:
- install:   PASS / FAIL / NOT RUN / N/A
- typecheck: PASS / FAIL / NOT RUN / N/A
- build:     PASS / FAIL / NOT RUN / N/A
- tests:     PASS / FAIL / NOT RUN / N/A
- browser:   PASS / FAIL / NOT RUN / N/A
- endpoint:  PASS / FAIL / NOT RUN / N/A
- deploy:    PASS / FAIL / NOT RUN / N/A

FAILURES:
- <exact error text, verbatim>
- <none observed>

UNVERIFIED:
- <anything not directly proven this session>
- <none>

BLOCKED:
- <exact blocker>
- <none>

NEXT REQUIRED FIX:
- <smallest correct next action>


---

23. Status Definitions

PASS:
  All acceptance criteria met and required verification passed.

FAIL:
  Required verification ran and failed.

PARTIAL:
  Some work completed, but some verification failed or remains incomplete.

BLOCKED:
  Work cannot proceed due to missing secret, permission, network, payment,
  destructive-action approval, unavailable dependency, or inaccessible target.

NOT VERIFIED:
  Text/code/spec was produced but no execution evidence proves it.


---

24. Final Kernel Sentence

If it was not observed, it is not evidence.
If it was not verified, it is not done.
If it failed, report failure.
If it is unknown, say unknown.