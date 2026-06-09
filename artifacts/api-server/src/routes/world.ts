import { Router, type Request, type Response, type NextFunction } from "express";
import { renderWorldFrame, renderTraversalBlock } from "../lib/worldEngine";
import { runWorldCycle, readAuraState, getWorldState, resetWorldState, worldEngineEnabled } from "../lib/world";
import { requireOperator } from "../lib/auth";
import { timingSafeStrEqual } from "../lib/auth";

const router = Router();

// ── public, memoized previews (render verification; one render per process) ──
let cachedFrame: Promise<Buffer> | null = null;
router.get("/world/preview.png", async (_req, res) => {
  try {
    if (!cachedFrame) {
      cachedFrame = renderWorldFrame({
        width: 1080, height: 1080, busy: false, chapter: 0,
        title: "WORLD-00", subtitle: "chapter 0 — preview", stateLine: "render: production · $0",
        caption: ["AURA's world — rendered in production.", "this is a preview frame."], seed: 7,
      }).catch((e) => { cachedFrame = null; throw e; });
    }
    const buf = await cachedFrame;
    res.setHeader("Content-Type", "image/png"); res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(buf);
  } catch (err) { res.status(500).json({ error: `render failed: ${String(err).slice(0, 200)}` }); }
});

let cachedBlock: Promise<Buffer> | null = null;
router.get("/world/preview-block.png", async (_req, res) => {
  try {
    if (!cachedBlock) {
      cachedBlock = renderTraversalBlock({
        mood: "working", chapter: 0, step: 1, direction: "down",
        caption: ["chapter 0 · she walks"], stateLine: "preview · 6-tile block", seed: 2,
      }).catch((e) => { cachedBlock = null; throw e; });
    }
    const buf = await cachedBlock;
    res.setHeader("Content-Type", "image/png"); res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(buf);
  } catch (err) { res.status(500).json({ error: `block render failed: ${String(err).slice(0, 200)}` }); }
});

// ── status (read-only, public) ──────────────────────────────────────────────
router.get("/world/status", async (_req, res) => {
  try {
    const [a, w] = [await readAuraState(), await getWorldState()];
    res.json({ engineEnabled: worldEngineEnabled(), mood: a.mood, idle: a.idle, active: a.active,
      chapter: w.chapter, step: w.step, direction: w.direction, stopped: w.stopped });
  } catch (err) { res.status(500).json({ error: String(err).slice(0, 200) }); }
});

// ── run a cycle — operator OR a WORLD_TRIGGER_TOKEN header. dry-run by default. ──
function cycleAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env["WORLD_TRIGGER_TOKEN"];
  const provided = (req.headers["x-world-token"] as string | undefined) ?? "";
  if (token && provided && timingSafeStrEqual(provided, token)) { next(); return; }
  requireOperator(req, res, next);
}
router.post("/world/cycle", cycleAuth, async (req, res) => {
  try {
    const dry = req.query["dry"] !== "0"; // default DRY (safe). dry=0 to actually publish.
    const force = req.query["force"] === "1";
    const result = await runWorldCycle({ dryRun: dry, force });
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err).slice(0, 300) }); }
});

// ── reset the world to the beginning (chapter 0, step 0) — same auth as cycle ──
router.post("/world/reset", cycleAuth, async (_req, res) => {
  try {
    const w = await resetWorldState();
    res.json({ ok: true, chapter: w.chapter, step: w.step });
  } catch (err) { res.status(500).json({ error: String(err).slice(0, 300) }); }
});

export default router;
