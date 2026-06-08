import { useQuery } from "@tanstack/react-query";
import { resolveApiUrl } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { ShieldCheck, ShieldAlert } from "lucide-react";

/**
 * Dispatch panel — per-run observability for the multi-model swarm. Shows each
 * directive ABBY dispatched: which CLAW + which model handled it, the grounding
 * proof (did the operator's source material reach it — chars + hash, no raw
 * content), and status. Proves it's a real multi-model swarm, not one AI.
 */

interface Cmd {
  id: number;
  toAgentId: number | null;
  command: string;
  status: string;
  model?: string | null;
  groundingChars?: number | null;
  groundingHash?: string | null;
  createdAt: string;
}
interface Agent {
  id: number;
  name: string;
  color?: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  queued: "text-muted-foreground bg-muted border-muted-border",
  running: "text-[#00e5ff] bg-[#00e5ff]/10 border-[#00e5ff]/40",
  done: "text-[#00cc88] bg-[#00cc88]/10 border-[#00cc88]/40",
  failed: "text-[#ff2d78] bg-[#ff2d78]/10 border-[#ff2d78]/40",
};

export function DispatchPanel() {
  const { data: cmds = [], isLoading } = useQuery<Cmd[]>({
    queryKey: ["dispatches"],
    refetchInterval: 4000,
    queryFn: async () => {
      const r = await fetch(resolveApiUrl("/api/commands?limit=40"));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });
  const { data: agents = [] } = useQuery<Agent[]>({
    queryKey: ["agents-min"],
    refetchInterval: 30000,
    queryFn: async () => {
      const r = await fetch(resolveApiUrl("/api/agents"));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const agentOf = (id: number | null) => agents.find((a) => a.id === id);

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-3">
          <h2 className="text-lg font-bold tracking-tight text-foreground">Dispatch log</h2>
          <p className="text-xs text-muted-foreground">
            Every directive ABBY routed — which CLAW, which model, and the grounding proof that the operator's
            source material reached it. Live multi-model swarm, not one AI.
          </p>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground font-mono opacity-50">Loading dispatches…</div>
        ) : cmds.length === 0 ? (
          <div className="rounded-lg border border-dashed border-muted-border p-8 text-center text-sm text-muted-foreground font-mono opacity-60">
            No dispatches yet. Send a goal in Chat and ABBY will route it to the CLAWs.
          </div>
        ) : (
          <div className="space-y-2">
            {cmds.map((c) => {
              const a = agentOf(c.toAgentId);
              const grounded = (c.groundingChars ?? 0) > 0;
              return (
                <div key={c.id} className="rounded-lg border border-card-border bg-card/60 px-3 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="inline-flex items-center gap-1.5 text-sm font-semibold"
                      style={{ color: a?.color ?? "#22d3ee" }}
                    >
                      {a?.name ?? (c.toAgentId ? `agent #${c.toAgentId}` : "—")}
                    </span>
                    {c.model && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-muted-border">
                        {c.model}
                      </span>
                    )}
                    <span
                      className={cn(
                        "text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ml-auto",
                        STATUS_STYLE[c.status] ?? STATUS_STYLE.queued,
                      )}
                    >
                      {c.status}
                    </span>
                  </div>
                  <p className="text-[13px] text-foreground/90 mt-1.5 line-clamp-2 break-words">{c.command}</p>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px]">
                    {grounded ? (
                      <span className="inline-flex items-center gap-1 text-[#00cc88]" title={c.groundingHash ?? ""}>
                        <ShieldCheck className="w-3.5 h-3.5" /> grounded · {c.groundingChars?.toLocaleString()} chars ·{" "}
                        {(c.groundingHash ?? "").replace(/^sha256:/, "")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <ShieldAlert className="w-3.5 h-3.5" /> no source context
                      </span>
                    )}
                    <span className="text-muted-foreground/60 ml-auto">{new Date(c.createdAt).toLocaleTimeString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
