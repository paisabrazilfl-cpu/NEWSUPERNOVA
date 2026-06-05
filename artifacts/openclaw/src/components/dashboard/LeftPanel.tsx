import { useState, useEffect } from "react";
import { useListChannels, useListAgents } from "@workspace/api-client-react";
import { AgentStatusDot } from "@/components/ui/agent-status-dot";
import { Hash, Activity, TerminalSquare, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeftPanelProps {
  activeChannelId: number | null;
  setActiveChannelId: (id: number) => void;
  setViewMode: (mode: "canvas" | "chat") => void;
  viewMode: "canvas" | "chat";
}

export function LeftPanel({ activeChannelId, setActiveChannelId, setViewMode, viewMode }: LeftPanelProps) {
  const { data: channels = [] } = useListChannels();
  const { data: agents = [] } = useListAgents();

  // Set default channel if none selected
  useEffect(() => {
    if (!activeChannelId && channels.length > 0) {
      setActiveChannelId(channels[0].id);
    }
  }, [channels, activeChannelId, setActiveChannelId]);

  const getChannelIcon = (type: string) => {
    switch (type) {
      case 'swarm': return <Activity className="w-4 h-4" />;
      case 'terminal': return <TerminalSquare className="w-4 h-4" />;
      case 'hitl': return <AlertTriangle className="w-4 h-4 text-accent" />;
      default: return <Hash className="w-4 h-4" />;
    }
  };

  return (
    <div className="w-[280px] bg-card/80 border-r border-card-border flex flex-col h-full flex-shrink-0 z-10 backdrop-blur-md">
      {/* View Toggle */}
      <div className="p-4 border-b border-card-border">
        <div className="flex bg-background border border-card-border p-1 rounded-lg">
          <button
            onClick={() => setViewMode("canvas")}
            className={cn(
              "flex-1 text-xs font-bold px-3 py-1.5 rounded-md transition-all",
              viewMode === "canvas" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
            )}
            data-testid="toggle-view-canvas"
          >
            SWARM CANVAS
          </button>
          <button
            onClick={() => setViewMode("chat")}
            className={cn(
              "flex-1 text-xs font-bold px-3 py-1.5 rounded-md transition-all",
              viewMode === "chat" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
            )}
            data-testid="toggle-view-chat"
          >
            CHAT STREAM
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
        {/* Channels */}
        <div className="p-4">
          <h2 className="text-[10px] font-bold text-muted-foreground tracking-wider mb-3">CHANNELS</h2>
          <div className="space-y-1">
            {channels.map(channel => (
              <button
                key={channel.id}
                onClick={() => {
                  setActiveChannelId(channel.id);
                  setViewMode("chat");
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-sm transition-all text-left",
                  activeChannelId === channel.id && viewMode === "chat"
                    ? "bg-primary/10 text-primary" 
                    : "text-muted-foreground hover:bg-card hover:text-foreground"
                )}
                data-testid={`channel-item-${channel.id}`}
              >
                {getChannelIcon(channel.type)}
                <span className="truncate flex-1 font-medium">{channel.name}</span>
                {channel.unreadCount && channel.unreadCount > 0 ? (
                  <span className="bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                    {channel.unreadCount}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {/* Agent Roster */}
        <div className="p-4">
          <h2 className="text-[10px] font-bold text-muted-foreground tracking-wider mb-3">ACTIVE ABBY CLAW AGENTS</h2>
          <div className="space-y-1">
            {agents.map(agent => (
              <div
                key={agent.id}
                className="w-full flex items-center gap-3 px-2 py-1.5 rounded-md text-sm transition-all hover:bg-card group cursor-pointer"
                data-testid={`roster-agent-${agent.id}`}
              >
                <div className="relative">
                  <div className="w-8 h-8 rounded-md flex items-center justify-center font-mono font-bold text-xs"
                       style={{ backgroundColor: `${agent.color}20`, color: agent.color, border: `1px solid ${agent.color}40` }}>
                    {agent.avatarInitials}
                  </div>
                  <div className="absolute -bottom-1 -right-1">
                    <AgentStatusDot status={agent.status} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium text-foreground text-sm leading-none" style={{ color: agent.color }}>
                    {agent.name}
                  </div>
                  <div className="truncate text-muted-foreground text-xs mt-1">
                    {agent.role}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}