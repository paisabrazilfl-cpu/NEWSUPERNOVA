# Agent Runtime Rules (the "Kernel") ⚔️

These rules are **enforced in code**: they are appended to every CLAW agent's
system prompt via `ANTI_HALLUCINATION_DIRECTIVE` in
`artifacts/api-server/src/routes/ai.ts`, and injected into the chat route, the
orchestrator (`orchestrator.ts`), and the external OpenAI-compatible API
(`external.ts`).

## Why this exists (a real incident)

A "self-test this build" directive was dispatched to the swarm. Because the
agents' `code_exec` sandbox is namespace-isolated and **cannot see the app
repository**, they found an empty working dir — and then **fabricated** an
entire `src/runtime/*.ts` architecture, `print()`-ing file contents to stdout
and declaring them *"all created and verified."* None of those files existed.
Another agent reported a *"92.3% criteria satisfied"* matrix that was never
measured.

That is hallucinated creation and code. These rules stop it.

## The kernel directive (verbatim)

```text
EVIDENCE DISCIPLINE (non-negotiable):
- Never claim a tool ran, a file/record/URL exists, or an action (creating a
  file, writing code, passing a test, building, deploying) succeeded UNLESS a
  tool result in THIS conversation proves it. Printing text to stdout is NOT
  creating a file. Describing code is NOT writing it to the project.
- Your code_exec / cloud_code_exec sandbox is ISOLATED and CANNOT see the
  application's repository or filesystem, and you have NO tool to read or write
  project files. If asked to inspect, build, test, or modify the codebase, state
  plainly that you cannot do so from this environment — do not invent file paths,
  file contents, build output, or results.
- If a tool fails or returns an error, report it verbatim. Never convert a
  failure into success.
- If something is not verified, say "unverified" or "unknown". Never guess and
  present it as fact. Any estimate, score, or matrix you produce must be labelled
  as an estimate — never reported as a measured result.
```

## What agents CAN truthfully do (their real, observed capabilities)

| Capability | Tool | Grounded by |
|---|---|---|
| Search the live web | `web_search` (Tavily→Exa→Firecrawl) | real provider responses |
| Read a page | `web_scrape` / `web_screenshot` (Steel) | real fetched content |
| Call any public API (SSRF-guarded) | `http_request` | real HTTP response |
| Run isolated code (NO repo access) | `code_exec` / `cloud_code_exec` | stdout/stderr/exit code |
| Persist & recall shared memory | `memory_write` / `memory_search` | DB rows |
| List secret NAMES (never values) | `vault_list` | DB |
| Call connected social APIs | `social_api` / `social_accounts` | OAuth proxy |
| Post to the feed | `send_message` | DB row |
| Arithmetic | `calculator` | evaluated value |

**They CANNOT:** read or write the project's source files, run `npm`/`pnpm`/`tsc`
against the repo, or inspect the build. A "self-test the build" mission is
therefore out of scope for the runtime swarm unless a dedicated, sandboxed
repo-read tool is added by the operator.
