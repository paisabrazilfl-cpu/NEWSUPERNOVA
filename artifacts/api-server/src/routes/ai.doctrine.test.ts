import { describe, it, expect, vi } from "vitest";

// ai.ts pulls in the db (via the orchestrator import chain) at module load.
// Mock it the same way the other route tests do so importing the persona/
// doctrine constants never touches a real database.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("../test/dbMock");
  return { ...actual, db: mockDb };
});

import {
  AGENT_PERSONAS,
  ABBY_ID,
  EXECUTION_DOCTRINE,
  OPERATOR_INTENT_FIDELITY,
  ANTI_HALLUCINATION_DIRECTIVE,
  RESEARCH_PLAYBOOKS,
  SWARM_SAFETY_RULES,
  TOOL_CALL_DISCIPLINE,
  CODING_LIFECYCLE_DOCTRINE,
  JOB_COMPLETION_VALIDATOR,
  GITHUB_RENDER_OPERATIONS_DOCTRINE,
  SENIOR_SWE_GENIUS_DOCTRINE,
  SWE_SKILLS,
  requestsDownloadableArtifact,
  requestsImage,
  requestsConnectedAccountAction,
  requestsCodeWork,
  requestsGithubRenderWork,
  requestsSwarmExecution,
  CHAT_NO_TOOLS_DIRECTIVE,
  buildLiveReachCard,
} from "./ai";

describe("requestsDownloadableArtifact — deterministic dispatch for downloads", () => {
  it("triggers on clear artifact/download requests", () => {
    for (const m of [
      "save it as a downloadable markdown file with a download link",
      "create a deck for this and give me the download",
      "build a 24-slide presentation",
      "generate a CSV report",
      "make a PDF of the brief",
      "export this to a .docx",
      "give me a downloadable file",
    ]) {
      expect(requestsDownloadableArtifact(m)).toBe(true);
    }
  });

  it("does NOT trigger on pure conversation", () => {
    for (const m of ["who are you?", "save me time on this", "what is VPD?", "summarize this in one line"]) {
      expect(requestsDownloadableArtifact(m)).toBe(false);
    }
  });

  it("triggers on image requests routed through it", () => {
    expect(requestsDownloadableArtifact("ULTRA REALISTIC IMAGE OF A DOG")).toBe(true);
  });
});

describe("requestsImage — verb-less image-gen detection", () => {
  it("triggers on bare/verb-less image requests", () => {
    for (const m of [
      "ULTRA REALISTIC IMAGE OF A DOG",
      "image of a dog",
      "a photo of a sunset over mountains",
      "logo for my coffee brand",
      "an HD render of a sports car",
      "photorealistic portrait of a cat",
      "make me a poster",
      "draw a logo",
      "give me a picture of a robot",
      "i want an illustration of a dragon",
    ]) {
      expect(requestsImage(m), `should detect image request: "${m}"`).toBe(true);
    }
  });

  it("does NOT trigger on non-image conversation", () => {
    for (const m of [
      "who are you?",
      "what is VPD?",
      "summarize this report in one line",
      "build a CSV of leads",
      "explain how the swarm works",
    ]) {
      expect(requestsImage(m), `should NOT misfire on: "${m}"`).toBe(false);
    }
  });
});

describe("requestsConnectedAccountAction — dispatch operator-account requests, never refuse", () => {
  it("triggers on the operator's own connected accounts", () => {
    for (const m of [
      "Check my Instagram please do I have messages?",
      "any new emails?",
      "post to my LinkedIn",
      "what's on my calendar today?",
      "read my Gmail inbox",
      "send a DM on my Instagram",
      "do I have unread Slack messages",
      "open a GitHub issue on my repo",
      "Post to my IG right now as a test Ai news 2d image render",
      // Scheduled/cron-phrased posting tasks must ALSO classify as connected-account
      // actions so the cron path routes them to the Composio-capable agent (WIRE).
      "Every morning post the daily AI news card to my Instagram",
      "Post a motivational quote to my instagram feed",
      "publish today's market update to my IG",
    ]) {
      expect(requestsConnectedAccountAction(m), `should dispatch: "${m}"`).toBe(true);
    }
  });

  it("detects scheduled jobs whose NAME carries the platform but whose task does not (scheduler passes name+task)", () => {
    // Real production bug: job "Instagram Post news" had task "Post a New post on
    // the following topics at random, car news, world news…" — task-only detection
    // returned false, so the job fanned out to CLAWs without Instagram tools and
    // nothing ever reached Instagram. The scheduler now detects on `name + task`.
    const name = "Instagram Post  news";
    const task = "Post a New post on the following topics at random,  car news, world news, yacht news, ai news, finance and stocks news, and best stock of the day pick.";
    expect(requestsConnectedAccountAction(task)).toBe(false); // the task alone misses
    expect(requestsConnectedAccountAction(`${name} ${task}`)).toBe(true); // name+task catches it
  });

  it("an image-post-to-IG request takes the connected-account path, not the generic artifact path", () => {
    const m = "Post to my IG right now a 2d image render of AI news";
    // both detectors fire, but the override checks connected-account FIRST/guards
    // the artifact path, so this routes to the single Composio agent.
    expect(requestsConnectedAccountAction(m)).toBe(true);
    expect(requestsImage(m)).toBe(true);
  });

  it("does NOT trigger on unrelated conversation", () => {
    for (const m of ["who are you?", "explain TAM/SAM/SOM", "write a python script", "what is the capital of France?"]) {
      expect(requestsConnectedAccountAction(m), `should NOT fire on: "${m}"`).toBe(false);
    }
  });
});

// The fabricated "cognition" theater that was removed. None of it may come back
// to any agent persona — these are prompt strings with no implementing code.
const MYTHOLOGY = [
  "Expected Free Energy",
  "Mythos",
  "Predictive Inference",
  "cognitive mirror",
  "sovereign cognitive",
  "Axiomatic Execution",
  "PRISM",
  "tri-state",
  "never break character",
  "cyberpunk",
];

function assertNoMythology(text: string) {
  const lower = text.toLowerCase();
  for (const term of MYTHOLOGY) {
    expect(lower, `should not contain mythology term "${term}"`).not.toContain(term.toLowerCase());
  }
}

describe("ABBY persona — mythology removed, grounded worker", () => {
  const abby = AGENT_PERSONAS[ABBY_ID];

  it("is defined", () => {
    expect(abby).toBeTruthy();
  });

  it("carries none of the removed cognition theater", () => {
    assertNoMythology(abby!);
  });

  it("frames ABBY as a delegating, evidence-driven, self-reflecting worker", () => {
    for (const beat of ["PLAN FIRST", "DELEGATE", "DEMAND EVIDENCE", "SELF-REFLECT", "DELIVER"]) {
      expect(abby, `ABBY persona should include "${beat}"`).toContain(beat);
    }
  });
});

describe("specialist personas — clean of mythology", () => {
  for (const id of [2, 3, 4, 5, 6]) {
    it(`agent #${id} is defined and carries no mythology`, () => {
      const persona = AGENT_PERSONAS[id];
      expect(persona).toBeTruthy();
      assertNoMythology(persona!);
    });
  }
});

describe("buildLiveReachCard — every agent sees its tools + live integrations", () => {
  it("lists the agent's tools and splits integrations into ONLINE/OFFLINE", () => {
    process.env["TAVILY_API_KEY"] = "tvly-test";
    delete process.env["FIRECRAWL_API_KEY"];
    const card = buildLiveReachCard(ABBY_ID);
    expect(card).toContain("LIVE REACH");
    expect(card).toContain("Tools available to you:");
    expect(card).toContain("Integrations ONLINE:");
    expect(card).toContain("Integrations OFFLINE");
    expect(card).toMatch(/Integrations ONLINE:[^\n]*Tavily/);
    expect(card).toMatch(/OFFLINE[^\n]*Firecrawl/);
    delete process.env["TAVILY_API_KEY"];
  });

  it("is wired into the orchestrator's CLAW and planning prompts (source-level contract)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(new URL("../orchestrator.ts", import.meta.url), "utf8");
    // CLAW execution prompt and ABBY's planning prompt must both carry LIVE REACH.
    expect(src).toMatch(/const system = persona \+ toolGuide \+ buildLiveReachCard\(agent\.id\)/);
    expect(src).toMatch(/planSystem = [^;]*buildLiveReachCard\(ABBY_ID\)/);
  });
});

describe("OPERATOR_INTENT_FIDELITY — read commands as commands, act, don't bounce work back", () => {
  it("treats short/blunt operator messages as orders, not topics", () => {
    expect(OPERATOR_INTENT_FIDELITY).toContain("A COMMAND IS A COMMAND, NOT A TOPIC");
    expect(OPERATOR_INTENT_FIDELITY.toLowerCase()).toContain("orders to act now");
  });

  it("carries the whole conversation thread and resolves fragments against the goal", () => {
    expect(OPERATOR_INTENT_FIDELITY).toContain("CARRY THE WHOLE THREAD");
    expect(OPERATOR_INTENT_FIDELITY.toLowerCase()).toContain("never reset to zero");
  });

  it("forbids bouncing the work back when context already answers it", () => {
    expect(OPERATOR_INTENT_FIDELITY).toContain("DON'T BOUNCE THE WORK BACK");
    expect(OPERATOR_INTENT_FIDELITY).toContain("FORBIDDEN");
    expect(OPERATOR_INTENT_FIDELITY.toLowerCase()).toContain("ask the operator exactly one question only");
  });

  it("uses a supplied target instead of re-asking for an identifier already given", () => {
    expect(OPERATOR_INTENT_FIDELITY).toContain("WHEN THEY HAND YOU A TARGET, USE IT");
  });

  it("reads operator urgency/repetition as a signal to act harder, not to defer", () => {
    expect(OPERATOR_INTENT_FIDELITY).toContain("MATCH THE DEMAND'S FORCE");
    expect(OPERATOR_INTENT_FIDELITY.toLowerCase()).toContain("under-read");
  });
});

describe("EXECUTION_DOCTRINE — the 10/10 worker standard", () => {
  it("requires shipping the final product", () => {
    expect(EXECUTION_DOCTRINE).toContain("SHIP THE FINAL PRODUCT");
  });

  it("requires exhaustive-then-conclusive work", () => {
    expect(EXECUTION_DOCTRINE).toContain("EXHAUSTIVE, THEN CONCLUSIVE");
  });

  it("carries deep-research rules with multi-source cross-checking", () => {
    expect(EXECUTION_DOCTRINE).toContain("DEEP RESEARCH");
    expect(EXECUTION_DOCTRINE.toLowerCase()).toContain("two independent sources");
  });

  it("requires deciding over deferring back to the operator", () => {
    expect(EXECUTION_DOCTRINE).toContain("DECIDE, DON'T DEFER");
  });

  it("enforces an end-to-end definition of done", () => {
    expect(EXECUTION_DOCTRINE).toContain("DEFINITION OF DONE");
  });

  it("requires output to be the answer, not internal state", () => {
    expect(EXECUTION_DOCTRINE).toContain("OUTPUT IS THE ANSWER, NOT YOUR INTERNAL STATE");
  });
});

describe("RESEARCH_PLAYBOOKS — VPD(both) + market research + decks", () => {
  it("defines VPD as Vehicles Per Day (traffic/site research)", () => {
    expect(RESEARCH_PLAYBOOKS).toContain("VEHICLES PER DAY");
    expect(RESEARCH_PLAYBOOKS).toContain("VPD");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("aadt");
  });

  it("also covers Value Proposition Design", () => {
    expect(RESEARCH_PLAYBOOKS).toContain("VALUE PROPOSITION DESIGN");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("pain reliever");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("gain creator");
  });

  it("includes a market-research playbook with TAM/SAM/SOM", () => {
    expect(RESEARCH_PLAYBOOKS).toContain("MARKET RESEARCH");
    expect(RESEARCH_PLAYBOOKS).toContain("TAM/SAM/SOM");
  });

  it("includes a deck/presentation playbook with per-slide spec + design system", () => {
    expect(RESEARCH_PLAYBOOKS).toContain("DECK / PRESENTATION BUILDING");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("speaker notes");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("save_artifact");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("canva");
  });

  it("covers the domain library (SEO/AEO, marketing, geofencing, money, engineering)", () => {
    expect(RESEARCH_PLAYBOOKS).toContain("SEO / AEO / GEO");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("llms.txt");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("gptbot");
    expect(RESEARCH_PLAYBOOKS).toContain("PERFORMANCE MARKETING");
    expect(RESEARCH_PLAYBOOKS).toContain("GEOFENCING");
    expect(RESEARCH_PLAYBOOKS).toContain("UNIT ECONOMICS");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("cac");
  });
});

describe("RESEARCH_PLAYBOOKS — Tier-1 source policy", () => {
  it("carries the source hierarchy + evidence labeling + tier1_sources pointer", () => {
    expect(RESEARCH_PLAYBOOKS).toContain("SOURCE POLICY");
    expect(RESEARCH_PLAYBOOKS).toContain("CONFIRMED");
    expect(RESEARCH_PLAYBOOKS.toLowerCase()).toContain("tier1_sources");
  });
});

describe("EXECUTION_DOCTRINE — no internal-state / navel-gazing", () => {
  it("forbids reporting on the swarm itself", () => {
    expect(EXECUTION_DOCTRINE).toContain("NEVER REPORT ON THE SWARM ITSELF");
    expect(EXECUTION_DOCTRINE).toContain("DON'T NAVEL-GAZE IN MEMORY");
  });

  it("encodes a real learning loop: recall before researching, store the lesson after solving", () => {
    expect(EXECUTION_DOCTRINE).toContain("LEARN & REMEMBER");
    expect(EXECUTION_DOCTRINE).toContain("PROBLEM → SOLUTION");
    expect(EXECUTION_DOCTRINE.toLowerCase()).toContain("memory_search first");
    expect(EXECUTION_DOCTRINE.toLowerCase()).toContain("never has to learn it twice");
  });
});

describe("EXECUTION_DOCTRINE — self-learning on failure", () => {
  it("mandates the SELF-LEARN ON FAILURE protocol", () => {
    expect(EXECUTION_DOCTRINE).toContain("SELF-LEARN ON FAILURE");
  });

  it("encodes the diagnose → search memory → research online → retry → store loop", () => {
    expect(EXECUTION_DOCTRINE).toContain("DIAGNOSE");
    expect(EXECUTION_DOCTRINE).toContain("SEARCH MEMORY");
    expect(EXECUTION_DOCTRINE).toContain("RESEARCH ONLINE");
    expect(EXECUTION_DOCTRINE).toContain("RETRY");
    expect(EXECUTION_DOCTRINE).toContain("STORE THE LESSON");
  });

  it("limits research-retry cycles to prevent infinite loops", () => {
    expect(EXECUTION_DOCTRINE.toLowerCase()).toContain("3 research-retry cycles");
  });

  it("mandates relentless persistence — alternate tools/approaches before declaring blocked", () => {
    expect(EXECUTION_DOCTRINE).toContain("RELENTLESS PERSISTENCE");
    expect(EXECUTION_DOCTRINE).toContain("a different tool for the same job");
    expect(EXECUTION_DOCTRINE).toMatch(/LIST each approach attempted/);
    expect(EXECUTION_DOCTRINE).toContain("Never downgrade the goal");
  });

  it("frames the agent as self-improving — failures become permanent lessons", () => {
    expect(EXECUTION_DOCTRINE).toContain("SELF-IMPROVING");
    expect(EXECUTION_DOCTRINE.toLowerCase()).toContain("permanently smarter");
  });
});

describe("ANTI_HALLUCINATION_DIRECTIVE — still intact alongside the doctrine", () => {
  it("keeps the evidence-discipline guardrail", () => {
    expect(ANTI_HALLUCINATION_DIRECTIVE).toContain("EVIDENCE DISCIPLINE");
  });
});

describe("TOOL_CALL_DISCIPLINE — hardened rules from the LinkedIn-fraud run", () => {
  it("forbids guessing slugs and mandates discovery-first", () => {
    expect(TOOL_CALL_DISCIPLINE).toContain("DISCOVER, NEVER GUESS");
    expect(TOOL_CALL_DISCIPLINE).toContain("composio_tools");
    expect(TOOL_CALL_DISCIPLINE.toLowerCase()).toContain("your guessed name");
  });

  it("forbids transplanting one app's path shape onto another", () => {
    expect(TOOL_CALL_DISCIPLINE).toContain("PATHS ARE APP-SPECIFIC");
    expect(TOOL_CALL_DISCIPLINE).toContain("/gmail/v1/users/me/");
    expect(TOOL_CALL_DISCIPLINE).toContain("/me/");
  });

  it("makes agents judge the inner payload, not the proxy wrapper status", () => {
    expect(TOOL_CALL_DISCIPLINE).toContain("JUDGE THE INNER PAYLOAD");
    expect(TOOL_CALL_DISCIPLINE.toLowerCase()).toContain("failed call");
  });

  it("bans identical-call retries — one variable per retry, then switch method", () => {
    expect(TOOL_CALL_DISCIPLINE).toContain("ONE VARIABLE PER RETRY");
    expect(TOOL_CALL_DISCIPLINE.toLowerCase()).toContain("never resend an identical call");
  });

  it("makes a 2xx this run permanent ground truth a later malformed failure cannot override", () => {
    expect(TOOL_CALL_DISCIPLINE).toContain("A 2xx THIS RUN IS GROUND TRUTH");
    expect(TOOL_CALL_DISCIPLINE.toLowerCase()).toContain("not connected");
    expect(TOOL_CALL_DISCIPLINE.toLowerCase()).toContain("malformed call");
  });

  it("requires a well-formed authenticated attempt before reporting a capability absent", () => {
    expect(TOOL_CALL_DISCIPLINE).toContain("ONLY A WELL-FORMED CALL CAN PROVE ABSENCE");
    expect(TOOL_CALL_DISCIPLINE.toLowerCase()).toContain("verbatim");
  });

  it("treats 402/429 as infrastructure conditions: shrink, never resend the same oversized call", () => {
    expect(TOOL_CALL_DISCIPLINE).toContain("BUDGET/INFRA ERRORS ARE NOT TASK ERRORS");
    expect(TOOL_CALL_DISCIPLINE).toContain("402");
    expect(TOOL_CALL_DISCIPLINE).toContain("429");
  });

  it("encodes the connected-app escalation ladder", () => {
    expect(TOOL_CALL_DISCIPLINE).toContain("ESCALATION LADDER");
    expect(TOOL_CALL_DISCIPLINE).toContain("composio_apps");
    expect(TOOL_CALL_DISCIPLINE).toContain("composio_action");
  });
});

describe("SWARM_SAFETY_RULES — hardened guardrails from the STOCKVAULT incident", () => {
  it("bans raw secrets in the open and demands rotation on leak", () => {
    expect(SWARM_SAFETY_RULES).toContain("SECRETS NEVER IN THE OPEN");
    expect(SWARM_SAFETY_RULES).toContain("ghp_");
    expect(SWARM_SAFETY_RULES).toContain("rnd_");
    expect(SWARM_SAFETY_RULES.toUpperCase()).toContain("ROTATE");
  });

  it("makes the swarm read the vault and use {{secret:NAME}} instead of reporting keys missing", () => {
    expect(SWARM_SAFETY_RULES).toContain("CREDENTIALS LIVE IN THE OPERATOR'S SETTINGS");
    expect(SWARM_SAFETY_RULES).toContain("{{secret:NAME}}");
    expect(SWARM_SAFETY_RULES.toUpperCase()).toContain("WRITE-ONLY");
    expect(SWARM_SAFETY_RULES.toLowerCase()).toContain("never report a present secret as missing");
  });

  it("forbids fabricated build/deploy/test success", () => {
    expect(SWARM_SAFETY_RULES).toContain("NO FABRICATED SUCCESS");
    expect(SWARM_SAFETY_RULES).toContain("NOT deployed");
  });

  it("forbids fabricating/padding data and reporting empty results as success", () => {
    expect(SWARM_SAFETY_RULES).toContain("NEVER FABRICATE OR PAD DATA");
    expect(SWARM_SAFETY_RULES.toLowerCase()).toContain("placeholder symbols");
  });

  it("requires attaching auth instead of misdiagnosing a self-inflicted 401", () => {
    expect(SWARM_SAFETY_RULES).toContain("AUTHENTICATE, DON'T MISDIAGNOSE");
    expect(SWARM_SAFETY_RULES).toContain("401/403");
  });

  it("forbids destructive git (no force-push, no main, no mass-deletion)", () => {
    expect(SWARM_SAFETY_RULES.toLowerCase()).toContain("never force-push");
    expect(SWARM_SAFETY_RULES.toLowerCase()).toContain("never push to main");
  });

  it("forbids introducing a foreign stack into the TS monorepo", () => {
    expect(SWARM_SAFETY_RULES).toContain("STAY IN THE STACK");
    expect(SWARM_SAFETY_RULES.toLowerCase()).toContain("flask");
  });

  it("requires stop-and-ask over blind retry / guessing", () => {
    expect(SWARM_SAFETY_RULES).toContain("STOP-AND-ASK BEATS GUESS");
  });
});

describe("CODING_LIFECYCLE_DOCTRINE — verified job completion contract", () => {
  it("states the core law: text/README/clone is not completion; only inspected+changed+verified code is", () => {
    expect(CODING_LIFECYCLE_DOCTRINE).toContain("VERIFIED JOB COMPLETION CONTRACT");
    expect(CODING_LIFECYCLE_DOCTRINE).toContain("CORE LAW");
    const lower = CODING_LIFECYCLE_DOCTRINE.toLowerCase();
    expect(lower).toContain("created a readme");
    expect(lower).toContain("cloned a repo");
    expect(lower).toContain("inspected, changed where necessary, and verified");
  });

  it("encodes the full mandatory execution order", () => {
    for (const phase of [
      "READ FIRST",
      "ACCEPTANCE CRITERIA FIRST",
      "SELF-REFLECTION BEFORE EDITING",
      "PLAN",
      "EXECUTE FOCUSED CHANGES",
      "OBSERVE",
      "VERIFY",
      "UI VALIDATION",
      "FAILURE LOOP",
      "REGRESSION CHECK",
      "BRANCH / GIT SAFETY",
      "DEFINITION OF DONE",
    ]) {
      expect(CODING_LIFECYCLE_DOCTRINE, `execution order should include "${phase}"`).toContain(phase);
    }
  });

  it("bans unearned completion claims", () => {
    expect(CODING_LIFECYCLE_DOCTRINE).toContain("BANNED COMPLETION CLAIMS");
    expect(CODING_LIFECYCLE_DOCTRINE).toContain('"Should work" means UNVERIFIED');
    expect(CODING_LIFECYCLE_DOCTRINE.toLowerCase()).toContain("unless the test command was run and passed");
  });

  it("forbids markdown/text-only completion for code tasks", () => {
    expect(CODING_LIFECYCLE_DOCTRINE).toContain("CODE TASKS CANNOT COMPLETE AS TEXT ONLY");
    expect(CODING_LIFECYCLE_DOCTRINE).toContain("UNVERIFIED, PARTIAL, or BLOCKED");
  });

  it("keeps git safety + autonomy invariants", () => {
    const lower = CODING_LIFECYCLE_DOCTRINE.toLowerCase();
    expect(lower).toContain("never force-push");
    expect(lower).toContain("never push directly to main");
    expect(lower).toContain("branch from latest main");
    expect(CODING_LIFECYCLE_DOCTRINE).toContain("AUTONOMY");
    expect(lower).toContain("do not hand the operator work you can do yourself");
  });
});

describe("JOB_COMPLETION_VALIDATOR — final synthesis gate", () => {
  it("forces exactly one of COMPLETE/PARTIAL/BLOCKED on observed evidence", () => {
    expect(JOB_COMPLETION_VALIDATOR).toContain("FINAL SYNTHESIS GATE");
    for (const status of ["COMPLETE", "PARTIAL", "BLOCKED"]) {
      expect(JOB_COMPLETION_VALIDATOR).toContain(status);
    }
    expect(JOB_COMPLETION_VALIDATOR).toContain("observed evidence from THIS run");
  });

  it("forbids COMPLETE for markdown-only / acknowledgement-only / unverified output", () => {
    const lower = JOB_COMPLETION_VALIDATOR.toLowerCase();
    expect(lower).toContain("markdown-only");
    expect(lower).toContain("only an acknowledgement was sent");
    expect(lower).toContain("never summarize a failed verification as success");
  });
});

describe("GITHUB_RENDER_OPERATIONS_DOCTRINE — push ≠ deploy ≠ live", () => {
  it("separates push, deploy, and live verification as distinct states", () => {
    expect(GITHUB_RENDER_OPERATIONS_DOCTRINE).toContain("GITHUB + RENDER OPERATIONS DOCTRINE");
    const lower = GITHUB_RENDER_OPERATIONS_DOCTRINE.toLowerCase();
    expect(lower).toContain("a push is not complete until the remote github branch exists");
    expect(lower).toContain("render deployment is not complete");
    expect(lower).toContain("live web app is not verified until the deployed url");
  });

  it("bans 'pushed'/'deployed'/'live' claims without real evidence", () => {
    expect(GITHUB_RENDER_OPERATIONS_DOCTRINE).toContain("BANNED CLAIMS");
    const lower = GITHUB_RENDER_OPERATIONS_DOCTRINE.toLowerCase();
    expect(lower).toContain('"pushed" is forbidden unless the remote branch/commit exists');
    expect(lower).toContain('"deployed" is forbidden');
    expect(lower).toContain('"live" is forbidden unless the public url returns the expected response');
  });
});

describe("SENIOR_SWE_GENIUS_DOCTRINE + SWE skills", () => {
  it("carries the genius loop: map → localize → root-cause → surgical patch → verify", () => {
    expect(SENIOR_SWE_GENIUS_DOCTRINE).toContain("SENIOR SOFTWARE ENGINEERING GENIUS DOCTRINE");
    expect(SENIOR_SWE_GENIUS_DOCTRINE).toContain("THE GENIUS LOOP");
    for (const beat of ["MAP THE SYSTEM", "LOCALIZE BEFORE PATCHING", "ROOT-CAUSE HYPOTHESIS", "VERIFICATION LADDER", "REVIEW YOUR OWN DIFF"]) {
      expect(SENIOR_SWE_GENIUS_DOCTRINE, `genius loop should include "${beat}"`).toContain(beat);
    }
  });

  it("bundles the composable SWE skills", () => {
    expect(SWE_SKILLS).toContain("REPO MAPPING SKILL");
    expect(SWE_SKILLS).toContain("BUG LOCALIZATION SKILL");
    expect(SWE_SKILLS).toContain("VERIFICATION SKILL");
  });
});

describe("requestsCodeWork — deterministic coding/repo/deploy dispatch detector", () => {
  it("fires on coding, repo, build, test, and deploy work", () => {
    for (const m of [
      "fix the bug in the api route",
      "harden the deploy pipeline",
      "run the tests and build",
      "read the repo files and inspect the logs",
      "refactor the orchestrator code",
      "make ABBY a coding genius",
    ]) {
      expect(requestsCodeWork(m), `should dispatch as code work: "${m}"`).toBe(true);
    }
  });

  it("does NOT fire on pure conversation", () => {
    for (const m of ["who are you?", "what is the capital of France?", "summarize this in one line", "what's a good marketing strategy?"]) {
      expect(requestsCodeWork(m), `should NOT fire on: "${m}"`).toBe(false);
    }
  });
});

describe("requestsSwarmExecution — dispatch explicit swarm/search/research requests", () => {
  it("fires when the operator explicitly invokes the swarm or its tools", () => {
    for (const m of [
      "100x this information and no rush use the swarm",
      "use your online search and deepsearch this",
      "deep search the latest solana token guides",
      "run the swarm on this",
      "use the web search for me",
      "search the web for phantom wallet docs",
      "dispatch CRAWLER to scrape this site",
      "look up the current SOL price",
      "find me the official spl-token CLI docs",
      "research the best DEXes for a new token",
      "google this and report back",
    ]) {
      expect(requestsSwarmExecution(m), `should dispatch as swarm work: "${m}"`).toBe(true);
    }
  });

  it("fires on requests pinned to live/current data the inline reply cannot have", () => {
    for (const m of [
      "what's today's news on crypto",
      "give me the latest prices for SOL and ETH",
      "current weather in Miami right now",
    ]) {
      expect(requestsSwarmExecution(m), `should dispatch (live data): "${m}"`).toBe(true);
    }
  });

  it("does NOT fire on pure conversation answerable inline", () => {
    for (const m of [
      "who are you?",
      "what is VPD?",
      "explain how the swarm works",
      "summarize this in one line",
      "thanks, that's helpful",
      "what's a good marketing strategy in general?",
    ]) {
      expect(requestsSwarmExecution(m), `should NOT fire on: "${m}"`).toBe(false);
    }
  });
});

describe("CHAT_NO_TOOLS_DIRECTIVE — inline reply must not fake tool work", () => {
  it("states the inline reply runs with no tools", () => {
    expect(CHAT_NO_TOOLS_DIRECTIVE).toContain("NO TOOLS");
    expect(CHAT_NO_TOOLS_DIRECTIVE.toLowerCase()).toContain("cannot search the web");
  });

  it("forbids emitting tool-call markup or narrating tool use", () => {
    expect(CHAT_NO_TOOLS_DIRECTIVE.toLowerCase()).toContain("never emit tool-call json");
    expect(CHAT_NO_TOOLS_DIRECTIVE.toLowerCase()).toContain("never narrate using a tool");
  });

  it("forbids fabricated search/sandbox/save results and invented links", () => {
    const lower = CHAT_NO_TOOLS_DIRECTIVE.toLowerCase();
    expect(lower).toContain("never claim you searched");
    expect(lower).toContain("never invent urls");
    expect(lower).toContain("download link");
  });

  it("points real tool work at dispatch to the CLAWs, not self-simulation", () => {
    const lower = CHAT_NO_TOOLS_DIRECTIVE.toLowerCase();
    expect(lower).toContain("dispatched to the claws");
    expect(lower).toContain("do not simulate the swarm");
  });
});

describe("requestsGithubRenderWork — GitHub/Render operations detector", () => {
  it("fires on repo/deploy operations", () => {
    for (const m of ["push this to github", "trigger a render deploy", "create a PR for this", "verify the live url", "deploy to render and check the logs"]) {
      expect(requestsGithubRenderWork(m), `should fire: "${m}"`).toBe(true);
    }
  });

  it("does NOT fire on non-repo/deploy messages", () => {
    for (const m of ["who are you?", "fix the typo in this sentence", "what's the weather"]) {
      expect(requestsGithubRenderWork(m), `should NOT fire: "${m}"`).toBe(false);
    }
  });
});
