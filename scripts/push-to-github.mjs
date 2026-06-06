#!/usr/bin/env node
// One-shot push script — run with: node scripts/push-to-github.mjs
import { execSync } from "child_process";
import { existsSync } from "fs";

const GH_TOKEN = process.env.GITHUB_TOKEN;
if (!GH_TOKEN) {
  console.error("ERROR: GITHUB_TOKEN env var is required (no hardcoded token).");
  process.exit(1);
}
const REMOTE = `https://x-token:${GH_TOKEN}@github.com/paisabrazilfl-cpu/BOS-AURA.git`;

function run(cmd, opts = {}) {
  console.log(`$ ${cmd.replace(GH_TOKEN, "***")}`);
  return execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts }).trim();
}

try {
  // Config identity
  run(`git config user.email "openclaw@abbyclaw.io"`);
  run(`git config user.name "OPENCLAW OMEGA"`);

  // Remove secrets from tracking before push
  const trackedSecrets = [
    "attached_assets/Pasted-OPEN-ROUTER-AI-REDACTED_1780705489533.txt",
    "attached_assets/Pasted--name-firecrawl-description-Firecrawl-gives-AI-agents-a_1780704485514.txt",
    "attached_assets/Pasted-Here-is-a-comprehensive-system-blueprint-and-design-pro_1780702657055.txt",
    "attached_assets/Pasted-INTERNAL-RULE-DO-NOT-ASK-ME-TO-FIX-ANYTHING-IF-YOU-CAN-_1780701965396.txt",
    ".replit",
  ];

  for (const f of trackedSecrets) {
    try {
      run(`git rm --cached "${f}"`);
      console.log(`  untracked: ${f}`);
    } catch {
      // already untracked or doesn't exist
    }
  }

  // Stage .gitignore update
  run(`git add .gitignore`);

  // Commit the cleanup
  try {
    run(`git commit -m "chore: remove secrets from tracking, update .gitignore"`);
    console.log("Committed cleanup");
  } catch (e) {
    console.log("Nothing new to commit or already clean:", e.message?.slice(0, 80));
  }

  // Push
  const result = run(
    `git push "${REMOTE}" HEAD:main --force-with-lease`,
    { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }
  );
  console.log("Push result:", result || "(clean push)");
  console.log("\n✅ PUSHED TO: https://github.com/paisabrazilfl-cpu/BOS-AURA");
  console.log("🚀 RENDER URL: https://bos-aura.onrender.com");
} catch (err) {
  console.error("ERROR:", err.message);
  if (err.stdout) console.error("stdout:", err.stdout.toString().slice(0, 500));
  if (err.stderr) console.error("stderr:", err.stderr.toString().slice(0, 500));
  process.exit(1);
}
