import {
  useListAgents,
  getListAgentsQueryKey,
  useGetSwarmStatus,
  getGetSwarmStatusQueryKey,
  useListChannels,
  getListChannelsQueryKey,
  resolveApiUrl,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence, useReducedMotion, type Transition } from "framer-motion";
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

// Minimal shape shared by local (Aura) and peer (T800) agents on the canvas.
interface CanvasAgent {
  id: number;
  name: string;
  role?: string | null;
  status: string;
  color: string;
  avatarInitials?: string | null;
}

interface PeerAgentsResponse {
  enabled: boolean;
  peerName: string;
  agents: CanvasAgent[];
}

// Poll the OTHER swarm's agents (e.g. T800-AURA) so we can draw them as an inner
// ring. Quiet failure: the relay route returns an empty list when off/unreachable.
function usePeerAgents() {
  return useQuery<PeerAgentsResponse>({
    queryKey: ["relay-peer-agents"],
    queryFn: async () => {
      const r = await fetch(resolveApiUrl("/api/relay/peer-agents"), { credentials: "include" });
      if (!r.ok) throw new Error(`peer agents ${r.status}`);
      return (await r.json()) as PeerAgentsResponse;
    },
    refetchInterval: 4000,
    staleTime: 2000,
    retry: false,
  });
}

// A single orb (used for both rings). `orbPx` sizes the node + its echo spheres
// so the inner (peer) ring can render smaller than the outer (local) ring.
function AgentOrb({
  agent,
  x,
  y,
  orbPx,
  talking,
  reduceMotion,
  onClick,
}: {
  agent: CanvasAgent;
  x: number;
  y: number;
  orbPx: number;
  talking: boolean;
  reduceMotion: boolean;
  onClick: () => void;
}) {
  const view = agentState(agent.status);
  const StateIcon = view.icon;
  const animate = view.active && !reduceMotion;
  // The orb "pings" (outer echo sphere radiates) when the swarm is being talked
  // to, or when this specific agent is active. Reduced motion → steady ring.
  const ping = !reduceMotion && (talking || view.active);
  const echoColor = view.active || view.attention ? view.color : agent.color;
  const fontPx = Math.round(orbPx * 0.31);
  const pingTransition: Transition = { duration: 2.2, repeat: Infinity, ease: "easeOut" };

  return (
    <motion.div
      className="absolute pointer-events-auto cursor-pointer group"
      style={{ x, y }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.08, zIndex: 10 }}
      onClick={onClick}
      data-testid={`canvas-node-${agent.id}`}
    >
      {/* Doubled sphere — a second concentric orb around the node. Two staggered
          echo rings radiate outward when the swarm is being talked to (sonar
          "ping"); otherwise a single steady faint ring so the orb reads as
          doubled at rest. */}
      {ping ? (
        <>
          <motion.div
            className="absolute left-1/2 top-1/2 rounded-full border-2 -z-10"
            style={{ width: orbPx, height: orbPx, x: "-50%", y: "-50%", borderColor: echoColor }}
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 1.9, opacity: 0 }}
            transition={pingTransition}
          />
          <motion.div
            className="absolute left-1/2 top-1/2 rounded-full border-2 -z-10"
            style={{ width: orbPx, height: orbPx, x: "-50%", y: "-50%", borderColor: echoColor }}
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 1.9, opacity: 0 }}
            transition={{ ...pingTransition, delay: 1.1 }}
          />
        </>
      ) : (
        <div
          className="absolute left-1/2 top-1/2 rounded-full border -z-10"
          style={{ width: orbPx + 20, height: orbPx + 20, transform: "translate(-50%, -50%)", borderColor: `${echoColor}40` }}
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
        className="rounded-full bg-card border-2 flex items-center justify-center shadow-lg relative overflow-hidden"
        style={{ width: orbPx, height: orbPx, borderColor: view.active || view.attention ? view.color : `${agent.color}99` }}
      >
        <div className="absolute inset-0 opacity-20" style={{ backgroundColor: agent.color }} />
        <span className="font-mono font-bold relative z-10" style={{ color: agent.color, fontSize: fontPx }}>
          {agent.avatarInitials || agent.name.slice(0, 2).toUpperCase()}
        </span>
      </div>

      {/* Always-on label: human role + plain-English state (text + icon + colour). */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 text-center whitespace-nowrap">
        <div className="text-[11px] font-semibold text-foreground leading-tight">{agent.role || agent.name}</div>
        <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: view.color }}>
          <StateIcon className={animate && agent.status === "executing" ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
          {view.label}
        </div>
      </div>
    </motion.div>
  );
}

function ringPositions(agents: CanvasAgent[], radius: number, alwaysOnRing: boolean) {
  const n = Math.max(1, agents.length);
  return agents.map((agent, index) => {
    const angle = (index / n) * Math.PI * 2 - Math.PI / 2; // start at top
    const single = agents.length === 1 && !alwaysOnRing;
    return {
      id: agent.id,
      x: single ? 0 : Math.round(Math.cos(angle) * radius),
      y: single ? 0 : Math.round(Math.sin(angle) * radius),
    };
  });
}

export function SwarmCanvas({ onAgentClick }: SwarmCanvasProps) {
  const { data: agents = [] } = useListAgents({ query: { refetchInterval: 3000, queryKey: getListAgentsQueryKey() } });
  const { data: status } = useGetSwarmStatus({ query: { refetchInterval: 3000, queryKey: getGetSwarmStatusQueryKey() } });
  const { data: channels = [] } = useListChannels({ query: { refetchInterval: 4000, queryKey: getListChannelsQueryKey() } });
  const { data: peer } = usePeerAgents();
  const reduceMotion = useReducedMotion() ?? false;

  const peerAgents: CanvasAgent[] = peer?.agents ?? [];
  const peerName = peer?.peerName || "T800-AURA";
  const hasPeer = peerAgents.length > 0;

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
  const localTalking = working || recentlyEngaged;
  // The peer "ring" is talking when any of its agents is active.
  const peerTalking = peerAgents.some((a) => agentState(a.status).active);
  const talking = localTalking || peerTalking;

  // Measure the actual container so the layout is responsive.
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

  // Outer ring (local / Aura) radius scaled to container WIDTH; inner ring
  // (peer / T800) sits at ~half that, with a floor so its orbs never collide
  // with the centre.
  const radius = useMemo(() => {
    const w = size.w || 600;
    return Math.min(240, Math.max(120, Math.round(w / 2 - 80)));
  }, [size]);
  const innerRadius = Math.max(64, Math.round(radius * 0.52));

  // Reserve the outer ring's natural height (top+bottom orbs + label) and scroll
  // if the viewport is shorter, so spacing never compresses.
  const graphHeight = 2 * radius + 150;

  const outerPositions = useMemo(() => ringPositions(agents as CanvasAgent[], radius, false), [agents, radius]);
  const innerPositions = useMemo(() => ringPositions(peerAgents, innerRadius, true), [peerAgents, innerRadius]);

  const vbW = size.w || 1000;
  const vbH = Math.max(size.h || 0, graphHeight);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-y-auto bg-background/50">
      {/* Whole-canvas "being talked to" backdrop. */}
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

      {/* Floating status badge — explicit words, not just motion. */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
        <div
          className={
            "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur transition-colors " +
            (talking ? "border-[#00e5ff]/50 bg-[#00e5ff]/10 text-[#00e5ff]" : "border-card-border bg-card/60 text-muted-foreground")
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
              <Radio className="w-3.5 h-3.5" />
              {peerTalking && !localTalking
                ? `${peerName} is talking`
                : localTalking && peerTalking
                  ? `AURA ⇄ ${peerName}`
                  : "Swarm is engaged — being talked to"}
            </span>
          ) : (
            "Swarm idle"
          )}
        </div>
      </div>

      {/* Legend: which ring is which (only when the peer ring is present). */}
      {hasPeer && (
        <div className="absolute top-3 right-3 z-20 pointer-events-none rounded-lg border border-card-border bg-card/70 backdrop-blur px-2.5 py-1.5 text-[10px] font-medium leading-tight">
          <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full border-2 border-[#00e5ff]" /> AURA · outer</div>
          <div className="mt-0.5 flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#a855f7]" /> {peerName} · inner</div>
        </div>
      )}

      <div className="relative w-full h-full flex items-center justify-center" style={{ minHeight: graphHeight }}>
        {/* Connections (SVG) — outer-ring agents actively working. */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`${-vbW / 2} ${-vbH / 2} ${vbW} ${vbH}`} preserveAspectRatio="none">
          {outerPositions.map((pos1, i) =>
            outerPositions.slice(i + 1).map((pos2) => {
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
          {/* Relay link: a pulsing spoke from centre to each peer (inner) orb when
              the relay is engaged, so "who is talking to who" reads at a glance. */}
          {hasPeer && talking && innerPositions.map((p) => (
            <motion.line
              key={`relay-${p.id}`}
              x1={0} y1={0} x2={p.x} y2={p.y}
              stroke="#a855f7" strokeWidth={1.25} strokeDasharray="3 4"
              initial={{ opacity: reduceMotion ? 0.3 : 0 }}
              animate={reduceMotion ? { opacity: 0.3 } : { opacity: [0.15, 0.5, 0.15] }}
              transition={reduceMotion ? undefined : { duration: 2.2, repeat: Infinity, ease: "linear" }}
            />
          ))}
        </svg>

        {/* Inner ring — peer (T800) agents. Rendered first so outer orbs/labels win z-order. */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {peerAgents.map((agent) => {
            const pos = innerPositions.find((p) => p.id === agent.id) || { x: 0, y: 0 };
            return (
              <AgentOrb
                key={`peer-${agent.id}`}
                agent={agent}
                x={pos.x}
                y={pos.y}
                orbPx={48}
                talking={peerTalking}
                reduceMotion={reduceMotion}
                onClick={() => { /* peer agents are read-only here */ }}
              />
            );
          })}
        </div>

        {/* Outer ring — local (Aura) agents. */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {(agents as CanvasAgent[]).map((agent) => {
            const pos = outerPositions.find((p) => p.id === agent.id) || { x: 0, y: 0 };
            return (
              <AgentOrb
                key={agent.id}
                agent={agent}
                x={pos.x}
                y={pos.y}
                orbPx={64}
                talking={localTalking}
                reduceMotion={reduceMotion}
                onClick={() => onAgentClick(agent.id)}
              />
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
