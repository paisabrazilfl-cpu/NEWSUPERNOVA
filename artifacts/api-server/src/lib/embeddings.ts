/**
 * Embeddings — real semantic vectors via OpenRouter's /embeddings endpoint.
 * Default model: openai/text-embedding-3-small (1536 dims).
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "openai/text-embedding-3-small";
export const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM || 1536);

function headers(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

/** Embed one or more strings. Returns one vector per input. */
export async function embed(input: string | string[]): Promise<number[][]> {
  const texts = Array.isArray(input) ? input : [input];
  if (texts.length === 0) return [];
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  if (!r.ok) throw new Error(`Embeddings error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = (await r.json()) as { data?: { embedding: number[]; index: number }[] };
  const rows = (data.data ?? []).slice().sort((a, b) => a.index - b.index);
  return rows.map((row) => row.embedding);
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embed(text);
  return v ?? [];
}

/** pgvector literal, e.g. "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
