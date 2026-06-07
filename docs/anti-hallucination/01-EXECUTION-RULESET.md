# Execution Rule Set (Dev Agent) ⚔️

Binding rules for any agent that builds or modifies this repository.

```text
ANTI-HALLUCINATION EXECUTION RULES

1.  NEVER claim a file, repo, command, test, build, API, dependency, route,
    feature, or result exists unless DIRECTLY OBSERVED this session.

2.  BEFORE acting, inspect the real working directory:
      pwd ; ls -la ; read package.json / lockfiles / config ; read the source tree.

3.  DEFINE acceptance criteria BEFORE execution.
    For "build X": list what must exist and what must pass.

4.  NO fake placeholder work. Do not create unrelated demo folders, minimal
    projects, mock apps, or "hello world" substitutes unless explicitly asked.

5.  NO success without verification. Success requires evidence:
    changed files listed · install/build/test output · UI validation when UI
    changed · exact command results.

6.  IF a command fails or times out, report it EXACTLY. Never convert failure
    into success.

7.  IF unsure, say "Unknown / not verified." Never guess.

8.  USE the real repo only. Do not switch to /tmp, /workspace, or another
    directory unless confirmed as the target repo. (Ephemeral test infra — e.g.
    a throwaway Postgres — is allowed ONLY for verification and must be torn
    down; the code under test stays in the real repo.)

9.  PACKAGE MANAGER from lockfile:
      pnpm-lock.yaml → pnpm | package-lock.json → npm | yarn.lock → yarn | bun.lock(b) → bun
    THIS REPO: pnpm-lock.yaml → pnpm.

10. UI CHANGE RULE: if HTML/CSS/JS/frontend behaviour changed, run browser
    validation (Playwright or equivalent). If unavailable, say "browser: NOT RUN"
    and state why — do not claim the UI works.

11. REPORT ONLY OBSERVED FACTS (use the Verdict format, doc 03):
    files changed · commands run · pass/fail · exact errors · unverified items.

12. IF blocked by secrets, permissions, network, payment, or destructive action:
    STOP and report the exact blocker.
```

## Honesty calibration

- "It should work" → **forbidden.** Either you ran it (`PASS`) or you didn't (`NOT RUN`).
- "Tests pass" with no output → **forbidden.** Paste the count/summary.
- Deleting/overwriting a file you didn't create or can't explain → **STOP** (Rule 12).
- A green typecheck/build is **not** proof the feature works — it's proof it compiles. Say so.
