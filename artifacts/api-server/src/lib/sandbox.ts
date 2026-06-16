/**
 * E2B cloud dev-sandbox — gives the agent swarm a real, isolated computer.
 *
 * Agents can run shell (pnpm/tsc/vitest/node/curl/playwright) and clone THIS
 * repo to build/test/edit and open a PR — all inside a disposable E2B VM that
 * has zero access to the production server or its secrets.
 *
 * SECURITY:
 *  - The GitHub token (SANDBOX_GITHUB_TOKEN) is used ONLY by this module, only to
 *    authenticate the clone/push of the ONE allowed repo. It is never placed in a
 *    command whose output is returned to the model, and the working remote is
 *    reset to a token-free URL before any agent-supplied script runs.
 *  - All git operations are hard-scoped to GITHUB_REPO — a broad token cannot be
 *    used by agents to touch any other repository through these tools.
 */

import { Sandbox } from "e2b";

// The only repository agents may clone/push through these tools.
const GITHUB_REPO = "paisabrazilfl-cpu/newsupernova";
const GITHUB_API = "https://api.github.com";
const SANDBOX_TIMEOUT_MS = 180_000;

export function sandboxConfigured(): boolean {
  return !!process.env["E2B_API_KEY"];
}
export function gitWriteConfigured(): boolean {
  return !!process.env["SANDBOX_GITHUB_TOKEN"];
}

function clip(s: string, n = 6000): string {
  return s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s;
}

interface ExecResult { exitCode: number; stdout: string; stderr: string; }

// A writable working dir inside the sandbox (the sandbox user cannot write "/").
const WORKDIR = "/tmp/repo";

/**
 * Run a command, capturing the result whether it exits 0 or not. The e2b SDK
 * THROWS a CommandExitError on non-zero exit, so we catch it and normalize back
 * into a result (a failing test/build is data, not an exception).
 */
async function execCapture(sbx: Sandbox, cmd: string, timeoutMs: number): Promise<ExecResult> {
  try {
    const r = (await sbx.commands.run(cmd, { timeoutMs })) as ExecResult;
    return { exitCode: r.exitCode ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  } catch (e) {
    const err = e as { exitCode?: number; stdout?: string; stderr?: string; result?: ExecResult; message?: string };
    const res = err.result;
    if (res || err.exitCode != null || err.stdout != null || err.stderr != null) {
      return {
        exitCode: res?.exitCode ?? err.exitCode ?? 1,
        stdout: res?.stdout ?? err.stdout ?? "",
        stderr: res?.stderr ?? err.stderr ?? err.message ?? String(e),
      };
    }
    throw e; // a genuine failure (sandbox died / timed out), not a non-zero exit
  }
}

/** Run a single shell script inside a fresh, disposable E2B sandbox. */
export async function runInSandbox(script: string, timeoutMs = SANDBOX_TIMEOUT_MS): Promise<string> {
  const apiKey = process.env["E2B_API_KEY"];
  if (!apiKey) return "error: E2B_API_KEY is not set — the cloud sandbox is unavailable.";
  let sbx: Sandbox | null = null;
  try {
    sbx = await Sandbox.create({ apiKey, timeoutMs });
    const r = await execCapture(sbx, script, timeoutMs - 5000);
    const parts = [`exit code: ${r.exitCode}`];
    if (r.stdout.trim()) parts.push(`stdout:\n${clip(r.stdout.trim())}`);
    if (r.stderr.trim()) parts.push(`stderr:\n${clip(r.stderr.trim())}`);
    if (!r.stdout.trim() && !r.stderr.trim()) parts.push("(no output)");
    return parts.join("\n");
  } catch (e) {
    return `error: sandbox execution failed: ${String(e instanceof Error ? e.message : e).slice(0, 300)}`;
  } finally {
    try { await sbx?.kill(); } catch { /* best-effort */ }
  }
}

/** Internal: run a command, throwing (with stderr) on non-zero, else returning stdout. */
async function must(sbx: Sandbox, cmd: string, label: string): Promise<string> {
  const r = await execCapture(sbx, cmd, 120_000);
  if (r.exitCode !== 0) throw new Error(`${label} failed (exit ${r.exitCode}): ${clip((r.stderr || r.stdout || "").trim(), 500)}`);
  return r.stdout.trim();
}

export interface RepoPrOptions {
  branch: string;
  /** Shell script run inside the cloned repo (cwd = repo root) to make changes/run tests. */
  script: string;
  title: string;
  body?: string;
  baseBranch?: string;
}

/**
 * Clone GITHUB_REPO into a sandbox, run the agent's script (no token in scope),
 * commit any changes, push the branch (token only in tool-run push command), and
 * open a PR via the GitHub API (token stays server-side). Returns the script
 * output + PR URL. Never returns the token or push-command output to the model.
 */
export async function repoPr(opts: RepoPrOptions): Promise<string> {
  const e2bKey = process.env["E2B_API_KEY"];
  const ghToken = process.env["SANDBOX_GITHUB_TOKEN"];
  if (!e2bKey) return "error: E2B_API_KEY is not set.";
  if (!ghToken) return "error: SANDBOX_GITHUB_TOKEN is not set — agents cannot push/PR until the operator sets it.";

  const branch = opts.branch.replace(/[^A-Za-z0-9._/-]/g, "-").slice(0, 100);
  const base = (opts.baseBranch ?? "main").replace(/[^A-Za-z0-9._/-]/g, "-");
  const authUrl = `https://x-access-token:${ghToken}@github.com/${GITHUB_REPO}.git`;
  const cleanUrl = `https://github.com/${GITHUB_REPO}.git`;

  let sbx: Sandbox | null = null;
  try {
    sbx = await Sandbox.create({ apiKey: e2bKey, timeoutMs: SANDBOX_TIMEOUT_MS });

    // Phase 1 (tool): clone with auth into a writable dir, then strip the token
    // from the remote so the agent script can't read it. Create the working branch.
    await must(sbx, `rm -rf ${WORKDIR} && git clone --depth 1 --branch ${base} '${authUrl}' ${WORKDIR}`, "clone");
    await must(sbx, `cd ${WORKDIR} && git remote set-url origin '${cleanUrl}' && git config user.email agent@openclaw.local && git config user.name "OpenClaw Agent" && git checkout -b '${branch}'`, "branch setup");

    // Phase 2 (agent script): runs with a token-free remote. Output IS returned
    // (captured whether it exits 0 or not — a failing test is still useful info).
    const scriptRes = await execCapture(sbx, `cd ${WORKDIR} && ${opts.script}`, 150_000);
    const scriptOut = clip(`exit ${scriptRes.exitCode}\n${(scriptRes.stdout || "").trim()}\n${(scriptRes.stderr || "").trim()}`.trim(), 4000);

    // Phase 3 (tool): commit. Abort cleanly if the script produced no changes.
    const status = await must(sbx, `cd ${WORKDIR} && git add -A && git status --porcelain`, "git status");
    if (!status.trim()) {
      return `The script ran but produced no file changes — nothing to open a PR for.\n\nScript output:\n${scriptOut}`;
    }
    await must(sbx, `cd ${WORKDIR} && git commit -m ${JSON.stringify(opts.title)}`, "commit");

    // Phase 4 (tool): push using the auth URL directly (token not persisted, output not returned).
    const push = await execCapture(sbx, `cd ${WORKDIR} && git push '${authUrl}' '${branch}' 2>&1 | sed -E 's#x-access-token:[^@]*@#***@#g'`, 60_000);
    if (push.exitCode !== 0) throw new Error(`push failed (exit ${push.exitCode}): ${clip((push.stdout || push.stderr).trim(), 300)}`);

    // Phase 5 (server): open the PR via GitHub API (token stays here, never in the VM output).
    const pr = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/pulls`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ghToken}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "openclaw-agent" },
      body: JSON.stringify({ title: opts.title, head: branch, base, body: opts.body ?? "Opened by an OpenClaw agent from an E2B sandbox." }),
    });
    const prBody = (await pr.json()) as { html_url?: string; message?: string };
    if (!pr.ok) {
      return `Branch '${branch}' pushed, but opening the PR failed (${pr.status}: ${prBody.message ?? "unknown"}). Open it manually from the branch.\n\nScript output:\n${scriptOut}`;
    }
    return `✅ Pushed branch '${branch}' and opened PR: ${prBody.html_url}\n\nScript output:\n${scriptOut}`;
  } catch (e) {
    return `error: repo PR flow failed: ${String(e instanceof Error ? e.message : e).slice(0, 400)}`;
  } finally {
    try { await sbx?.kill(); } catch { /* best-effort */ }
  }
}
