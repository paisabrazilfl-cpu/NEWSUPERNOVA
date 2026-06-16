import { useQuery } from "@tanstack/react-query";
import { resolveApiUrl } from "@workspace/api-client-react";
import { Bot, Cpu, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Live "is the partner swarm working?" cue for the primary/secondary relay
 * (lib/relay.ts). It polls GET /api/relay and reads the newest session's
 * `status`, which the backend now tracks as a phase:
 *   - "self-working"  → THIS swarm's orchestrator cycle is running
 *   - "awaiting-peer" → handed off; the PEER swarm (e.g. T800-AURA) is working
 *   - "done"          → the relay finished
 *   - anything else   → idle / stalled / error (no live work)
 *
 * On NEWSUPERNOVA the peer is T800-AURA, so "awaiting-peer" is exactly the
 * "T800 is working" signal the operator asked for. Names come from the API
 * (RELAY_SELF_NAME / RELAY_PEER_NAME) so nothing is hardcoded.
 */

type Phase = "peer" | "self" | "done" | "idle";

interface RelaySession {
  relayId: string;
  role: string;
  status: string;
  round: number;
  goal: string;
  lastActor?: string | null;
  lastKind?: string | null;
  updatedAt: string;
}

interface RelayStatusResponse {
  enabled: boolean;
  role: string;
  selfName: string;
  peerName: string;
  sessions: RelaySession[];
}

function useRelayStatus() {
  return useQuery<RelayStatusResponse>({
    queryKey: ["relay-status"],
    queryFn: async () => {
      const r = await fetch(resolveApiUrl("/api/relay"), { credentials: "include" });
      if (!r.ok) throw new Error(`relay status ${r.status}`);
      return (await r.json()) as RelayStatusResponse;
    },
    refetchInterval: 4000,
    staleTime: 2000,
    // Quiet failure — the relay route may be 503 when the feature is off.
    retry: false,
  });
}

interface RelayView {
  phase: Phase;
  peerName: string;
  selfName: string;
  round: number;
  ageMs: number;
  enabled: boolean;
  hasSession: boolean;
}

function useRelayView(): RelayView {
  const { data } = useRelayStatus();
  const peerName = data?.peerName || "Peer";
  const selfName = data?.selfName || "This swarm";
  const session = data?.sessions?.[0];
  const ageMs = session ? Date.now() - new Date(session.updatedAt).getTime() : Infinity;

  let phase: Phase = "idle";
  if (data?.enabled && session) {
    if (session.status === "awaiting-peer") phase = "peer";
    else if (session.status === "self-working") phase = "self";
    else if (session.status === "done") phase = "done";
  }

  return {
    phase,
    peerName,
    selfName,
    round: session?.round ?? 0,
    ageMs,
    enabled: !!data?.enabled,
    hasSession: !!session,
  };
}

function agoLabel(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/**
 * Floating, always-on-top banner. Appears only when there is something live to
 * announce: the peer working, this swarm working, or a just-finished relay.
 * Self-dismisses when the relay goes idle (or a completed one ages out).
 */
export function RelayBanner() {
  const { phase, peerName, selfName, round, ageMs } = useRelayView();

  // Show a "complete" flash only briefly after the relay finishes.
  const showDone = phase === "done" && ageMs < 90_000;
  const visible = phase === "peer" || phase === "self" || showDone;
  if (!visible) return null;

  const styles =
    phase === "peer"
      ? "border-primary/50 bg-primary/10 text-primary shadow-[0_0_24px_rgba(217,119,87,0.25)]"
      : phase === "self"
        ? "border-[#d97757]/50 bg-[#d97757]/10 text-[#d97757] shadow-[0_0_24px_rgba(191,0,255,0.22)]"
        : "border-emerald-500/50 bg-emerald-500/10 text-emerald-400 shadow-[0_0_24px_rgba(16,185,129,0.22)]";

  const Icon = phase === "peer" ? Bot : phase === "self" ? Cpu : CheckCircle2;
  const label =
    phase === "peer"
      ? `${peerName} is working`
      : phase === "self"
        ? `${selfName} is working`
        : "Relay complete";

  return (
    <div
      className="pointer-events-none fixed top-3 left-1/2 -translate-x-1/2 z-50 flex justify-center px-3"
      role="status"
      aria-live="polite"
      data-testid="relay-banner"
    >
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-2.5 rounded-full border px-4 py-1.5 backdrop-blur-md",
          styles,
        )}
      >
        {phase === "done" ? (
          <Icon className="w-4 h-4" />
        ) : (
          <span className="relative flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
          </span>
        )}
        <span className="text-xs font-semibold tracking-wide whitespace-nowrap">
          {label}
          {round > 0 && phase !== "done" && (
            <span className="opacity-70 font-medium"> · relay round {round}</span>
          )}
        </span>
        {phase !== "done" && (
          <span className="w-2 h-2 rounded-full bg-current animate-pulse shadow-[0_0_8px_currentColor]" />
        )}
      </div>
    </div>
  );
}

/**
 * Compact, persistent indicator for the desktop side rail. Mirrors the existing
 * ACTIVE/PAUSED dot's style. Hidden when the relay feature is off and no session
 * has ever run, so it never adds noise to a swarm that isn't using the relay.
 */
export function RelayRailIndicator() {
  const { phase, peerName, selfName, round, ageMs, enabled, hasSession } = useRelayView();
  if (!enabled && !hasSession) return null;

  const working = phase === "peer" || phase === "self";
  const color =
    phase === "peer"
      ? "text-primary"
      : phase === "self"
        ? "text-[#d97757]"
        : phase === "done"
          ? "text-emerald-400"
          : "text-muted-foreground";
  const dot =
    phase === "peer"
      ? "bg-primary"
      : phase === "self"
        ? "bg-[#d97757]"
        : phase === "done"
          ? "bg-emerald-400"
          : "bg-muted-foreground";
  const shortLabel =
    phase === "peer"
      ? peerName
      : phase === "self"
        ? selfName
        : phase === "done"
          ? "DONE"
          : "IDLE";
  const title =
    phase === "peer"
      ? `${peerName} is working (relay round ${round})`
      : phase === "self"
        ? `${selfName} is working (relay round ${round})`
        : phase === "done"
          ? `Relay complete ${agoLabel(ageMs)}`
          : "Relay idle";

  return (
    <div
      title={title}
      data-testid="relay-rail-indicator"
      className="flex flex-col items-center gap-1.5 px-2 py-2 rounded-xl"
    >
      <span
        className={cn(
          "w-2.5 h-2.5 rounded-full shadow-[0_0_10px_currentColor]",
          dot,
          working && "animate-pulse",
        )}
      />
      <span className={cn("text-[8px] font-bold tracking-wider leading-none truncate max-w-[72px] text-center", color)}>
        {shortLabel}
      </span>
    </div>
  );
}
