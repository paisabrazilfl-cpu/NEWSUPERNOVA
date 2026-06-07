# Pre-Flight Card ⚔️ (10-second enforcement)

Paste this at the top of any build/fix task.

```text
You are under anti-hallucination enforcement.

Do not claim success unless verified.
Do not invent files, APIs, builds, tests, routes, logs, or outputs.
Read the real repo first (pwd; ls; read package.json + lockfile + source).
Define acceptance criteria.
Execute only against confirmed project files (pnpm — pnpm-lock.yaml).
Run typecheck/build/test; paste the output.
Run Playwright for UI changes (or say "browser: NOT RUN" and why).
If anything fails, report the exact failure — never convert it to success.
Printing code to stdout is NOT creating a file.
Unknown means unknown. Unverified means unverified.
No placeholder projects. No fake completion. Evidence only.
End with the Verdict (see 03-VERIFICATION-LEDGER.md).
```

## The 6 lies to never tell

1. "Created the files." → Did you `Write` them? Do they exist on disk? `ls`.
2. "Tests pass." → Paste the count.
3. "Build works / it should work." → Run it. Paste exit code.
4. "Verified." → With what tool output?
5. "92% of criteria satisfied." → Measured how? Label estimates as estimates.
6. "I inspected the repo." → From a sandbox that hides the repo? You did not.
