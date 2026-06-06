import { Router } from "express";
import { PLATFORMS, isPlatformConnected } from "../lib/connectors";

const router = Router();

// List official social platforms with their docs/console URLs and live
// connection status. Status is checked against Replit's connector proxy; no
// token value is ever returned to the client.
router.get("/social/platforms", async (_req, res) => {
  const platforms = Object.values(PLATFORMS);
  const rows = await Promise.all(
    platforms.map(async (p) => ({
      key: p.key,
      displayName: p.displayName,
      apiBase: p.apiBase,
      docsUrl: p.docsUrl,
      consoleUrl: p.consoleUrl,
      connected: await isPlatformConnected(p),
    })),
  );
  res.json(rows);
});

export default router;
