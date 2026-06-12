# Anti-hallucination (evidence discipline)

The agent kernels carry a hard rule against fabricating creation/inspection/results.

## Where it lives in code
- `ANTI_HALLUCINATION_DIRECTIVE` in `artifacts/api-server/src/routes/ai.ts`.
- Appended to every agent system prompt: chat (`ai.ts`), orchestration
  (`orchestrator.ts`, `const system = persona + toolGuide + ANTI_HALLUCINATION_DIRECTIVE`),
  and the external OpenAI-compatible API (`external.ts`).
- Full rule sets: `docs/anti-hallucination/`.

## The incident that motivated it
A "self-test the build" directive was dispatched to the swarm. The agents'
`code_exec` sandbox is namespace-isolated and **cannot see the app repo**, so
they found an empty dir and **fabricated** `src/runtime/*.ts` files (printed to
stdout, never written) and declared them "all created and verified," plus a fake
"92.3% criteria satisfied" matrix. None of it was real.

## Hard truths the agents must respect
- `code_exec` / `cloud_code_exec` run in an isolated sandbox with **no access to
  the repository or filesystem** (HOME=/tmp/clawexec-*). There is **no tool** for
  agents to read or write project files.
- Therefore the runtime swarm **cannot** inspect, build, test, or modify this
  codebase. Such requests must be answered with "cannot from this environment,"
  not invention.
- Printing code to stdout ≠ creating a file. Describing a test ≠ running it.

## What IS real (verified behaviors, do not doubt these)
- SSRF guard blocks loopback/link-local/private/metadata IPs (127.0.0.1,
  169.254.169.254, 10/8, 192.168/16, 0.0.0.0, [::1]).
- `vault_list` returns secret NAMES only, never values.
- `cloud_code_exec` honestly reports when the E2B SDK is absent.
- Memory write→search round-trips (semantic when EMBEDDINGS_API_KEY is set, else keyword).

## The solution gate must not pressure fabrication (2026-06-12)
In the osint-hub audit run the CLAWs held evidence discipline (404s reported
verbatim, blocks reported as blocks, UNVERIFIED labelled), but the SOLUTION
GATE verifier failed the briefing for "not inspecting the local
/workspace/osint-hub" — a thing the sandbox cannot do — and for "deferring to
the operator instead of forcing the result". That verdict demanded the exact
behavior the kernel forbids. `SOLUTION_GATE_DOCTRINE` (orchestrator.ts) now
states: verified impossibility / an operator-only blocker backed by tool
evidence IS a solution, and corrective directives must be executable with the
swarm's real tools (never "clone/inspect/build local files"). Asserted by
orchestrator.solve.test.ts.
