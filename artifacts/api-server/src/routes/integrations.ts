/**
 * OPENCLAW OMEGA — Integration status + Composio connection management.
 *
 * GET /api/integrations is public-safe (booleans only, no key values).
 *
 * The /api/integrations/composio/* endpoints drive connecting external apps
 * (Gmail, Slack, GitHub, …) into Composio so the agent swarm can act on them.
 * They are operator-gated (requireOperator) because they initiate OAuth and
 * expose which accounts are connected.
 */

import { Router } from "express";
import {
  integrationStatus,
  composioConfigured,
  composioListToolkits,
  composioListConnections,
  composioConnect,
  composioConnectionStatus,
  composioDeleteConnection,
} from "../lib/integrations";
import { requireOperator } from "../lib/auth";
import { vaultHealth } from "../lib/vaultHealth";

const router = Router();

// GET /api/integrations
router.get("/integrations", (_req, res) => {
  const items = integrationStatus();
  res.json({
    integrations: items,
    configuredCount: items.filter((i) => i.configured).length,
    total: items.length,
    // Orphaned vault rows (count only — never names) so a key change that
    // silently turned integrations Off is a visible, explained signal.
    vault: vaultHealth(),
  });
});

// ─── Composio connection management ──────────────────────────────────────────

function guardComposio(res: import("express").Response): boolean {
  if (!composioConfigured()) {
    res.status(400).json({ error: "Composio is not configured — set COMPOSIO_API_KEY." });
    return false;
  }
  return true;
}

// GET /api/integrations/composio/toolkits?search=gmail — list connectable apps
router.get("/integrations/composio/toolkits", requireOperator, async (req, res) => {
  if (!guardComposio(res)) return;
  try {
    const search = typeof req.query["search"] === "string" ? req.query["search"] : undefined;
    res.json({ toolkits: await composioListToolkits(search) });
  } catch (err) {
    req.log.error({ err }, "composio: list toolkits failed");
    res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// GET /api/integrations/composio/connections — list connected accounts + status
router.get("/integrations/composio/connections", requireOperator, async (req, res) => {
  if (!guardComposio(res)) return;
  try {
    res.json({ connections: await composioListConnections() });
  } catch (err) {
    req.log.error({ err }, "composio: list connections failed");
    res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// POST /api/integrations/composio/connect  { toolkit, userId? }
// Finds-or-creates the app's auth config and initiates a connection. Returns the
// OAuth authorize URL the operator opens to approve access.
router.post("/integrations/composio/connect", requireOperator, async (req, res) => {
  if (!guardComposio(res)) return;
  const { toolkit, userId } = (req.body ?? {}) as { toolkit?: string; userId?: string };
  if (!toolkit?.trim()) {
    res.status(400).json({ error: "toolkit is required (e.g. 'gmail', 'slack', 'github')." });
    return;
  }
  try {
    const result = await composioConnect(toolkit.trim(), userId?.trim() || "operator");
    res.status(201).json(result);
  } catch (err) {
    req.log.error({ err, toolkit }, "composio: connect failed");
    res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// GET /api/integrations/composio/connections/:id — poll a connection's status
router.get("/integrations/composio/connections/:id", requireOperator, async (req, res) => {
  if (!guardComposio(res)) return;
  try {
    res.json(await composioConnectionStatus(String(req.params.id)));
  } catch (err) {
    req.log.error({ err }, "composio: connection status failed");
    res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

// DELETE /api/integrations/composio/connections/:id — remove a connected account
// (e.g. an EXPIRED linkedin/slack entry) so the operator can re-connect cleanly.
router.delete("/integrations/composio/connections/:id", requireOperator, async (req, res) => {
  if (!guardComposio(res)) return;
  try {
    await composioDeleteConnection(String(req.params.id));
    res.json({ ok: true, deleted: String(req.params.id) });
  } catch (err) {
    req.log.error({ err, connectionId: req.params.id }, "composio: delete connection failed");
    res.status(502).json({ error: String(err instanceof Error ? err.message : err) });
  }
});

export default router;
