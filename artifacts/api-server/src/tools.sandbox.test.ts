import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// tools.ts pulls in the db via its import chain; mock it like the other tool
// tests so importing the registry never touches a real database. With an empty
// db the vault has no secrets, so an unknown {{secret:NAME}} stays unresolved —
// which is exactly the guard path we want to exercise.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("./test/dbMock");
  return { ...actual, db: mockDb };
});

// Mock the E2B sandbox so the tools never spin up a real VM. runInSandbox echoes
// back the script it was handed, letting us assert that resolved {{secret}}
// placeholders actually reach the VM command (and that unresolved ones don't).
// vi.hoisted defines the spy alongside the hoisted vi.mock factory so it's
// initialized before the factory runs.
const { runInSandbox } = vi.hoisted(() => ({
  runInSandbox: vi.fn(async (script: string) => `exit code: 0\nstdout:\n${script}`),
}));
vi.mock("./lib/sandbox", () => ({
  runInSandbox,
  repoPr: vi.fn(),
  sandboxConfigured: () => true,
  gitWriteConfigured: () => true,
}));

import { TOOL_REGISTRY, normalizeGitHubAuth } from "./tools";

describe("normalizeGitHubAuth — fix GitHub git auth form", () => {
  it("rewrites a bare-token github URL to the x-access-token form that works", () => {
    expect(normalizeGitHubAuth("git push https://ghp_abc123@github.com/o/r.git")).toBe(
      "git push https://x-access-token:ghp_abc123@github.com/o/r.git",
    );
  });

  it("leaves an already-correct x-access-token URL untouched", () => {
    const ok = "https://x-access-token:ghp_abc123@github.com/o/r.git";
    expect(normalizeGitHubAuth(ok)).toBe(ok);
  });

  it("leaves a credential-free github URL untouched", () => {
    const plain = "git clone --mirror https://github.com/paisabrazilfl-cpu/NEWSUPERNOVA.git";
    expect(normalizeGitHubAuth(plain)).toBe(plain);
  });

  it("rewrites every occurrence (clone source + push remote)", () => {
    const s =
      "git remote set-url origin https://TOK@github.com/o/r.git && git push https://TOK@github.com/o/r.git";
    expect(normalizeGitHubAuth(s)).toBe(
      "git remote set-url origin https://x-access-token:TOK@github.com/o/r.git && git push https://x-access-token:TOK@github.com/o/r.git",
    );
  });
});

const ctx = { agentId: 1, agentName: "ABBY" } as never;

describe("sandbox_exec — vault secret resolution", () => {
  beforeEach(() => runInSandbox.mockClear());

  it("passes a script with no secret placeholder straight through to the VM", async () => {
    const out = await TOOL_REGISTRY.sandbox_exec!.run({ script: "echo hello" }, ctx);
    expect(runInSandbox).toHaveBeenCalledOnce();
    expect(runInSandbox.mock.calls[0]![0]).toContain("echo hello");
    expect(out).toContain("hello");
  });

  it("refuses to run when a {{secret:NAME}} placeholder cannot be resolved (name not in vault)", async () => {
    const out = await TOOL_REGISTRY.sandbox_exec!.run(
      { script: "git push https://{{secret:DOES_NOT_EXIST}}@github.com/o/r.git" },
      ctx,
    );
    expect(out).toContain("did not resolve");
    // Critically: nothing was executed — the literal placeholder never reaches git.
    expect(runInSandbox).not.toHaveBeenCalled();
  });
});
