import { Circle, Sparkles, Loader2, Clock, Hand, AlertTriangle, type LucideIcon } from "lucide-react";

/**
 * Single source of truth for how an agent's machine `status` is presented to a
 * human. Every state carries a plain-English label, an icon, and a tone colour
 * so the UI never communicates state through colour alone (accessibility) and
 * never asks the user to infer meaning from motion alone (anti-anxiety).
 *
 * `active` marks the states that justify ambient motion (glow/pulse); calm
 * states stay still so an idle swarm looks calm, not chaotic.
 */
export interface AgentStateView {
  label: string;
  color: string;
  icon: LucideIcon;
  /** True for states that warrant ambient motion (subject to reduced-motion). */
  active: boolean;
  /** True for states that need the operator's attention. */
  attention: boolean;
}

const STATES: Record<string, AgentStateView> = {
  idle: { label: "Idle", color: "#8a8f98", icon: Circle, active: false, attention: false },
  thinking: { label: "Planning", color: "#00e5ff", icon: Sparkles, active: true, attention: false },
  executing: { label: "Working", color: "#22c55e", icon: Loader2, active: true, attention: false },
  waiting: { label: "Waiting", color: "#3b82f6", icon: Clock, active: false, attention: false },
  hitl: { label: "Needs you", color: "#f59e0b", icon: Hand, active: true, attention: true },
  stalled: { label: "Error", color: "#ef4444", icon: AlertTriangle, active: false, attention: true },
};

const FALLBACK: AgentStateView = STATES["idle"]!;

/** Resolve an agent status string to its human-facing presentation. */
export function agentState(status: string | null | undefined): AgentStateView {
  return (status && STATES[status]) || FALLBACK;
}
