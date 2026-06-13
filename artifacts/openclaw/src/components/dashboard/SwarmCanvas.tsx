import {
  useListAgents,
  getListAgentsQueryKey,
  useGetSwarmStatus,
  getGetSwarmStatusQueryKey,
  useListChannels,
  getListChannelsQueryKey,
} from "@workspace/api-client-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { agentState } from "@/lib/agentState";

interface SwarmCanvasProps {
  onAgentClick: (id: number) => void;
}

// How long after the last channel activity the swarm still counts as "being
// talked to". lastActivity is bumped on every message insert, so this keeps the
// cue lit for a beat after the operator speaks / a reply lands, instead of
// flickering off the instant an agent returns to idle.
const TALKING_WINDOW_MS = 30_000;

export function SwarmCanvas({ onAgentClick }: SwarmCanvasProps) {
  const { data: agents = [] } = useListAgents({ query: { refetchInterval: 3000, queryKey: getListAgentsQueryKey() } });
  const { data: status } = useGetSwarmStatus({ query: { refetchInterval: 3000, queryKey: getGetSwarmStatusQueryKey() } });
  const { data: channels = [] } = useListChannels({ query: { refetchInterval: 4000, queryKey: getListChannelsQueryKey() } });
  const reduceMotion = useReducedMotion();

  // "Being talked to" = the swarm is actively working OR a channel saw activity
  // (a message in/out) within the talking window. Re-evaluated on every poll
  // tick (3–4s), which is well inside the 30s window.
  const working = !(status?.paused ?? false) && ((status?.activeAgents ?? 0) > 0 || (status?.runningTasks ?? 0) > 0);
  const lastActivityMs = useMemo(() => {
    let newest = 0;
    for (const c of channels) {
      const t = c.lastActivity ? Date.parse(c.lastActivity) : 0;
      if (t > newest) newest = t;
    }
    return newest;
  }, [channels]);
  const recentlyEngaged = lastActivityMs > 0 && Date.now() - lastActivityMs < TALKING_WINDOW_MS;
  const talking = working || recentlyEngaged;

  // Measure the actual container so the layout is responsive (fixes orbs clipping
  // off-screen on mobile, where the old fixed pixel radius was larger than half
  // the viewport width).
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Ring radius scaled to the container WIDTH (not min(w,h)). Driving it off
  // width keeps the spacing stable on mobile: when the idle-hint panel shrinks
  // the canvas height, a min-dimension radius used to collapse to its floor and
  // the labels overlapped the neighbouring orbs (the cramped layout). Width is
  // stable, so the ring now keeps its roomy, even spacing in every state.
  // Deterministic (no Math.random) so orbs don't jump around on every render.
  const radius = useMemo(() => {
    const w = size.w || 600;
    return Math.min(240, Math.max(120, Math.round(w / 2 - 80)));
  }, [size]);

  // The natural height the ring needs: top+bottom orbs (radius each from centre)
  // plus the orb itself and its two-line label below. The canvas reserves this
  // via min-height and scrolls if the viewport is shorter — so the spacing never
  // compresses (which is what caused the label/orb overlap).
  const graphHeight = 2 * radius + 150;

  const positions = useMemo(() => {
    const n = Math.max(1, agents.length);
    return agents.map((agent, index) => {
      const angle = (index / n) * Math.PI * 2 - Math.PI / 2; // start at top
      return {
        id: agent.id,
        x: agents.length === 1 ? 0 : Math.round(Math.cos(angle) * radius),
        y: agents.length === 1 ? 0 : Math.round(Math.sin(angle) * radius),
      };
    });
  }, [agents, radius]);

  // Pixel-space viewBox centered at 0,0 so SVG line endpoints (pos.x,pos.y) line
  // up exactly with the absolutely-positioned nodes. Height tracks the inner
  // graph box (which is at least graphHeight) so lines stay aligned when the
  // canvas scrolls.
  const vbW = size.w || 1000;
  const vbH = Math.max(size.h || 0, graphHeight);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-y-auto bg-background/50">
      {/* Whole-canvas "being talked to" backdrop: a soft cyan radial glow that
          fades in while the swarm is engaged, so the activity reads even from a
          glance across the room. */}
      <AnimatePresence>
        {talking && (
          <motion.div
            key="talking-backdrop"
            className="absolute inset-0 pointer-events-none -z-0"
            style={{ background: "radial-gradient(circle at 50% 45%, rgba(0,229,255,0.12), transparent 60%)" }}
            initial={{ opacity: 0 }}
            animate={reduceMotion ? { opacity: 0.6 } : { opacity: [0.45, 0.8, 0.45] }}
            exit={{ opacity: 0 }}
            transition={reduceMotion ? { duration: 0.4 } : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </AnimatePresence>

      {/* Floating status badge: an explicit, words-not-just-motion cue for whether
          the swarm is currently being talked to. */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
        <div
          className={
            "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur transition-colors " +
            (talking
              ? "border-[#00e5ff]/50 bg-[#00e5ff]/10 text-[#00e5ff]"
              : "border-card-border bg-card/60 text-muted-foreground")
          }
          data-testid="swarm-talking-badge"
          data-talking={talking ? "true" : "false"}
        >
          <span className="relative flex h-2.5 w-2.5 items-center justify-center">
            {talking && !reduceMotion && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00e5ff] opacity-75" />
            )}
            <span className={"relative inline-flex h-2.5 w-2.5 rounded-full " + (talking ? "bg-[#00e5ff]" : "bg-muted-foreground")} />
          </span>
          {talking ? (
            <span className="inline-flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5" /> Swarm is engaged — being talked to
            </span>
          ) : (
            "Swarm idle"
          )}
        </div>
      </div>

      <div className="relative w-full h-full flex items-center justify-center" style={{ minHeight: graphHeight }}>
      {/* Connections (SVG) — only drawn between agents that are actively working,
          so a calm swarm shows no lines. Animation is gated on reduced-motion. */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`${-vbW / 2} ${-vbH / 2} ${vbW} ${vbH}`} preserveAspectRatio="none">
        {positions.map((pos1, i) =>
          positions.slice(i + 1).map((pos2) => {
            const a1 = agents.find((a) => a.id === pos1.id);
            const a2 = agents.find((a) => a.id === pos2.id);
            const bothActive = !!a1 && !!a2 && agentState(a1.status).active && agentState(a2.status).active;
            if (!bothActive) return null;
            return (
              <motion.line
                key={`${pos1.id}-${pos2.id}`}
                x1={pos1.x} y1={pos1.y} x2={pos2.x} y2={pos2.y}
                stroke="#00e5ff" strokeWidth={1.5}
                initial={{ opacity: reduceMotion ? 0.3 : 0 }}
                animate={reduceMotion ? { opacity: 0.3 } : { opacity: [0.12, 0.45, 0.12] }}
                transition={reduceMotion ? undefined : { duration: 2.4, repeat: Infinity, ease: "linear" }}
              />
            );
          })
        )}
      </svg>

      {/* Agent nodes */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {agents.map((agent) => {
          const pos = positions.find((p) => p.id === agent.id) || { x: 0, y: 0 };
          const view = agentState(agent.status);
          const StateIcon = view.icon;
          const animate = view.active && !reduceMotion;
          // The orb "pings" (outer echo sphere radiates) when the swarm is being
          // talked to, or when this specific agent is active. Reduced motion keeps
          // a steady doubled ring instead.
          const ping = !reduceMotion && (talking || view.active);
          const echoColor = view.active || view.attention ? view.color : agent.color;

          return (
            <motion.div
              key={agent.id}
              className="absolute pointer-events-auto cursor-pointer group"
              style={{ x: pos.x, y: pos.y }}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.06, zIndex: 10 }}
              onClick={() => onAgentClick(agent.id)}
              data-testid={`canvas-node-${agent.id}`}
            >
              {/* Doubled sphere — a second concentric orb around the node. Two
                  staggered echo rings radiate outward when the swarm is being
                  talked to (sonar "ping"); otherwise a single steady faint ring
                  so the orb still reads as doubled at rest. */}
              {ping ? (
                <>
                  <motion.div
                    className="absolute left-1/2 top-1/2 rounded-full border-2 -z-10"
                    style={{ width: 64, height: 64, x: "-50%", y: "-50%", borderColor: echoColor }}
                    initial={{ scale: 1, opacity: 0.5 }}
                    animate={{ scale: 1.9, opacity: 0 }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
                  />
                  <motion.div
                    className="absolute left-1/2 top-1/2 rounded-full border-2 -z-10"
                    style={{ width: 64, height: 64, x: "-50%", y: "-50%", borderColor: echoColor }}
                    initial={{ scale: 1, opacity: 0.5 }}
                    animate={{ scale: 1.9, opacity: 0 }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut", delay: 1.1 }}
                  />
                </>
              ) : (
                <div
                  className="absolute left-1/2 top-1/2 rounded-full border -z-10"
                  style={{ width: 84, height: 84, transform: "translate(-50%, -50%)", borderColor: `${echoColor}40` }}
                />
              )}

              {/* Ambient glow — only for active states, calmed for everyone else. */}
              <motion.div
                className="absolute inset-0 rounded-full blur-md -z-10"
                style={{ backgroundColor: view.active ? view.color : agent.color }}
                animate={animate ? { scale: [1, 1.18, 1], opacity: [0.35, 0.6, 0.35] } : { scale: 1, opacity: view.attention ? 0.4 : 0.16 }}
                transition={animate ? { duration: 1.8, repeat: Infinity } : undefined}
              />

              {/* Node body — ring colour reflects live state, not just brand colour. */}
              <div
                className="w-16 h-16 rounded-full bg-card border-2 flex items-center justify-center shadow-lg relative overflow-hidden"
                style={{ borderColor: view.active || view.attention ? view.color : `${agent.color}99` }}
              >
                <div className="absolute inset-0 opacity-20" style={{ backgroundColor: agent.color }} />
                <span className="font-mono font-bold text-lg relative z-10" style={{ color: agent.color }}>
                  {agent.avatarInitials}
                </span>
              </div>

              {/* Always-on label: human role + plain-English state (text + icon + colour). */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 text-center whitespace-nowrap">
                <div className="text-[12px] font-semibold text-foreground leading-tight">{agent.role || agent.name}</div>
                <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: view.color }}>
                  <StateIcon className={animate && agent.status === "executing" ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
                  {view.label}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {agents.length === 0 && (
        <div className="text-muted-foreground text-sm">No agents detected in the swarm.</div>
      )}
      </div>
    </div>
  );
}
