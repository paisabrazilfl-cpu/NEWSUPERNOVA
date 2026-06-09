import { Router, type Request, type Response, type NextFunction } from "express";
import { renderWorldFrame, renderTraversalBlock } from "../lib/worldEngine";
import { runWorldCycle, runStoryCycle, runArtTriptych, runIntroPost, readAuraState, getWorldState, resetWorldState, worldDiag, worldEngineEnabled } from "../lib/world";
import { requireOperator } from "../lib/auth";
import { timingSafeStrEqual } from "../lib/auth";
import { logger } from "../lib/logger";

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
    // Publishing 6 tiles can exceed the HTTP gateway timeout. async=1 fires the
    // cycle in the background and returns immediately (poll /world/status).
    if (req.query["async"] === "1") {
      runWorldCycle({ dryRun: dry, force }).catch((e) => logger.error({ err: String(e) }, "world: async cycle failed"));
      res.status(202).json({ accepted: true, async: true, note: "cycle running in background — poll /api/world/status" });
      return;
    }
    const result = await runWorldCycle({ dryRun: dry, force });
    res.json(result);
  } catch (err) { res.status(500).json({ error: String(err).slice(0, 300) }); }
});

// ── post the one-time INTRO card (single feed image) — dry by default ──
router.post("/world/intro", cycleAuth, async (req, res) => {
  try {
    const dry = req.query["dry"] !== "0";
    if (req.query["async"] === "1") {
      runIntroPost({ dryRun: dry }).catch((e) => logger.error({ err: String(e) }, "world: async intro failed"));
      res.status(202).json({ accepted: true, async: true, note: "intro running in background — poll /api/world/status" });
      return;
    }
    res.json(await runIntroPost({ dryRun: dry }));
  } catch (err) { res.status(500).json({ error: String(err).slice(0, 300) }); }
});

// ── post an Instagram STORY (vertical, walk/dream) — dry by default ──────────
router.post("/world/story", cycleAuth, async (req, res) => {
  try {
    const dry = req.query["dry"] !== "0";
    const force = req.query["force"] === "1";
    if (req.query["async"] === "1") {
      runStoryCycle({ dryRun: dry, force }).catch((e) => logger.error({ err: String(e) }, "world: async story failed"));
      res.status(202).json({ accepted: true, async: true, note: "story running in background — poll /api/world/status" });
      return;
    }
    res.json(await runStoryCycle({ dryRun: dry, force }));
  } catch (err) { res.status(500).json({ error: String(err).slice(0, 300) }); }
});

// ── post an ART TRIPTYCH to the feed (3 tiles = one grid row) — dry by default ─
router.post("/world/art", cycleAuth, async (req, res) => {
  try {
    const dry = req.query["dry"] !== "0";
    const force = req.query["force"] === "1";
    // 3 sequential feed publishes can exceed the gateway timeout — async=1 backgrounds it.
    if (req.query["async"] === "1") {
      runArtTriptych({ dryRun: dry, force }).catch((e) => logger.error({ err: String(e) }, "world: async art failed"));
      res.status(202).json({ accepted: true, async: true, note: "art triptych running in background — poll /api/world/status" });
      return;
    }
    res.json(await runArtTriptych({ dryRun: dry, force }));
  } catch (err) { res.status(500).json({ error: String(err).slice(0, 300) }); }
});

// ── read-only diagnostic (cap usage + actual IG media) — same auth as cycle ──
router.post("/world/diag", cycleAuth, async (_req, res) => {
  try { res.json(await worldDiag()); }
  catch (err) { res.status(500).json({ error: String(err).slice(0, 300) }); }
});

// ── reset the world to the beginning (chapter 0, step 0) — same auth as cycle ──
router.post("/world/reset", cycleAuth, async (req, res) => {
  try {
    const w = await resetWorldState(req.query["cap"] === "1"); // cap=1 also clears the 24h post ledger
    res.json({ ok: true, chapter: w.chapter, step: w.step, capCleared: req.query["cap"] === "1" });
  } catch (err) { res.status(500).json({ error: String(err).slice(0, 300) }); }
});

export default router;
