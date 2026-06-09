import { Router } from "express";
import { renderWorldFrame } from "../lib/worldEngine";

const router = Router();

// Memoized so a public GET can't be used to burn CPU: the demo frame is rendered
// at most once per process, then the bytes are served from memory.
let cached: Promise<Buffer> | null = null;
function previewFrame(): Promise<Buffer> {
  if (!cached) {
    cached = renderWorldFrame({
      width: 1080, height: 1080,
      busy: false,
      chapter: 0,
      title: "WORLD-00",
      subtitle: "chapter 0 — preview",
      stateLine: "render: production · $0",
      caption: ["AURA's world — rendered in production.", "this is a preview frame."],
      seed: 7,
    }).catch((e) => { cached = null; throw e; });
  }
  return cached;
}

// GET /api/world/preview.png — proves the production renderer works (browser-viewable).
router.get("/world/preview.png", async (_req, res) => {
  try {
    const buf = await previewFrame();
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.end(buf);
  } catch (err) {
    res.status(500).json({ error: `world render failed: ${String(err).slice(0, 200)}` });
  }
});

export default router;
