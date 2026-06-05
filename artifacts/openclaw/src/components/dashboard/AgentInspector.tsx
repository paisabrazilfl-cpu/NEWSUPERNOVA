import { useGetAgent, useGetAgentTelemetry } from "@workspace/api-client-react";
import { X, Activity, Terminal, Database, Code, CheckCircle, Clock, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useEffect, useRef } from "react";
import { AgentStatusDot } from "@/components/ui/agent-status-dot";

interface AgentInspectorProps {
  agentId: number | null;
  onClose: () => void;
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

  const contextPercentage = telemetry 
    ? Math.min(100, Math.round((telemetry.contextUsed / telemetry.contextMax) * 100))
    : 0;

  return (
    <div className="w-[400px] border-l border-card-border bg-card/95 backdrop-blur-xl flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.5)] z-30 absolute right-0 top-0 bottom-0 animate-in slide-in-from-right-8 duration-300">
      {/* Header */}
      <div className="p-4 border-b border-card-border flex items-start justify-between relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-1" style={{ backgroundColor: agent.color }} />
        
        <div className="flex gap-3 items-center">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm shadow-[0_0_15px_rgba(0,0,0,0.2)]"
               style={{ backgroundColor: `${agent.color}20`, color: agent.color, border: `1px solid ${agent.color}40` }}>
            {agent.avatarInitials}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-lg leading-none" style={{ color: agent.color }}>{agent.name}</h2>
              <AgentStatusDot status={agent.status} />
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-mono uppercase tracking-wider">{agent.role}</p>
          </div>
        </div>
        
        <button 
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          data-testid="btn-close-inspector"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-6">
        
        {/* Context Window Gauge */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-1.5 text-muted-foreground">
              <Database className="w-3 h-3" /> Context Memory
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">
              {telemetry?.contextUsed.toLocaleString() || 0} / {telemetry?.contextMax.toLocaleString() || 0} TK
            </div>
          </div>
          
          <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-card-border relative">
            <div 
              className={cn(
                "h-full transition-all duration-500",
                contextPercentage > 90 ? "bg-destructive shadow-[0_0_10px_var(--color-destructive)]" 
                : contextPercentage > 75 ? "bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.5)]"
                : "bg-primary shadow-[0_0_10px_rgba(0,255,255,0.5)]"
              )}
              style={{ width: `${contextPercentage}%` }}
            />
          </div>
        </div>

        {/* Monologue Terminal */}
        <div className="flex flex-col h-[250px]">
          <div className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-1.5 text-muted-foreground mb-2">
            <Terminal className="w-3 h-3" /> Internal Monologue
          </div>
          <div 
            ref={monologueRef}
            className="flex-1 bg-background border border-card-border rounded-lg p-3 overflow-y-auto scrollbar-thin font-mono text-xs space-y-2 relative"
          >
            {telemetry?.monologue.length === 0 ? (
              <div className="text-muted-foreground/50 italic">No activity recorded.</div>
            ) : (
              telemetry?.monologue.map(line => (
                <div key={line.id} className="flex gap-2">
                  <span className="text-muted-foreground/40 shrink-0">[{format(new Date(line.timestamp), "HH:mm:ss")}]</span>
                  <span className={cn(
                    "whitespace-pre-wrap break-words",
                    line.type === 'thought' ? "text-muted-foreground italic" :
                    line.type === 'action' ? "text-primary font-bold" :
                    line.type === 'conclusion' ? "text-green-400 font-bold" :
                    "text-foreground/80"
                  )}>
                    {line.text}
                  </span>
                </div>
              ))
            )}
            <div className="absolute top-0 right-0 bottom-0 w-8 bg-gradient-to-l from-background pointer-events-none" />
          </div>
        </div>

        {/* Tool Call Matrix */}
        <div>
          <div className="text-[10px] uppercase font-bold tracking-widest flex items-center gap-1.5 text-muted-foreground mb-2">
            <Activity className="w-3 h-3" /> Execution Matrix
          </div>
          <div className="space-y-2">
            {telemetry?.toolCalls.length === 0 ? (
              <div className="text-xs text-muted-foreground/50 italic px-2">No tools executed.</div>
            ) : (
              telemetry?.toolCalls.map(call => (
                <div key={call.id} className="bg-background border border-card-border rounded-lg p-2 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold text-foreground">
                      <Code className="w-3 h-3 text-primary" /> {call.toolName}
                    </div>
                    <div>
                      {call.status === 'running' && <Activity className="w-3 h-3 text-primary animate-pulse" />}
                      {call.status === 'pending' && <Clock className="w-3 h-3 text-muted-foreground" />}
                      {call.status === 'success' && <CheckCircle className="w-3 h-3 text-green-500" />}
                      {call.status === 'error' && <AlertCircle className="w-3 h-3 text-destructive" />}
                    </div>
                  </div>
                  
                  {call.args && (
                    <div className="text-[10px] font-mono text-muted-foreground truncate opacity-70">
                      {call.args}
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