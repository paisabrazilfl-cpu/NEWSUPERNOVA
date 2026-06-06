---
name: social-connectors
description: How agents reach official social-platform APIs via Replit-managed OAuth (no passwords, no browser login).
---

# Social platform API access

The safe/legal path for agents to act on a user's social account is **official
APIs via Replit-managed OAuth connectors** — never browser username/password
login (ToS violation + account-ban risk, even for an owned/experimental account;
this was firmly declined multiple times).

## Decision

- Browser credential login automation: **refused**, regardless of ownership.
- Official API + OAuth: the supported path. User authorizes their own account
  once; Replit's connector proxy mints short-lived tokens at request time.

**Why:** platforms prohibit automated credential login; ownership doesn't change
the ToS or the ban risk. The connector proxy keeps tokens out of our DB and out
of the model context entirely.

## How to apply

- Catalog connectors exist for: instagram, facebook, x, reddit, youtube,
  tiktok-personal. **LinkedIn has NO first-party account connector** — only
  third-party prospecting tools (ContactOut/HeyReach/Wiza). Don't promise it.
- Token fetch = Replit connector proxy: GET
  `https://${REPLIT_CONNECTORS_HOSTNAME}/api/v2/connection?include_secrets=true&connector_names=<name>`
  with header `X_REPLIT_TOKEN: repl <REPL_IDENTITY>` (or `depl <WEB_REPL_RENEWAL>`).
  Token is at `items[0].settings.access_token` or
  `items[0].settings.oauth.credentials.access_token`.
- These are `connector_catalog/requires_setup` → drive setup with
  `proposeIntegration(id)`, which **exits the agent loop** (one platform per
  turn; verify/next-platform happen on later turns).
- Agent surface: `social_accounts` (lists connected platforms) and `social_api`
  (calls the official API). Both scrub the token from any echoed response.
  Granted to ABBY (all), CRAWLER(3), WIRE(5), MR.NICE(6).
