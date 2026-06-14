# Agentic Source-Grounded Orchestration

Runtime strategy for **OPENCLAW OMEGA**:

> Agentic Software Engineering with Source-Grounded Context Propagation.

This pattern ensures that when the operator provides source material, the exact material is propagated from the chat layer into ABBY planning, CLAW execution, coordinator review, artifact generation, and final synthesis.

The system must build from the provided source, not from memory guesses, prior context, empty search results, or agent self-analysis.

---

## 0. Core Definition

```text
Agentic Source-Grounded Orchestration =
  operator-provided source material
  + orchestrator-level prompt hydration
  + worker-agent source propagation
  + evidence-bound dispatch
  + grounding proof logs
  + anti-hallucination verification
  + artifact-backed deliverables


---

1. Full Name

Agentic Software Engineering with Source-Grounded Context Propagation


---

2. Short Name

Source-Grounded Orchestration


---

3. Runtime Principle

The source material is the primary input.
The source material must follow the task through every execution phase.
No agent may pretend to have source context it did not receive.


---

4. Failure Mode This Fixes

Broken flow

operator pastes document
→ chat layer sees the document
→ orchestrator receives only "build report"
→ CLAWs receive only one-line directives
→ CLAWs do memory_search
→ memory_search returns empty / unrelated content
→ CLAWs fabricate placeholder material
→ final synthesis looks polished but is ungrounded

Root cause

CONTEXT LOSS POINT

The operator-provided source existed at the chat boundary but was not passed into the agent runtime.


---

5. Hard Rule

If the task depends on operator-provided source material, every planning and execution agent must receive the sourceContext or explicitly report that it was not received.


---

6. Source Context Object

export interface SourceContext {
  raw: string;
  chars: number;
  hash: string;
  kind:
    | "pasted_text"
    | "uploaded_file"
    | "connector_doc"
    | "operator_message"
    | "system_supplied"
    | "mixed";
  title?: string;
  filename?: string;
  mimeType?: string;
  excerpt?: string;
  createdAt: string;
  bounded: boolean;
  originalChars?: number;
}


---

7. Source Context Constructor

import { createHash } from "node:crypto";

export function sha256Short(input: string, length = 12): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

export function createSourceContext(input: {
  raw: string;
  kind: SourceContext["kind"];
  title?: string;
  filename?: string;
  mimeType?: string;
  maxChars?: number;
}): SourceContext {
  const maxChars = input.maxChars ?? 60_000;
  const original = input.raw ?? "";
  const bounded = original.length > maxChars;
  const raw = bounded ? original.slice(0, maxChars) : original;

  return {
    raw,
    chars: raw.length,
    originalChars: original.length,
    hash: `sha256:${sha256Short(raw)}`,
    kind: input.kind,
    title: input.title,
    filename: input.filename,
    mimeType: input.mimeType,
    excerpt: raw.slice(0, 500),
    createdAt: new Date().toISOString(),
    bounded,
  };
}


---

8. Grounding Proof Model

export interface GroundingProof {
  phase:
    | "chat-ingest"
    | "abby-planning"
    | "directive-dispatch"
    | "claw-execution"
    | "coordinator-review"
    | "final-synthesis"
    | "artifact-save";
  received: boolean;
  chars: number;
  hash: string | null;
  bounded?: boolean;
  originalChars?: number;
  agentId?: number;
  agentName?: string;
  commandId?: number;
  artifactId?: string;
  timestamp: string;
}


---

9. Grounding Proof Function

export function groundingProof(input: {
  phase: GroundingProof["phase"];
  sourceContext?: SourceContext | null;
  agentId?: number;
  agentName?: string;
  commandId?: number;
  artifactId?: string;
}): GroundingProof {
  return {
    phase: input.phase,
    received: Boolean(input.sourceContext?.raw),
    chars: input.sourceContext?.chars ?? 0,
    hash: input.sourceContext?.hash ?? null,
    bounded: input.sourceContext?.bounded,
    originalChars: input.sourceContext?.originalChars,
    agentId: input.agentId,
    agentName: input.agentName,
    commandId: input.commandId,
    artifactId: input.artifactId,
    timestamp: new Date().toISOString(),
  };
}


---

10. Safe Grounding Log Rule

Log only:
- phase
- received boolean
- char count
- short hash
- bounded flag
- agent name/id
- timestamp

Never log:
- raw source content
- full pasted document
- secrets
- full operator message if sensitive


---

11. Grounding Log Example

{
  "phase": "abby-planning",
  "received": true,
  "chars": 12482,
  "hash": "sha256:8f91a31c0d42",
  "bounded": false,
  "timestamp": "2026-06-13T00:00:00.000Z"
}

{
  "phase": "claw-execution",
  "agentName": "CRAWLER",
  "received": true,
  "chars": 12482,
  "hash": "sha256:8f91a31c0d42",
  "bounded": false,
  "timestamp": "2026-06-13T00:00:00.000Z"
}


---

12. Pipeline Contract

operator pasted content
  → chat handler
  → sourceContext
  → orchestrateGoal(goal, sourceContext)
  → ABBY planning prompt hydrated with sourceContext
  → dispatchDirectives(directives, sourceContext)
  → executeAgentCommand(command, sourceContext)
  → CLAW execution prompt hydrated with sourceContext
  → tool loop
  → coordinator review
  → final synthesis
  → save_artifact
  → verification ledger


---

13. Function Signature Contract

export async function orchestrateGoal(input: {
  goal: string;
  channelId: number;
  operatorId?: string;
  sourceContext?: SourceContext | null;
}) {
  // ABBY planning receives sourceContext.
}

export async function dispatchDirectives(input: {
  goal: string;
  directives: AgentDirective[];
  channelId: number;
  sourceContext?: SourceContext | null;
}) {
  // Every CLAW command receives sourceContext.
}

export async function executeAgentCommand(input: {
  commandId: number;
  agentId: number;
  agentName: string;
  command: string;
  payload?: unknown;
  channelId: number;
  sourceContext?: SourceContext | null;
}) {
  // CLAW prompt is hydrated with sourceContext.
}


---

14. Agent Directive Model

export interface AgentDirective {
  toAgentId: number;
  toAgentName: "ABBY" | "FORGE" | "CRAWLER" | "VAULT" | "WIRE" | "MR.NICE" | string;
  directive: string;
  expectedOutput: string;
  priority: "low" | "normal" | "high" | "urgent";
  requiresSourceContext: boolean;
}


---

15. Source Context Requirement Classifier

export function requiresSourceContext(goal: string): boolean {
  const s = goal.toLowerCase();

  return [
    "from this",
    "from the above",
    "from the document",
    "based on this",
    "use this",
    "turn this into",
    "transform this",
    "make this",
    "summarize this",
    "extract from",
    "build a report",
    "build a deck",
    "rewrite this",
    "analyze this",
    "frontier level",
    "mvp",
  ].some((needle) => s.includes(needle));
}


---

16. No-Source-No-Claim Gate

export function assertSourceAvailable(input: {
  goal: string;
  sourceContext?: SourceContext | null;
}) {
  const required = requiresSourceContext(input.goal);

  if (required && !input.sourceContext?.raw) {
    return {
      ok: false,
      status: "BLOCKED",
      reason:
        "This task requires operator-provided source material, but no sourceContext reached this execution phase.",
    };
  }

  return {
    ok: true,
    status: "READY",
  };
}


---

17. Prompt Hydration — ABBY Planning

export function buildAbbyPlanningPrompt(input: {
  persona: string;
  goal: string;
  sourceContext?: SourceContext | null;
  antiHallucinationDirective: string;
}) {
  const sourceBlock = input.sourceContext?.raw
    ? `
SOURCE CONTEXT — PRIMARY INPUT
hash: ${input.sourceContext.hash}
chars: ${input.sourceContext.chars}
bounded: ${input.sourceContext.bounded}

BEGIN SOURCE
${input.sourceContext.raw}
END SOURCE

RULE:
Plan from SOURCE CONTEXT.
Do not memory_search for the source.
Do not invent missing content.
If source is insufficient, say what is missing.
`
    : `
SOURCE CONTEXT
received: false

RULE:
If the task requires source material, block instead of guessing.
`;

  return `
${input.persona}

${input.antiHallucinationDirective}

GOAL:
${input.goal}

${sourceBlock}

TASK:
Decompose the goal into grounded CLAW directives.
Each directive must state whether it requires sourceContext.
Return only executable directives.
`;
}


---

18. Prompt Hydration — CLAW Execution

export function buildClawExecutionPrompt(input: {
  agentName: string;
  roleFocus: string;
  directive: string;
  sourceContext?: SourceContext | null;
  antiHallucinationDirective: string;
}) {
  const sourceBlock = input.sourceContext?.raw
    ? `
SOURCE CONTEXT — PRIMARY INPUT
hash: ${input.sourceContext.hash}
chars: ${input.sourceContext.chars}
bounded: ${input.sourceContext.bounded}

BEGIN SOURCE
${input.sourceContext.raw}
END SOURCE

MANDATORY:
Use SOURCE CONTEXT as the grounding material.
Do not replace it with memory_search.
Do not report facts not supported by SOURCE CONTEXT or tool evidence.
`
    : `
SOURCE CONTEXT
received: false

MANDATORY:
If this directive depends on source material, report BLOCKED.
Do not fabricate.
`;

  return `
You are ${input.agentName}.
Primary role: ${input.roleFocus}

${input.antiHallucinationDirective}

DIRECTIVE:
${input.directive}

${sourceBlock}

OUTPUT RULE:
Return a grounded result, not a description of what you would do.
`;
}


---

19. Source Context Bounding

export interface BoundSourceOptions {
  maxChars: number;
  preserveHeadChars?: number;
  preserveTailChars?: number;
}

export function boundSourceContext(
  raw: string,
  options: BoundSourceOptions,
): {
  raw: string;
  bounded: boolean;
  originalChars: number;
} {
  const maxChars = options.maxChars;
  const originalChars = raw.length;

  if (raw.length <= maxChars) {
    return {
      raw,
      bounded: false,
      originalChars,
    };
  }

  const head = options.preserveHeadChars ?? Math.floor(maxChars * 0.75);
  const tail = options.preserveTailChars ?? maxChars - head;

  return {
    raw:
      raw.slice(0, head) +
      `\n\n[...SOURCE TRUNCATED: ${raw.length - maxChars} CHARS OMITTED...]\n\n` +
      raw.slice(-tail),
    bounded: true,
    originalChars,
  };
}


---

20. Source Integrity Check

export function sourceIntegrityCheck(input: {
  expectedHash?: string | null;
  sourceContext?: SourceContext | null;
}) {
  if (!input.expectedHash) {
    return {
      ok: false,
      reason: "No expected source hash provided.",
    };
  }

  if (!input.sourceContext?.hash) {
    return {
      ok: false,
      reason: "No sourceContext hash received.",
    };
  }

  if (input.expectedHash !== input.sourceContext.hash) {
    return {
      ok: false,
      reason: "Source hash mismatch.",
      expected: input.expectedHash,
      received: input.sourceContext.hash,
    };
  }

  return {
    ok: true,
    hash: input.sourceContext.hash,
  };
}


---

21. Grounded Dispatch Payload

export interface GroundedCommandPayload {
  goal: string;
  directive: string;
  sourceHash: string | null;
  sourceChars: number;
  sourceRequired: boolean;
  sourceReceived: boolean;
  payload?: unknown;
}

export function createGroundedCommandPayload(input: {
  goal: string;
  directive: AgentDirective;
  sourceContext?: SourceContext | null;
  payload?: unknown;
}): GroundedCommandPayload {
  return {
    goal: input.goal,
    directive: input.directive.directive,
    sourceHash: input.sourceContext?.hash ?? null,
    sourceChars: input.sourceContext?.chars ?? 0,
    sourceRequired: input.directive.requiresSourceContext,
    sourceReceived: Boolean(input.sourceContext?.raw),
    payload: input.payload,
  };
}


---

22. Dispatch Guard

export function canDispatchDirective(input: {
  directive: AgentDirective;
  sourceContext?: SourceContext | null;
}) {
  if (input.directive.requiresSourceContext && !input.sourceContext?.raw) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "Directive requires sourceContext but none was provided.",
      directive: input.directive.directive,
      agent: input.directive.toAgentName,
    };
  }

  return {
    ok: true,
    status: "DISPATCHABLE",
  };
}


---

23. Memory Search Restriction

export function shouldAllowMemorySearch(input: {
  directive: string;
  sourceContext?: SourceContext | null;
}) {
  const hasSource = Boolean(input.sourceContext?.raw);
  const s = input.directive.toLowerCase();

  const sourceTask =
    s.includes("from this") ||
    s.includes("from source") ||
    s.includes("based on the document") ||
    s.includes("extract") ||
    s.includes("summarize") ||
    s.includes("rewrite") ||
    s.includes("transform");

  if (hasSource && sourceTask) {
    return {
      allow: false,
      reason:
        "SourceContext is present and is the primary material. memory_search would risk replacing source-grounded execution.",
    };
  }

  return {
    allow: true,
  };
}


---

24. Internal Meta Filter

export function isInternalMeta(text: string): boolean {
  const s = text.toLowerCase();

  return [
    "anti-hallucination",
    "swarm rules",
    "kernel directive",
    "agent runtime rules",
    "verification ledger",
    "pre-flight card",
    "claude.md",
    "tool-call discipline",
    "operator intent fidelity",
    "stockvault incident",
    "self-test incident",
    "navel-gazing",
  ].some((needle) => s.includes(needle));
}


---

25. Memory Search Result Filter

export function filterMemorySearchResults<T extends { content?: string | null }>(
  results: T[],
): T[] {
  return results.filter((r) => !isInternalMeta(r.content ?? ""));
}


---

26. No Navel-Gazing Rule

The swarm must not answer operator deliverable tasks by analyzing its own rules,
memory, identity, kernel, safety docs, or prior self-audits.

If sourceContext exists, it outranks memory.
If memory conflicts with sourceContext, sourceContext wins.
If memory is empty, do not fabricate.


---

27. Evidence-Bound Dispatch Rule

export interface EvidenceBoundDispatch {
  commandId: number;
  agentId: number;
  agentName: string;
  directive: string;
  sourceHash: string | null;
  sourceReceived: boolean;
  sourceRequired: boolean;
  dispatchedAt: string;
}

export function evidenceBoundDispatch(input: {
  commandId: number;
  agentId: number;
  agentName: string;
  directive: AgentDirective;
  sourceContext?: SourceContext | null;
}): EvidenceBoundDispatch {
  return {
    commandId: input.commandId,
    agentId: input.agentId,
    agentName: input.agentName,
    directive: input.directive.directive,
    sourceHash: input.sourceContext?.hash ?? null,
    sourceReceived: Boolean(input.sourceContext?.raw),
    sourceRequired: input.directive.requiresSourceContext,
    dispatchedAt: new Date().toISOString(),
  };
}


---

28. Coordinator Review Contract

export interface CoordinatorReview {
  sourceHash: string | null;
  sourceReceivedByPlanning: boolean;
  sourceReceivedByAgents: Array<{
    agentName: string;
    received: boolean;
    hash: string | null;
  }>;
  deliverableProduced: boolean;
  artifactIds: string[];
  unsupportedClaims: string[];
  missingEvidence: string[];
  verdict: "PASS" | "FAIL" | "PARTIAL" | "BLOCKED" | "NOT_VERIFIED";
}


---

29. Coordinator Review Function

export function coordinatorReview(input: {
  planningProof: GroundingProof;
  clawProofs: GroundingProof[];
  artifactIds?: string[];
  unsupportedClaims?: string[];
  missingEvidence?: string[];
}): CoordinatorReview {
  const sourceHash = input.planningProof.hash;

  const sourceReceivedByAgents = input.clawProofs.map((p) => ({
    agentName: p.agentName ?? "UNKNOWN",
    received: p.received,
    hash: p.hash,
  }));

  const allRequiredAgentsReceivedSource =
    input.clawProofs.length > 0 && input.clawProofs.every((p) => p.received);

  const deliverableProduced = Boolean(input.artifactIds?.length);

  const unsupportedClaims = input.unsupportedClaims ?? [];
  const missingEvidence = input.missingEvidence ?? [];

  let verdict: CoordinatorReview["verdict"] = "PASS";

  if (!input.planningProof.received) verdict = "BLOCKED";
  else if (!allRequiredAgentsReceivedSource) verdict = "PARTIAL";
  else if (!deliverableProduced) verdict = "NOT_VERIFIED";
  else if (unsupportedClaims.length || missingEvidence.length) verdict = "PARTIAL";

  return {
    sourceHash,
    sourceReceivedByPlanning: input.planningProof.received,
    sourceReceivedByAgents,
    deliverableProduced,
    artifactIds: input.artifactIds ?? [],
    unsupportedClaims,
    missingEvidence,
    verdict,
  };
}


---

30. Final Synthesis Rule

Final synthesis must distinguish:
- source-grounded facts
- tool-verified facts
- generated recommendations
- unverified assumptions
- blocked items

Final synthesis must not claim every CLAW succeeded unless coordinatorReview proves it.


---

31. Artifact Requirement

If the operator requests a deck, report, file, document, spreadsheet, image, or downloadable deliverable:

deliverable text alone is NOT enough.

The runtime must call save_artifact or equivalent artifact-writing tool and return a real artifact reference.


---

32. Artifact Result Model

export interface SavedArtifact {
  id: string;
  filename: string;
  mimeType: string;
  bytes: number;
  url?: string;
  sourceHash?: string | null;
  createdAt: string;
}


---

33. Artifact Evidence Rule

export function artifactEvidence(input: {
  artifact?: SavedArtifact | null;
  sourceContext?: SourceContext | null;
}) {
  if (!input.artifact) {
    return {
      ok: false,
      status: "NOT_VERIFIED",
      reason: "No artifact was saved.",
    };
  }

  return {
    ok: true,
    status: "VERIFIED",
    artifactId: input.artifact.id,
    filename: input.artifact.filename,
    bytes: input.artifact.bytes,
    sourceHash: input.sourceContext?.hash ?? null,
  };
}


---

34. Source-Grounded Orchestration Result

export interface SourceGroundedOrchestrationResult {
  goal: string;
  source: {
    received: boolean;
    chars: number;
    hash: string | null;
    bounded?: boolean;
    originalChars?: number;
  };
  planning: {
    proof: GroundingProof;
    directives: AgentDirective[];
  };
  dispatches: EvidenceBoundDispatch[];
  clawProofs: GroundingProof[];
  artifacts: SavedArtifact[];
  coordinatorReview: CoordinatorReview;
  verdict: "PASS" | "FAIL" | "PARTIAL" | "BLOCKED" | "NOT_VERIFIED";
}


---

35. Orchestrate Goal MVP Implementation

export async function orchestrateGoal(input: {
  goal: string;
  channelId: number;
  operatorId?: string;
  sourceContext?: SourceContext | null;
  antiHallucinationDirective: string;
  persona: string;
  planWithAbby: (prompt: string) => Promise<AgentDirective[]>;
  createCommand: (payload: {
    toAgentId: number;
    command: string;
    payload: GroundedCommandPayload;
    priority: AgentDirective["priority"];
  }) => Promise<{ id: number }>;
  executeAgentCommand: (payload: {
    commandId: number;
    agentId: number;
    agentName: string;
    command: string;
    channelId: number;
    sourceContext?: SourceContext | null;
  }) => Promise<GroundingProof>;
  saveGroundingProof: (proof: GroundingProof) => Promise<void>;
}): Promise<SourceGroundedOrchestrationResult> {
  const sourceGate = assertSourceAvailable({
    goal: input.goal,
    sourceContext: input.sourceContext,
  });

  if (!sourceGate.ok) {
    const planningProof = groundingProof({
      phase: "abby-planning",
      sourceContext: input.sourceContext,
    });

    return {
      goal: input.goal,
      source: {
        received: Boolean(input.sourceContext?.raw),
        chars: input.sourceContext?.chars ?? 0,
        hash: input.sourceContext?.hash ?? null,
        bounded: input.sourceContext?.bounded,
        originalChars: input.sourceContext?.originalChars,
      },
      planning: {
        proof: planningProof,
        directives: [],
      },
      dispatches: [],
      clawProofs: [],
      artifacts: [],
      coordinatorReview: {
        sourceHash: input.sourceContext?.hash ?? null,
        sourceReceivedByPlanning: Boolean(input.sourceContext?.raw),
        sourceReceivedByAgents: [],
        deliverableProduced: false,
        artifactIds: [],
        unsupportedClaims: [],
        missingEvidence: [sourceGate.reason],
        verdict: "BLOCKED",
      },
      verdict: "BLOCKED",
    };
  }

  const planningProof = groundingProof({
    phase: "abby-planning",
    sourceContext: input.sourceContext,
  });

  await input.saveGroundingProof(planningProof);

  const planningPrompt = buildAbbyPlanningPrompt({
    persona: input.persona,
    goal: input.goal,
    sourceContext: input.sourceContext,
    antiHallucinationDirective: input.antiHallucinationDirective,
  });

  const directives = await input.planWithAbby(planningPrompt);

  const dispatches: EvidenceBoundDispatch[] = [];
  const clawProofs: GroundingProof[] = [];

  for (const directive of directives) {
    const guard = canDispatchDirective({
      directive,
      sourceContext: input.sourceContext,
    });

    if (!guard.ok) {
      clawProofs.push(
        groundingProof({
          phase: "claw-execution",
          sourceContext: null,
          agentId: directive.toAgentId,
          agentName: directive.toAgentName,
        }),
      );
      continue;
    }

    const command = await input.createCommand({
      toAgentId: directive.toAgentId,
      command: directive.directive,
      payload: createGroundedCommandPayload({
        goal: input.goal,
        directive,
        sourceContext: input.sourceContext,
      }),
      priority: directive.priority,
    });

    const dispatch = evidenceBoundDispatch({
      commandId: command.id,
      agentId: directive.toAgentId,
      agentName: directive.toAgentName,
      directive,
      sourceContext: input.sourceContext,
    });

    dispatches.push(dispatch);

    const proof = await input.executeAgentCommand({
      commandId: command.id,
      agentId: directive.toAgentId,
      agentName: directive.toAgentName,
      command: directive.directive,
      channelId: input.channelId,
      sourceContext: input.sourceContext,
    });

    clawProofs.push(proof);
    await input.saveGroundingProof(proof);
  }

  const review = coordinatorReview({
    planningProof,
    clawProofs,
    artifactIds: [],
  });

  return {
    goal: input.goal,
    source: {
      received: Boolean(input.sourceContext?.raw),
      chars: input.sourceContext?.chars ?? 0,
      hash: input.sourceContext?.hash ?? null,
      bounded: input.sourceContext?.bounded,
      originalChars: input.sourceContext?.originalChars,
    },
    planning: {
      proof: planningProof,
      directives,
    },
    dispatches,
    clawProofs,
    artifacts: [],
    coordinatorReview: review,
    verdict: review.verdict,
  };
}


---

36. Execute Agent Command MVP Implementation

export async function executeAgentCommandWithSource(input: {
  commandId: number;
  agentId: number;
  agentName: string;
  roleFocus: string;
  directive: string;
  channelId: number;
  sourceContext?: SourceContext | null;
  antiHallucinationDirective: string;
  runClawModel: (prompt: string) => Promise<string>;
  saveMessage: (payload: {
    channelId: number;
    agentId: number;
    messageType: "agent" | "system" | "tool_output";
    content: string;
  }) => Promise<void>;
}): Promise<GroundingProof> {
  const proof = groundingProof({
    phase: "claw-execution",
    sourceContext: input.sourceContext,
    agentId: input.agentId,
    agentName: input.agentName,
    commandId: input.commandId,
  });

  const prompt = buildClawExecutionPrompt({
    agentName: input.agentName,
    roleFocus: input.roleFocus,
    directive: input.directive,
    sourceContext: input.sourceContext,
    antiHallucinationDirective: input.antiHallucinationDirective,
  });

  const sourceGate = assertSourceAvailable({
    goal: input.directive,
    sourceContext: input.sourceContext,
  });

  if (!sourceGate.ok) {
    await input.saveMessage({
      channelId: input.channelId,
      agentId: input.agentId,
      messageType: "system",
      content: `BLOCKED: ${sourceGate.reason}`,
    });

    return proof;
  }

  const result = await input.runClawModel(prompt);

  await input.saveMessage({
    channelId: input.channelId,
    agentId: input.agentId,
    messageType: "agent",
    content: result,
  });

  return proof;
}


---

37. Grounding Persistence Schema

import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const groundingLogs = pgTable("grounding_logs", {
  id: serial("id").primaryKey(),
  phase: text("phase").notNull(),
  agentId: integer("agent_id"),
  agentName: text("agent_name"),
  commandId: integer("command_id"),
  artifactId: text("artifact_id"),
  received: boolean("received").notNull(),
  chars: integer("chars").notNull(),
  originalChars: integer("original_chars"),
  hash: text("hash"),
  bounded: boolean("bounded"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});


---

38. Grounding Insert Mapper

export function groundingProofToRow(proof: GroundingProof) {
  return {
    phase: proof.phase,
    agentId: proof.agentId ?? null,
    agentName: proof.agentName ?? null,
    commandId: proof.commandId ?? null,
    artifactId: proof.artifactId ?? null,
    received: proof.received,
    chars: proof.chars,
    originalChars: proof.originalChars ?? null,
    hash: proof.hash,
    bounded: proof.bounded ?? null,
  };
}


---

39. API Debug Endpoint

import { Router } from "express";
import { desc, eq } from "drizzle-orm";

export function createGroundingRouter(input: {
  db: any;
  groundingLogs: any;
  requireOperator: any;
}) {
  const router = Router();

  router.get("/api/grounding", input.requireOperator, async (req, res) => {
    const commandId = req.query["commandId"]
      ? Number(req.query["commandId"])
      : null;

    const query = input.db
      .select()
      .from(input.groundingLogs)
      .orderBy(desc(input.groundingLogs.createdAt))
      .limit(100);

    if (commandId) {
      const rows = await input.db
        .select()
        .from(input.groundingLogs)
        .where(eq(input.groundingLogs.commandId, commandId))
        .orderBy(desc(input.groundingLogs.createdAt))
        .limit(100);

      return res.json({ items: rows });
    }

    const rows = await query;
    return res.json({ items: rows });
  });

  return router;
}


---

40. Grounding Failure Modes

FAILURE: sourceContext missing at ABBY planning
CAUSE: chat handler did not construct or pass sourceContext
RESULT: orchestration must BLOCK if source is required

FAILURE: sourceContext present at ABBY but missing at CLAW
CAUSE: dispatchDirectives did not thread optional param
RESULT: directive must BLOCK or mark PARTIAL

FAILURE: memory_search replaces sourceContext
CAUSE: CLAW prompt under-specified or tool policy too loose
RESULT: output must be marked UNGROUNDED

FAILURE: raw source logged
CAUSE: groundingProof implementation leaked content
RESULT: SECURITY FAILURE

FAILURE: artifact claimed but not saved
CAUSE: deliverable was text-only
RESULT: NOT_VERIFIED

FAILURE: coordinator says PASS while CLAW source proof missing
CAUSE: review ignored grounding logs
RESULT: HALLUCINATION RISK


---

41. Acceptance Criteria

ACCEPTANCE CRITERIA:

1. sourceContext is created when operator provides source material.
2. sourceContext includes chars and sha256 short hash.
3. raw source is injected into ABBY planning prompt.
4. raw source is injected into every CLAW execution prompt that needs it.
5. sourceContext is bounded to protect context size.
6. groundingProof logs planning receipt without raw content.
7. groundingProof logs CLAW receipt without raw content.
8. memory_search is not used as a replacement for provided source.
9. internal swarm meta memories are filtered from memory_search results.
10. coordinatorReview checks whether source reached planning and agents.
11. final synthesis separates verified/source-grounded facts from unverified claims.
12. artifact deliverables are saved via artifact tool when requested.
13. missing required sourceContext produces BLOCKED, not fabricated output.
14. source hash mismatch produces BLOCKED or PARTIAL, not PASS.
15. no raw source is stored in telemetry logs unless explicitly intended by product design.


---

42. Verification Checklist

VERIFICATION:

source propagation:
- chat handler creates sourceContext
- orchestrateGoal receives sourceContext
- ABBY planning prompt includes source hash and raw bounded source
- dispatchDirectives receives same source hash
- executeAgentCommand receives same source hash
- CLAW prompt includes source hash and raw bounded source

grounding logs:
- abby-planning log exists
- claw-execution log exists per dispatched agent
- hashes match across stages
- logs do not contain raw content

guardrails:
- missing source blocks source-required task
- source tasks do not memory_search as substitute
- internal meta memories filtered
- unsupported claims labeled unverified

deliverables:
- requested file is created by artifact tool
- artifact bytes > 0
- artifact associated with source hash


---

43. Final Verdict Format

STATUS: PASS / FAIL / PARTIAL / BLOCKED / NOT VERIFIED

SOURCE:
- received: true / false
- chars: <number>
- hash: sha256:<short>
- bounded: true / false

GROUNDING:
- chat-ingest: PASS / FAIL / NOT RUN
- abby-planning: PASS / FAIL / NOT RUN
- directive-dispatch: PASS / FAIL / NOT RUN
- claw-execution: PASS / FAIL / NOT RUN
- coordinator-review: PASS / FAIL / NOT RUN
- final-synthesis: PASS / FAIL / NOT RUN
- artifact-save: PASS / FAIL / NOT RUN / N/A

OBSERVED:
- <grounding proof or command output>

CHANGED FILES:
- <path> — <what changed>

COMMANDS RUN:
- <command> → <result>

VERIFICATION:
- source propagation: PASS / FAIL / NOT RUN
- hash consistency: PASS / FAIL / NOT RUN
- artifact creation: PASS / FAIL / NOT RUN / N/A
- anti-hallucination: PASS / FAIL / NOT RUN

FAILURES:
- <exact failure>

UNVERIFIED:
- <anything not proven>

NEXT REQUIRED FIX:
- <smallest correct action>


---

44. Runtime Doctrine Block

SOURCE-GROUNDED ORCHESTRATION DOCTRINE

When operator-provided source material exists, it is the primary input.

You must build from the sourceContext provided in this prompt.
Do not search memory to recover the source.
Do not replace the source with prior memory.
Do not summarize your own rules instead of the operator's material.
Do not fabricate missing sections.
If the source is insufficient, say exactly what is missing.

Grounding must be provable:
- source received
- char count
- short sha256 hash
- phase
- agent

Raw source must not be written to telemetry logs.
Deliverables must be saved as real artifacts when requested.
Final answers must separate source-grounded facts from unverified claims.


---

45. Vocabulary

Agentic Software Engineering
Agentic Source-Grounded Orchestration
Source-Grounded Context Propagation
Trace-Driven Context Propagation
Source Context Injection
Prompt Hydration
Grounded Dispatch
Evidence-Bound Dispatch
Context Integrity Check
Grounding Proof
Context Hash
No-Source-No-Claim
No Navel-Gazing
Coordinator Review
Artifact-Backed Deliverable
Plan-Act-Observe-Verify
ReAct
Verification Ledger


---

46. One-Line Kernel

If the operator gave source material, every agent must receive it, prove receipt by hash, build from it, and refuse to invent what it cannot verify.


---

END OF SPEC