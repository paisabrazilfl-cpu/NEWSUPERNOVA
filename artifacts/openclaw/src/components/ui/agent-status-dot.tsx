import { cn } from "@/lib/utils";
import { AgentStatus } from "@workspace/api-client-react";

export function AgentStatusDot({ status, className }: { status: AgentStatus; className?: string }) {
  const getStatusColor = () => {
    switch (status) {
      case 'thinking':
      case 'executing':
        return 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse';
      case 'waiting':
        return 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]';
      case 'hitl':
        return 'bg-accent shadow-[0_0_10px_var(--color-accent)] animate-pulse';
      case 'stalled':
        return 'bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.8)]';
      case 'idle':
      default:
        return 'bg-muted-foreground/50';
    }
  };

  return (
    <div 
      className={cn("w-2.5 h-2.5 rounded-full transition-all duration-300", getStatusColor(), className)} 
      title={`Status: ${status}`}
      data-testid={`status-dot-${status}`}
    />
  );
}