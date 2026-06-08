import { Router } from "express";

const router = Router();
const STEEL_BASE = "https://api.steel.dev/v1";

function steelHeaders() {
  const key = process.env["STEEL_API_KEY"];
  if (!key) throw new Error("STEEL_API_KEY is not set");
  return { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };
}

// fetch with a hard timeout so a hung Steel API can't hold a request open
// forever (the Steel calls previously had no AbortController).
async function steelFetch(path: string, init?: RequestInit, timeoutMs = 20000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${STEEL_BASE}${path}`, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// List all sessions
router.get("/steel/sessions", async (req, res) => {
  try {
    const r = await steelFetch(`/sessions`, { headers: steelHeaders() });
    const data = await r.json().catch(() => ({ error: "Steel returned a non-JSON body" }));
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to list Steel sessions");
    res.status(500).json({ error: "Failed to list Steel sessions" });
  }
});

// Get a single session
router.get("/steel/sessions/:id", async (req, res) => {
  try {
    const r = await steelFetch(`/sessions/${req.params.id}`, { headers: steelHeaders() });
    const data = await r.json().catch(() => ({ error: "Steel returned a non-JSON body" }));
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to get Steel session");
    res.status(500).json({ error: "Failed to get Steel session" });
  }
});

// Create a new session
router.post("/steel/sessions", async (req, res) => {
  const { useProxy = false, solveCaptcha = false, sessionTimeout = 600000, userAgent, dimensions } = req.body ?? {};
  try {
    const body: Record<string, unknown> = { sessionTimeout, solveCaptcha, useProxy };
    if (userAgent) body.userAgent = userAgent;
    // Match the live browser viewport to the embedding container so the player
    // fills the panel instead of floating a fixed 1920x1080 window inside it.
    // Dimensions MUST be even — the live-stream H.264 encoder rejects odd
    // width/height with "Invalid live-stream request" (WHEP 400).
    if (
      dimensions &&
      typeof dimensions === "object" &&
      Number(dimensions.width) > 0 &&
      Number(dimensions.height) > 0
    ) {
      const toEven = (v: unknown, lo: number, hi: number) => {
        const n = Math.max(lo, Math.min(hi, Math.round(Number(v))));
        return n - (n % 2);
      };
      body.dimensions = {
        width: toEven(dimensions.width, 640, 1920),
        height: toEven(dimensions.height, 480, 1200),
      };
    }
    const r = await fetch(`${STEEL_BASE}/sessions`, {
      method: "POST",
      headers: steelHeaders(),
      body: JSON.stringify(body),
    });
    const data = await r.json();
    res.status(r.ok ? 201 : r.status).json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to create Steel session");
    res.status(500).json({ error: "Failed to create Steel session" });
  }
});

// Release (delete) a session
router.delete("/steel/sessions/:id", async (req, res) => {
  try {
    const r = await fetch(`${STEEL_BASE}/sessions/${req.params.id}`, {
      method: "DELETE",
      headers: steelHeaders(),
    });
    if (r.status === 204 || r.status === 200) {
      res.status(204).send();
    } else {
      const data = await r.json();
      res.status(r.status).json(data);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to release Steel session");
    res.status(500).json({ error: "Failed to release Steel session" });
  }
});

// One-shot scrape (no persistent session required)
router.post("/steel/scrape", async (req, res) => {
  const { url, sessionId, waitFor, useProxy = false } = req.body ?? {};
  if (!url) { res.status(400).json({ error: "url is required" }); return; }
  try {
    const body: Record<string, unknown> = { url, useProxy };
    if (sessionId) body.sessionId = sessionId;
    if (waitFor) body.waitFor = waitFor;
    const r = await fetch(`${STEEL_BASE}/scrape`, {
      method: "POST",
      headers: steelHeaders(),
      body: JSON.stringify(body),
    });
    const data = await r.json();
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to scrape via Steel");
    res.status(500).json({ error: "Failed to scrape via Steel" });
  }
});

// One-shot screenshot
router.post("/steel/screenshot", async (req, res) => {
  const { url, sessionId, fullPage = false, useProxy = false } = req.body ?? {};
  if (!url) { res.status(400).json({ error: "url is required" }); return; }
  try {
    const body: Record<string, unknown> = { url, fullPage, useProxy };
    if (sessionId) body.sessionId = sessionId;
    const r = await fetch(`${STEEL_BASE}/screenshot`, {
      method: "POST",
      headers: steelHeaders(),
      body: JSON.stringify(body),
    });
    // May return binary image or JSON
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("image")) {
      const buf = Buffer.from(await r.arrayBuffer());
      res.set("Content-Type", ct).send(buf);
    } else {
      const data = await r.json();
      res.status(r.ok ? 200 : r.status).json(data);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to screenshot via Steel");
    res.status(500).json({ error: "Failed to screenshot via Steel" });
  }
});

// PDF capture
router.post("/steel/pdf", async (req, res) => {
  const { url, sessionId, useProxy = false } = req.body ?? {};
  if (!url) { res.status(400).json({ error: "url is required" }); return; }
  try {
    const body: Record<string, unknown> = { url, useProxy };
    if (sessionId) body.sessionId = sessionId;
    const r = await fetch(`${STEEL_BASE}/pdf`, {
      method: "POST",
      headers: steelHeaders(),
      body: JSON.stringify(body),
    });
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("pdf")) {
      const buf = Buffer.from(await r.arrayBuffer());
      res.set("Content-Type", "application/pdf").send(buf);
    } else {
      const data = await r.json();
      res.status(r.ok ? 200 : r.status).json(data);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to generate PDF via Steel");
    res.status(500).json({ error: "Failed to generate PDF via Steel" });
  }
});

export default router;
