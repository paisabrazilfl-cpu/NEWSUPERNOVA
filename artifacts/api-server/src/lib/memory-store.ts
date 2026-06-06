/**
 * Persistent memory + RAG for VAULT, backed by Postgres + pgvector.
 *
 * - agent_memory: durable key/value store (survives restarts).
 * - vector_chunks: embedded text chunks with a pgvector column for cosine search.
 *
 * If the pgvector extension is unavailable, it degrades gracefully: embeddings
 * are stored as JSONB and cosine ranking is done in JS. Either way the data is
 * persistent — no more reset-on-restart.
 */

import { pool } from "@workspace/db";
import { embed, embedOne, toVectorLiteral, EMBEDDING_DIM } from "./embeddings.js";

let ready = false;
let pgvector = false;

export async function initMemoryStore(): Promise<void> {
  if (ready) return;
  // Try to enable pgvector.
  try {
    await pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    pgvector = true;
  } catch {
    pgvector = false;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_memory (
      id serial PRIMARY KEY,
      scope text NOT NULL DEFAULT 'global',
      key text NOT NULL,
      value text,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (scope, key)
    )`);

  if (pgvector) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vector_chunks (
        id serial PRIMARY KEY,
        collection text NOT NULL,
        doc_id text,
        content text NOT NULL,
        embedding vector(${EMBEDDING_DIM}),
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    try { await pool.query("CREATE INDEX IF NOT EXISTS vector_chunks_emb_idx ON vector_chunks USING hnsw (embedding vector_cosine_ops)"); } catch { /* index optional */ }
  } else {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vector_chunks (
        id serial PRIMARY KEY,
        collection text NOT NULL,
        doc_id text,
        content text NOT NULL,
        embedding jsonb,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
  }
  ready = true;
  console.log(`Memory store ready (pgvector=${pgvector})`);
}

async function ensureReady(): Promise<void> { if (!ready) await initMemoryStore(); }

export function isPgvector(): boolean { return pgvector; }

// ── key/value memory ─────────────────────────────────────────────────────────
export async function putMemory(scope: string, key: string, value: unknown): Promise<void> {
  await ensureReady();
  const v = typeof value === "string" ? value : JSON.stringify(value);
  await pool.query(
    `INSERT INTO agent_memory (scope, key, value, updated_at) VALUES ($1,$2,$3, now())
     ON CONFLICT (scope, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [scope, key, v],
  );
}

export async function getMemory(scope: string, key: string): Promise<unknown> {
  await ensureReady();
  const { rows } = await pool.query("SELECT value FROM agent_memory WHERE scope=$1 AND key=$2", [scope, key]);
  if (!rows[0]) return null;
  try { return JSON.parse(rows[0].value); } catch { return rows[0].value; }
}

export async function searchMemory(scope: string, query: string, limit = 5): Promise<Array<{ key: string; value: unknown }>> {
  await ensureReady();
  const { rows } = await pool.query(
    "SELECT key, value FROM agent_memory WHERE scope=$1 AND (key ILIKE $2 OR value ILIKE $2) ORDER BY updated_at DESC LIMIT $3",
    [scope, `%${query}%`, limit],
  );
  return rows.map((r) => { let v: unknown; try { v = JSON.parse(r.value); } catch { v = r.value; } return { key: r.key, value: v }; });
}

// ── vector store ─────────────────────────────────────────────────────────────
export async function upsertVector(collection: string, docId: string, text: string, metadata?: unknown): Promise<void> {
  await ensureReady();
  const vec = await embedOne(text);
  await pool.query("DELETE FROM vector_chunks WHERE collection=$1 AND doc_id=$2", [collection, docId]);
  if (pgvector) {
    await pool.query(
      "INSERT INTO vector_chunks (collection, doc_id, content, embedding, metadata) VALUES ($1,$2,$3,$4::vector,$5)",
      [collection, docId, text, toVectorLiteral(vec), metadata ? JSON.stringify(metadata) : null],
    );
  } else {
    await pool.query(
      "INSERT INTO vector_chunks (collection, doc_id, content, embedding, metadata) VALUES ($1,$2,$3,$4,$5)",
      [collection, docId, text, JSON.stringify(vec), metadata ? JSON.stringify(metadata) : null],
    );
  }
}

export async function deleteVector(collection: string, docId: string): Promise<number> {
  await ensureReady();
  const { rowCount } = await pool.query("DELETE FROM vector_chunks WHERE collection=$1 AND doc_id=$2", [collection, docId]);
  return rowCount ?? 0;
}

export async function searchVectors(collection: string, query: string, limit = 5): Promise<Array<{ doc_id: string; content: string; score: number; metadata: unknown }>> {
  await ensureReady();
  const qv = await embedOne(query);
  if (pgvector) {
    const { rows } = await pool.query(
      `SELECT doc_id, content, metadata, 1 - (embedding <=> $2::vector) AS score
       FROM vector_chunks WHERE collection=$1
       ORDER BY embedding <=> $2::vector LIMIT $3`,
      [collection, toVectorLiteral(qv), limit],
    );
    return rows.map((r) => ({ doc_id: r.doc_id, content: r.content, score: Number(r.score), metadata: r.metadata }));
  }
  // JS cosine fallback
  const { rows } = await pool.query("SELECT doc_id, content, metadata, embedding FROM vector_chunks WHERE collection=$1", [collection]);
  const scored = rows.map((r) => {
    const e = typeof r.embedding === "string" ? JSON.parse(r.embedding) : r.embedding;
    return { doc_id: r.doc_id, content: r.content, metadata: r.metadata, score: cosine(qv, e as number[]) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export async function indexDocument(collection: string, docId: string, text: string, chunkChars = 1200): Promise<string[]> {
  await ensureReady();
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkChars) chunks.push(text.slice(i, i + chunkChars));
  if (chunks.length === 0) return [];
  const vecs = await embed(chunks);
  await pool.query("DELETE FROM vector_chunks WHERE collection=$1 AND doc_id LIKE $2", [collection, `${docId}#%`]);
  const ids: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const id = `${docId}#${i}`;
    if (pgvector) {
      await pool.query("INSERT INTO vector_chunks (collection, doc_id, content, embedding, metadata) VALUES ($1,$2,$3,$4::vector,$5)",
        [collection, id, chunks[i], toVectorLiteral(vecs[i]), JSON.stringify({ doc: docId, chunk: i })]);
    } else {
      await pool.query("INSERT INTO vector_chunks (collection, doc_id, content, embedding, metadata) VALUES ($1,$2,$3,$4,$5)",
        [collection, id, chunks[i], JSON.stringify(vecs[i]), JSON.stringify({ doc: docId, chunk: i })]);
    }
    ids.push(id);
  }
  return ids;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
