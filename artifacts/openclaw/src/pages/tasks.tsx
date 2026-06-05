import { useListTasks } from "@workspace/api-client-react";
import { LayoutGrid, Clock, PlayCircle, CheckCircle2, XCircle, PauseCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Tasks() {
  const { data: tasks = [], isLoading } = useListTasks();

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'queued': return <Clock className="w-4 h-4 text-muted-foreground" />;
      case 'running': return <PlayCircle className="w-4 h-4 text-primary animate-pulse" />;
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'failed': return <XCircle className="w-4 h-4 text-destructive" />;
      case 'paused': return <PauseCircle className="w-4 h-4 text-accent" />;
      default: return null;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch(priority) {
      case 'critical': return 'text-destructive border-destructive/50 bg-destructive/10';
      case 'high': return 'text-orange-500 border-orange-500/50 bg-orange-500/10';
      case 'medium': return 'text-yellow-500 border-yellow-500/50 bg-yellow-500/10';
      case 'low': return 'text-blue-500 border-blue-500/50 bg-blue-500/10';
      default: return 'text-muted-foreground border-card-border bg-card';
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden relative">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-accent/5 via-background to-background"></div>
      
      <div className="p-8 border-b border-card-border relative z-10 flex items-center gap-4">
        <div className="w-12 h-12 bg-accent/10 rounded-lg flex items-center justify-center border border-accent/20">
          <LayoutGrid className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">GLOBAL TASK QUEUE</h1>
          <p className="text-sm text-muted-foreground mt-1">Operational objectives and execution status.</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 relative z-10">
        <div className="bg-card/40 backdrop-blur-sm border border-card-border rounded-xl overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-card-border bg-card/50 text-[10px] uppercase tracking-widest text-muted-foreground font-bold">
                <th className="p-4">Status</th>
                <th className="p-4">Objective</th>
                <th className="p-4">Assigned Agent</th>
                <th className="p-4">Priority</th>
                <th className="p-4 w-[200px]">Progress</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground animate-pulse">
                    Scanning queue...
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No active tasks. Swarm is idle.
                  </td>
                </tr>
              ) : (
                tasks.map(task => (
                  <tr key={task.id} className="border-b border-card-border hover:bg-card/60 transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(task.status)}
                        <span className="text-xs uppercase font-mono">{task.status}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="font-medium text-sm">{task.title}</div>
                      {task.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1 mt-1">{task.description}</div>
                      )}
                    </td>
                    <td className="p-4">
                      {task.agentName ? (
                        <span className="text-xs font-mono font-bold text-primary">{task.agentName}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Unassigned</span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className={cn("text-[10px] px-2 py-1 rounded-md border uppercase font-bold tracking-wider", getPriorityColor(task.priority))}>
                        {task.priority}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 flex-1 bg-background rounded-full overflow-hidden border border-card-border">
                          <div 
                            className={cn(
                              "h-full transition-all duration-500",
                              task.status === 'completed' ? "bg-green-500" : task.status === 'failed' ? "bg-destructive" : "bg-primary"
                            )} 
                            style={{ width: `${task.progress || 0}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono w-8 text-right">{task.progress || 0}%</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}