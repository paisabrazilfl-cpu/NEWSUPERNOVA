# Agentic Source-Grounded Orchestration

The runtime strategy OPENCLAW OMEGA uses: an AI orchestrator inspects the goal,
propagates the operator's real source material through the orchestrator into every
worker agent's prompt, prevents hallucinated execution, and verifies the result.

**Full name:** Agentic Software Engineering with Source-Grounded Context Propagation.

## Why it exists

Failure mode it fixes: the operator pastes a document and says "build a deck/report
from THIS," but the worker agents (CLAWs) only received a one-line directive — never
the document. They `memory_search` for it (empty), then navel-gaze or fabricate
placeholder output. The cause is a **context loss point** between the chat layer and
the agent runtime.

## The pattern: Trace-Driven Context Propagation

```
operator pasted content
  → chat handler (routes/ai.ts)
  → sourceContext
  → orchestrateGoal()                  ← ABBY planning prompt hydrated with source
  → dispatchDirectives()
  → executeAgentCommand()              ← each CLAW's prompt hydrated with source
  → CLAW execution (grounded, not guessing)
  → coordinator review + final synthesis
  → verification + grounding logs
```

`sourceContext` is threaded through `orchestrateGoal → dispatchDirectives →
executeAgentCommand` (optional param) and embedded in both ABBY's planning prompt
and every CLAW's execution prompt as the **primary input** ("build from it; do NOT
memory_search for it"). Bounded for context size.

## Grounding proof (observability)

`lib/grounding.ts#groundingProof()` logs that the material reached each stage —
**length + a short sha256 hash only, never the raw content** — so grounding is
provable without leaking sensitive material:

```
{ phase: "abby-planning", received: true, chars: 12482, hash: "sha256:8f91..." }   // orchestration grounding
{ claw: "CRAWLER",        received: true, chars: 12482, hash: "sha256:8f91..." }   // claw dispatch grounding
```

## Guardrails that ride on top

- **No-source-no-claim / evidence discipline** (`ANTI_HALLUCINATION_DIRECTIVE`).
- **No navel-gazing**: `isInternalMeta` filters the swarm's own self-audit/vault
  entries out of `memory_search`, and the doctrine forbids reporting on the swarm
  itself.
- **Deliverables, not descriptions**: `save_artifact` produces real download links.
- **Verify before done**: ABBY's coordinator-review round + definition-of-done.

## Vocabulary

Context Propagation · Source Context Injection · Prompt Hydration · Grounding ·
Evidence-Bound Dispatch · Trace-Driven Execution · Grounding Proof · Context Hash ·
Context Integrity Check · Plan-Act-Observe-Verify (ReAct).
