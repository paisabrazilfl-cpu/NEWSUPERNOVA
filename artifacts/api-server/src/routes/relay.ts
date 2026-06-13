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
