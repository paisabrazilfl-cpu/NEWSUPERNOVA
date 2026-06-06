/**
 * OPENCLAW OMEGA — Integration status.
 *
 * Reports which third-party integrations are configured on the server. Returns
 * ONLY booleans + metadata — never any key value — so it is safe to surface in
 * the dashboard.
 */

import { Router } from "express";
import { integrationStatus } from "../lib/integrations";

const router = Router();

// GET /api/integrations
router.get("/integrations", (_req, res) => {
  const items = integrationStatus();
  res.json({
    integrations: items,
    configuredCount: items.filter((i) => i.configured).length,
    total: items.length,
  });
});

export default router;
