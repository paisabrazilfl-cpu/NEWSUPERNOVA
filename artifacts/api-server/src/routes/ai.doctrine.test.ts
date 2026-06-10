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
  ANTI_HALLUCINATION_DIRECTIVE,
  RESEARCH_PLAYBOOKS,
  SWARM_SAFETY_RULES,
  CODING_LIFECYCLE_DOCTRINE,
  requestsDownloadableArtifact,
  requestsImage,
  requestsConnectedAccountAction,
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

describe("CODING_LIFECYCLE_DOCTRINE — hardened, non-optional engineering workflow", () => {
  it("mandates autonomy: fix it yourself, do not hand back fixable to-dos", () => {
    expect(CODING_LIFECYCLE_DOCTRINE).toContain("FIX IT YOURSELF");
    expect(CODING_LIFECYCLE_DOCTRINE.toLowerCase()).toContain("can i fix this");
  });

  it("requires methodical dated branch names off the latest project with zero loss", () => {
    expect(CODING_LIFECYCLE_DOCTRINE).toContain("BRANCH-PER-PUSH");
    expect(CODING_LIFECYCLE_DOCTRINE.toUpperCase()).toContain("ZERO LOSS OF FUNCTION");
    expect(CODING_LIFECYCLE_DOCTRINE).toContain("NEVER REGRESS");
  });

  it("encodes the full self-reflect → plan → execute → verify → review lifecycle", () => {
    for (const phase of [
      "Self-Reflection",
      "Planning",
      "Execution",
      "Observation",
      "Verification",
      "Playwright",
      "Regression Check",
      "Root Cause Analysis",
      "Correction Loop",
      "Reflective Alignment Check",
    ]) {
      expect(CODING_LIFECYCLE_DOCTRINE, `lifecycle should include "${phase}"`).toContain(phase);
    }
  });

  it("requires evidence-based reporting with an execution trace + acceptance criteria", () => {
    expect(CODING_LIFECYCLE_DOCTRINE).toContain("EVIDENCE-BASED REPORTING");
    expect(CODING_LIFECYCLE_DOCTRINE).toContain("Execution Trace");
    expect(CODING_LIFECYCLE_DOCTRINE).toContain("Acceptance Criteria");
  });
});
