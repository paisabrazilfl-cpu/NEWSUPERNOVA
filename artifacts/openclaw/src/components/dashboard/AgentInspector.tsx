import { useGetAgent, useGetAgentTelemetry } from "@workspace/api-client-react";
import { X, Activity, Terminal, Database, Code, CheckCircle, Clock, AlertCircle, Cpu, Zap } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { AgentStatusDot } from "@/components/ui/agent-status-dot";

interface AgentInspectorProps {
  agentId: number | null;
  onClose: () => void;
}

// ABBYCLAW tool categories — every tool OpenClaw ships
const TOOL_CATEGORIES: { label: string; color: string; tools: string[] }[] = [
  {
    label: "Runtime",
    color: "#bf00ff",
    tools: ["exec", "code_execution", "process"],
  },
  {
    label: "Files",
    color: "#00e5ff",
    tools: ["read", "write", "edit", "apply_patch", "diffs"],
  },
  {
    label: "Web",
    color: "#0066ff",
    tools: ["web_search", "x_search", "web_fetch"],
  },
  {
    label: "Browser",
    color: "#00cc88",
    tools: ["browser", "screenshot", "pdf"],
  },
  {
    label: "Memory",
    color: "#ff6b00",
    tools: ["memory_lancedb", "memory_wiki"],
  },
  {
    label: "Agents",
    color: "#00e5ff",
    tools: ["subagents", "sessions_spawn", "sessions_history", "agents_list", "goal", "session_status"],
  },
  {
    label: "Automation",
    color: "#bf00ff",
    tools: ["cron", "heartbeat_respond", "webhook", "message"],
  },
  {
    label: "Media / AI",
    color: "#ff2d78",
    tools: ["image", "image_generate", "tts", "music_generate", "video_generate", "llm_task", "tokenjuice", "lobster"],
  },
  {
    label: "Gateway",
    color: "#00cc88",
    tools: ["gateway", "nodes", "tool_search", "tool_describe"],
  },
];

function getMonologueColor(type: string) {
  switch (type) {
    case "thought":    return "text-zinc-400 italic";
    case "action":     return "text-cyan-400 font-semibold";
    case "result":     return "text-green-400";
    case "system":     return "text-purple-400";
    case "conclusion": return "text-green-300 font-bold";
    default:           return "text-zinc-300";
  }
}

function getMonologuePrefix(type: string) {
  switch (type) {
    case "thought":    return "◆";
    case "action":     return "▶";
    case "result":     return "✓";
    case "system":     return "⚙";
    case "conclusion": return "★";
    default:           return "·";
  }
}

export function AgentInspector({ agentId, onClose }: AgentInspectorProps) {
  const { data: agent } = useGetAgent(agentId ?? 0, {
    query: { enabled: !!agentId }
  });

  const { data: telemetry } = useGetAgentTelemetry(agentId ?? 0, {
    query: { enabled: !!agentId, refetchInterval: 2000 }
  });

  const monologueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (monologueRef.current) {
      monologueRef.current.scrollTop = monologueRef.current.scrollHeight;
    }
  }, [telemetry?.monologue]);

  if (!agentId || !agent) return null;

  const capabilities: string[] = (agent.capabilities as string[]) ?? [];
  const contextPercentage = telemetry
    ? Math.min(100, Math.round((telemetry.contextUsed / telemetry.contextMax) * 100))
    : 0;

  return (
    <div className="w-[440px] border-l border-card-border bg-card/95 backdrop-blur-xl flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.5)] z-30 absolute right-0 top-0 bottom-0 animate-in slide-in-from-right-8 duration-300">
      
      {/* Header */}
      <div className="p-4 border-b border-card-border flex items-start justify-between relative overflow-hidden shrink-0">
        <div className="absolute top-0 left-0 right-0 h-0.5" style={{ backgroundColor: agent.color, boxShadow: `0 0 12px ${agent.color}` }} />

        <div className="flex gap-3 items-center">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center font-mono font-bold text-sm shadow-lg"
               style={{ backgroundColor: `${agent.color}20`, color: agent.color, border: `1px solid ${agent.color}50`, boxShadow: `0 0 16px ${agent.color}30` }}>
            {agent.avatarInitials}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-lg leading-none tracking-wide" style={{ color: agent.color }}>{agent.name}</h2>
              <AgentStatusDot status={agent.status} />
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono uppercase tracking-widest">{agent.role}</p>
            <p className="text-[10px] text-muted-foreground/50 mt-0.5 font-mono">{agent.model}</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 mt-1"
          data-testid="btn-close-inspector"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Description */}
      {agent.description && (
        <div className="px-4 py-2.5 border-b border-card-border shrink-0">
          <p className="text-[10px] text-muted-foreground/70 leading-relaxed font-mono">{agent.description}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-5">

        {/* Context Window Gauge */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-1.5 text-muted-foreground">
              <Database className="w-3 h-3" /> Context Window
            </div>
            <div className="text-[10px] font-mono" style={{ color: contextPercentage > 90 ? "#ef4444" : contextPercentage > 75 ? "#f97316" : agent.color }}>
              {telemetry?.contextUsed.toLocaleString() ?? 0} / {telemetry?.contextMax.toLocaleString() ?? 0} tk &nbsp;
              <span className="text-muted-foreground">{contextPercentage}%</span>
            </div>
          </div>
          <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-card-border">
            <div
              className="h-full transition-all duration-700 rounded-full"
              style={{
                width: `${contextPercentage}%`,
                backgroundColor: contextPercentage > 90 ? "#ef4444" : contextPercentage > 75 ? "#f97316" : agent.color,
                boxShadow: `0 0 8px ${contextPercentage > 90 ? "#ef4444" : contextPercentage > 75 ? "#f97316" : agent.color}80`,
              }}
            />
          </div>
        </div>

        {/* ABBYCLAW Tool Grid */}
        <div>
          <div className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-1.5 text-muted-foreground mb-3">
            <Cpu className="w-3 h-3" />
            <span>ABBYCLAW Tool Matrix</span>
            <span className="ml-auto text-[9px] font-normal" style={{ color: agent.color }}>{capabilities.length} tools loaded</span>
          </div>
          <div className="space-y-2.5">
            {TOOL_CATEGORIES.map(cat => {
              const active = cat.tools.filter(t => capabilities.includes(t));
              if (active.length === 0) return null;
              return (
                <div key={cat.label}>
                  <div className="text-[9px] uppercase tracking-widest mb-1.5 font-bold" style={{ color: `${cat.color}99` }}>
                    {cat.label}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {cat.tools.map(tool => {
                      const isActive = capabilities.includes(tool);
                      const isRunning = telemetry?.toolCalls.some(
                        tc => tc.toolName === tool && tc.status === "running"
                      );
                      return (
                        <span
                          key={tool}
                          className={cn(
                            "text-[9px] font-mono px-1.5 py-0.5 rounded border transition-all",
                            isActive
                              ? "text-foreground border-opacity-40"
                              : "text-muted-foreground/30 border-transparent"
                          )}
                          style={isActive ? {
                            backgroundColor: isRunning ? `${cat.color}25` : `${cat.color}10`,
                            borderColor: isRunning ? cat.color : `${cat.color}40`,
                            boxShadow: isRunning ? `0 0 6px ${cat.color}60` : undefined,
                            color: isRunning ? cat.color : undefined,
                          } : {}}
                        >
                          {isRunning && <span className="inline-block w-1 h-1 rounded-full mr-1 animate-pulse" style={{ backgroundColor: cat.color, verticalAlign: "middle" }} />}
                          {tool}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Internal Monologue Terminal */}
        <div className="flex flex-col" style={{ height: 240 }}>
          <div className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-1.5 text-muted-foreground mb-2">
            <Terminal className="w-3 h-3" /> Internal Monologue
          </div>
          <div
            ref={monologueRef}
            className="flex-1 bg-background border border-card-border rounded-lg p-3 overflow-y-auto scrollbar-thin font-mono text-[10px] space-y-1.5"
          >
            {!telemetry?.monologue.length ? (
              <div className="text-muted-foreground/40 italic">Awaiting activity...</div>
            ) : (
              telemetry.monologue.map(line => (
                <div key={line.id} className="flex gap-2 leading-relaxed">
                  <span className="text-muted-foreground/30 shrink-0 select-none">
                    [{format(new Date(line.timestamp), "HH:mm:ss")}]
                  </span>
                  <span className="shrink-0 select-none" style={{ color: line.type === "system" ? "#a78bfa" : line.type === "action" ? "#22d3ee" : line.type === "result" ? "#4ade80" : "#71717a" }}>
                    {getMonologuePrefix(line.type)}
                  </span>
                  <span className={cn("whitespace-pre-wrap break-words", getMonologueColor(line.type))}>
                    {line.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Execution Matrix */}
        <div>
          <div className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-1.5 text-muted-foreground mb-2">
            <Activity className="w-3 h-3" /> Execution Matrix
            {telemetry?.toolCalls.some(t => t.status === "running") && (
              <Zap className="w-3 h-3 ml-1 animate-pulse" style={{ color: agent.color }} />
            )}
          </div>
          <div className="space-y-1.5">
            {!telemetry?.toolCalls.length ? (
              <div className="text-xs text-muted-foreground/40 italic px-2">No tools executed.</div>
            ) : (
              telemetry.toolCalls.map(call => (
                <div key={call.id}
                     className={cn(
                       "bg-background border rounded-lg p-2.5 flex flex-col gap-1.5 transition-all",
                       call.status === "running"
                         ? "border-opacity-60 shadow-sm"
                         : "border-card-border"
                     )}
                     style={call.status === "running" ? { borderColor: `${agent.color}60`, boxShadow: `0 0 8px ${agent.color}20` } : {}}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold">
                      <Code className="w-3 h-3 shrink-0" style={{ color: agent.color }} />
                      <span style={{ color: call.status === "running" ? agent.color : undefined }}>{call.toolName}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {call.completedAt && call.startedAt && (
                        <span className="text-[9px] font-mono text-muted-foreground/40">
                          {Math.round((new Date(call.completedAt).getTime() - new Date(call.startedAt).getTime()) / 100) / 10}s
                        </span>
                      )}
                      {call.status === "running"  && <Activity className="w-3.5 h-3.5 animate-pulse" style={{ color: agent.color }} />}
                      {call.status === "pending"  && <Clock className="w-3.5 h-3.5 text-muted-foreground" />}
                      {call.status === "success"  && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                      {call.status === "error"    && <AlertCircle className="w-3.5 h-3.5 text-destructive" />}
                    </div>
                  </div>

                  {call.args && (
                    <div className="text-[9px] font-mono text-muted-foreground/50 truncate bg-zinc-950/60 px-1.5 py-1 rounded border border-zinc-800/50">
                      {(() => {
                        try {
                          const parsed = JSON.parse(call.args);
                          return Object.entries(parsed)
                            .slice(0, 3)
                            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                            .join("  ");
                        } catch {
                          return call.args;
                        }
                      })()}
                    </div>
                  )}

                  {call.result && call.status === "success" && (
                    <div className="text-[9px] font-mono text-green-500/60 truncate">
                      {(() => {
                        try {
                          const parsed = JSON.parse(call.result);
                          const firstKey = Object.keys(parsed)[0];
                          return firstKey ? `↳ ${firstKey}: ${JSON.stringify(parsed[firstKey])}` : "↳ ok";
                        } catch {
                          return `↳ ${String(call.result).slice(0, 80)}`;
                        }
                      })()}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
