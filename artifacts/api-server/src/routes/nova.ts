import { Router, type IRouter } from "express";

// Cross-app bridge: save a Supernova conversation into NOVA's knowledge base
// (NOVA's searchable "workspace" memory). This is a server-side proxy so the
// browser never sees the shared key, and so CORS + NOVA's PIN gate are handled
// here. NOVA accepts the shared SUPERNOVA_API_KEY / OPENCLAW_API_KEY as a
// server-to-server bypass of its operator PIN.
const router: IRouter = Router();

function novaBase(): string {
  return (process.env["NOVA_BASE_URL"] || "https://nova-sszi.onrender.com").replace(/\/$/, "");
}

function sharedKey(): string {
  return process.env["OPENCLAW_API_KEY"] || process.env["SUPERNOVA_API_KEY"] || "";
}

router.post("/nova/save-conversation", async (req, res) => {
  const body = (req.body ?? {}) as { title?: unknown; content?: unknown };
  const title = typeof body.title === "string" && body.title.trim() ? body.title.slice(0, 500) : "Supernova conversation";
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) {
    res.status(400).json({ error: "content is required" });
    return;
  }
  if (content.length > 190_000) {
    res.status(400).json({ error: "content too large" });
    return;
  }
  const key = sharedKey();
  if (!key) {
    res.status(503).json({ error: "Cross-app key (OPENCLAW_API_KEY) is not configured on this server." });
    return;
  }
  try {
    const r = await fetch(`${novaBase()}/api/knowledge/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ source: "supernova-chat", title, content }),
    });
    const text = await r.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 500) }; }
    if (!r.ok) {
      res.status(502).json({ error: "NOVA rejected the save", status: r.status, detail: parsed });
      return;
    }
    res.json({ ok: true, nova: parsed });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
