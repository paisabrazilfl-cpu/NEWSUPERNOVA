import { Link } from "wouter";
import { useGetSwarmStatus, usePauseSwarm, useResumeSwarm } from "@workspace/api-client-react";
import { Pause, Play, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

function formatUptime(seconds?: number): string | null {
  if (!seconds || seconds < 1) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `up ${h}h ${m}m`;
  if (m > 0) return `up ${m}m`;
  return "up <1m";
}

/**
 * Persistent "what is the swarm doing right now" header for the observation-first
 * Swarm page. Everything here is derived from the real SwarmStatus payload — we
 * deliberately do NOT invent a current-goal/step field the backend doesn't have.
 * Goal-setting is handed off to Chat (the single command surface).
 */
export function SwarmStatusStrip() {
  const { data: status } = useGetSwarmStatus();
  const pauseSwarm = usePauseSwarm();
  const resumeSwarm = useResumeSwarm();

  const paused = status?.paused ?? false;
  const active = status?.activeAgents ?? 0;
  const running = status?.runningTasks ?? 0;
  const done = status?.completedTasks ?? 0;
  const total = status?.totalAgents ?? 0;
  const working = !paused && (active > 0 || running > 0);

  const headline = paused ? "Paused" : working ? "Working" : "Ready";
  const dot = paused ? "bg-muted-foreground" : working ? "bg-green-500" : "bg-primary";
  const uptime = formatUptime(status?.uptimeSeconds);

  const toggle = () => {
    if (paused) resumeSwarm.mutate(undefined as unknown as void);
    else pauseSwarm.mutate(undefined as unknown as void);
  };

  return (
    <div className="shrink-0 border-b border-card-border bg-card/50 backdrop-blur px-4 py-2.5 flex items-center gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={cn("w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_8px_currentColor]", dot, working && "animate-pulse")} />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground leading-tight">Swarm · {headline}</div>
          <div className="text-[11px] text-muted-foreground leading-tight truncate">
            {active} of {total} agents active · {running} running · {done} done{uptime ? ` · ${uptime}` : ""}
          </div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 shrink-0">
        <button
          onClick={toggle}
          aria-label={paused ? "Resume swarm" : "Pause swarm"}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-card-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
        >
          {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">{paused ? "Resume" : "Pause"}</span>
        </button>
        <Link href="/">
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/15 border border-primary/30 text-primary text-xs font-semibold hover:bg-primary/25 transition-colors">
            Set a goal <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </Link>
      </div>
    </div>
  );
}
