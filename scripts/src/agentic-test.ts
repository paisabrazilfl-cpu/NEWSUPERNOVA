import { createHash } from "node:crypto";

const BASE = (process.env["BASE_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
const CHANNEL = 1;
const TIMEOUT_MS = 180_000;

const nonce = Math.random().toString(36).slice(2, 12);
const secret = `openclaw-agentic-proof-${nonce}`;
const expected = createHash("sha256").update(secret).digest("hex");

const goal =
  `Use the code_exec tool to run Python that computes and prints ONLY the SHA-256 hex digest ` +
  `of this exact string: "${secret}". Report that 64-character hex digest as your final answer.`;

interface Msg {
  id: number;
  agentName?: string | null;
  content?: string | null;
  messageType: string;
}

async function getMessages(): Promise<Msg[]> {
  const r = await fetch(`${BASE}/api/channels/${CHANNEL}/messages`);
  return (await r.json()) as Msg[];
}

async function main() {
  console.log(`nonce string : ${secret}`);
  console.log(`expected hash: ${expected}\n`);

  const before = await getMessages();
  const baseId = before.length ? before[before.length - 1].id : 0;

  const r = await fetch(`${BASE}/api/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      command: goal,
      priority: "high",
      channelId: CHANNEL,
    }),
  });

  console.log(`dispatch → HTTP ${r.status}`);

  if (!r.ok) {
    console.log("dispatch failed:", (await r.text()).slice(0, 200));
    process.exit(1);
  }

  let planSeen = false;
  let toolRan = false;
  let hashFound = false;
  let errored = "";

  const start = Date.now();

  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((res) => setTimeout(res, 5000));

    const fresh = (await getMessages()).filter((m) => m.id > baseId);

    planSeen = fresh.some((m) => /orchestrat/i.test(m.content ?? ""));

    toolRan = fresh.some(
      (m) =>
        m.messageType === "tool_output" &&
        /(code_exec|exit code|stdout)/i.test(m.content ?? "")
    );

    hashFound = fresh.some((m) =>
      (m.content ?? "").toLowerCase().includes(expected)
    );

    const errMsg = fresh.find(
      (m) =>
        /error|out of credits|402|failed/i.test(m.content ?? "") &&
        m.messageType === "system"
    );

    if (errMsg) errored = errMsg.content ?? "";

    console.log(
      `  [${String(Math.round((Date.now() - start) / 1000)).padStart(
        3
      )}s] new=${fresh.length} plan=${
        planSeen ? "Y" : "·"
      } toolOutput=${toolRan ? "Y" : "·"} correctHash=${
        hashFound ? "Y" : "·"
      }`
    );

    if (hashFound) break;
  }

  const fresh = (await getMessages()).filter((m) => m.id > baseId);

  console.log("\n--- live swarm feed (what actually happened) ---");
  for (const m of fresh) {
    console.log(
      `  [${(m.agentName ?? m.messageType).padEnd(11)}] ${(
        m.content ?? ""
      )
        .replace(/\s+/g, " ")
        .slice(0, 150)}`
    );
  }

  console.log("\n=== AGENTIC VERDICT ===");
  console.log(
    `  goal decomposed/dispatched : ${
      planSeen || fresh.length > 0 ? "YES" : "NO"
    }`
  );
  console.log(`  real tool executed (feed)  : ${toolRan ? "YES" : "NO"}`);
  console.log(
    `  UNFAKEABLE correct hash    : ${
      hashFound
        ? "YES ✅  (only possible by actually running code_exec)"
        : "NO"
    }`
  );

  if (errored) {
    console.log(
      `  note: a system error appeared → ${errored.slice(0, 160)}`
    );
  }

  console.log(
    `\n  RESULT: ${
      hashFound ? "PASS — verified genuinely agentic" : "NOT PROVEN"
    }`
  );

  process.exit(hashFound ? 0 : 1);
}

main().catch((e) => {
  console.error("agentic-test crashed:", e);
  process.exit(1);
});
