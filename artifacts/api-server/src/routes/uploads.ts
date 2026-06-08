/**
 * OPENCLAW OMEGA — file/image uploads for chat.
 *
 * The operator can drop pictures or documents into chat; ABBY then "sees" images
 * via a vision model and reads text-like files directly. Bytes are accepted as
 * base64 JSON (no multipart dependency), stored in Postgres, and served back raw
 * so the chat feed can render them.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { attachmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

// 20 MB cap on the decoded file (base64 inflates ~33%, so the JSON body limit in
// app.ts must be comfortably above this).
const MAX_BYTES = 20 * 1024 * 1024;
// Text-like files we extract inline so the agent can read them without vision.
const TEXT_MIME_RE = /^(text\/|application\/(json|xml|x-yaml|yaml|csv|javascript|typescript))/i;
const TEXT_EXT_RE = /\.(txt|md|markdown|csv|json|ya?ml|xml|log|ts|tsx|js|jsx|py|rb|go|rs|java|c|cpp|h|sh|sql|html|css)$/i;

function kindFor(mime: string, filename: string): "image" | "text" | "other" {
  if (/^image\//i.test(mime)) return "image";
  if (TEXT_MIME_RE.test(mime) || TEXT_EXT_RE.test(filename)) return "text";
  return "other";
}

// POST /api/uploads  { name, mime, dataBase64 }
router.post("/uploads", async (req, res) => {
  const { name, mime, dataBase64 } = (req.body ?? {}) as {
    name?: string;
    mime?: string;
    dataBase64?: string;
  };
  if (!dataBase64 || typeof dataBase64 !== "string") {
    res.status(400).json({ error: "dataBase64 is required" });
    return;
  }
  // Accept a full data URL or a bare base64 payload.
  const base64 = dataBase64.includes(",") ? dataBase64.slice(dataBase64.indexOf(",") + 1) : dataBase64;
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, "base64");
  } catch {
    res.status(400).json({ error: "invalid base64 payload" });
    return;
  }
  if (buf.length === 0) {
    res.status(400).json({ error: "empty file" });
    return;
  }
  if (buf.length > MAX_BYTES) {
    res.status(413).json({ error: `file too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB)` });
    return;
  }

  const filename = (name && String(name).slice(0, 255)) || "upload";
  const mimeType = (mime && String(mime).slice(0, 128)) || "application/octet-stream";
  const kind = kindFor(mimeType, filename);

  let extractedText: string | null = null;
  if (kind === "text") {
    // Store a bounded plaintext extraction so the agent can read it directly.
    extractedText = buf.toString("utf8").slice(0, 200_000);
  }

  try {
    const [row] = await db
      .insert(attachmentsTable)
      .values({
        filename,
        mimeType,
        kind,
        sizeBytes: buf.length,
        data: base64,
        extractedText,
      })
      .returning();
    res.status(201).json({
      id: row.id,
      name: row.filename,
      mime: row.mimeType,
      kind: row.kind,
      size: row.sizeBytes,
      url: `/api/uploads/${row.id}`,
    });
  } catch (err) {
    req.log.error({ err }, "upload: failed to store attachment");
    res.status(500).json({ error: "failed to store upload" });
  }
});

// GET /api/uploads/:id — serve the raw bytes (so the chat feed can render images)
router.get("/uploads/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "invalid id" });
    return;
  }
  try {
    const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id));
    if (!row) {
      res.status(404).json({ error: "not found" });
      return;
    }
    const buf = Buffer.from(row.data, "base64");
    // ?download=1 forces a save-as download; otherwise render inline (images/PDF).
    const disposition = req.query["download"] != null ? "attachment" : "inline";
    res.setHeader("Content-Type", row.mimeType);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    // Sanitize the operator-supplied filename for the header: drop quotes,
    // backslashes and control chars (newlines would allow header injection), and
    // add an RFC 5987 UTF-8 form for non-ASCII names.
    const safeName = row.filename.replace(/[\u0000-\u001f\u007f"\\]/g, "").slice(0, 200) || "file";
    const encName = encodeURIComponent(row.filename).slice(0, 300);
    res.setHeader("Content-Disposition", `${disposition}; filename="${safeName}"; filename*=UTF-8''${encName}`);
    res.end(buf);
  } catch (err) {
    req.log.error({ err }, "upload: failed to serve attachment");
    res.status(500).json({ error: "failed to read upload" });
  }
});

export default router;
