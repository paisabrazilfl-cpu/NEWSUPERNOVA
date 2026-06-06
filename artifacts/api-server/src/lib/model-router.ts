/**
 * Model router — routes an agent's chat call to the right backend.
 *
 *   model "buddy:<persona>"  -> NeuroBuddy external API (persona brain, no native tools)
 *   anything else            -> OpenRouter (OpenAI-compatible, supports tool-calling)
 *
 * Returns the raw OpenAI-style assistant message so the executor can inspect
 * `tool_calls`. NeuroBuddy never returns tool_calls (chat-only).
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export interface ChatMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCallShape[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCallShape {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCallShape[];
}

export interface ChatOptions {
  model: string;
  messages: ChatMessage[];
  tools?: Array<Record<string, unknown>>;
  maxTokens?: number;
}

export interface Provider {
  kind: "openrouter" | "neurobuddy";
  /** Whether this backend can natively emit tool_calls. */
  supportsTools: boolean;
  /** The model id to send upstream (prefix stripped for buddy). */
  upstreamModel: string;
}

export function resolveProvider(model: string | null | undefined): Provider {
  const m = (model ?? "x-ai/grok-4.3").trim();
  if (m.startsWith("buddy:")) {
    return { kind: "neurobuddy", supportsTools: false, upstreamModel: m.slice("buddy:".length) };
  }
  return { kind: "openrouter", supportsTools: true, upstreamModel: m };
}

function openrouterHeaders(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://bos-aura.onrender.com",
    "X-Title": "BOS-AURA",
  };
}

function neurobuddyHeaders(): Record<string, string> {
  const key = process.env.NEUROBUDDY_API_KEY;
  if (!key) throw new Error("NEUROBUDDY_API_KEY not set");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

function neurobuddyBase(): string {
  return (process.env.NEUROBUDDY_BASE_URL ?? "https://neurobuddy-wg8b.onrender.com/api/external/v1").replace(/\/$/, "");
}

/** One non-streaming chat turn. Returns the assistant message (with tool_calls if any). */
export async function chatTurn(opts: ChatOptions): Promise<AssistantMessage> {
  const provider = resolveProvider(opts.model);

  if (provider.kind === "neurobuddy") {
    const r = await fetch(`${neurobuddyBase()}/chat/completions`, {
      method: "POST",
      headers: neurobuddyHeaders(),
      body: JSON.stringify({
        model: provider.upstreamModel,
        messages: opts.messages.map((m) => ({ role: m.role, content: m.content ?? "" })),
        stream: false,
        max_tokens: opts.maxTokens ?? 1024,
      }),
    });
    if (!r.ok) throw new Error(`NeuroBuddy error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    return { role: "assistant", content: data.choices?.[0]?.message?.content ?? "" };
  }

  // OpenRouter
  const body: Record<string, unknown> = {
    model: provider.upstreamModel,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 1024,
  };
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: openrouterHeaders(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`OpenRouter error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = (await r.json()) as { choices?: { message?: AssistantMessage }[] };
  const msg = data.choices?.[0]?.message;
  return { role: "assistant", content: msg?.content ?? "", tool_calls: msg?.tool_calls };
}
