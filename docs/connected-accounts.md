# Operating your accounts — Composio + browser, with a hard safety guardrail

The swarm can operate your connected accounts end-to-end (Gmail and every
Composio app), choosing the right tool automatically, with a guardrail it can
never override.

## How it negotiates (Composio first, browser fallback)

`ACCOUNT_POLICY_DOCTRINE` (in `routes/ai.ts`) is part of ABBY's planner and every
agent's prompt:

1. **Prefer the API.** If an action can run through a connected Composio app
   (Gmail, Calendar, Sheets, Slack, GitHub, Notion, Instagram, …), it uses
   `composio_apps` → `composio_action` / `instagram_post`. OAuth-based, reliable,
   no passwords.
2. **Browser is the hard fallback (on Steel).** For a site with no connected
   API, the `browser_login` tool runs a browser on **Steel** (managed, stealth,
   residential proxy + CAPTCHA-solving) and logs in **as you** using credentials
   from the vault, then performs the task. Details below.
3. **New connections / signups.** It can connect existing apps via OAuth and
   sign up for ordinary online services (newsletters, SaaS, dev tools) on your
   behalf. Financial accounts and government-ID submission are hard-blocked.

## Browser login fallback (operate sites with your login)

For any site without an API, the swarm uses `browser_login`:

1. **Store the credentials in the vault** (Settings → vault), e.g.
   `MYSITE_EMAIL` = your username and `MYSITE_PASSWORD` = your password.
   Never put a password in chat — only the vault.
2. The swarm calls `browser_login` with the **vault names** (not the values):
   `url`, `username_secret: "MYSITE_EMAIL"`, `password_secret: "MYSITE_PASSWORD"`,
   and optional Playwright `steps` to do the task after login.
3. A Steel-hosted browser logs in and runs the steps; credentials and the Steel
   key are injected just-in-time and redacted from all output. The session runs
   single-use and is released immediately after.

**How it runs:** the browser lives on Steel (so it gets stealth, a residential
proxy, and CAPTCHA-solving); Playwright connects to it over CDP from the E2B
sandbox, which only needs `pip install playwright` — no local Chromium. Requires
`STEEL_API_KEY` and `E2B_API_KEY` (both set).

**Limit:** sites that force a 2FA challenge may still stop an automated login.
For Google/Gmail specifically, prefer the Composio OAuth connector above.

## Connecting Gmail / Google (the safe way — no stored password)

Do this once, in the dashboard:

1. Settings → Integrations → Composio.
2. Connect **Gmail** (and Calendar, etc.). You'll be sent to Google's real OAuth
   consent screen; approve the scopes.
3. Back in the app, the connection shows **live**. The swarm can now read/send/
   draft mail on your behalf via the API.

`ALLOW_COMPOSIO_EXECUTE=true` must be set on the server (it is) for actions to run.

> Do NOT put a Google password in chat, code, or the vault. Automated
> password-login to Google violates Google's policy and gets accounts flagged —
> OAuth above is the supported path.

## The hard guardrail (enforced in code, not just prompt)

`lib/safetyPolicy.ts` `assessActionRisk()` is checked before any goal is
dispatched (`orchestrateGoal`) **and** before any `composio_action` runs. Two
categories are blocked no matter what is asked:

- **Financial account opening** — bank, brokerage, trading, credit/debit card,
  loan, mortgage, payment processor, or crypto-exchange accounts.
- **Government ID / KYC identity** — submitting/entering an SSN, passport,
  driver's license, national/tax ID, birth certificate, or immigration documents.

It targets the *action*, so ordinary work is unaffected — "email my bank
statement" or "write a post about social security" are allowed; "open a bank
account" or "enter my SSN" are blocked with a clear refusal in the feed.

Everything else runs end-to-end without a pause-for-approval step.
