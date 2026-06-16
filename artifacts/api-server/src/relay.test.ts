/**
 * Primary/secondary collaboration relay contract (lib/relay.ts).
 *
 * The operator hands a goal to the PRIMARY; each swarm runs its own cycle and
 * forwards output to the peer until the PRIMARY judges the MVP done or the hard
 * round cap stops the loop. These tests pin the load-bearing invariants:
 *   - the feature is OFF unless explicitly enabled AND fully addressed;
 *   - only the PRIMARY can end the loop on "done"; the round cap stops either side;
 *   - the control-marker classifier maps a cycle's last line to the right kind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

// The relay module pulls in the orchestrator; stub it so these stay pure unit
// tests (no LLM, no swarm, no network).
vi.mock("./orchestrator", () => ({ orchestrateGoal: vi.fn(async () => {}) }));

import {
  relayEnabled,
  relayRole,
  relayMaxRounds,
  classifyOutput,
  decideTerminate,
  wrapRelayGoal,
} from "./lib/relay";

const RELAY_ENV = [
  "RELAY_ENABLED",
  "RELAY_PEER_URL",
  "RELAY_API_KEY",
  "RELAY_ROLE",
  "RELAY_MAX_ROUNDS",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of RELAY_ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of RELAY_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("relayEnabled — hard feature flag", () => {
  it("is OFF when nothing is configured", () => {
    expect(relayEnabled()).toBe(false);
  });

  it("is OFF when the flag is on but URL/key are missing", () => {
    process.env["RELAY_ENABLED"] = "true";
    expect(relayEnabled()).toBe(false);
    process.env["RELAY_PEER_URL"] = "https://peer.example.com";
    expect(relayEnabled()).toBe(false);
  });

  it("is ON only with flag + URL + key all set", () => {
    process.env["RELAY_ENABLED"] = "1";
    process.env["RELAY_PEER_URL"] = "https://peer.example.com";
    process.env["RELAY_API_KEY"] = "k";
    expect(relayEnabled()).toBe(true);
  });
});

describe("relayRole — defaults to secondary", () => {
  it("is secondary when unset (a misconfigured node never assumes primary authority)", () => {
    expect(relayRole()).toBe("secondary");
  });
  it("is primary only when explicitly set", () => {
    process.env["RELAY_ROLE"] = "primary";
    expect(relayRole()).toBe("primary");
  });
});

describe("relayMaxRounds — bounded default", () => {
  it("defaults to 8", () => {
    expect(relayMaxRounds()).toBe(8);
  });
  it("honours a sane override", () => {
    process.env["RELAY_MAX_ROUNDS"] = "4";
    expect(relayMaxRounds()).toBe(4);
  });
  it("ignores junk / out-of-range and falls back to 8", () => {
    process.env["RELAY_MAX_ROUNDS"] = "0";
    expect(relayMaxRounds()).toBe(8);
    process.env["RELAY_MAX_ROUNDS"] = "999";
    expect(relayMaxRounds()).toBe(8);
    process.env["RELAY_MAX_ROUNDS"] = "nope";
    expect(relayMaxRounds()).toBe(8);
  });
});

describe("classifyOutput — control-marker reader", () => {
  it("reads MVP-DONE as done", () => {
    expect(classifyOutput("did the work\nMVP-DONE: shipped the MVP").kind).toBe("done");
  });
  it("reads QUESTION as question", () => {
    expect(classifyOutput("analysis...\nQUESTION: which database?").kind).toBe("question");
  });
  it("reads NO-ACTION as no-action", () => {
    expect(classifyOutput("looked it over\nNO-ACTION: nothing for me here").kind).toBe("no-action");
  });
  it("reads CONTINUE as continue", () => {
    expect(classifyOutput("partial\nCONTINUE: wire the API next").kind).toBe("continue");
  });
  it("treats substantive output with no marker as a result", () => {
    expect(classifyOutput("here is the analysis with no marker").kind).toBe("result");
  });
  it("treats empty output as no-action", () => {
    expect(classifyOutput("   ").kind).toBe("no-action");
  });
});

describe("decideTerminate — primary owns 'done', round cap stops either side", () => {
  it("primary stops on its own done", () => {
    expect(decideTerminate({ role: "primary", round: 2, maxRounds: 8, kind: "done" })).toEqual({
      stop: true,
      reason: "primary-mvp-done",
    });
  });

  it("secondary CANNOT end the loop on done", () => {
    expect(decideTerminate({ role: "secondary", round: 2, maxRounds: 8, kind: "done" }).stop).toBe(false);
  });

  it("the round cap stops either side regardless of kind", () => {
    expect(decideTerminate({ role: "secondary", round: 8, maxRounds: 8, kind: "result" }).reason).toBe("round-cap");
    expect(decideTerminate({ role: "primary", round: 8, maxRounds: 8, kind: "continue" }).reason).toBe("round-cap");
  });

  it("keeps going mid-loop on an ordinary turn", () => {
    expect(decideTerminate({ role: "primary", round: 3, maxRounds: 8, kind: "result" }).stop).toBe(false);
  });
});

describe("wrapRelayGoal — carries role, goal, and the peer's input", () => {
  it("tells the secondary it may NOT declare done", () => {
    const w = wrapRelayGoal({ role: "secondary", round: 2, peerName: "NEWSUPERNOVA", goal: "build X", inputText: "primary output" });
    expect(w).toContain("SECONDARY");
    expect(w).toContain("may NOT declare the MVP done");
    expect(w).toContain("build X");
    expect(w).toContain("primary output");
  });
  it("tells the primary it is the final authority", () => {
    const w = wrapRelayGoal({ role: "primary", round: 1, peerName: "T800-AURA", goal: "build X", inputText: "go" });
    expect(w).toContain("FINAL authority");
    expect(w).toContain("MVP-DONE");
  });
});
