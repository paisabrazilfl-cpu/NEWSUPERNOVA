import { useListAgents, getListAgentsQueryKey } from "@workspace/api-client-react";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { agentState } from "@/lib/agentState";

interface SwarmCanvasProps {
  onAgentClick: (id: number) => void;
}

export function SwarmCanvas({ onAgentClick }: SwarmCanvasProps) {
  const { data: agents = [] } = useListAgents({ query: { refetchInterval: 3000, queryKey: getListAgentsQueryKey() } });
  const reduceMotion = useReducedMotion();

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

  // Ring radius scaled to the container, leaving room for the node + its label.
  // Deterministic (no Math.random) so orbs don't jump around on every render.
  const radius = useMemo(() => {
    const minDim = Math.min(size.w || 600, size.h || 500);
    return Math.max(74, Math.round(minDim / 2 - 72));
  }, [size]);

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
  // up exactly with the absolutely-positioned nodes.
  const vbW = size.w || 1000;
  const vbH = size.h || 800;

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-background/50 flex items-center justify-center">
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
  );
}
