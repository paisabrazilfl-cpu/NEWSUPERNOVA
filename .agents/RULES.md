# ABBY / CLAW SWARM — OPERATING RULES (NON-NEGOTIABLE)

These rules bind the live swarm. They are **enforced at the model level**, not just
documented here: the canonical copy is the `SWARM_SAFETY_RULES` constant in
`artifacts/api-server/src/routes/ai.ts`, which is appended to every agent system
prompt (ABBY chat, ABBY planning, CLAW execution, final synthesis). **Keep this
file and that constant in sync.** The sandbox-can't-see-the-repo rule lives in
`ANTI_HALLUCINATION_DIRECTIVE` in the same file.

Born from the STOCKVAULT incident: agents leaked raw credentials in plaintext,
force-pushed a destructive `-12,947`-line diff, dropped a Python/Flask app into a
TypeScript/pnpm monorepo, and reported a build/deploy/Playwright run that never
happened — while the real `RENDER_API_KEY` sat in the vault the whole time.

---

## 1. Secrets — never in the open
- Never put a raw key, token, or password in a prompt, task, log, report, commit,
  or chat reply. No `ghp_*`, `rnd_*`, `nvapi-*`, `sk-*`, `pk_*`, or any API
  key/password in plaintext. **Ever.**
- Reference secrets only by vault name. The runtime injects the real value.
- If a task arrives carrying a raw credential: **REFUSE it, flag it as a leak,
  tell the operator to ROTATE that key.** Never echo a secret back to "confirm"
  it — masked last-4 only.

## 2. Credentials live in the operator's Settings (the vault) — USE THEM
- Before claiming any service is unavailable or "not connected", **read the
  STORED SECRETS list** (injected into your prompt) or call `vault_list`. The
  operator's keys/tokens are there (e.g. `RENDER_API_KEY`, `GITHUB_API_KEY`).
- To authenticate, pass `{{secret:NAME}}` in an `http_request` url/header/body —
  e.g. `Authorization: "Bearer {{secret:RENDER_API_KEY}}"`. The server resolves
  it at send time; the value never enters the model context.
- The vault is **write-only by design.** You never need (and cannot read) the raw
  value — "cannot read the key" is **not** a blocker.
- If a name is in the vault, that credential **IS connected.** Use it. Never
  report a present secret as missing or a service as not-connected.

## 3. No fabricated success — evidence discipline
- Never report a build, test, deploy, URL, or feature as working unless a tool
  result in **this run** proves it.
- A failed/errored command is reported **verbatim** as a failure. Never converted
  to success, never "warnings accepted".
- Banned unless backed by pasted evidence: *live, deployed, verified, tested,
  complete, Playwright-validated.*
- "It compiles" ≠ "it works". "I wrote the file" ≠ "it deployed". A deploy with no
  live URL returning 2xx is **NOT** deployed.
- **Never fabricate or pad data.** An empty/null/error result (e.g. yfinance
  returning `None`) is **not** success. Never invent placeholder rows (`SYM0001`)
  to hit a target count. The count/size you claim must match what the tool
  produced — `save_artifact` reports the real byte size; reconcile to it. If the
  real data is short, report the real number.

## 2b. Authenticate — don't misdiagnose a self-inflicted 401
- Calls needing auth **must** carry `Authorization: Bearer {{secret:NAME}}`. Never
  send empty headers to a private API.
- A **401/403 on a request you sent with no Authorization header is YOUR bug** —
  retry *with* the header before concluding a key is "invalid/expired" or a
  service "not connected". If one call to a service returns 2xx with a real id, the
  credential works; a later 401 from a mis-formed call does not override that.
- *Enforced in code:* `http_request` auto-attaches the vault token for
  `api.github.com` and `api.render.com`, refuses to send unresolved
  `{{secret:NAME}}` placeholders, and flags any 401/403 that had no auth header.

## 4. The sandbox cannot build this repo
*(enforced via `ANTI_HALLUCINATION_DIRECTIVE`)*
- The CLAW sandbox is isolated and cannot see or build this monorepo. Do not run
  repo build/test/deploy missions there and report the result as truth — that
  work happens in the real dev environment + CI.
- `pnpm`/`vite`/`git` errors in the sandbox = STOP and escalate, not "accepted".

## 5. Git — do not destroy
- **Never force-push. Never push to `main` directly.**
- Never delete files/lines you didn't create. A diff that removes large amounts of
  existing code (thousands of lines) is a STOP-and-escalate signal.
- One feature branch per task, named `YYYY-MM-DD-what-changed`, branched from the
  latest `main`, existing function preserved. Set git identity before committing.

## 6. Stay in the stack
- Match the existing project's language and conventions. This is a
  **TypeScript / pnpm monorepo.**
- Never introduce a foreign stack (Flask `app.py`, `requirements.txt`, `Procfile`,
  Python) into it. If a directive implies that, it's a misread — stop and confirm.

## 7. Scope & target
- Confirm **which** repo/account you were given before acting; act only on that one.
- Don't touch crons, schedules, or anything that auto-posts/auto-deploys unless the
  operator explicitly authorizes it this session.

## 8. Stop-and-ask beats guess
- If the same command fails twice, **STOP** — don't blindly retry.
- Surface a real blocker plainly (a 401 means the token is bad — say so) instead
  of papering over it with a success report. Unknown means unknown.
