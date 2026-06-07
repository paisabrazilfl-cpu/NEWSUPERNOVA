# Verification Ledger & Verdict Format ⚔️

Use this to report any build/test/change. Evidence only. If a line has no
command output behind it, it is `UNVERIFIED` or `NOT RUN` — never `PASS`.

## Final Verdict (copy/paste template)

```text
STATUS: PASS / FAIL / PARTIAL / BLOCKED

OBSERVED:
- <facts you directly saw, with where>

CHANGED FILES:
- <path> — <what changed>

COMMANDS RUN:
- <command> → <exit/summary>

VERIFICATION:
- install:  PASS / FAIL / NOT RUN
- typecheck: PASS / FAIL / NOT RUN
- build:    PASS / FAIL / NOT RUN
- tests:    PASS / FAIL / NOT RUN   (include count, e.g. 52/52)
- browser:  PASS / FAIL / NOT RUN   (N/A if no UI change)

FAILURES:
- <exact error text, verbatim>

UNVERIFIED:
- <anything not directly proven this session>

NEXT REQUIRED FIX:
- <smallest correct next action>
```

## Evidence rules

- **PASS** requires pasted output (a test count, an exit code, an HTTP status, a
  file diff). "It should pass" is `NOT RUN`.
- **A green typecheck/build is not proof a feature works** — it proves it
  compiles. Say which is which.
- **UI changes** require browser validation (Playwright/equivalent). If the
  environment has no browser, record `browser: NOT RUN` and say why — do not
  claim the UI works.
- **Ephemeral verification infra** (e.g. a throwaway Postgres started only to run
  the server) is allowed, must be torn down, and must be disclosed in
  `COMMANDS RUN`. The code under test stays in the real repo.

## This repo's verify commands (pnpm)

```bash
pnpm install --no-frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/openclaw run build   # PORT=3000 BASE_PATH=/ required
```
