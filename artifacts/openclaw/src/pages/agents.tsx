import { useListAgents } from "@workspace/api-client-react";
import { AgentStatusDot } from "@/components/ui/agent-status-dot";
import { Terminal, Shield, Cpu, Activity, Info } from "lucide-react";

export default function Agents() {
  const { data: agents = [], isLoading } = useListAgents();

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden relative">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-background to-background"></div>
      
      <div className="p-8 border-b border-card-border relative z-10 flex items-center gap-4">
        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center border border-primary/20">
          <Terminal className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">ABBY CLAW AGENTS</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage and monitor autonomous operational units.</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 relative z-10">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-64 bg-card/50 rounded-xl border border-card-border animate-pulse"></div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map(agent => (
              <div key={agent.id} className="bg-card/40 backdrop-blur-sm border border-card-border rounded-xl p-6 relative overflow-hidden group hover:border-primary/50 transition-colors">
                {/* Accent line top */}
                <div className="absolute top-0 left-0 right-0 h-1" style={{ backgroundColor: agent.color }}></div>
                
                <div className="flex justify-between items-start mb-6">
                  <div className="flex gap-4 items-center">
                    <div className="w-12 h-12 rounded-lg flex items-center justify-center font-mono font-bold text-lg"
                         style={{ backgroundColor: `${agent.color}20`, color: agent.color, border: `1px solid ${agent.color}40` }}>
                      {agent.avatarInitials}
                    </div>
                    <div>
                      <h3 className="font-bold text-lg" style={{ color: agent.color }}>{agent.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <AgentStatusDot status={agent.status} />
                        <span className="text-xs uppercase tracking-wider text-muted-foreground font-mono">{agent.status}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Role</div>
                    <div className="text-sm font-medium">{agent.role}</div>
                  </div>
                  
                  {agent.description && (
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Directive</div>
                      <div className="text-xs text-muted-foreground line-clamp-2">{agent.description}</div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-background/50 p-3 rounded-lg border border-card-border">
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-2">
                        <Cpu className="w-3 h-3" /> Model
                      </div>
                      <div className="text-xs font-mono">{agent.model || 'Unknown'}</div>
                    </div>
                    <div className="bg-background/50 p-3 rounded-lg border border-card-border">
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-2">
                        <Activity className="w-3 h-3" /> Context
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="text-xs font-mono">{Math.round((agent.contextUsed / agent.contextMax) * 100)}% Used</div>
                        <div className="h-1.5 w-full bg-card-border rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-primary" 
                            style={{ width: `${Math.min(100, (agent.contextUsed / agent.contextMax) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {agent.capabilities && agent.capabilities.length > 0 && (
                    <div>
                      <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-2">Capabilities</div>
                      <div className="flex flex-wrap gap-2">
                        {agent.capabilities.map(cap => (
                          <span key={cap} className="px-2 py-1 bg-secondary text-secondary-foreground text-[10px] rounded-md border border-card-border uppercase font-mono">
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}