import { useEffect, useState } from "react";
import { useGetSwarmStatus, usePauseSwarm, useResumeSwarm, useListAgents, useSendMessage, getListMessagesQueryKey } from "@workspace/api-client-react";
import { Send, Pause, Play, Globe, AtSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";

interface CommandBarProps {
  activeChannelId: number | null;
}

export function CommandBar({ activeChannelId }: CommandBarProps) {
  const [content, setContent] = useState("");
  const [routingMode, setRoutingMode] = useState<"global" | "targeted">("global");
  const [targetAgentId, setTargetAgentId] = useState<number | null>(null);
  
  const { data: swarmStatus } = useGetSwarmStatus();
  const { data: agents = [] } = useListAgents();
  
  const pauseSwarm = usePauseSwarm();
  const resumeSwarm = useResumeSwarm();
  const sendMessage = useSendMessage();
  const queryClient = useQueryClient();

  const handleSend = () => {
    if (!content.trim() || !activeChannelId) return;
    
    sendMessage.mutate({
      data: {
        content,
        messageType: 'user',
        ...(routingMode === 'targeted' && targetAgentId ? { targetAgentId } : {})
      },
      channelId: activeChannelId
    }, {
      onSuccess: () => {
        setContent("");
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(activeChannelId) });
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleSwarmState = () => {
    if (swarmStatus?.paused) {
      resumeSwarm.mutate({});
    } else {
      pauseSwarm.mutate({});
    }
  };

  return (
    <div className="p-4 bg-background border-t border-card-border relative z-20">
      <div className="max-w-4xl mx-auto flex items-end gap-3">
        {/* Swarm Control */}
        <button
          onClick={toggleSwarmState}
          className={cn(
            "h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-all border",
            swarmStatus?.paused 
              ? "bg-muted text-muted-foreground border-card-border hover:bg-card hover:text-foreground" 
              : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 shadow-[0_0_15px_rgba(0,255,255,0.1)]"
          )}
          title={swarmStatus?.paused ? "Resume Swarm" : "Pause Swarm"}
          data-testid="btn-toggle-swarm"
        >
          {swarmStatus?.paused ? <Play className="w-5 h-5 ml-1" /> : <Pause className="w-5 h-5" />}
        </button>

        {/* Input Area */}
        <div className="flex-1 bg-card/50 backdrop-blur-sm border border-card-border rounded-xl focus-within:border-primary/50 focus-within:shadow-[0_0_10px_rgba(0,255,255,0.1)] transition-all overflow-hidden flex flex-col">
          {/* Top meta bar */}
          <div className="flex items-center px-3 py-1.5 border-b border-card-border/50 bg-background/50">
            <button 
              className={cn(
                "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md flex items-center gap-1.5 transition-colors",
                routingMode === "global" 
                  ? "bg-primary/20 text-primary" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => {
                setRoutingMode("global");
                setTargetAgentId(null);
              }}
              data-testid="mode-global"
            >
              <Globe className="w-3 h-3" /> GLOBAL BROADCAST
            </button>
            <div className="w-px h-3 bg-card-border mx-2" />
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
              {agents.map(agent => (
                <button
                  key={agent.id}
                  className={cn(
                    "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md flex items-center gap-1 transition-all",
                    routingMode === "targeted" && targetAgentId === agent.id
                      ? "text-background shadow-[0_0_8px_currentColor]" 
                      : "bg-transparent hover:bg-card-border opacity-50 hover:opacity-100"
                  )}
                  style={{ 
                    backgroundColor: routingMode === "targeted" && targetAgentId === agent.id ? agent.color : "transparent",
                    color: routingMode === "targeted" && targetAgentId === agent.id ? "#000" : agent.color,
                  }}
                  onClick={() => {
                    setRoutingMode("targeted");
                    setTargetAgentId(agent.id);
                  }}
                  data-testid={`mode-targeted-${agent.id}`}
                >
                  <AtSign className="w-2.5 h-2.5" /> {agent.name}
                </button>
              ))}
            </div>
          </div>
          
          <div className="flex items-end p-2 gap-2">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={routingMode === 'global' ? "Issue command to entire swarm..." : `Direct command to selected agent...`}
              className="flex-1 bg-transparent border-none focus:ring-0 resize-none h-10 py-2 px-2 text-sm placeholder:text-muted-foreground/50 scrollbar-thin"
              data-testid="input-command"
            />
            
            <button
              onClick={handleSend}
              disabled={!content.trim() || !activeChannelId || sendMessage.isPending}
              className={cn(
                "h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-all",
                content.trim() && activeChannelId
                  ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(0,255,255,0.4)]"
                  : "bg-card border border-card-border text-muted-foreground opacity-50"
              )}
              data-testid="btn-send-command"
            >
              <Send className="w-4 h-4 ml-0.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}