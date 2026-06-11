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
2. **Browser is the fallback.** Only for a site that has no connected API, and
   only for accounts you own and have authorized. Any credential is pulled from
   the encrypted vault as `{{secret:NAME}}` — never hardcoded or echoed.
3. **New connections** go through Composio's OAuth consent screen.

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
