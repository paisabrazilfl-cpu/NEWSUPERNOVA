/**
 * OPENCLAW OMEGA — Pinecone vector memory (primary semantic store).
 *
 * When configured, Pinecone is the PRIMARY index for the swarm's semantic memory:
 * memory_write upserts vectors here and memory_search queries here first. Postgres
 * remains the durable record and the FALLBACK search (cosine, then keyword), so
 * nothing is lost and search still works if Pinecone is unset or unreachable.
 *
 * Uses Pinecone's serverless data-plane REST API directly (no SDK). Best-effort:
 * every call degrades gracefully (returns false/null) and never throws.
 *
 * Config (env — or save the same names in the in-app vault):
 *   PINECONE_API_KEY     — required to enable Pinecone.
 *   PINECONE_INDEX_HOST  — the index host, e.g. my-index-abc.svc.us-east-1.pinecone.io
 *                          (the "Host" shown on the index page; scheme optional).
 *   PINECONE_NAMESPACE   — optional namespace (default "").
 *
 * The index's dimension MUST match the embedding model (text-embedding-3-small = 1536).
 */
import { logger } from "./logger";

function explicitHost(): string | null {
  const h = process.env["PINECONE_INDEX_HOST"] || process.env["PINECONE_INDEX_URL"];
  if (!h) return null;
  const trimmed = h.trim().replace(/\/$/, "");
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

let cachedHost: { key: string; host: string } | null = null;

/**
 * Resolve the index host. Prefers an explicit PINECONE_INDEX_HOST/URL; otherwise,
 * given PINECONE_API_KEY + PINECONE_INDEX (name), asks the Pinecone control plane
 * (describe_index) for the host — so the operator only needs the key + index name,
 * not the long host URL. Cached. Returns null if it can't be resolved.
 */
async function resolveHost(): Promise<string | null> {
  const explicit = explicitHost();
  if (explicit) return explicit;
  const key = process.env["PINECONE_API_KEY"];
  const name = process.env["PINECONE_INDEX"]?.trim();
  if (!key || !name) return null;
  const cacheKey = `${key}:${name}`;
  if (cachedHost && cachedHost.key === cacheKey) return cachedHost.host;
  try {
    const r = await fetch(`https://api.pinecone.io/indexes/${encodeURIComponent(name)}`, {
      headers: { "Api-Key": key, "X-Pinecone-API-Version": "2024-07" },
    });
    if (!r.ok) {
      logger.debug({ status: r.status }, "pinecone: describe_index failed");
      return null;
    }
    const data = (await r.json()) as { host?: string };
    if (!data.host) return null;
    const h = /^https?:\/\//i.test(data.host) ? data.host : `https://${data.host}`;
    cachedHost = { key: cacheKey, host: h };
    return h;
  } catch (err) {
    logger.debug({ err }, "pinecone: describe_index errored");
    return null;
  }
}

function namespace(): string {
  return process.env["PINECONE_NAMESPACE"] ?? "";
}

/** True when a key AND (an explicit host OR an index name to resolve) are set. */
export function pineconeConfigured(): boolean {
  return !!process.env["PINECONE_API_KEY"] && (!!explicitHost() || !!process.env["PINECONE_INDEX"]?.trim());
}

export interface PineconeMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/** Upsert one vector. Returns true on success, false (logged) on any failure. */
export async function pineconeUpsert(id: string, values: number[], metadata: Record<string, unknown>): Promise<boolean> {
  const key = process.env["PINECONE_API_KEY"];
  const base = await resolveHost();
  if (!key || !base) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${base}/vectors/upsert`, {
      method: "POST",
      headers: { "Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ vectors: [{ id, values, metadata }], namespace: namespace() }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      logger.debug({ status: r.status }, "pinecone: upsert failed");
      return false;
    }
    return true;
  } catch (err) {
    logger.debug({ err }, "pinecone: upsert errored");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Query the topK nearest vectors. Returns matches, or null when Pinecone is
 * unconfigured/unreachable so the caller can fall back to Postgres. An empty
 * array means "configured and reachable, but no hits".
 */
export async function pineconeQuery(values: number[], topK: number): Promise<PineconeMatch[] | null> {
  const key = process.env["PINECONE_API_KEY"];
  const base = await resolveHost();
  if (!key || !base) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${base}/query`, {
      method: "POST",
      headers: { "Api-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ vector: values, topK, includeMetadata: true, namespace: namespace() }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      logger.debug({ status: r.status }, "pinecone: query failed");
      return null;
    }
    const data = (await r.json()) as { matches?: PineconeMatch[] };
    return Array.isArray(data.matches) ? data.matches : [];
  } catch (err) {
    logger.debug({ err }, "pinecone: query errored");
    return null;
  } finally {
    clearTimeout(timer);
  }
}
