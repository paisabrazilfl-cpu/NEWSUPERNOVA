import { useState } from "react";
import {
  useGetSwarmStatus,
  usePauseSwarm,
  useResumeSwarm,
  useListAgents,
  getListMessagesQueryKey,
  resolveApiUrl,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Send, Pause, Play, Loader2, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Clean, single-purpose swarm input: type a goal → ABBY dispatches the right
 * agents. Replaces the old mode-heavy command bar. Power options (target a
 * specific agent) live behind a small "Advanced" disclosure (progressive
 * disclosure). The conversational surface lives on the Chat page.
 */
export function SwarmComposer({ channelId }: { channelId: number | null }) {
  const [goal, setGoal] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [target, setTarget] = useState<number | "all">("all");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const { data: swarmStatus } = useGetSwarmStatus();
  const { data: agents = [] } = useListAgents();
  const pauseSwarm = usePauseSwarm();
  const resumeSwarm = useResumeSwarm();
  const qc = useQueryClient();

  const paused = swarmStatus?.paused;

  const send = async () => {
    const g = goal.trim();
    if (!g || sending || paused) return;
    setSending(true);
    try {
      const body: Record<string, unknown> = { command: g, priority: "high" };
      if (channelId) body.channelId = channelId;
      if (target !== "all") body.toAgentId = target;
      const r = await fetch(resolveApiUrl("/api/commands"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error();
      setGoal("");
      setSent(true);
      setTimeout(() => setSent(false), 3000);
      if (channelId) setTimeout(() => qc.invalidateQueries({ queryKey: getListMessagesQueryKey(channelId) }), 1500);
    } catch {
      /* surfaced via the feed; keep the input intact on hard failure */
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

  const toggleSwarm = () => {
    if (paused) resumeSwarm.mutate(undefined as unknown as void);
    else pauseSwarm.mutate(undefined as unknown as void);
  };

  return (
    <div className="shrink-0 border-t border-card-border bg-card/60 backdrop-blur px-3 py-3">
      <div className="max-w-3xl mx-auto">
        {advanced && (
          <div className="mb-2 flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Send to</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value === "all" ? "all" : Number(e.target.value))}
              className="bg-background border border-card-border rounded-md px-2 py-1 text-foreground focus:outline-none focus:border-primary/50"
              aria-label="Target agent"
            >
              <option value="all">ABBY — orchestrate the whole swarm</option>
              {agents.filter((a) => a.id !== 1).map((a) => (
                <option key={a.id} value={a.id}>{a.name} only</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-card-border bg-background px-2 py-1.5 focus-within:border-primary/50 transition-colors">
          <button
            onClick={toggleSwarm}
            title={paused ? "Resume swarm" : "Pause swarm"}
            aria-label={paused ? "Resume swarm" : "Pause swarm"}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            {paused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
          </button>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            disabled={!!paused}
            aria-label="Goal for the swarm"
            placeholder={paused ? "Swarm paused — resume to dispatch" : "Give the swarm a goal — ABBY will dispatch the right agents…"}
            className="flex-1 min-w-0 resize-none bg-transparent py-2 text-[15px] leading-relaxed focus:outline-none placeholder:text-muted-foreground/60 max-h-[160px]"
          />
          <button
            onClick={send}
            disabled={!goal.trim() || sending || !!paused}
            aria-label="Dispatch goal to the swarm"
            className="p-2.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity shrink-0"
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>

        <div className="flex items-center justify-between mt-2 px-1">
          <button
            onClick={() => setAdvanced((v) => !v)}
            className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <ChevronDown className={cn("w-3 h-3 transition-transform", advanced && "rotate-180")} /> Advanced
          </button>
          <span className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
            {sent ? (
              <><Check className="w-3 h-3 text-primary" /> Dispatched — watch the agents above</>
            ) : (
              "Enter to dispatch · Shift+Enter for a new line"
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
