import { useListAgents, getListAgentsQueryKey } from "@workspace/api-client-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

interface SwarmCanvasProps {
  onAgentClick: (id: number) => void;
}

export function SwarmCanvas({ onAgentClick }: SwarmCanvasProps) {
  const { data: agents = [] } = useListAgents({ query: { refetchInterval: 3000, queryKey: getListAgentsQueryKey() } });

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

  // Ring radius scaled to the container, leaving room for the 64px node + margin.
  // Deterministic (no Math.random) so orbs don't jump around on every render.
  const radius = useMemo(() => {
    const minDim = Math.min(size.w || 600, size.h || 500);
    return Math.max(70, Math.round(minDim / 2 - 56));
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

  const getStatusColor = (status: string, baseColor: string) => {
    switch (status) {
      case 'thinking':
      case 'executing': return '#22c55e'; // Green
      case 'waiting': return '#3b82f6'; // Blue
      case 'hitl': return 'var(--color-accent)'; // Purple/Accent
      case 'stalled': return '#ef4444'; // Red
      case 'idle':
      default: return '#888888'; // Gray
    }
  };

  const getPulseAnimation = (status: string) => {
    switch (status) {
      case 'thinking':
      case 'executing': 
        return { scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] };
      case 'hitl':
        return { scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] };
      default:
        return { scale: 1, opacity: 0.5 };
    }
  };

  // Pixel-space viewBox centered at 0,0 so SVG line endpoints (pos.x,pos.y) line
  // up exactly with the absolutely-positioned nodes.
  const vbW = size.w || 1000;
  const vbH = size.h || 800;

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-background/50 flex items-center justify-center">
      {/* Grid background is handled by parent, just need to draw connections and nodes */}

      {/* Connections (SVG) - viewBox centers origin at 0,0 matching div offsets */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`${-vbW / 2} ${-vbH / 2} ${vbW} ${vbH}`} preserveAspectRatio="none">
        {positions.map((pos1, i) =>
          positions.slice(i + 1).map((pos2) => {
            const agent1 = agents.find(a => a.id === pos1.id);
            const agent2 = agents.find(a => a.id === pos2.id);
            const isActive = (agent1?.status === 'executing' || agent1?.status === 'thinking') &&
                             (agent2?.status === 'executing' || agent2?.status === 'thinking');
            if (!isActive) return null;
            return (
              <motion.line
                key={`${pos1.id}-${pos2.id}`}
                x1={pos1.x}
                y1={pos1.y}
                x2={pos2.x}
                y2={pos2.y}
                stroke="#00e5ff"
                strokeWidth={1.5}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0.15, 0.5, 0.15] }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
            );
          })
        )}
      </svg>

      {/* Agent Nodes */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        {agents.map(agent => {
          const pos = positions.find(p => p.id === agent.id) || { x: 0, y: 0 };
          const statusColor = getStatusColor(agent.status, agent.color);
          
          return (
            <motion.div
              key={agent.id}
              className="absolute pointer-events-auto cursor-pointer group"
              style={{ x: pos.x, y: pos.y }}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              whileHover={{ scale: 1.1, zIndex: 10 }}
              onClick={() => onAgentClick(agent.id)}
              data-testid={`canvas-node-${agent.id}`}
            >
              {/* Pulse effect */}
              <motion.div 
                className="absolute inset-0 rounded-full blur-md -z-10"
                style={{ backgroundColor: statusColor }}
                animate={getPulseAnimation(agent.status)}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
              
              {/* Node body */}
              <div 
                className="w-16 h-16 rounded-full bg-card border-2 flex items-center justify-center flex-col shadow-lg relative overflow-hidden"
                style={{ borderColor: agent.color }}
              >
                <div className="absolute inset-0 opacity-20" style={{ backgroundColor: agent.color }} />
                <span className="font-mono font-bold text-lg relative z-10" style={{ color: agent.color }}>
                  {agent.avatarInitials}
                </span>
              </div>
              
              {/* Label */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-3 text-center whitespace-nowrap bg-background/80 backdrop-blur-sm px-3 py-1 rounded-md border border-card-border opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="font-bold text-sm" style={{ color: agent.color }}>{agent.name}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-widest">{agent.status}</div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {agents.length === 0 && (
        <div className="text-muted-foreground font-mono text-sm uppercase tracking-widest animate-pulse">
          No agents detected in swarm.
        </div>
      )}
    </div>
  );
}