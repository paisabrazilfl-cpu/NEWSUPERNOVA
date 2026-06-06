/**
 * OPENCLAW OMEGA — Text embeddings for semantic memory (real RAG).
 *
 * Provides vector embeddings via any OpenAI-compatible `/embeddings` endpoint
 * (OpenAI, Together, Voyage, Jina, a local server, …). This is what turns
 * VAULT's memory_search from keyword `ILIKE` matching into genuine semantic
 * retrieval — cosine similarity over real embeddings.
 *
 * Fully optional: when no embeddings key is configured, `embed()` returns null
 * and callers fall back to keyword search, so nothing breaks.
 *
 * Config (env):
 *   EMBEDDINGS_API_KEY   — required to enable embeddings.
 *   EMBEDDINGS_BASE_URL  — OpenAI-compatible base (default https://api.openai.com/v1).
 *   EMBEDDINGS_MODEL     — model id (default text-embedding-3-small).
 */

import { logger } from "./logger";

const DEFAULT_BASE = "https://api.openai.com/v1";
const DEFAULT_MODEL = "text-embedding-3-small";

export function embeddingsConfigured(): boolean {
  return !!process.env["EMBEDDINGS_API_KEY"];
}

export function embeddingsModel(): string {
  return process.env["EMBEDDINGS_MODEL"] ?? DEFAULT_MODEL;
}

/**
 * Embed a single piece of text. Returns the vector, or null if embeddings are
 * not configured or the call fails (caller should then fall back to keyword
 * search). Never throws.
 */
export async function embed(text: string): Promise<number[] | null> {
  const key = process.env["EMBEDDINGS_API_KEY"];
  if (!key) return null;
  const input = text.trim();
  if (!input) return null;

  const base = (process.env["EMBEDDINGS_BASE_URL"] ?? DEFAULT_BASE).replace(/\/$/, "");
  const model = embeddingsModel();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // Cap input length defensively — embedding models have token limits and we
      // only store short memory entries anyway.
      body: JSON.stringify({ model, input: input.slice(0, 8000) }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      logger.debug({ status: r.status }, "embeddings: request failed");
      return null;
    }
    const data = (await r.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = data.data?.[0]?.embedding;
    return Array.isArray(vec) && vec.length ? vec : null;
  } catch (err) {
    logger.debug({ err }, "embeddings: call errored");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Cosine similarity of two equal-length vectors. Returns 0 on mismatch. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Parse a stored embedding (JSON text) back into a vector, or null if invalid. */
export function parseEmbedding(stored: string | null | undefined): number[] | null {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.every((n) => typeof n === "number") ? parsed : null;
  } catch {
    return null;
  }
}
