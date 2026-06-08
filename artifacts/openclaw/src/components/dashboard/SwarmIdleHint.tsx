import { useLocation } from "wouter";
import { useListAgents, getListAgentsQueryKey } from "@workspace/api-client-react";
import { agentState } from "@/lib/agentState";
import { GOAL_DRAFT_KEY } from "@/lib/handoff";

const STARTERS = [
  "Use the marketing engine to write + post a lead-gen Instagram post (with a cited stat).",
  "Draft a CAN-SPAM-compliant 7-email nurture sequence for my niche.",
  "Research a topic and report back with sources.",
  "Build a small web UI and validate it in the browser.",
];

/**
 * Calm, non-intrusive onboarding cue. Only shows while the swarm is idle (no
 * agent actively working), so it guides newcomers without nagging returning
 * operators. Picking a starter prefills the Chat composer (the command surface).
 */
export function SwarmIdleHint({ onPick }: { onPick?: (prompt: string) => void }) {
  const [, navigate] = useLocation();
  const { data: agents = [] } = useListAgents({ query: { refetchInterval: 3000, queryKey: getListAgentsQueryKey() } });

  const anyActive = agents.some((a) => agentState(a.status).active);
  if (agents.length === 0 || anyActive) return null;

  // Prefill the on-page dispatch input when wired; otherwise hand off to Chat.
  const start = (prompt: string) => {
    if (onPick) { onPick(prompt); return; }
    try { sessionStorage.setItem(GOAL_DRAFT_KEY, prompt); } catch { /* ignore */ }
    navigate("/");
  };

  return (
    <div className="shrink-0 border-t border-card-border bg-card/40 backdrop-blur px-4 py-3 flex flex-col items-center gap-2">
      <p className="text-xs text-muted-foreground text-center">
        Agents are ready. Dispatch a goal below — or start with:
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {STARTERS.map((s) => (
          <button
            key={s}
            onClick={() => start(s)}
            className="text-xs rounded-full border border-card-border bg-background/70 px-3 py-1.5 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
