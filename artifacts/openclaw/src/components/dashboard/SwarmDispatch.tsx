import { useState } from "react";
import { resolveApiUrl } from "@workspace/api-client-react";
import { Send, Loader2, Check } from "lucide-react";

/**
 * Slim, direct dispatch input on the Swarm page: posts to /api/commands, which
 * runs orchestrateGoal — the real CLAW execution engine (tools + results stream
 * into the channel). For firing a goal while you watch the orbs, without
 * switching to Chat. `value`/`onChange` are lifted so the idle starter chips can
 * prefill it.
 */
export function SwarmDispatch({
  channelId,
  value,
  onChange,
}: {
  channelId: number | null;
  value: string;
  onChange: (s: string) => void;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const send = async () => {
    const goal = value.trim();
    if (!goal || sending) return;
    setSending(true);
    try {
      const body: Record<string, unknown> = { command: goal, priority: "high" };
      if (channelId) body.channelId = channelId;
      const r = await fetch(resolveApiUrl("/api/commands"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error();
      onChange("");
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch {
      /* surfaced in the activity feed; keep the text on hard failure */
    } finally {
      setSending(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="shrink-0 border-t border-card-border bg-card/40 backdrop-blur px-3 py-2.5">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-2 rounded-xl border border-card-border bg-background px-2 py-1.5 focus-within:border-primary/50 transition-colors">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            aria-label="Dispatch a goal to the swarm"
            placeholder="Dispatch a goal to the swarm — agents execute with real tools…"
            className="flex-1 min-w-0 resize-none bg-transparent py-1.5 text-sm focus:outline-none placeholder:text-muted-foreground/60 max-h-32"
          />
          <button
            onClick={send}
            disabled={!value.trim() || sending}
            aria-label="Dispatch goal to the swarm"
            className="btn-3d btn-3d-sm p-2.5 disabled:cursor-not-allowed shrink-0"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : sent ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground/60 mt-1.5 px-1">
          {sent ? "Dispatched — watch the agents above." : "Runs the real swarm. Or just chat with ABBY — it dispatches automatically."}
        </p>
      </div>
    </div>
  );
}
