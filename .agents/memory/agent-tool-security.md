---
name: agent tool security
description: Security posture for the autonomous CLAW agent tools (http_request, code_exec).
---

# Autonomous agent tool security

The CLAW agents call real server-side tools via OpenRouter function-calling. Two
tools carry real risk and must keep their guards:

- **http_request** — runs outbound from the server runtime, so it needs an SSRF
  guard. We resolve DNS and block loopback, link-local (incl. the
  `169.254.169.254` cloud-metadata endpoint), and private/reserved ranges, plus
  `localhost`/`.internal`/`.local` hostnames. CRITICAL: validating only the
  initial URL is NOT enough — `fetch` follows redirects by default, so an
  open-redirect can bounce to an internal target. Use `redirect: "manual"` and
  re-run `ssrfGuard` on every `Location` hop. web_scrape/web_screenshot go out
  through Steel's infra (not our server) so they don't need this.
- **code_exec** — sandboxed via unshare (net+mount) with a tmpfs hiding the repo,
  fail-closed; see `code-exec-sandbox.md` for the isolation contract. Do NOT
  weaken it by giving agents repo read/write or shell tools (see below).
- **calculator** — evaluates arithmetic via `new Function`, but only after a
  strict char whitelist (`[-+*/%.()0-9eE\s]`) + length cap, so no identifier or
  global is reachable. Never relax the whitelist to allow letters/identifiers.
- **send_message** — channel target comes ONLY from server-provided ToolContext
  (`ctx.channelId`), never from tool args, so an agent can't post into arbitrary
  channels. Keep channel/agent routing context-derived for any new write tool.

**Why:** an architect review FAILed an earlier version on SSRF + non-isolated code
exec; the whole point of the hardening is that autonomous LLM agents are untrusted.
**How to apply:** any new URL-taking tool must route through `ssrfGuard`; any new
write tool must take its target from ToolContext, not model args; any new
eval/exec tool must be sandboxed or whitelisted — all in
`artifacts/api-server/src/tools.ts`.
