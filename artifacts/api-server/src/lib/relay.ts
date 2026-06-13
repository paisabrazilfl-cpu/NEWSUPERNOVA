/**
 * OPENCLAW OMEGA — Primary/Secondary collaboration relay.
 *
 * Two swarms owned by the same operator (BOS-AURA = primary, T800-AURA =
 * secondary) work a goal together. The operator hands the goal to the PRIMARY.
 * Each side runs its OWN orchestrator cycle on the input it receives — i.e.
 * each analyses the work as an independent swarm — and forwards its output to
 * the peer as the peer's next input. They go back and forth until the PRIMARY
 * judges the MVP complete or the hard round cap is reached.
 *
 * SAFETY / DESIGN:
 *  - Feature-flagged: a no-op unless RELAY_ENABLED is truthy AND both
 *    RELAY_PEER_URL and RELAY_API_KEY are set. Unset = nothing runs, and no
 *    deploy is needed to disable it.
 *  - Hard round cap (RELAY_MAX_ROUNDS, default 8) force-stops the loop
 *    regardless of any "done" signal, so two live LLM swarms can never ping-pong
 *    forever / burn budget unbounded.
 *  - Only the PRIMARY may declare the MVP done — the secondary can only reply
 *    question / result / no-action / continue.
 *  - Asynchronous: an inbound turn is ACK'd immediately and the cycle runs in
 *    the background, posting the result back to the peer when finished. No HTTP
 *    connection is held open across a multi-minute swarm cycle.
 *  - Idempotent: each turn carries (relayId, round); a re-delivered turn whose
 *    round was already processed is skipped.
 *  - Best-effort transport: a down/throttled peer can never throw into the
 *    caller's request path.
 */
import { and, desc, eq, gt } from "drizzle-orm";
import { db, relaySessionsTable, messagesTable } from "@workspace/db";
import { logger } from "./logger";
import { orchestrateGoal } from "../orchestrator";

export type RelayRole = "primary" | "secondary";
export type RelayKind = "turn" | "question" | "result" | "no-action" | "done" | "continue";

/** The relay is live only when explicitly enabled AND fully addressed. */
export function relayEnabled(): boolean {
  const flag = (process.env["RELAY_ENABLED"] ?? "").toLowerCase();
  const on = flag === "1" || flag === "true" || flag === "yes";
  return on && !!process.env["RELAY_PEER_URL"] && !!process.env["RELAY_API_KEY"];
}

/** This deployment's role. Defaults to "secondary" — a misconfigured node must
 * never silently assume the authority to declare the MVP done. */
export function relayRole(): RelayRole {
  return (process.env["RELAY_ROLE"] ?? "").toLowerCase() === "primary" ? "primary" : "secondary";
}

export function relaySelfName(): string {
  return (process.env["RELAY_SELF_NAME"] ?? (relayRole() === "primary" ? "PRIMARY" : "SECONDARY")).slice(0, 40);
}

export function relayPeerName(): string {
  return (process.env["RELAY_PEER_NAME"] ?? "peer").slice(0, 40);
}

/** Absolute ceiling on round-trips, regardless of any "done" signal. */
export function relayMaxRounds(): number {
  const v = Number(process.env["RELAY_MAX_ROUNDS"]);
  return Number.isFinite(v) && v >= 1 && v <= 50 ? Math.floor(v) : 8;
}

/**
 * The criteria the PRIMARY applies when deciding the MVP is genuinely done.
 * Injected into every cycle's goal so each swarm works toward the same bar and
 * leans on every tool it holds (code, git, browser/research, social, memory).
 */
export const RELAY_DEFINITION_OF_DONE = [
  "Definition of done — judge the MVP holistically across EVERY dimension, using every tool you have:",
  "- CODE: written, executed, and verified to actually run (FORGE / code sandbox).",
  "- GITHUB: changes committed and pushed / a PR opened where applicable (sandbox git tools).",
  "- FRONT-END: any UI built and validated, not just described.",
  "- RESEARCH: competitors and prior art searched on the LIVE internet (browser) and accounted for.",
  "- TASK: the operator's goal fully satisfied end-to-end — a shippable result, not a draft or outline.",
].join("\n");

/**
 * Classify a cycle's final output into a control kind by reading the trailing
 * control marker the swarm was asked to emit. Deterministic and side-effect
 * free so it can be unit-tested. Falls back to "result" for substantive output
 * and "no-action" for empty output.
 */
export function classifyOutput(text: string): { kind: RelayKind; summary: string } {
  const body = (text ?? "").trim();
  if (!body) return { kind: "no-action", summary: "(no output produced)" };
  // Scan the last few non-empty lines for a marker (the swarm emits it last).
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(-5).reverse()) {
    const m = /^(MVP-DONE|NO-ACTION|QUESTION|CONTINUE)\s*[:\-]\s*(.*)$/i.exec(line);
    if (m) {
      const marker = m[1].toUpperCase();
      const summary = (m[2] ?? "").slice(0, 500) || line.slice(0, 500);
      if (marker === "MVP-DONE") return { kind: "done", summary };
      if (marker === "NO-ACTION") return { kind: "no-action", summary };
      if (marker === "QUESTION") return { kind: "question", summary };
      return { kind: "continue", summary };
    }
  }
  return { kind: "result", summary: body.slice(0, 500) };
}

/**
 * Decide whether the loop stops after this side's cycle. The PRIMARY owns the
 * "done" verdict; a "done" from a secondary is ignored (downgraded to a normal
 * turn). The hard round cap stops EITHER side.
 */
export function decideTerminate(o: {
  role: RelayRole;
  round: number;
  maxRounds: number;
  kind: RelayKind;
}): { stop: boolean; reason: string } {
  if (o.round >= o.maxRounds) return { stop: true, reason: "round-cap" };
  if (o.role === "primary" && o.kind === "done") return { stop: true, reason: "primary-mvp-done" };
  return { stop: false, reason: "continue" };
}

/** Build the goal text handed to this side's orchestrator for one relay turn. */
export function wrapRelayGoal(o: {
  role: RelayRole;
  round: number;
  peerName: string;
  goal: string;
  inputText: string;
}): string {
  const roleNote =
    o.role === "primary"
      ? `You are the PRIMARY swarm and the FINAL authority on whether the MVP is done. Only you may emit "MVP-DONE".`
      : `You are the SECONDARY swarm. Analyse this independently and do your part. You may NOT declare the MVP done — instead reply with your result, a QUESTION, or NO-ACTION.`;
  return [
    `[RELAY round ${o.round}] ${roleNote}`,
    ``,
    `Original operator goal:`,
    `"""`,
    o.goal.slice(0, 8000),
    `"""`,
    ``,
    `Latest input from the ${o.peerName} swarm (treat as your input for this round):`,
    `"""`,
    o.inputText.slice(0, 12000),
    `"""`,
    ``,
    RELAY_DEFINITION_OF_DONE,
    ``,
    `Do the real work now using all tools available to you. Then, on the FINAL line, emit EXACTLY ONE control marker:`,
    `- "MVP-DONE: <one-line summary>"  (PRIMARY ONLY — the whole MVP meets the definition of done)`,
    `- "QUESTION: <question>"          (you need the other swarm to decide/clarify before continuing)`,
    `- "NO-ACTION: <why>"              (nothing further is needed from your side this round)`,
    `- "CONTINUE: <next step>"         (work remains; the other swarm should take the next pass)`,
  ].join("\n");
}

/** POST one turn to the peer's inbound relay endpoint. Best-effort; never throws. */
export async function sendTurn(turn: {
  relayId: string;
  round: number;
  goal: string;
  kind: RelayKind;
  payload: string;
}): Promise<string> {
  if (!relayEnabled()) return "relay disabled";
  const base = process.env["RELAY_PEER_URL"]!.replace(/\/$/, "");
  const key = process.env["RELAY_API_KEY"]!;
  const url = `${base}/api/external/v1/relay`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...turn, from: relaySelfName() }),
      signal: ac.signal,
    });
    if (!r.ok) {
      const body = (await r.text().catch(() => "")).slice(0, 200);
      logger.warn({ status: r.status, body, relayId: turn.relayId }, "relay: peer rejected turn");
      return `relay: HTTP ${r.status}`;
    }
    return "relay: turn sent";
  } catch (err) {
    logger.warn({ err: String(err), relayId: turn.relayId }, "relay: peer unreachable");
    return "relay: peer unreachable";
  } finally {
    clearTimeout(timer);
  }
}

async function postRelayNote(channelId: number, content: string): Promise<void> {
  try {
    await db.insert(messagesTable).values({
      channelId,
      agentId: null,
      agentName: "RELAY",
      agentColor: "#22d3ee",
      content: content.slice(0, 20_000),
      messageType: "system",
      metadata: JSON.stringify({ source: "relay" }),
    });
  } catch (err) {
    logger.warn({ err: String(err) }, "relay: failed to post note");
  }
}

/** Newest ABBY ("agent" type) message text written to the channel after `sinceId`. */
async function readCycleOutput(channelId: number, sinceId: number): Promise<string> {
  const rows = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.channelId, channelId),
        gt(messagesTable.id, sinceId),
        eq(messagesTable.messageType, "agent"),
      ),
    )
    .orderBy(desc(messagesTable.id))
    .limit(1);
  return rows[0]?.content?.trim() ?? "";
}

async function upsertSession(s: {
  relayId: string;
  goal: string;
  channelId: number;
  round: number;
  status: string;
  lastActor: string;
  lastKind: RelayKind;
  lastPayload: string;
}): Promise<void> {
  const [existing] = await db
    .select({ id: relaySessionsTable.id })
    .from(relaySessionsTable)
    .where(eq(relaySessionsTable.relayId, s.relayId))
    .limit(1);
  const values = {
    role: relayRole(),
    round: s.round,
    status: s.status,
    lastActor: s.lastActor,
    lastKind: s.lastKind,
    lastPayload: s.lastPayload.slice(0, 12000),
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(relaySessionsTable).set(values).where(eq(relaySessionsTable.id, existing.id));
  } else {
    await db.insert(relaySessionsTable).values({
      relayId: s.relayId,
      goal: s.goal.slice(0, 8000),
      channelId: s.channelId,
      ...values,
    });
  }
}

/**
 * Run ONE relay turn on this swarm: orchestrate the wrapped goal, read back the
 * output, classify it, decide whether to stop, and either finalize or forward
 * the next turn to the peer. Best-effort; never throws into the caller.
 */
export async function cycleAndForward(o: {
  relayId: string;
  round: number;
  goal: string;
  inputText: string;
  channelId: number;
}): Promise<void> {
  if (!relayEnabled()) return;
  const role = relayRole();
  const maxRounds = relayMaxRounds();
  const peerName = relayPeerName();
  try {
    // Mark THIS swarm as actively working this round so the operator's UI can
    // show a live cue. Creating the row here (if missing) means a freshly
    // started relay appears immediately, not only once the first cycle returns.
    await upsertSession({
      relayId: o.relayId, goal: o.goal, channelId: o.channelId, round: o.round,
      status: "self-working", lastActor: relaySelfName(), lastKind: "turn",
      lastPayload: o.inputText,
    }).catch(() => {});

    const [latest] = await db
      .select({ id: messagesTable.id })
      .from(messagesTable)
      .orderBy(desc(messagesTable.id))
      .limit(1);
    const sinceId = latest?.id ?? 0;

    await orchestrateGoal({
      goal: wrapRelayGoal({ role, round: o.round, peerName, goal: o.goal, inputText: o.inputText }),
      channelId: o.channelId,
      priority: "normal",
    });

    const output = await readCycleOutput(o.channelId, sinceId);
    const { kind } = classifyOutput(output);
    const term = decideTerminate({ role, round: o.round, maxRounds, kind });

    if (term.stop) {
      const status = term.reason === "round-cap" ? "aborted" : "done";
      await upsertSession({
        relayId: o.relayId, goal: o.goal, channelId: o.channelId, round: o.round,
        status, lastActor: relaySelfName(), lastKind: kind, lastPayload: output,
      });
      await postRelayNote(
        o.channelId,
        `RELAY ${o.relayId} ${status === "done" ? "COMPLETE" : "STOPPED"} at round ${o.round} (${term.reason}).\n${output.slice(0, 4000)}`,
      );
      // Tell the peer to close its side too (best-effort).
      await sendTurn({ relayId: o.relayId, round: o.round, goal: o.goal, kind: "done", payload: output });
      return;
    }

    const nextRound = o.round + 1;
    // Hand the next turn to the peer FIRST, then record the outcome so the
    // status is truthful: "awaiting-peer" (the peer swarm is now working) only
    // when the handoff actually reached it, otherwise "stalled".
    const sendResult = await sendTurn({ relayId: o.relayId, round: nextRound, goal: o.goal, kind: "turn", payload: output });
    const handedOff = sendResult === "relay: turn sent";
    await upsertSession({
      relayId: o.relayId, goal: o.goal, channelId: o.channelId, round: o.round,
      status: handedOff ? "awaiting-peer" : "stalled",
      lastActor: relaySelfName(), lastKind: kind,
      lastPayload: handedOff ? output : `[handoff failed: ${sendResult}]\n${output}`,
    });
  } catch (err) {
    logger.error({ err: String(err), relayId: o.relayId }, "relay: cycle failed");
    await upsertSession({
      relayId: o.relayId, goal: o.goal, channelId: o.channelId, round: o.round,
      status: "error", lastActor: relaySelfName(), lastKind: "no-action", lastPayload: String(err).slice(0, 500),
    }).catch(() => {});
  }
}

/**
 * PRIMARY-only entry point: the operator hands a goal to this swarm. Mints a
 * relayId, opens the session, and runs the first cycle (which forwards to the
 * secondary). Returns the relayId so the operator can track it.
 */
export async function startRelay(o: { goal: string; channelId?: number }): Promise<string> {
  const relayId = `relay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channelId = o.channelId ?? 1;
  await postRelayNote(channelId, `RELAY ${relayId} START (round 1) — goal: ${o.goal.slice(0, 500)}`);
  // Round 1: the primary works the operator goal directly, then forwards.
  void cycleAndForward({ relayId, round: 1, goal: o.goal, inputText: o.goal, channelId }).catch((err) =>
    logger.error({ err: String(err), relayId }, "relay: startRelay cycle crashed"),
  );
  return relayId;
}

/** Mark this side's session closed when the peer signals done/closed. */
export async function closeRelay(relayId: string, payload: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(relaySessionsTable)
    .where(eq(relaySessionsTable.relayId, relayId))
    .limit(1);
  if (!existing) return;
  await db
    .update(relaySessionsTable)
    .set({ status: "done", lastKind: "done", lastActor: relayPeerName(), lastPayload: payload.slice(0, 12000), updatedAt: new Date() })
    .where(eq(relaySessionsTable.id, existing.id));
  await postRelayNote(existing.channelId, `RELAY ${relayId} closed by ${relayPeerName()}.`);
}
