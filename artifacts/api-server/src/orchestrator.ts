/**
 * OPENCLAW OMEGA — Real Orchestration Engine
 *
 * This is what makes the swarm REAL instead of scripted text:
 *  - ABBY (Grok) decomposes an operator goal into concrete per-CLAW directives.
 *  - Each target CLAW actually executes its directive via its real NIM model.
 *  - CRAWLER (browser agent) runs a real Steel scrape when a URL is present and
 *    feeds the real web content back into its reasoning.
 *  - Real messages, tool calls, tasks, monologue lines, agent status, and command
 *    rows are written to the DB so the live dashboard reflects actual work.
 *
 * Execution runs in the background (fire-and-forget) so the HTTP request returns
 * immediately and the feed fills in as agents report, via the dashboard's polling.
 */

import { db } from "@workspace/db";
import {
  agentsTable,
  messagesTable,
  tasksTable,
  toolCallsTable,
  monologueLinesTable,
  agentCommandsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger";
import {
  AGENT_PERSONAS,
  ABBY_ID,
  resolveModel,
  SECONDARY_CHAT_MODEL,
  rescueRawToolCalls,
  rescuePlainJsonToolCalls,
  stripToolTokenNoise,
  ANTI_HALLUCINATION_DIRECTIVE,
  TOOL_CALL_DISCIPLINE,
  EXECUTION_DOCTRINE,
  OPERATOR_INTENT_FIDELITY,
  RESEARCH_PLAYBOOKS,
  SWARM_SAFETY_RULES,
  CODING_LIFECYCLE_DOCTRINE,
  ACCOUNT_POLICY_DOCTRINE,
  JOB_COMPLETION_VALIDATOR,
  GITHUB_RENDER_OPERATIONS_DOCTRINE,
  SENIOR_SWE_GENIUS_DOCTRINE,
  SWE_SKILLS,
  buildVaultCard,
  buildLiveReachCard,
} from "./routes/ai";
import { isSwarmPaused } from "./routes/swarm";
import {
  steelScrape,
  getOpenAiToolsForAgent,
  getToolNamesForAgent,
  buildCapabilityCard,
  runTool,
  sanitizeForStorage,
  type ToolContext,
} from "./tools";
import { sendInngestEvent, traceLlmRun, chatRequestFor, llmFetch, llmMaxTokens } from "./lib/integrations";
import { groundingProof } from "./lib/grounding";
import { assessActionRisk, policyRefusal } from "./lib/safetyPolicy";

type Agent = typeof agentsTable.$inferSelect;

const ABBY_COLOR = "#00e5ff";

/**
 * SYNTHESIS DOCTRINE — the standing contract for how ABBY reports back to the
 * operator after the CLAWs finish. Hardened so it applies on EVERY run: every
 * CLAW reports its work to ABBY, and ABBY relays the whole team's work to the
 * operator in a peer-to-peer conversational voice, always covering both what was
 * found (Discovery) and what to do with it (Application). A single source of
 * truth (used by the synthesis pass and asserted by tests) so it can't drift.
 */
export const SYNTHESIS_DOCTRINE = `

HOW YOU REPORT BACK (MANDATORY — every run, no exceptions):
Your CLAWs are your peers on the swarm. Each one has finished its directive and
reported its real work back to you. Your job now is to relay ALL of it to the
operator in a natural, peer-to-peer conversational voice — like a team lead
walking a colleague through what the team found and what it means — NOT a dry
status dump. Speak as ABBY, using ONLY the CLAW results provided.

Always structure the briefing in these three movements:
1. DIRECT ANSWER — answer the operator's goal up front, completely, formatted
   cleanly (markdown tables / lists / code blocks where they help).
2. DISCOVERY — for EACH CLAW that contributed, an attributed section: name the
   CLAW and walk through what it actually discovered/found — the real result,
   with the evidence and sources it produced. Include CLAWs that were blocked or
   returned only partial data; say so plainly and label it UNVERIFIED. Never turn
   "couldn't access it" into "it doesn't exist." The operator must see every
   peer's contribution, not just a verdict.
3. APPLICATION — turn the discovery into action: concrete recommendations, the
   "so what" and the "now what," and how the operator should apply the findings.
   End with the clear next step(s).

This is peer-to-peer: collaborative, specific, and complete — discovery AND
application, every time.

RESOLVE CONFLICTS BY EVIDENCE (do not echo contradictions): when two CLAWs
disagree, do NOT present both conclusions as co-equal and leave the operator to
guess. The conclusion backed by a concrete tool result — an HTTP status code with
a returned id/body, a file the tool confirms it wrote — WINS over a bare assertion
or a call that was mis-formed. Example: a CLAW that got HTTP 201 with a real
deploy id genuinely deployed; another CLAW's 401 from a request sent with no auth
header is its own mistake, not a contradiction — state the deploy succeeded and
note the 401 was an unauthenticated call. Give ONE evidence-based DIRECT ANSWER.

A VERIFIED TOOL RESULT OUTRANKS YOUR OWN INFERENCE: if any CLAW got a concrete
success earlier in THIS run — an HTTP 2xx with a real body/id (e.g. a Gmail
profile 200 returning the address, a 201 with a deploy id) — you MUST NOT later
conclude the opposite ("not connected", "no access", "doesn't exist") from
guessed slugs, mis-formed calls, or unauthenticated 401/404s. The earlier 2xx is
ground truth; a later failure usually means the wrong slug/path/auth was used,
not that the capability is absent. When your draft conclusion contradicts a 2xx
already observed this run, the 2xx wins — say the connection/capability IS
present and attribute the failure to the malformed call.`;

/**
 * Max autonomous reasoning/tool steps per CLAW directive. Bounded for cost, but
 * set high enough that RELENTLESS PERSISTENCE in EXECUTION_DOCTRINE is real:
 * deep research (broad search → several scrapes → cross-checking sources →
 * synthesis) PLUS multiple self-learn research-retry cycles and alternate-tool
 * attempts must all fit before the budget truncates a mission. Default raised
 * 24 → 40 so a single CLAW can web_search a fix when stuck, scrape it, and retry
 * several times within one directive instead of running out of steps mid-solve.
 * The anti-spin guards still stop flailing, so the extra steps buy real progress,
 * not repeats. Operator-tunable via MAX_AGENT_STEPS without a redeploy.
 */
const MAX_AGENT_STEPS = Number(process.env["MAX_AGENT_STEPS"]) > 0 ? Number(process.env["MAX_AGENT_STEPS"]) : 40;

/**
 * Loop-accuracy guards. A CLAW that keeps making the SAME call — or makes no
 * forward progress for several steps — is flailing, not working, and burns the
 * whole step budget (observed live: ~40 identical web_search/save_artifact
 * calls on one directive). These bound that:
 *  - MAX_IDENTICAL_CALL_ATTEMPTS: after this many attempts of the exact same
 *    (tool + args), the call is refused with a hard stop instead of re-run or
 *    re-deduplicated, so the model is forced to change approach or conclude.
 *  - MAX_NO_PROGRESS_STREAK: consecutive steps that produced NO new successful
 *    tool result (only repeats, truncations, or errors) before the loop breaks
 *    and the CLAW is told to conclude with what it has.
 */
export const MAX_IDENTICAL_CALL_ATTEMPTS = 3;
export const MAX_NO_PROGRESS_STREAK = 3;

/**
 * What to do with a tool call given how many times this EXACT call (tool+args)
 * has now been attempted this run. 1st = run it; 2nd = run/reuse but nudge the
 * model that it's repeating; 3rd+ = hard stop (refuse to execute). Pure so the
 * escalation policy is unit-tested and can't silently drift.
 */
export function repeatedCallAction(attempts: number): "run" | "nudge" | "stop" {
  if (attempts >= MAX_IDENTICAL_CALL_ATTEMPTS) return "stop";
  if (attempts === MAX_IDENTICAL_CALL_ATTEMPTS - 1) return "nudge";
  return "run";
}

/**
 * Deterministic JSON with sorted object keys, so two semantically identical tool
 * calls whose arguments differ only in key order produce the SAME cache/loop key
 * (raw JSON.stringify is key-insertion-order dependent across model outputs, which
 * would silently defeat the dedupe cache and the identical-call stop guard).
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/**
 * Did a CLAW fail to do its work (blocked / errored / produced nothing) rather
 * than return a real result? Conservative on purpose: matches only the
 * hard-failure markers executeAgentCommand emits when a directive did NOT
 * complete, plus a leading "error:". This drives ABBY's recovery — a blocked
 * CLAW reports back and she re-routes or changes the approach instead of the run
 * silently stalling on it — and it must NOT mistake a successful connected-
 * account action (which returns a real result, e.g. a permalink) for a failure,
 * or a recovery round could repeat a side effect.
 */
export function resultWasBlocked(result: string): boolean {
  const r = (result ?? "").trim();
  if (!r || r === "(no result produced)" || r === "(no response)") return true;
  return /could not complete its directive|UNVERIFIED — blocked or errored/i.test(r) || /^error:/i.test(r);
}

/**
 * Total solve budget per operator goal, expressed as a multiple of a single
 * run. There is NO fixed round count: the swarm keeps cycling — try → if the
 * solution gate says it isn't solved, research a fix (web_search/scrape) and try
 * that → re-judge — for AS MANY rounds as it keeps making real, source-backed
 * progress. Two conditions END the loop, never an arbitrary number:
 *   1. SOLVED — the gate confirms the briefing solves the operator's input, with
 *      its key claims backed by tool results / sources (so it cannot be a
 *      hallucinated "done").
 *   2. STALLED — MAX_SOLVE_STALL consecutive corrective rounds produced no new
 *      progress (no new non-blocked result AND the gate's objection didn't
 *      change), i.e. even researching the fix isn't moving it. Then the remaining
 *      gap is reported HONESTLY (never papered over as solved).
 *
 * MAX_SOLVE_CYCLES is now only a high SAFETY CEILING (default 50) — a backstop
 * against a pathological run that somehow "progresses" forever; a real task
 * terminates on SOLVED or STALLED long before it. Per-CLAW anti-spin guards
 * (MAX_IDENTICAL_CALL_ATTEMPTS, MAX_NO_PROGRESS_STREAK) still stop within-round
 * flailing. Both the ceiling and the stall threshold are env-tunable
 * (MAX_SOLVE_CYCLES / MAX_SOLVE_STALL) without a redeploy.
 */
export const MAX_SOLVE_CYCLES = Number(process.env["MAX_SOLVE_CYCLES"]) > 0 ? Number(process.env["MAX_SOLVE_CYCLES"]) : 50;

/**
 * STALL THRESHOLD — the REAL terminator (not a round count). After this many
 * CONSECUTIVE corrective rounds that make no progress — no new non-blocked CLAW
 * result AND the solution gate's objection is unchanged — the swarm concedes and
 * reports the gap honestly, because more identical-outcome rounds would just burn
 * budget on the same wall (the agents were already told to web_search a fix; if
 * even that yields nothing new for MAX_SOLVE_STALL rounds, it is genuinely stuck).
 * A round that DOES make progress resets the counter, so a solvable task runs as
 * long as it keeps advancing. Env-tunable via MAX_SOLVE_STALL.
 */
export const MAX_SOLVE_STALL = Number(process.env["MAX_SOLVE_STALL"]) > 0 ? Number(process.env["MAX_SOLVE_STALL"]) : 3;

/**
 * Hard time ceiling for the entire orchestrateGoal solve loop — coordinator
 * rounds + solution gate combined. Acts as a safety backstop alongside the
 * cycle budget: whichever limit is hit first terminates the loop. Prevents
 * runaway cost / infinite oscillation when cycle count alone is insufficient.
 * Default 5 minutes. Operator-tunable via MAX_SOLVE_RUNTIME_MS env var.
 */
export const MAX_SOLVE_RUNTIME_MS =
  Number(process.env["MAX_SOLVE_RUNTIME_MS"]) > 0
    ? Number(process.env["MAX_SOLVE_RUNTIME_MS"])
    : 5 * 60 * 1000;

/**
 * SOLUTION GATE — the verifier contract appended when ABBY judges whether the
 * final briefing actually solves the operator's input. Exported (and asserted
 * by tests) so the gate's strictness can't silently drift.
 */
export const SOLUTION_GATE_DOCTRINE = `
SOLUTION GATE (MANDATORY): you are judging whether the final briefing SOLVES the
operator's input — not whether it is well-written. "Solves" means the operator
could act on it as-is: the question is answered with evidence, or the requested
deliverable exists and is complete. A status report, a plan, a partial answer,
or "we couldn't" without exhausting the swarm's tools is NOT a solution.
Judge ONLY on evidence present in the briefing/results. Be strict: when in
doubt, the goal is NOT solved.
EVERY KEY CLAIM NEEDS A SOURCE (no hallucination may pass): mark solved=true only
if the briefing's important factual claims are each backed by REAL evidence
gathered THIS run — a tool result, a fetched/cited URL, or code-execution output,
ideally cited inline. A confident-sounding answer with no source or tool result
behind its claims is NOT solved (it risks being fabricated): set solved=false and
issue a corrective directive to GO FETCH the evidence (web_search then scrape the
authoritative source, or run the code) before the answer can pass.
CODE GOALS NEED WORKING CODE, NOT DOCS: when the operator asked for software, an
app, a feature, a script, or a fix, the goal is solved ONLY if the briefing
contains the actual working code AND evidence it runs — real code-execution
output, a passing test, or verified behavior. A cloned/forked repository, a
directory listing, a README or any markdown/.md write-up, an architecture
description, or an empty scaffold with no functioning code does NOT solve a code
goal — mark it NOT solved. "I created the files / wrote the docs / set up the
repo" without code that demonstrably works is an automatic FAIL; a clone plus a
README is not a codebase.
A briefing that bounces the work back to the operator — asking what they want,
asking them to confirm, or asking for an input they ALREADY provided — when a
connected tool or named account could have done the task is an automatic FAIL:
the swarm under-read a command as a question. The operator's short or repeated
commands ("Report", "do it", "you have the tool") are orders; a briefing that
answers them with a question instead of the completed action does NOT solve.
VERIFIED IMPOSSIBILITY IS A SOLUTION: if the briefing proves with verbatim tool
evidence that the target does not exist (e.g. an HTTP 404 from a real lookup),
that the task is outside the swarm's tools, or that it is blocked on an input
ONLY the operator holds (a secret, a private-repo grant, a path on the
operator's machine the operator never provided), then naming that blocker IS
the answer — mark it solved. Demanding the swarm "force" a result past such
evidence invites fabrication and is itself a violation.
DIRECTIVES MUST BE EXECUTABLE: every corrective directive must be achievable
with the swarm's REAL tools (web search/scrape, HTTP, isolated code exec,
memory, connected accounts). The CLAWs' sandbox CANNOT see the application
repository, the operator's filesystem, or any local path — never direct an
agent to clone, open, inspect, build, or test local files or the codebase.
EVIDENCE REQUIRED — NO HALLUCINATION GATE: you MUST cite the specific tool
outputs, URLs, or results that support your verdict. "solved: true" with an
empty evidence array is INVALID and will be treated as "solved: false". Every
verdict must include at least one concrete evidence item drawn from what is
actually present in the briefing. If you cannot cite real evidence, the goal is
not solved — do not fabricate sources.`;

/**
 * Code-level enforcement of "DIRECTIVES MUST BE EXECUTABLE". The doctrine above
 * tells the verifier model not to demand repo/local-filesystem access, but a
 * prompt is advice — this filter is law. In the osint-hub incident the gate
 * burned all 4 dispatch rounds insisting the swarm "clone or inspect the local
 * /workspace/osint-hub", an action no CLAW tool can perform; every round
 * re-pressured agents toward the fabrication failure mode the kernel directive
 * exists to prevent. A directive (or verdict reason) matching these patterns is
 * structurally impossible for the sandbox and must never be dispatched.
 */
const OUT_OF_SCOPE_DIRECTIVE_PATTERNS: RegExp[] = [
  /\bclone\b/i, // git clone — no git, no filesystem
  /\blocal\s+(file|files|path|paths|director(?:y|ies)|repo|repository|environment|machine|filesystem)\b/i,
  /\bfilesystem\b/i,
  /(^|[\s"'`(])\/workspace\//, // sandbox-relative paths that do not exist
  /\b(?:operator|user)'s\s+(?:machine|environment|filesystem|computer|laptop)\b/i,
  /\b(?:pnpm|npm|yarn|tsc|vitest|playwright)\b/i, // toolchain runs against the repo
  /\b(?:inspect|read|open|audit|browse|modify|edit|patch|fix|build|test)\b[^.]*\bcodebase\b/i,
  /\bcodebase\b[^.]*\b(?:inspect|read|open|audit|browse|modify|edit|patch|fix|build|test)\b/i,
  /\brun\s+the\s+(?:build|tests?)\b/i,
];

/** True when a corrective directive is achievable with the swarm's real tools. */
export function directiveIsExecutable(text: string): boolean {
  return !OUT_OF_SCOPE_DIRECTIVE_PATTERNS.some((re) => re.test(text));
}

/** One cited piece of evidence supporting a solution-gate verdict. */
export interface SolutionEvidence { source: string; excerpt: string; url?: string }

/**
 * Parse the solution-gate verifier's verdict. The verifier replies with a JSON
 * object {"solved": boolean, "reason": string, "evidence": [...], "directives": [...]}; models
 * wrap JSON in prose/fences often enough that this is regex-hardened. An
 * unparseable verdict fails OPEN (solved=true) so a flaky judge can never burn
 * the whole cycle budget churning on its own garbage — the failure is logged.
 * Evidence is extracted and surfaced so the caller can enforce the evidence gate.
 */
export function parseSolutionVerdict(raw: string): { solved: boolean; reason: string; evidence: SolutionEvidence[] } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      if (typeof parsed["solved"] === "boolean") {
        const ev = Array.isArray(parsed["evidence"])
          ? (parsed["evidence"] as Record<string, unknown>[])
              .filter((e) => typeof e === "object" && e !== null && typeof e["source"] === "string")
              .map((e) => ({
                source: String(e["source"]).slice(0, 200),
                excerpt: String(e["excerpt"] ?? "").slice(0, 400),
                url: typeof e["url"] === "string" ? e["url"].slice(0, 300) : undefined,
              }))
          : [];
        return { solved: parsed["solved"], reason: String(parsed["reason"] ?? "").slice(0, 600), evidence: ev };
      }
    } catch {
      // fall through to regex
    }
  }
  const m = raw.match(/"solved"\s*:\s*(true|false)/i);
  if (m) {
    const reason = raw.match(/"reason"\s*:\s*"([^"]{0,600})/i)?.[1] ?? "";
    return { solved: m[1]!.toLowerCase() === "true", reason, evidence: [] };
  }
  return { solved: true, reason: "verdict unparseable — accepted without verification", evidence: [] };

}

/**
 * Crash/restart recovery. Execution is in-process and fire-and-forget, so a
 * restart mid-run can leave commands/tasks stuck `running` and agents stuck in a
 * non-idle status. On boot we mark those orphans as `interrupted` (NOT `failed` —
 * a deploy/restart killing in-flight work is infrastructure, not an agent
 * failure, and must not pollute the failure view or the failure count) and reset
 * agent status so the dashboard never shows phantom "thinking" agents.
 */
export async function reconcileStaleWork(): Promise<void> {
  try {
    const now = new Date();
    await db
      .update(agentCommandsTable)
      .set({ status: "interrupted", result: "Interrupted by server restart (deploy or redeploy) — not an agent failure.", completedAt: now })
      .where(eq(agentCommandsTable.status, "running"));
    await db
      .update(tasksTable)
      .set({ status: "interrupted", completedAt: now })
      .where(eq(tasksTable.status, "running"));
    await db.update(toolCallsTable).set({ status: "error", completedAt: now }).where(eq(toolCallsTable.status, "running"));
    for (const status of ["thinking", "executing", "waiting"]) {
      await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.status, status));
    }
    logger.info("reconcileStaleWork: marked interrupted orchestration state");
  } catch (err) {
    logger.error({ err }, "reconcileStaleWork failed");
  }
}

// ─── Low-level helpers ───────────────────────────────────────────────────────

/**
 * Non-streaming NIM completion. Returns the assistant text. `maxTokens`
 * defaults to a small budget (planning/review emit short JSON), but callers that
 * produce the operator-facing deliverable (final synthesis) pass a larger budget
 * so a 10/10 answer isn't truncated.
 */
/**
 * Secondary chat model used when an agent's own model fails (e.g. its NIM
 * engine is 429-rate-limited or 5xxing). A Mistral NIM build — a different
 * model family from the nemotron/qwen/deepseek CLAW primaries, all served from
 * the same NVIDIA NIM endpoint — so a CLAW-model outage stays inside the swarm
 * (and inside NVIDIA). Shared with the chat routes via SECONDARY_CHAT_MODEL
 * (imported from ./routes/ai).
 */

async function completeChat(model: string, system: string, user: string, maxTokens = llmMaxTokens()): Promise<string> {
  const startedAt = new Date();
  let r: Response;
  try {
    // llmFetch carries the NIM auth circuit-breaker and key-pool rotation: a
    // rejected NVIDIA key advances to the next pooled key before failing.
    ({ r } = await llmFetch(model, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
      max_tokens: maxTokens,
    }));
  } catch (err) {
    traceLlmRun({ name: "completeChat", model, input: { system, user }, output: null, startedAt, error: String(err) });
    throw err;
  }
  if (!r.ok) {
    const errText = (await r.text()).slice(0, 200);
    // 402 = out of credits for the requested max_tokens. The error states what we
    // CAN afford ("requested up to 8000 tokens, but can only afford 1784"). Rather
    // than re-sending the same unaffordable payload to the (equally starved)
    // secondary pool, retry once on the SAME model with a token cap that fits the
    // remaining budget — this is what silently killed the swarm's final rounds.
    if (r.status === 402) {
      const afford = errText.match(/can only afford\s+(\d+)/i);
      const budget = afford ? Math.max(64, Math.floor(parseInt(afford[1]!, 10) * 0.9)) : Math.floor(maxTokens / 4);
      if (budget < maxTokens) {
        try {
          const { r: r2 } = await llmFetch(model, {
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            stream: false,
            max_tokens: budget,
          });
          if (r2.ok) {
            const d2 = (await r2.json()) as { choices?: Array<{ message?: { content?: string } }> };
            const o2 = d2?.choices?.[0]?.message?.content?.trim();
            if (o2) {
              traceLlmRun({ name: "completeChat", model: `${model} (402 budget-fit ${budget}t)`, input: { system, user }, output: o2, startedAt });
              return o2;
            }
          }
        } catch (e) {
          logger.warn({ e, budget }, "402 budget-fit retry failed; falling through");
        }
      }
    }
    // Last resort: the swarm's secondary model (different NIM pool). A 429 on
    // a CLAW's qwen/deepseek pool must stay inside the swarm — the secondary
    // keeps the persona/system prompt intact.
    try {
      const primary = chatRequestFor(model);
      const fb = chatRequestFor(SECONDARY_CHAT_MODEL);
      if (fb.model !== primary.model || fb.url !== primary.url) {
        const fr = await fetch(fb.url, {
          method: "POST",
          headers: fb.headers,
          body: JSON.stringify({
            ...fb.bodyExtras,
            model: fb.model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
            stream: false,
            max_tokens: maxTokens,
          }),
        });
        if (fr.ok) {
          const fdata = (await fr.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const fout = fdata?.choices?.[0]?.message?.content?.trim();
          if (fout) {
            traceLlmRun({ name: "completeChat", model: `${fb.model} (secondary fallback)`, input: { system, user }, output: fout, startedAt });
            return fout;
          }
        }
      }
    } catch (e) {
      logger.warn({ e }, "secondary-model fallback failed after primary error");
    }
    traceLlmRun({ name: "completeChat", model, input: { system, user }, output: null, startedAt, error: `NVIDIA NIM ${r.status}: ${errText}` });
    throw new Error(`NVIDIA NIM ${r.status}: ${errText}`);
  }
  const data = (await r.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const out = stripToolTokenNoise(data?.choices?.[0]?.message?.content?.trim() ?? "") || "(no response)";
  traceLlmRun({ name: "completeChat", model, input: { system, user }, output: out, startedAt });
  return out;
}

// ─── Native tool-calling primitives ─────────────────────────────────────────

interface ToolCallReq {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCallReq[];
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; name: string; content: string };

/**
 * One NIM chat turn that may request tools. Returns the raw assistant
 * message (content and/or tool_calls). Falls back to a tool-free call if the
 * model/provider rejects the `tools` parameter.
 */
/**
 * Normalize a provider assistant message: when the model emitted raw Kimi-style
 * tool-call tokens as plain text (provider failed to parse them), rescue them
 * into real tool_calls so the action still executes, and strip the markup so
 * it never reaches the operator's chat.
 */
function normalizeAssistantMessage(
  msg: { content?: string | null; tool_calls?: ToolCallReq[] } | undefined,
  knownToolNames: string[] = [],
): AssistantMessage {
  let content = msg?.content ?? null;
  let toolCalls = msg?.tool_calls;
  // (a) Native <|tool_call|> markup leaked into content (Kimi-family).
  if ((!toolCalls || toolCalls.length === 0) && typeof content === "string" && content.includes("<|tool_call")) {
    const rescued = rescueRawToolCalls(content);
    if (rescued.calls.length) {
      toolCalls = rescued.calls.map((c, i) => ({
        id: `rescued_${Date.now()}_${i}`,
        type: "function" as const,
        function: { name: c.name, arguments: c.arguments },
      }));
      logger.warn({ count: toolCalls.length }, "rescued raw tool-call tokens the provider failed to parse into tool_calls");
    }
    content = rescued.clean || null;
  }
  // (b) Bare-JSON tool call in content with NO structured tool_calls — the most
  // common "can't tool call" failure: the model prints {"name":"...","parameters":{…}}
  // as text and the action never executes. Recover it against the known tool set.
  if ((!toolCalls || toolCalls.length === 0) && typeof content === "string" && content.includes("{") && knownToolNames.length) {
    const rescued = rescuePlainJsonToolCalls(content, knownToolNames);
    if (rescued.calls.length) {
      toolCalls = rescued.calls.map((c, i) => ({
        id: `rescued_json_${Date.now()}_${i}`,
        type: "function" as const,
        function: { name: c.name, arguments: c.arguments },
      }));
      logger.warn({ count: toolCalls.length }, "rescued plain-JSON tool calls the model emitted as text content");
      content = rescued.clean || null;
    }
  }
  return { role: "assistant", content, tool_calls: toolCalls };
}

async function completeChatTurn(
  model: string,
  messages: ChatMessage[],
  tools: Array<Record<string, unknown>>,
): Promise<AssistantMessage> {
  const payload: Record<string, unknown> = { messages, stream: false, max_tokens: llmMaxTokens() };
  // Tool names this turn can call — drives the plain-JSON tool-call rescue when a
  // model emits a call as text content instead of a structured tool_call.
  const knownToolNames = tools
    .map((t) => ((t["function"] as { name?: unknown } | undefined)?.name))
    .filter((n): n is string => typeof n === "string");
  if (tools.length) {
    payload["tools"] = tools;
    payload["tool_choice"] = "auto";
  }
  // llmFetch carries the NIM auth circuit-breaker and key-pool rotation: a
  // rejected NVIDIA key advances to the next pooled key before failing.
  let { r, req: llmReq } = await llmFetch(model, payload);
  if (!r.ok && tools.length) {
    // Some providers reject function-calling — retry once without tools.
    delete payload["tools"];
    delete payload["tool_choice"];
    ({ r, req: llmReq } = await llmFetch(model, payload));
  }
  if (!r.ok) {
    const errText = (await r.text()).slice(0, 200);
    // 402 = insufficient credits for max_tokens:8000 (this is what aborted the
    // swarm's final corrective rounds). Retry once on the SAME model with a cap
    // that fits the budget the error reports, keeping tools intact.
    if (r.status === 402) {
      const afford = errText.match(/can only afford\s+(\d+)/i);
      const budget = afford ? Math.max(256, Math.floor(parseInt(afford[1]!, 10) * 0.9)) : 1500;
      try {
        const fitted: Record<string, unknown> = { ...payload, max_tokens: budget };
        const { r: r3 } = await llmFetch(model, fitted);
        if (r3.ok) {
          const d3 = (await r3.json()) as { choices?: Array<{ message?: AssistantMessage }> };
          const m3 = d3?.choices?.[0]?.message;
          if (m3) {
            logger.info({ model, budget }, "tool turn recovered via 402 budget-fit retry");
            return normalizeAssistantMessage(m3, knownToolNames);
          }
        }
      } catch (e) {
        logger.warn({ e, budget }, "402 budget-fit retry failed (tool turn); falling through");
      }
    }
    // Last resort: the swarm's secondary model, WITH tools — so a 429 on the
    // CLAW's own pool keeps the agent fully operational (persona + tool
    // calling).
    try {
      const fb = chatRequestFor(SECONDARY_CHAT_MODEL);
      if (fb.model !== llmReq.model || fb.url !== llmReq.url) {
        const fbBody: Record<string, unknown> = { ...fb.bodyExtras, model: fb.model, messages, stream: false, max_tokens: llmMaxTokens() };
        if (tools.length) {
          fbBody["tools"] = tools;
          fbBody["tool_choice"] = "auto";
        }
        const fr = await fetch(fb.url, { method: "POST", headers: fb.headers, body: JSON.stringify(fbBody) });
        if (fr.ok) {
          const fdata = (await fr.json()) as { choices?: Array<{ message?: AssistantMessage }> };
          const fmsg = fdata?.choices?.[0]?.message;
          if (fmsg) {
            logger.info({ from: llmReq.model, to: fb.model }, "tool turn recovered on secondary model after primary failure");
            return normalizeAssistantMessage(fmsg, knownToolNames);
          }
        }
      }
    } catch (e) {
      logger.warn({ e }, "secondary-model fallback failed (tool turn)");
    }
    throw new Error(`NVIDIA NIM ${r.status}: ${errText}`);
  }
  const data = (await r.json()) as {
    choices?: Array<{ message?: AssistantMessage }>;
  };
  return normalizeAssistantMessage(data?.choices?.[0]?.message, knownToolNames);
}

function summarizeArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 60)}`)
    .join(" ")
    .slice(0, 160);
}

const URL_RE = /https?:\/\/[^\s"')<>]+/i;
function extractUrl(text: string): string | null {
  return text.match(URL_RE)?.[0] ?? null;
}

function isBrowserAgent(agent: Agent): boolean {
  return (
    agent.id === 3 ||
    /crawler|claw-2/i.test(agent.name) ||
    /browser|scrap|crawl|web/i.test(agent.role ?? "")
  );
}

async function postMessage(opts: {
  channelId: number;
  agent?: Agent | null;
  agentId?: number | null;
  agentName?: string | null;
  agentColor?: string | null;
  content: string;
  messageType: string;
}): Promise<void> {
  await db.insert(messagesTable).values({
    channelId: opts.channelId,
    agentId: opts.agent?.id ?? opts.agentId ?? null,
    agentName: opts.agent?.name ?? opts.agentName ?? null,
    agentColor: opts.agent?.color ?? opts.agentColor ?? null,
    content: opts.content,
    messageType: opts.messageType,
  });
}

// ─── Single-command execution ────────────────────────────────────────────────

/**
 * Execute one already-created command end-to-end as a genuinely autonomous,
 * tool-using agent:
 *  - The CLAW reasons over the directive with its real NIM model.
 *  - It decides for itself which of its permitted tools to call (web_scrape,
 *    web_screenshot, http_request, code_exec, memory_write, memory_search) via
 *    native function-calling, in a bounded loop (MAX_AGENT_STEPS).
 *  - Every tool call, monologue line, tool_output message, and the final result
 *    are persisted so the live dashboard reflects real multi-step work.
 *
 * Returns the agent's final reported result text (used by ABBY's coordinator).
 */
export async function executeAgentCommand(opts: {
  commandId: number;
  agent: Agent;
  command: string;
  payload: string | null;
  channelId: number;
  sourceContext?: string | null;
}): Promise<string> {
  const { commandId, agent, command, payload, channelId, sourceContext } = opts;
  // Grounding proof: prove the operator's source material reached this CLAW
  // (length + hash only, never the raw content). Persisted for the Dispatch panel.
  const proof = groundingProof(sourceContext);
  const dispatchModel = resolveModel(agent.id, agent.model, undefined);
  logger.info({ claw: agent.name, model: dispatchModel, ...proof }, "claw dispatch grounding");
  let taskId: number | null = null;
  try {
    await db
      .update(agentCommandsTable)
      .set({ status: "running", model: dispatchModel, groundingChars: proof.chars, groundingHash: proof.hash || null })
      .where(eq(agentCommandsTable.id, commandId));
    await db.update(agentsTable).set({ status: "thinking" }).where(eq(agentsTable.id, agent.id));

    const [task] = await db
      .insert(tasksTable)
      .values({
        title: command.slice(0, 140),
        description: payload ?? null,
        agentId: agent.id,
        agentName: agent.name,
        status: "running",
        priority: "high",
        progress: 10,
        channelId,
      })
      .returning();
    taskId = task?.id ?? null;

    await db.insert(monologueLinesTable).values({
      agentId: agent.id,
      text: `Directive received: ${command}`,
      type: "thought",
    });

    const ctx: ToolContext = { agentId: agent.id, agentName: agent.name, agentColor: agent.color, channelId };
    const toolNames = getToolNamesForAgent(agent.id);
    const tools = getOpenAiToolsForAgent(agent.id);

    // Convenience pre-scrape: if the browser CLAW is handed a URL, fetch it once
    // up front so it starts the loop with live data (it can still call more tools).
    let priming = "";
    const url = extractUrl(`${command} ${payload ?? ""}`);
    if (url && isBrowserAgent(agent) && process.env["STEEL_API_KEY"]) {
      const [tc] = await db
        .insert(toolCallsTable)
        .values({ agentId: agent.id, toolName: "web_scrape", args: JSON.stringify({ url }), status: "running" })
        .returning();
      try {
        const scraped = sanitizeForStorage((await steelScrape(url)).slice(0, 6000));
        priming = scraped;
        await db
          .update(toolCallsTable)
          .set({ status: "success", result: scraped.slice(0, 4000), completedAt: new Date() })
          .where(eq(toolCallsTable.id, tc.id));
        await postMessage({
          channelId,
          agent,
          content: `web_scrape("${url}")\n\n${scraped.slice(0, 1400)}${scraped.length > 1400 ? "\n…" : ""}`,
          messageType: "tool_output",
        });
        if (taskId) await db.update(tasksTable).set({ progress: 35 }).where(eq(tasksTable.id, taskId));
      } catch (e) {
        await db
          .update(toolCallsTable)
          .set({ status: "error", result: String(e).slice(0, 1000), completedAt: new Date() })
          .where(eq(toolCallsTable.id, tc.id));
      }
    }

    // ── Autonomous reasoning + tool loop ──
    const model = resolveModel(agent.id, agent.model, undefined);
    const persona =
      AGENT_PERSONAS[agent.id] ??
      `You are ${agent.name}, an autonomous agent of the ABBY CLAW swarm. Execute directives precisely.`;
    const toolGuide = toolNames.length
      ? `\n\nYou are an autonomous tool-using agent. Call tools to gather real data and perform real work instead of guessing — chain multiple calls when needed, and avoid repeating a call that already returned (it wastes time and budget). When the directive is fully satisfied, stop calling tools and reply with your final concrete result (no preamble).${buildCapabilityCard(agent.id)}`
      : "";
    // LIVE REACH gives the CLAW the same ground truth the chat path gets: its
    // tool list plus which integrations are ONLINE/OFFLINE right now — so a
    // dispatched CLAW never "forgets" Tavily/Firecrawl/Composio/E2B exist, and
    // never pretends an offline one works.
    // ABBY runs solo now, so the executing agent carries the COMPLETE ruleset
    // the swarm defined — the core execution doctrines PLUS the job-completion
    // gate, GitHub/Render ops, and senior-SWE discipline that previously lived
    // only on the chat/synthesis path. Same rules the swarm ran by, in one agent.
    const system = persona + toolGuide + buildLiveReachCard(agent.id) + EXECUTION_DOCTRINE + OPERATOR_INTENT_FIDELITY + RESEARCH_PLAYBOOKS + ANTI_HALLUCINATION_DIRECTIVE + TOOL_CALL_DISCIPLINE + SWARM_SAFETY_RULES + CODING_LIFECYCLE_DOCTRINE + JOB_COMPLETION_VALIDATOR + GITHUB_RENDER_OPERATIONS_DOCTRINE + SENIOR_SWE_GENIUS_DOCTRINE + SWE_SKILLS + ACCOUNT_POLICY_DOCTRINE + (await buildVaultCard());

    const messages: ChatMessage[] = [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `Directive from ABBY (orchestrator): ${command}\n${payload ? `Payload: ${payload}\n` : ""}` +
          (sourceContext && sourceContext.trim()
            ? `\nOPERATOR-PROVIDED SOURCE MATERIAL — this is your primary input. Build directly from it; do NOT memory_search for it (it is right here):\n"""\n${sourceContext.slice(0, 30000)}\n"""\n`
            : "") +
          (priming ? `\nLive page content already retrieved for you:\n"""\n${priming}\n"""\n` : "") +
          `\nExecute the directive now. Use your tools for anything requiring real data or computation.`,
      },
    ];

    let finalText = "";
    let steps = 0;
    // Cache of identical tool calls made during THIS run, so a repeated
    // (tool + exact args) call reuses its result instead of re-billing the
    // external API and re-spending tokens — a frequent, costly agent loop.
    const callCache = new Map<string, string>();
    // Track tool failures so the self-learning nudge fires after errors,
    // telling the CLAW to research a fix online before retrying blindly.
    const failedTools = new Set<string>();
    // Loop-accuracy bookkeeping: how many times each exact (tool+args) call was
    // attempted, and how many consecutive steps produced no new result.
    const attemptCounts = new Map<string, number>();
    let noProgressStreak = 0;
    while (steps < MAX_AGENT_STEPS) {
      steps++;
      const assistant = await completeChatTurn(model, messages, tools);
      const calls = assistant.tool_calls ?? [];

      if (calls.length === 0) {
        finalText = (assistant.content ?? "").trim();
        break;
      }

      // Parse each tool call's arguments up front. Models (esp. Qwen) sometimes
      // emit a tool call whose `function.arguments` is truncated/invalid JSON when
      // the intended output is large (code, HTML decks, save_artifact content).
      // If that raw string is pushed back into the message history, the provider
      // rejects the NEXT turn with `400 InternalError.Algo.InvalidParameter
      // (function.arguments)` — or we throw `SyntaxError: Unexpected end of JSON
      // input` locally — and the whole directive hard-fails. So we normalize every
      // recorded call to GUARANTEED-valid JSON, and flag the truncated ones so the
      // model retries with smaller output instead of poisoning the conversation.
      const parsed = calls.map((call) => {
        let args: Record<string, unknown> = {};
        let truncated = false;
        const raw = call.function?.arguments;
        if (raw) {
          try {
            args = JSON.parse(raw);
          } catch {
            truncated = true;
          }
        }
        return { call, args, truncated };
      });

      // Record the assistant turn with valid argument JSON so a resend never 400s.
      messages.push({
        role: "assistant",
        content: assistant.content ?? "",
        tool_calls: parsed.map(({ call, args }): ToolCallReq => ({
          id: call.id,
          type: "function",
          function: { name: call.function.name, arguments: JSON.stringify(args) },
        })),
      });
      await db.update(agentsTable).set({ status: "executing" }).where(eq(agentsTable.id, agent.id));

      // Did any call this step produce a NEW successful result? If not, the
      // step made no forward progress and counts toward the no-progress streak.
      let madeProgress = false;
      // Tools that failed in THIS step only — drives the self-learn nudge. Must
      // be per-step, not the run-global failedTools (which would keep firing the
      // nudge for a tool that failed once and then succeeded).
      const stepFailed = new Set<string>();
      for (const { call, args: parsedArgs, truncated } of parsed) {
        const name = call.function?.name ?? "unknown";

        const [tc] = await db
          .insert(toolCallsTable)
          .values({ agentId: agent.id, toolName: name, args: JSON.stringify(parsedArgs).slice(0, 2000), status: "running" })
          .returning();
        await db.insert(monologueLinesTable).values({
          agentId: agent.id,
          text: `${name}(${summarizeArgs(parsedArgs)})`,
          type: "action",
        });

        let toolResult: string;
        let ok = true;
        const callKey = `${name}:${stableStringify(parsedArgs)}`;
        const attempts = (attemptCounts.get(callKey) ?? 0) + 1;
        attemptCounts.set(callKey, attempts);
        const action = repeatedCallAction(attempts);
        if (action === "stop") {
          // The CLAW has made this EXACT call too many times — refuse it. Repeating
          // identical arguments cannot produce a different result; force a change of
          // approach (or an honest conclusion) instead of burning the budget.
          ok = false;
          toolResult =
            `error: STOP REPEATING — you have called ${name} with these exact arguments ${attempts} times. ` +
            `An identical call cannot return anything new. Do ONE of: (a) call a different tool, ` +
            `(b) call ${name} with materially different arguments, or (c) if you cannot make progress, ` +
            `stop calling tools and give your final answer with what you already have (state honestly what is missing).`;
        } else if (truncated) {
          // The model's arguments were truncated/invalid JSON (the content was too
          // large for one turn). Give ACTIONABLE advice that matches a real
          // capability: save_artifact supports chunked saving, so point there
          // instead of the impossible "write in sections" for a one-shot tool.
          ok = false;
          toolResult =
            name === "save_artifact"
              ? `error: your save_artifact call was dropped — the content was too large for a single turn. ` +
                `Save it in CHUNKS: call save_artifact repeatedly with {"filename":"<same name>","content":"<a slice of the base64>","encoding":"base64","chunk":true} ` +
                `for each consecutive slice (a few KB each), IN ORDER, then a final call {"filename":"<same name>","done":true} to assemble and store it. Do not resend the whole payload at once.`
              : `error: your ${name} call was dropped — its arguments were truncated/invalid JSON, almost always because the content was too large for a single turn. Retry ${name} with a SMALLER payload (split the work into more, smaller calls).`;
        } else if (callCache.has(callKey)) {
          // Identical call already executed this run — reuse it, don't pay again.
          const nudge = action === "nudge"
            ? ` This is repeat #${attempts}; if you call it identically once more it will be REFUSED. Use this result or change your approach now.`
            : "";
          toolResult = `(deduplicated: you already called ${name} with these exact arguments earlier in this run. Reusing that result — do not repeat it.${nudge})\n\n${callCache.get(callKey)}`;
        } else {
          try {
            toolResult = await runTool(name, parsedArgs, ctx);
            if (toolResult.startsWith("error:")) ok = false;
          } catch (e) {
            ok = false;
            toolResult = `error: ${String(e).slice(0, 300)}`;
          }
          if (ok) { callCache.set(callKey, toolResult); madeProgress = true; }
        }

        await db
          .update(toolCallsTable)
          .set({ status: ok ? "success" : "error", result: toolResult.slice(0, 4000), completedAt: new Date() })
          .where(eq(toolCallsTable.id, tc.id));
        await db.insert(monologueLinesTable).values({
          agentId: agent.id,
          text: ok ? `${name} → ${toolResult.slice(0, 200)}` : `${name} failed: ${toolResult.slice(0, 200)}`,
          type: ok ? "result" : "system",
        });
        await postMessage({
          channelId,
          agent,
          content: `${name}(${summarizeArgs(parsedArgs)})\n\n${toolResult.slice(0, 1400)}${toolResult.length > 1400 ? "\n…" : ""}`,
          messageType: "tool_output",
        });

        messages.push({ role: "tool", tool_call_id: call.id, name, content: toolResult.slice(0, 6000) });
        if (!ok) { failedTools.add(name); stepFailed.add(name); }
      }

      // Self-learning nudge: when a tool genuinely failed THIS step (and the same
      // call didn't ultimately succeed/cache this step), remind the CLAW to
      // research a fix (memory_search → web_search → retry) rather than retrying
      // blindly or giving up.
      if (stepFailed.size > 0) {
        const failedNames = [...stepFailed].join(", ");
        messages.push({
          role: "user",
          content:
            `[SELF-LEARN] ${failedNames} failed. Before retrying, follow the self-learning protocol: ` +
            `(1) memory_search for a prior lesson about this error, ` +
            `(2) if no lesson found, web_search for how to fix it, then web_scrape the best result, ` +
            `(3) retry with the fix applied, ` +
            `(4) if it works, memory_write the lesson as "PROBLEM → SOLUTION (evidence)" tagged "lesson,self-learned". ` +
            `Do NOT repeat the exact same failing call without changing something.`,
        });
      }

      if (taskId) {
        const progress = Math.min(90, 35 + steps * 12);
        await db.update(tasksTable).set({ progress }).where(eq(tasksTable.id, taskId));
      }
      await db.update(agentsTable).set({ status: "thinking" }).where(eq(agentsTable.id, agent.id));

      // No-progress circuit breaker: if several steps in a row produced no new
      // successful result (only repeats, truncations, or errors), the CLAW is
      // stuck. Stop looping and make it conclude with what it has — far better
      // than spending the whole budget flailing on the same failing call.
      noProgressStreak = madeProgress ? 0 : noProgressStreak + 1;
      if (noProgressStreak >= MAX_NO_PROGRESS_STREAK) {
        await db.insert(monologueLinesTable).values({
          agentId: agent.id,
          text: `No forward progress for ${noProgressStreak} steps — breaking the loop to conclude with current evidence.`,
          type: "system",
        });
        messages.push({
          role: "user",
          content:
            `You have made no forward progress for ${noProgressStreak} steps (only repeated, truncated, or failed calls). ` +
            `Stop calling tools now and give your final concrete result based on what you already have. ` +
            `If the goal could not be fully completed, say so honestly and state exactly what is missing and why.`,
        });
        break;
      }
    }

    // If the loop hit the step cap mid-tool-use, force a final summary turn.
    if (!finalText) {
      messages.push({
        role: "user",
        content: "Step budget reached. Stop using tools and give your final concrete result now based on what you have.",
      });
      const wrap = await completeChatTurn(model, messages, []);
      finalText = (wrap.content ?? "").trim();
    }
    if (!finalText) finalText = "(no result produced)";

    await postMessage({ channelId, agent, content: finalText, messageType: "agent" });

    await db
      .update(agentCommandsTable)
      .set({ status: "done", result: finalText.slice(0, 4000), completedAt: new Date() })
      .where(eq(agentCommandsTable.id, commandId));
    if (taskId) {
      await db
        .update(tasksTable)
        .set({ status: "completed", progress: 100, completedAt: new Date() })
        .where(eq(tasksTable.id, taskId));
    }
    await db.insert(monologueLinesTable).values({
      agentId: agent.id,
      text: `Directive complete after ${steps} step${steps === 1 ? "" : "s"}. Result reported to ABBY.`,
      type: "conclusion",
    });
    return finalText;
  } catch (err) {
    logger.error({ err, commandId, agentId: agent.id }, "executeAgentCommand failed");
    await db
      .update(agentCommandsTable)
      .set({ status: "failed", result: String(err).slice(0, 2000), completedAt: new Date() })
      .where(eq(agentCommandsTable.id, commandId))
      .catch(() => {});
    if (taskId) {
      await db
        .update(tasksTable)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(tasksTable.id, taskId))
        .catch(() => {});
    }
    await postMessage({
      channelId,
      agent,
      content: `Execution failed: ${String(err).slice(0, 300)}`,
      messageType: "system",
    }).catch(() => {});
    // Report the failure back to ABBY rather than returning nothing — a blocked
    // CLAW must still appear (honestly, as UNVERIFIED) in ABBY's final briefing,
    // never silently drop out of the team's reported work.
    return `⚠️ ${agent.name} could not complete its directive (UNVERIFIED — blocked or errored): ${String(err).slice(0, 300)}`;
  } finally {
    await db
      .update(agentsTable)
      .set({ status: "idle" })
      .where(eq(agentsTable.id, agent.id))
      .catch(() => {});
  }
}

// ─── Goal orchestration ──────────────────────────────────────────────────────

interface Directive {
  agentId: number;
  directive: string;
}

function parseDirectives(raw: string, claws: Agent[]): Directive[] {
  const ids = new Set(claws.map((c) => c.id));
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown[];
      const out: Directive[] = [];
      for (const item of parsed) {
        if (item && typeof item === "object") {
          const rec = item as Record<string, unknown>;
          const agentId = Number(rec["agentId"]);
          const directive = String(rec["directive"] ?? "").trim();
          if (ids.has(agentId) && directive) out.push({ agentId, directive });
        }
      }
      if (out.length) return out.slice(0, 5);
    } catch {
      // fall through to fallback
    }
  }
  return [];
}

/**
 * Create command rows for a set of directives and run the target CLAWs'
 * autonomous loops CONCURRENTLY — they are independent agents and execute in
 * parallel, like a real swarm. Each CLAW persists its own feed/tool/task rows
 * as it works, so the dashboard fills in live and interleaved. Returns each
 * CLAW's final result for ABBY's coordinator review. Honors pause at launch.
 */
async function dispatchDirectives(
  directives: Directive[],
  claws: Agent[],
  channelId: number,
  priority: string,
  abby: Agent | null,
  sourceContext?: string | null,
): Promise<Array<{ name: string; result: string }>> {
  if (isSwarmPaused()) {
    await postMessage({
      channelId,
      agentId: ABBY_ID,
      agentName: "ABBY",
      agentColor: abby?.color ?? ABBY_COLOR,
      content: "SWARM is paused. Directives were not dispatched.",
      messageType: "system",
    });
    return [];
  }

  const runs = directives.map(async (d): Promise<{ name: string; result: string } | null> => {
    const agent = claws.find((c) => c.id === d.agentId);
    if (!agent) return null;
    const [cmd] = await db
      .insert(agentCommandsTable)
      .values({
        fromAgentId: ABBY_ID,
        toAgentId: agent.id,
        command: d.directive,
        payload: null,
        priority,
        status: "queued",
      })
      .returning();
    if (!cmd) return null;
    const result = await executeAgentCommand({
      commandId: cmd.id,
      agent,
      command: d.directive,
      payload: null,
      channelId,
      sourceContext,
    });
    return { name: agent.name, result };
  });

  // allSettled, not all: a CLAW's command-insert or executor can reject (DB
  // blip), and one rejection must NOT discard every sibling's completed work in
  // the round. Rejected entries become an honest UNVERIFIED line for ABBY.
  const settled = await Promise.allSettled(runs);
  const out: Array<{ name: string; result: string }> = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") {
      if (s.value !== null) out.push(s.value);
    } else {
      const agent = claws.find((c) => c.id === directives[i]?.agentId);
      logger.error({ err: s.reason, agentId: directives[i]?.agentId }, "dispatchDirectives: a CLAW run rejected");
      out.push({
        name: agent?.name ?? `agent#${directives[i]?.agentId ?? "?"}`,
        result: `⚠️ This CLAW could not be dispatched (UNVERIFIED — infrastructure error): ${String(s.reason).slice(0, 200)}`,
      });
    }
  });
  return out;
}

/**
 * ABBY decomposes an operator goal and dispatches real directives to the CLAWs,
 * each of which actually executes. Runs sequentially so the feed reads naturally.
 */
export async function orchestrateGoal(opts: {
  goal: string;
  channelId: number;
  priority: string;
  sourceContext?: string | null;
  /**
   * Force the whole goal onto a SINGLE agent as ONE directive (no multi-CLAW
   * decomposition). Used for connected-account/Composio actions: only ABBY/WIRE/
   * MR.NICE hold the Composio tools, and the goal must run exactly once — fanning
   * it out duplicated work (e.g. published an Instagram post twice) and routed
   * slices to agents that can't act on it.
   */
  forceAgentId?: number;
}): Promise<void> {
  const { goal, channelId, priority, sourceContext, forceAgentId } = opts;
  logger.info({ phase: "abby-planning", ...groundingProof(sourceContext) }, "orchestration grounding");

  // Hard safety guardrail: refuse blocked categories (financial account opening,
  // government-ID/KYC submission) before any planning or dispatch. Enforced in
  // code so a prompt-injected or mis-reasoned goal can't slip past the doctrine.
  const goalRisk = assessActionRisk(`${goal}\n${sourceContext ?? ""}`);
  if (goalRisk.blocked) {
    logger.warn({ category: goalRisk.category }, "orchestrateGoal blocked by safety policy");
    await postMessage({
      channelId,
      agentId: ABBY_ID,
      agentName: "ABBY",
      agentColor: ABBY_COLOR,
      content: policyRefusal(goalRisk),
      messageType: "system",
    }).catch(() => {});
    void sendInngestEvent("swarm/goal.blocked", { goal, channelId, category: goalRisk.category });
    return;
  }

  void sendInngestEvent("swarm/goal.received", { goal, channelId, priority });
  try {
    const agents = await db.select().from(agentsTable);
    const abby = agents.find((a) => a.id === ABBY_ID) ?? null;
    // SOLO MODE: the CLAW sub-agents were removed, so ABBY is her own worker —
    // she holds every tool and executes directives herself. (Falls back to the
    // legacy multi-CLAW set if any sub-agents still exist.)
    const others = agents.filter((a) => a.id !== ABBY_ID);
    const claws = others.length > 0 ? others : (abby ? [abby] : []);

    if (isSwarmPaused()) {
      await postMessage({
        channelId,
        agentId: ABBY_ID,
        agentName: "ABBY",
        agentColor: abby?.color ?? ABBY_COLOR,
        content: "SWARM is paused. Resume the swarm to execute directives.",
        messageType: "system",
      });
      return;
    }

    await db.update(agentsTable).set({ status: "thinking" }).where(eq(agentsTable.id, ABBY_ID));

    // ABBY (Grok) decomposes the goal into per-CLAW directives.
    const roster = claws
      .map((c) => `${c.id}=${c.name} (${c.role ?? "agent"})`)
      .join(", ");
    // ABBY plans with LIVE REACH so directives only lean on integrations that
    // are actually online (e.g. don't direct a CLAW to Firecrawl if it's off).
    const planSystem = (AGENT_PERSONAS[ABBY_ID] ?? "You are ABBY, the swarm orchestrator.") + buildLiveReachCard(ABBY_ID) + EXECUTION_DOCTRINE + OPERATOR_INTENT_FIDELITY + RESEARCH_PLAYBOOKS + TOOL_CALL_DISCIPLINE + SWARM_SAFETY_RULES + CODING_LIFECYCLE_DOCTRINE + ACCOUNT_POLICY_DOCTRINE + (await buildVaultCard());
    const planUser = `Operator goal: "${goal}"
${sourceContext && sourceContext.trim() ? `\nThe operator provided this source material to work from (decompose against THIS; the CLAWs will receive it too — do not tell them to search memory for it):\n"""\n${sourceContext.slice(0, 12000)}\n"""\n` : ""}
Available CLAWs you command: ${roster}.

Decompose this goal into precise, exhaustive, granular directives — ONE per CLAW that is genuinely relevant (skip CLAWs that add nothing). Together the directives must cover EVERY part of the goal; leave nothing implied. Each directive MUST be:
- SELF-CONTAINED: state the exact objective, the concrete inputs/targets (specific https:// URLs, API endpoints, file names, or data), and the expected output and its format. Assume the CLAW sees ONLY this directive — no other context.
- GRANULAR & CONCLUSIVE: spell out the steps and the DEFINITION OF DONE — what the finished deliverable must contain for that part of the goal to count as fully met (a 10/10, shippable result, not a draft or outline).
- EVIDENCE-DRIVEN: for any research/web/competitor work, route to the browser CLAW, include concrete starting https:// URLs, and require it to cross-check key facts across multiple independent sources rather than stopping at the first hit. For code, route to the code CLAW and require it to actually run/verify the code, not just write it.

Respond with ONLY a JSON array (no prose, no code fences) of objects shaped: {"agentId": <number>, "directive": "<single, fully-specified instruction>"}. Maximum 5 directives.`;

    const model = resolveModel(ABBY_ID, abby?.model, undefined);

    // Single-agent path: dispatch the whole goal as ONE directive to the forced
    // agent (must be a real CLAW). Skips ABBY's multi-directive planning entirely
    // so the action runs exactly once on a capable agent.
    let directives: Directive[];
    if (forceAgentId && claws.some((c) => c.id === forceAgentId)) {
      directives = [{ agentId: forceAgentId, directive: goal }];
    } else {
      const planRaw = await completeChat(model, planSystem, planUser);
      directives = parseDirectives(planRaw, claws);
    }

    // Fallback: if ABBY didn't return parseable directives, route the raw goal
    // to the most relevant single CLAW (browser if a URL is present, else FORGE).
    if (directives.length === 0) {
      const url = extractUrl(goal);
      const fallback =
        (url ? claws.find((c) => isBrowserAgent(c)) : null) ??
        claws.find((c) => c.id === 2) ??
        claws[0];
      if (fallback) directives = [{ agentId: fallback.id, directive: goal }];
    }

    await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.id, ABBY_ID));

    await postMessage({
      channelId,
      agentId: ABBY_ID,
      agentName: "ABBY",
      agentColor: abby?.color ?? ABBY_COLOR,
      content: directives.length
        ? `Orchestrating: "${goal}"\n\n` +
          directives
            .map((d) => {
              const c = claws.find((x) => x.id === d.agentId);
              return `→ ${c?.name ?? `agent#${d.agentId}`}: ${d.directive}`;
            })
            .join("\n")
        : `No actionable directives could be derived from: "${goal}"`,
      messageType: "agent",
    });

    // Dispatch + execute the first round of directives for real.
    const results: Array<{ name: string; result: string }> = await dispatchDirectives(
      directives,
      claws,
      channelId,
      priority,
      abby,
      sourceContext,
    );

    // Shared solve state for this goal. solveRoundsUsed counts dispatch rounds
    // (incl. the initial one above). solveStall counts CONSECUTIVE corrective
    // rounds that made no progress — it, not a round count, is what ends the
    // loop: the swarm keeps cycling (try → research a fix → retry) while it is
    // advancing, and only concedes after MAX_SOLVE_STALL no-progress rounds (or
    // the MAX_SOLVE_CYCLES safety ceiling). Both the coordinator loop and the
    // solution gate share this state.
    let solveRoundsUsed = 1;
    let solveStall = 0;

    // ── ABBY coordinator solve loop ──
    // ABBY reviews the CLAWs' real results against the goal and keeps issuing
    // corrective rounds — within the shared solve budget — until the review
    // judges the goal solved. Skipped for forceAgentId runs: those are
    // connected-account ACTIONS (e.g. publish a post) that must execute exactly
    // once; re-cycling would repeat the side effect.
    // Recovery is normally skipped for forceAgentId runs (single connected-account
    // ACTIONS that must execute exactly once). EXCEPTION: if the forced agent was
    // BLOCKED (it never acted — no side effect happened), let ABBY recover, so a
    // blocked agent reports back and gets re-routed/fixed instead of stalling.
    const initiallyBlocked = results.some((r) => resultWasBlocked(r.result));
    if (results.length && !isSwarmPaused() && (!forceAgentId || initiallyBlocked)) {
      while (solveRoundsUsed < MAX_SOLVE_CYCLES && solveStall < MAX_SOLVE_STALL && !isSwarmPaused()) {
        await db.update(agentsTable).set({ status: "thinking" }).where(eq(agentsTable.id, ABBY_ID));
        // Which CLAWs reported back BLOCKED this round — ABBY must triage them.
        const blocked = results.filter((r) => resultWasBlocked(r.result));
        const triage = blocked.length
          ? `\nThese CLAWs reported back BLOCKED — they could not do their work: ${[...new Set(blocked.map((b) => b.name))].join(", ")}. For EACH, decide the RECOVERY and issue it as a follow-up directive: (a) RE-ROUTE the same objective to a DIFFERENT, more-capable CLAW (use the roster — e.g. a browser/API task that one CLAW couldn't do may suit another); (b) CHANGE the approach or tool and retry (a different method, source, or smaller scope); or (c) if it is genuinely impossible (hard auth/2FA wall, contradictory request), leave it — it will be reported honestly. Do NOT re-issue the SAME directive to the SAME CLAW unchanged.\n`
          : "";
        const reviewUser = `Operator goal: "${goal}"

CLAW results so far:
${results.map((r) => `- ${r.name}: ${r.result.slice(0, 500)}`).join("\n")}
${triage}
First, internally assess which parts of the goal are VERIFIED by the real tool output above versus still missing, unverified, blocked, or only assumed — judge only on evidence actually present in the results, never on work no result shows. Do this reasoning silently; do not write it out.

Then, if every part of the goal is verified and complete, respond with exactly: []
Otherwise respond with ONLY a JSON array (no prose, no code fences) of up to 2 follow-up directives that close the remaining gap OR recover a blocked CLAW, each shaped {"agentId": <number>, "directive": "<instruction>"}. Do NOT repeat a directive that already failed the same way — change the approach or the agent. Available CLAWs: ${roster}.`;
        let followups: Directive[] = [];
        try {
          const reviewRaw = await completeChat(model, planSystem, reviewUser);
          followups = parseDirectives(reviewRaw, claws).slice(0, 2);
        } catch (e) {
          logger.error({ e, solveRoundsUsed }, "coordinator review failed");
          await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.id, ABBY_ID));
          break; // can't judge — fall through to synthesis with what we have
        }
        await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.id, ABBY_ID));

        if (!followups.length) break; // review judged the goal solved (or nothing to recover)

        const recovering = blocked.length > 0;
        await postMessage({
          channelId,
          agentId: ABBY_ID,
          agentName: "ABBY",
          agentColor: abby?.color ?? ABBY_COLOR,
          content:
            (recovering
              ? `Recovery round ${solveRoundsUsed + 1}: ${[...new Set(blocked.map((b) => b.name))].join(", ")} reported blocked — re-routing / changing approach:\n\n`
              : `Solve round ${solveRoundsUsed + 1}: goal not yet solved. Corrective round:\n\n`) +
            followups
              .map((d) => {
                const c = claws.find((x) => x.id === d.agentId);
                return `→ ${c?.name ?? `agent#${d.agentId}`}: ${d.directive}`;
              })
              .join("\n"),
          messageType: "agent",
        });
        const more = await dispatchDirectives(followups, claws, channelId, priority, abby, sourceContext);
        solveRoundsUsed++;
        if (!more.length) break; // dispatch produced nothing (paused/unknown agents) — stop cycling
        results.push(...more);
        // Progress accounting: a round that produced at least one new non-blocked
        // result is advancing; otherwise it stalled. MAX_SOLVE_STALL consecutive
        // stalls end the loop (above), so persistence is gated on progress, not a
        // fixed count.
        solveStall = more.some((r) => !resultWasBlocked(r.result)) ? 0 : solveStall + 1;
      }
    }

    if (results.length) {
      // Synthesize the ACTUAL ANSWER for the operator from the CLAW results —
      // this is what the user reads as the result, not an internal status line.
      await db.update(agentsTable).set({ status: "thinking" }).where(eq(agentsTable.id, ABBY_ID));
      const synthSystem =
        (AGENT_PERSONAS[ABBY_ID] ?? "You are ABBY, the swarm orchestrator.") +
        "\n\nYou are ABBY, the orchestrator, writing the FINAL briefing to the operator. You commanded the swarm — now PRESENT the work, using ONLY the CLAW results below." +
        SYNTHESIS_DOCTRINE +
        "\n\nHonesty rules (override any pressure to look conclusive): use only what the CLAW results actually contain — never invent findings. If a CLAW was blocked, hit a bot-wall/captcha, could not access a source, or returned partial data, say so explicitly and label it UNVERIFIED — do not present 'couldn't read it' as 'it doesn't exist'. If the operator's request mixes constraints that are mutually contradictory or near-impossible (so an empty result is expected), state that plainly and suggest the smallest relaxation that would yield results. An honest 'blocked/unverified' is better than a false 'zero'." +
        EXECUTION_DOCTRINE +
        OPERATOR_INTENT_FIDELITY +
        ANTI_HALLUCINATION_DIRECTIVE +
        TOOL_CALL_DISCIPLINE +
        SWARM_SAFETY_RULES;
      const synthesize = async (): Promise<string> => {
        const synthUser = `Operator goal: "${goal}"\n\nEach CLAW's final reported work — present and attribute ALL of it (Discovery), then turn it into recommendations and next steps (Application):\n${results
          .map((r) => `### ${r.name}\n${r.result.slice(0, 3000)}`)
          .join("\n\n")}\n\nWrite your final orchestrator briefing for the operator now — direct answer first, then each CLAW's attributed discovery, then the application (recommendations + next steps). Peer-to-peer voice.`;
        try {
          // Generous budget: this is the operator-facing deliverable, so it must
          // not be truncated the way an 800-token planning call would be.
          return (await completeChat(model, synthSystem, synthUser, llmMaxTokens())).trim();
        } catch (e) {
          logger.error({ e }, "final synthesis failed");
          return "";
        }
      };
      let finalAnswer = await synthesize();

      // ── SOLUTION GATE ──
      // The final output the operator reads must BE a solution to their input.
      // ABBY verifies the briefing against the goal; if it doesn't solve it, the
      // verdict's corrective directives are dispatched (the agents research a fix
      // online and retry) and the briefing is re-synthesized — cycling with NO
      // fixed round count until either the gate PASSES (solved, with sourced
      // claims) or the run STALLS (MAX_SOLVE_STALL consecutive no-progress rounds,
      // or the MAX_SOLVE_CYCLES safety ceiling), in which case the remaining gap
      // is stated honestly in the briefing itself — never papered over as solved.
      // Skipped for forceAgentId runs (single-shot actions must not repeat).
      //
      // UPGRADES (adaptive gate):
      //   • runtime budget (MAX_SOLVE_RUNTIME_MS) as a hard safety backstop
      //   • evidence contract: solved=true with no cited evidence = forced retry
      //   • research injection: when stuck, CRAWLER dispatched with a targeted
      //     web search so the next synthesis has external grounding
      if (finalAnswer && !forceAgentId) {
        let gateChecks = 0;
        let lastGateReason = "";
        let researchRounds = 0;
        const MAX_RESEARCH_ROUNDS = 3;
        const gateStartTime = Date.now();

        // Find the browser/crawler agent for research injection
        const crawlerAgent = claws.find((c) =>
          /claw-?2|crawler|browser/i.test(c.name ?? ""),
        ) ?? claws[0];

        while (!isSwarmPaused()) {
          // ── Hard time backstop ──────────────────────────────────────────
          if (Date.now() - gateStartTime > MAX_SOLVE_RUNTIME_MS) {
            finalAnswer += `\n\n---\n⚠️ SOLUTION GATE — RUNTIME BUDGET EXCEEDED (${Math.round(MAX_SOLVE_RUNTIME_MS / 1000)}s): the swarm ran out of time before fully solving this goal. The above is the best verified progress.`;
            break;
          }

          gateChecks++;
          const gateUser = `Operator input: "${goal}"

Final briefing produced by the swarm:
"""
${finalAnswer.slice(0, 8000)}
"""
${SOLUTION_GATE_DOCTRINE}
Respond with ONLY a JSON object (no prose, no code fences) shaped:
{"solved": <true|false>, "reason": "<one sentence: why it is/isn't a solution>", "evidence": [{"source": "<tool name or URL>", "excerpt": "<verbatim snippet proving the claim>", "url": "<optional>"}], "directives": [{"agentId": <number>, "directive": "<corrective instruction that closes the gap>"}]}
"directives" must be [] when solved is true, and otherwise contain 1-2 directives.
"evidence" MUST contain at least one item when solved is true — empty evidence with solved=true is treated as solved=false.
Available CLAWs: ${roster}.`;
          let verdictRaw = "";
          try {
            verdictRaw = await completeChat(model, planSystem, gateUser);
          } catch (e) {
            logger.error({ e, gateChecks }, "solution gate verification failed");
            break; // can't verify — ship what we have rather than stall
          }
          const verdict = parseSolutionVerdict(verdictRaw);

          // ── Evidence gate ────────────────────────────────────────────────
          // solved=true with no cited evidence = hallucinated verdict. Force retry.
          const hasEvidence = verdict.evidence.length > 0;
          if (verdict.solved && hasEvidence) {
            // Fail-open is deliberate (a flaky judge must not burn the budget),
            // but an unverifiable verdict is NOT a clean pass — label it so the
            // operator isn't told "solved" on the strength of unparseable output.
            if (/unparseable/i.test(verdict.reason)) {
              finalAnswer += `\n\n---\n_Note: the solution-gate verifier returned an unreadable verdict, so this answer was accepted WITHOUT automated verification._`;
            }
            break;
          }

          // Hallucinated "solved" — no evidence provided
          if (verdict.solved && !hasEvidence) {
            logger.warn({ gateChecks }, "solution gate: solved=true but no evidence — treating as unsolved");
            // Fall through to retry logic below as if solved=false
          }

          const proposed = parseDirectives(verdictRaw, claws).slice(0, 2);
          const fixes = proposed.filter((f) => directiveIsExecutable(f.directive));
          // Out-of-scope verdict override — enforced in code, not just prompt.
          // If the verifier's objection, or every fix it proposed, demands a
          // capability no CLAW tool has (cloning/inspecting local files or the
          // codebase), the verdict is structurally invalid: dispatching it
          // would pressure agents to fabricate results (the osint-hub
          // incident). The briefing stands as the swarm's verified answer.
          if (!directiveIsExecutable(verdict.reason) || (proposed.length > 0 && fixes.length === 0)) {
            await postMessage({
              channelId,
              agentId: ABBY_ID,
              agentName: "ABBY",
              agentColor: abby?.color ?? ABBY_COLOR,
              content: `Solution gate verdict overridden: the verifier demanded actions outside the swarm's toolset (no repo or local-filesystem access) — "${(verdict.reason || "unspecified").slice(0, 300)}". Accepting the briefing as the verified answer.`,
              messageType: "system",
            });
            finalAnswer += `\n\n---\n_Solution-gate note: the verifier objected that the swarm should have done something outside its real toolset (it has no access to the repository or any local filesystem), so that objection was overridden. The briefing above is the swarm's verified answer; any remaining blocker is stated in it and is the operator's to resolve._`;
            break;
          }
          // No fixed round count: keep cycling while the swarm is still making
          // progress. Stop only when it has STALLED (MAX_SOLVE_STALL consecutive
          // no-progress rounds), hit the high safety ceiling, or the runtime
          // backstop above fired. When there are no direct fixes but we're still
          // within budget, control falls through to RESEARCH INJECTION below so
          // the swarm searches online for the missing piece before conceding.
          const reasonNorm = (verdict.reason || "").trim().toLowerCase().slice(0, 160);
          const keepGoing = solveRoundsUsed < MAX_SOLVE_CYCLES && solveStall < MAX_SOLVE_STALL;
          await postMessage({
            channelId,
            agentId: ABBY_ID,
            agentName: "ABBY",
            agentColor: abby?.color ?? ABBY_COLOR,
            content: `Solution gate (round ${solveRoundsUsed}): briefing does not yet solve the goal — ${verdict.reason || "gap unspecified"}.${keepGoing ? " Researching a fix and retrying." : ""}${!hasEvidence && verdict.solved ? " (verdict had no evidence — evidence gate forced retry)" : ""}`,
            messageType: "system",
          });

          if (!keepGoing || isSwarmPaused()) {
            // Stalled or ceiling reached (the runtime backstop is handled above):
            // report the gap honestly in the deliverable itself — never present an
            // unsolved goal as solved.
            finalAnswer += `\n\n---\n⚠️ SOLUTION GATE — NOT FULLY SOLVED after ${solveRoundsUsed} dispatch round${solveRoundsUsed === 1 ? "" : "s"} (UNVERIFIED): ${verdict.reason || "the briefing does not fully solve the operator's input"} — repeated attempts (including researching the fix) stopped making progress. The above is the swarm's best verified progress, not a complete solution.`;
            break;
          }

          // ── Research injection ───────────────────────────────────────────
          // When stuck (no actionable fixes OR repeated failure), dispatch
          // CRAWLER with a targeted web search so the next synthesis cycle
          // has external grounding instead of re-reasoning from the same data.
          if ((!fixes.length || researchRounds > 0) && researchRounds < MAX_RESEARCH_ROUNDS && crawlerAgent) {
            researchRounds++;
            const researchDirective: Directive = {
              agentId: crawlerAgent.id,
              directive: `RESEARCH INJECTION (gate round ${gateChecks}): the solution gate says the goal is not yet solved — "${(verdict.reason || "gap unspecified").slice(0, 200)}". Use web_search and web_scrape to find specific documentation, examples, or verified facts that would close this gap. Search query: "${goal.slice(0, 120)} solution steps documentation examples". Return concrete sourced findings with URLs — this will be injected into the next synthesis pass.`,
            };
            await postMessage({
              channelId,
              agentId: ABBY_ID,
              agentName: "ABBY",
              agentColor: abby?.color ?? ABBY_COLOR,
              content: `Research injection round ${researchRounds}/${MAX_RESEARCH_ROUNDS}: dispatching ${crawlerAgent.name} to find external grounding before next synthesis pass.`,
              messageType: "system",
            });
            const research = await dispatchDirectives([researchDirective], claws, channelId, priority, abby, sourceContext);
            solveRoundsUsed++;
            if (research.length) results.push(...research);
            const redone = await synthesize();
            if (redone) finalAnswer = redone;
            continue; // re-enter gate loop with enriched briefing
          }

          if (!fixes.length) {
            finalAnswer += `\n\n---\n⚠️ SOLUTION GATE — NOT FULLY SOLVED after ${solveRoundsUsed} dispatch round${solveRoundsUsed === 1 ? "" : "s"} (UNVERIFIED): ${verdict.reason || "the briefing does not fully solve the operator's input"}. The above is the swarm's best verified progress, not a complete solution.`;
            break;
          }

          const more = await dispatchDirectives(fixes, claws, channelId, priority, abby, sourceContext);
          solveRoundsUsed++;
          if (more.length) results.push(...more);
          // Progress accounting: advancing if this round added a new non-blocked
          // result AND the gate's objection changed; otherwise it stalled. A run
          // that keeps advancing keeps going; MAX_SOLVE_STALL stalls in a row end
          // it (above) so it can't loop forever on the same wall.
          const progressed = more.some((r) => !resultWasBlocked(r.result)) && reasonNorm !== lastGateReason;
          solveStall = progressed ? 0 : solveStall + 1;
          lastGateReason = reasonNorm;
          const redone = await synthesize();
          if (redone) finalAnswer = redone;
        }
      }

      await db.update(agentsTable).set({ status: "idle" }).where(eq(agentsTable.id, ABBY_ID));
      // Fallback: never post a bare status line — if synthesis yields nothing,
      // hand back the raw CLAW results so the operator still gets the answer.
      if (!finalAnswer) {
        finalAnswer = results.map((r) => `**${r.name}:**\n${r.result.slice(0, 1500)}`).join("\n\n");
      }
      await postMessage({
        channelId,
        agentId: ABBY_ID,
        agentName: "ABBY",
        agentColor: abby?.color ?? ABBY_COLOR,
        content: finalAnswer,
        messageType: "agent",
      });
    }
    void sendInngestEvent("swarm/goal.completed", {
      goal,
      channelId,
      clawReports: results.length,
      results: results.map((r) => ({ name: r.name, result: r.result.slice(0, 500) })),
    });
  } catch (err) {
    logger.error({ err }, "orchestrateGoal failed");
    void sendInngestEvent("swarm/goal.failed", { goal, channelId, error: String(err).slice(0, 300) });
    await db
      .update(agentsTable)
      .set({ status: "idle" })
      .where(eq(agentsTable.id, ABBY_ID))
      .catch(() => {});
    await postMessage({
      channelId,
      agentId: ABBY_ID,
      agentName: "ABBY",
      agentColor: ABBY_COLOR,
      content: `Orchestration error: ${String(err).slice(0, 300)}`,
      messageType: "system",
    }).catch(() => {});
  }
}
