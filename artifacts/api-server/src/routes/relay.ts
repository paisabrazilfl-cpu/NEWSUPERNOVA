/**
 * Operator-facing control for the primary/secondary collaboration relay.
 * Mounted behind requireOperator (see routes/index.ts).
 *
 *   POST /api/relay        — (PRIMARY only) start a relay session for a goal
 *   GET  /api/relay        — list recent relay sessions
 *   GET  /api/relay/:id    — fetch one relay session by relayId
 */
import { Router } from "express";
import { db, relaySessionsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { relayEnabled, relayRole, relaySelfName, relayPeerName, startRelay } from "../lib/relay";

const router = Router();

router.post("/relay", async (req, res) => {
  if (!relayEnabled()) {
    res.status(503).json({ error: "Relay disabled — set RELAY_ENABLED + RELAY_PEER_URL + RELAY_API_KEY." });
    return;
  }
  if (relayRole() !== "primary") {
    res.status(409).json({ error: "This swarm is not the relay PRIMARY — only the primary starts a relay." });
    return;
  }
  const goal = String((req.body ?? {})["goal"] ?? "").trim();
  if (!goal) {
    res.status(400).json({ error: "goal is required" });
    return;
  }
  const channelIdRaw = (req.body ?? {})["channelId"];
  const channelId = Number.isFinite(Number(channelIdRaw)) ? Number(channelIdRaw) : undefined;
  try {
    const relayId = await startRelay({ goal, ...(channelId ? { channelId } : {}) });
    res.status(201).json({ relayId, status: "started" });
  } catch (err) {
    req.log.error({ err }, "relay: start failed");
    res.status(500).json({ error: "Failed to start relay" });
  }
});

router.get("/relay", async (_req, res) => {
  const rows = await db
    .select()
    .from(relaySessionsTable)
    .orderBy(desc(relaySessionsTable.id))
    .limit(50);
  // Include the relay config so the UI can label which side is working without
  // hardcoding swarm names (peerName = the OTHER swarm, e.g. T800-AURA on BOS).
  res.json({
    enabled: relayEnabled(),
    role: relayRole(),
    selfName: relaySelfName(),
    peerName: relayPeerName(),
    sessions: rows,
  });
});

// GET /api/relay/peer-agents — the OTHER swarm's live agents, fetched server-side
// from the peer's external API (Bearer RELAY_API_KEY = the peer's OPENCLAW_API_KEY).
// Lets the canvas draw the peer (e.g. T800-AURA) as an inner ring beside the local
// (Aura) outer ring, so the operator can see which side is working. Non-fatal:
// when the relay is off or the peer is unreachable it returns an empty list.
router.get("/relay/peer-agents", async (_req, res) => {
  const peerName = relayPeerName();
  if (!relayEnabled()) {
    res.json({ enabled: false, peerName, agents: [] });
    return;
  }
  const base = process.env["RELAY_PEER_URL"]!.replace(/\/$/, "");
  const key = process.env["RELAY_API_KEY"]!;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(`${base}/api/external/v1/agents`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ac.signal,
    });
    if (!r.ok) {
      res.json({ enabled: true, peerName, agents: [], error: `peer HTTP ${r.status}` });
      return;
    }
    const data = (await r.json()) as { agents?: Array<Record<string, unknown>> };
    const agents = (data.agents ?? []).map((a) => ({
      id: Number(a["id"]),
      name: String(a["name"] ?? ""),
      role: (a["role"] as string | null) ?? null,
      status: String(a["status"] ?? "idle"),
      color: String(a["color"] ?? "#8a8f98"),
      avatarInitials: (a["avatarInitials"] as string | null) ?? null,
    }));
    res.json({ enabled: true, peerName, agents });
  } catch (err) {
    res.json({ enabled: true, peerName, agents: [], error: String(err).slice(0, 200) });
  } finally {
    clearTimeout(timer);
  }
});

router.get("/relay/:id", async (req, res) => {
  const [row] = await db
    .select()
    .from(relaySessionsTable)
    .where(eq(relaySessionsTable.relayId, String(req.params.id)))
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "relay session not found" });
    return;
  }
  res.json({ session: row });
});

export default router;
