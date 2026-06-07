import { useListMessages } from "@workspace/api-client-react";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getListMessagesQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Terminal, Bot, Shield, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatStreamProps {
  channelId: number | null;
}

export function ChatStream({ channelId }: ChatStreamProps) {
  const queryClient = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);
  
  const { data: messages = [], isLoading } = useListMessages(channelId ?? 0, {
    query: {
      enabled: !!channelId,
      queryKey: getListMessagesQueryKey(channelId ?? 0)
    }
  });

  // Auto-poll messages
  useEffect(() => {
    if (!channelId) return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(channelId) });
    }, 3000);
    return () => clearInterval(interval);
  }, [channelId, queryClient]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (!channelId) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-background/50 text-muted-foreground">
        <div className="text-center font-mono uppercase tracking-widest text-sm opacity-50 flex flex-col items-center">
          <Terminal className="w-8 h-8 mb-4 opacity-50" />
          Select a channel to view stream
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-background/50">
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent,rgba(0,0,0,0.8))] pointer-events-none z-10 h-16" />
      
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 pt-16 scrollbar-thin relative z-0"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground animate-pulse font-mono text-sm">
            Initializing stream...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
            <Shield className="w-12 h-12 mb-4" />
            <div className="font-mono uppercase tracking-widest text-sm">Stream initialized. Awaiting input.</div>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isConsecutive = i > 0 && messages[i - 1].agentId === msg.agentId && messages[i-1].messageType === msg.messageType;
            
            return (
              <div 
                key={msg.id} 
                className={cn(
                  "flex gap-4 group",
                  isConsecutive ? "mt-2" : "mt-6"
                )}
                data-testid={`message-${msg.id}`}
              >
                {/* Avatar area */}
                <div className="w-10 flex-shrink-0 flex justify-center">
                  {!isConsecutive && (
                    msg.messageType === 'user' ? (
                      <div className="w-10 h-10 rounded-lg bg-card border border-card-border flex items-center justify-center shadow-sm">
                        <Terminal className="w-5 h-5 text-foreground opacity-70" />
                      </div>
                    ) : msg.messageType === 'system' ? (
                      <div className="w-10 h-10 rounded-lg bg-muted border border-muted-border flex items-center justify-center">
                        <Shield className="w-5 h-5 text-muted-foreground" />
                      </div>
                    ) : (
                      <div 
                        className="w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm shadow-[0_0_15px_rgba(0,0,0,0.2)]"
                        style={{ 
                          backgroundColor: `${msg.agentColor || '#888'}20`, 
                          color: msg.agentColor || '#888', 
                          border: `1px solid ${msg.agentColor || '#888'}40`,
                          boxShadow: `0 0 10px ${msg.agentColor || '#888'}20`
                        }}
                      >
                        {msg.agentName ? msg.agentName.substring(0, 2).toUpperCase() : <Bot className="w-5 h-5" />}
                      </div>
                    )
                  )}
                  {isConsecutive && (
                    <div className="opacity-0 group-hover:opacity-50 text-[10px] font-mono text-muted-foreground pt-1">
                      {format(new Date(msg.timestamp), "HH:mm")}
                    </div>
                  )}
                </div>

                {/* Content area */}
                <div className="flex-1 min-w-0">
                  {!isConsecutive && (
                    <div className="flex items-baseline gap-2 mb-1">
                      <span 
                        className="font-bold text-sm tracking-wide"
                        style={{ color: msg.messageType === 'user' ? 'var(--color-foreground)' : (msg.agentColor || 'var(--color-muted-foreground)') }}
                      >
                        {msg.messageType === 'user' ? 'OPERATOR' : msg.messageType === 'system' ? 'SYSTEM' : msg.agentName || 'UNKNOWN_AGENT'}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {format(new Date(msg.timestamp), "HH:mm:ss.SSS")}
                      </span>
                    </div>
                  )}

                  <div className={cn(
                    "text-sm leading-relaxed",
                    msg.messageType === 'system' && "text-muted-foreground font-mono text-xs uppercase tracking-wider",
                    msg.messageType === 'tool_output' && "bg-card/50 border border-card-border rounded-md p-3 font-mono text-xs text-muted-foreground mt-2",
                    msg.messageType === 'hitl_request' && "bg-accent/10 border border-accent/30 rounded-lg p-4 text-accent mt-2 shadow-[0_0_15px_rgba(var(--color-accent),0.1)]",
                    msg.messageType === 'user' && "text-foreground",
                    msg.messageType === 'agent' && "text-foreground/90"
                  )}>
                    {msg.messageType === 'hitl_request' && (
                      <div className="flex items-center gap-2 font-bold mb-2 uppercase tracking-widest text-xs">
                        <AlertTriangle className="w-4 h-4 animate-pulse" /> Authorization Required
                      </div>
                    )}
                    
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}