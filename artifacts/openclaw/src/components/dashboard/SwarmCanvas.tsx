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
// talked to". lastActivity is bumped on every message insert, so the cue lingers
// a beat after the operator speaks instead of flickering off when an agent idles.
const TALKING_WINDOW_MS = 30_000;

const OUTER_ORB = 54; // local (AURA) orb diameter, px
const INNER_ORB = 30; // peer (T800) orb diameter, px

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

// Poll the OTHER swarm's agents (e.g. T800-AURA) for the inner ring. Quiet
// failure: the relay route returns an empty list when off/unreachable.
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

// A single orb, used for both rings. The inner ring passes `showLabel={false}`
// (initials inside the orb are enough — full labels there collided with the
// outer ring). `labelAbove` places the label radially OUTWARD (above for the top
// half of the ring, below for the bottom) so labels never point into the centre.
function AgentOrb({
  agent,
  x,
  y,
  orbPx,
  talking,
  reduceMotion,
  showLabel,
  labelAbove,
  onClick,
}: {
  agent: CanvasAgent;
  x: number;
  y: number;
  orbPx: number;
  talking: boolean;
  reduceMotion: boolean;
  showLabel: boolean;
  labelAbove: boolean;
  onClick: () => void;
}) {
  const view = agentState(agent.status);
  const StateIcon = view.icon;
  const animate = view.active && !reduceMotion;
  const ping = !reduceMotion && (talking || view.active);
  const echoColor = view.active || view.attention ? view.color : agent.color;
  const fontPx = Math.round(orbPx * 0.32);
  const pingTransition: Transition = { duration: 2.2, repeat: Infinity, ease: "easeOut" };

  return (
    <motion.div
      className="absolute pointer-events-auto cursor-pointer group"
      style={{ x, y }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.1, zIndex: 10 }}
      onClick={onClick}
      data-testid={`canvas-node-${agent.id}`}
    >
      {/* Echo "ping" rings — radiate outward while being talked to / active. */}
      {ping ? (
        <>
          <motion.div
            className="absolute left-1/2 top-1/2 rounded-full border-2 -z-10"
            style={{ width: orbPx, height: orbPx, x: "-50%", y: "-50%", borderColor: echoColor }}
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={pingTransition}
          />
          <motion.div
            className="absolute left-1/2 top-1/2 rounded-full border-2 -z-10"
            style={{ width: orbPx, height: orbPx, x: "-50%", y: "-50%", borderColor: echoColor }}
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ ...pingTransition, delay: 1.1 }}
          />
        </>
      ) : (
        <div
          className="absolute left-1/2 top-1/2 rounded-full border -z-10"
          style={{ width: orbPx + 14, height: orbPx + 14, transform: "translate(-50%, -50%)", borderColor: `${echoColor}33` }}
        />
      )}

      {/* Ambient glow — active states only. */}
      <motion.div
        className="absolute inset-0 rounded-full blur-md -z-10"
        style={{ backgroundColor: view.active ? view.color : agent.color }}
        animate={animate ? { scale: [1, 1.18, 1], opacity: [0.35, 0.6, 0.35] } : { scale: 1, opacity: view.attention ? 0.4 : 0.16 }}
        transition={animate ? { duration: 1.8, repeat: Infinity } : undefined}
      />

      {/* Node body. */}
      <div
        className="rounded-full bg-card border-2 flex items-center justify-center shadow-lg relative overflow-hidden"
        style={{ width: orbPx, height: orbPx, borderColor: view.active || view.attention ? view.color : `${agent.color}99` }}
      >
        <div className="absolute inset-0 opacity-20" style={{ backgroundColor: agent.color }} />
        <span className="font-mono font-bold relative z-10" style={{ color: agent.color, fontSize: fontPx }}>
          {agent.avatarInitials || agent.name.slice(0, 2).toUpperCase()}
        </span>
      </div>

      {showLabel && (
        <div
          className={
            "absolute left-1/2 -translate-x-1/2 text-center whitespace-nowrap " +
            (labelAbove ? "bottom-full mb-1.5" : "top-full mt-1.5")
          }
        >
          <div className="text-[11px] font-semibold text-foreground leading-tight">{agent.name}</div>
          <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: view.color }}>
            <StateIcon className={animate && agent.status === "executing" ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
            {view.label}
          </div>
        </div>
      )}
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
  const peerTalking = peerAgents.some((a) => agentState(a.status).active);
  const talking = localTalking || peerTalking;

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

  // Outer ring radius is sized so the WHOLE graph fits the visible canvas without
  // clipping — constrained by BOTH width and height. On a short phone panel the
  // height is the binding limit; sizing on width alone reserved a ~530px tall graph
  // inside a ~270px panel, which centered the cluster below the fold and clipped the
  // orb. Inner ring keeps a guaranteed gap from the outer so the rings stay distinct.
  const radius = useMemo(() => {
    const w = size.w || 600;
    const h = size.h || 400;
    const byWidth = Math.round(w / 2) - 40;
    const byHeight = Math.round(h / 2) - 55; // room for orb radius + outward label
    return Math.max(70, Math.min(230, byWidth, byHeight));
  }, [size]);
  const innerRadius = useMemo(
    () => Math.max(46, Math.min(Math.round(radius * 0.5), radius - 58)),
    [radius],
  );

  // Reserve enough height for top+bottom orbs plus their (outward) labels; the
  // canvas scrolls if the viewport is shorter, so spacing never compresses.
  const graphHeight = 2 * radius + 110;

  const outerPositions = useMemo(() => ringPositions(agents as CanvasAgent[], radius, false), [agents, radius]);
  const innerPositions = useMemo(() => ringPositions(peerAgents, innerRadius, true), [peerAgents, innerRadius]);

  const vbW = size.w || 1000;
  const vbH = Math.max(size.h || 0, graphHeight);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-y-auto overflow-x-hidden bg-background/50">
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

      {/* Status badge — top-left so it never sits over the legend on narrow screens. */}
      <div className="absolute top-3 left-3 z-20 pointer-events-none max-w-[60%]">
        <div
          className={
            "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur transition-colors " +
            (talking ? "border-[#00e5ff]/50 bg-[#00e5ff]/10 text-[#00e5ff]" : "border-card-border bg-card/60 text-muted-foreground")
          }
          data-testid="swarm-talking-badge"
          data-talking={talking ? "true" : "false"}
        >
          <span className="relative flex h-2.5 w-2.5 items-center justify-center shrink-0">
            {talking && !reduceMotion && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#00e5ff] opacity-75" />
            )}
            <span className={"relative inline-flex h-2.5 w-2.5 rounded-full " + (talking ? "bg-[#00e5ff]" : "bg-muted-foreground")} />
          </span>
          <span className="inline-flex items-center gap-1.5 truncate">
            {talking && <Radio className="w-3.5 h-3.5 shrink-0" />}
            {!talking
              ? "Swarm idle"
              : peerTalking && !localTalking
                ? `${peerName} working`
                : localTalking && peerTalking
                  ? `AURA ⇄ ${peerName}`
                  : "Being talked to"}
          </span>
        </div>
      </div>

      {/* Legend — only when the peer ring is present. */}
      {hasPeer && (
        <div className="absolute top-3 right-3 z-20 pointer-events-none rounded-lg border border-card-border bg-card/70 backdrop-blur px-2.5 py-1.5 text-[10px] font-medium leading-tight">
          <div className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full border-2 border-[#00e5ff] shrink-0" /> AURA · outer</div>
          <div className="mt-1 flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-[#a855f7] shrink-0" /> {peerName} · inner</div>
        </div>
      )}

      <div className="relative w-full flex items-center justify-center" style={{ minHeight: graphHeight, height: "100%" }}>
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`${-vbW / 2} ${-vbH / 2} ${vbW} ${vbH}`} preserveAspectRatio="none">
          {/* Lines between actively-working outer agents. */}
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
          {/* Relay spokes: centre → each peer orb when engaged (who's talking to who). */}
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

        {/* Inner ring — peer (T800) agents: initials only, no labels (kept the centre clean). */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {peerAgents.map((agent) => {
            const pos = innerPositions.find((p) => p.id === agent.id) || { x: 0, y: 0 };
            return (
              <AgentOrb
                key={`peer-${agent.id}`}
                agent={agent}
                x={pos.x}
                y={pos.y}
                orbPx={INNER_ORB}
                talking={peerTalking}
                reduceMotion={reduceMotion}
                showLabel={false}
                labelAbove={false}
                onClick={() => { /* peer agents are read-only here */ }}
              />
            );
          })}
        </div>

        {/* Outer ring — local (AURA) agents, with labels placed radially outward. */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {(agents as CanvasAgent[]).map((agent) => {
            const pos = outerPositions.find((p) => p.id === agent.id) || { x: 0, y: 0 };
            return (
              <AgentOrb
                key={agent.id}
                agent={agent}
                x={pos.x}
                y={pos.y}
                orbPx={OUTER_ORB}
                talking={localTalking}
                reduceMotion={reduceMotion}
                showLabel
                labelAbove={pos.y < -8}
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
