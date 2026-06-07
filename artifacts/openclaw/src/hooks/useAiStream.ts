import { useCallback, useRef, useState } from "react";
import { resolveApiUrl } from "@workspace/api-client-react";

export interface AiStreamState {
  streaming: boolean;
  tokens: string;
  agentName: string | null;
  agentId: number | null;
  model: string | null;
  error: string | null;
}

export function useAiStream(onComplete?: (agentId: number | null) => void) {
  const [state, setState] = useState<AiStreamState>({
    streaming: false,
    tokens: "",
    agentName: null,
    agentId: null,
    model: null,
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(async (opts: {
    message: string;
    agentId?: number | null;
    channelId: number;
    model?: string;
    attachmentIds?: number[];
  }) => {
    // Cancel any in-flight stream
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setState({ streaming: true, tokens: "", agentName: null, agentId: opts.agentId ?? null, model: null, error: null });

    try {
      const res = await fetch(resolveApiUrl("/api/ai/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          message: opts.message,
          agentId: opts.agentId ?? undefined,
          channelId: opts.channelId,
          model: opts.model,
          attachmentIds: opts.attachmentIds?.length ? opts.attachmentIds : undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        setState(s => ({ ...s, streaming: false, error: errText }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            if (parsed.token) {
              setState(s => ({ ...s, tokens: s.tokens + parsed.token }));
            }
            if (parsed.done) {
              setState(s => ({
                ...s,
                streaming: false,
                agentName: parsed.agentName ?? s.agentName,
                agentId: parsed.agentId ?? s.agentId,
                model: parsed.model ?? s.model,
              }));
              onComplete?.(parsed.agentId ?? null);
            }
            if (parsed.error) {
              setState(s => ({ ...s, streaming: false, error: parsed.error }));
            }
          } catch {
            // skip
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") return;
      setState(s => ({ ...s, streaming: false, error: String(err) }));
    }
  }, [onComplete]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState(s => ({ ...s, streaming: false }));
  }, []);

  const clear = useCallback(() => {
    setState({ streaming: false, tokens: "", agentName: null, agentId: null, model: null, error: null });
  }, []);

  return { ...state, send, cancel, clear };
}
