import { useListTasks, getListTasksQueryKey } from "@workspace/api-client-react";
import { LayoutGrid, Clock, PlayCircle, CheckCircle2, XCircle, PauseCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Tasks() {
  // Poll so this reflects what agents are doing RIGHT NOW, live.
  const { data: tasks = [], isLoading, isError, refetch } = useListTasks({
    query: { refetchInterval: 3000, queryKey: getListTasksQueryKey() },
  });

  // Surface active work first: running → queued → paused → newest of the rest.
  const rank: Record<string, number> = { running: 0, queued: 1, paused: 2, failed: 3, interrupted: 5, completed: 4 };
  const sorted = [...tasks].sort(
    (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || b.id - a.id,
  );
  const counts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});
  const live = (counts["running"] ?? 0) + (counts["queued"] ?? 0);

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'queued': return <Clock className="w-4 h-4 text-muted-foreground" />;
      case 'running': return <PlayCircle className="w-4 h-4 text-primary animate-pulse" />;
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'failed': return <XCircle className="w-4 h-4 text-destructive" />;
      case 'interrupted': return <RotateCcw className="w-4 h-4 text-amber-500" />;
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
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Tasks</h1>
          <p className="text-sm text-muted-foreground mt-1">What your agents are working on right now.</p>
        </div>
        {!isLoading && !isError && tasks.length > 0 && (
          <div className="ml-auto flex items-center gap-3 text-xs shrink-0">
            <span className="flex items-center gap-1.5 text-foreground">
              <span className={cn("w-2 h-2 rounded-full", live > 0 ? "bg-primary animate-pulse" : "bg-muted-foreground")} />
              {live > 0 ? `${live} active` : "idle"}
            </span>
            <span className="text-muted-foreground hidden sm:inline">
              {counts["running"] ?? 0} running · {counts["queued"] ?? 0} queued · {counts["completed"] ?? 0} done · {counts["failed"] ?? 0} failed{counts["interrupted"] ? ` · ${counts["interrupted"]} interrupted` : ""}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-8 relative z-10">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground animate-pulse">Scanning queue…</div>
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
            <span>Couldn't load the task queue.</span>
            <button onClick={() => refetch()} className="text-xs underline text-foreground hover:text-primary">Retry</button>
          </div>
        ) : tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2 text-muted-foreground">
            <LayoutGrid className="w-8 h-8 opacity-40" />
            <span>No tasks yet — the swarm is idle.</span>
            <span className="text-xs">Give the swarm a goal in <span className="text-foreground font-medium">Chat</span> and tasks will appear here live as agents work.</span>
          </div>
        ) : (
          <>
            {/* Desktop: table */}
            <div className="hidden md:block bg-card/40 backdrop-blur-sm border border-card-border rounded-xl overflow-x-auto">
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
                  {sorted.map(task => (
                    <tr key={task.id} className="border-b border-card-border hover:bg-card/60 transition-colors group">
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(task.status)}
                          <span className="text-xs uppercase font-mono">{task.status}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-sm">{task.title}</div>
                        {task.description && <div className="text-xs text-muted-foreground line-clamp-1 mt-1">{task.description}</div>}
                      </td>
                      <td className="p-4">
                        {task.agentName ? <span className="text-xs font-mono font-bold text-primary">{task.agentName}</span> : <span className="text-xs text-muted-foreground italic">Unassigned</span>}
                      </td>
                      <td className="p-4">
                        <span className={cn("text-[10px] px-2 py-1 rounded-md border uppercase font-bold tracking-wider", getPriorityColor(task.priority))}>{task.priority}</span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="h-1.5 flex-1 bg-background rounded-full overflow-hidden border border-card-border">
                            <div className={cn("h-full transition-all duration-500", task.status === 'completed' ? "bg-green-500" : task.status === 'failed' ? "bg-destructive" : (task.status as string) === 'interrupted' ? "bg-amber-500" : "bg-primary")} style={{ width: `${task.progress || 0}%` }} />
                          </div>
                          <span className="text-xs font-mono w-8 text-right">{task.progress || 0}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards */}
            <div className="md:hidden space-y-3">
              {sorted.map(task => (
                <div key={task.id} className="bg-card/40 backdrop-blur-sm border border-card-border rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(task.status)}
                      <span className="text-xs uppercase font-mono text-muted-foreground">{task.status}</span>
                    </div>
                    <span className={cn("text-[10px] px-2 py-1 rounded-md border uppercase font-bold tracking-wider shrink-0", getPriorityColor(task.priority))}>{task.priority}</span>
                  </div>
                  <div className="font-medium text-sm mt-2">{task.title}</div>
                  {task.description && <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{task.description}</div>}
                  <div className="flex items-center justify-between mt-3 mb-1.5 text-xs">
                    {task.agentName ? <span className="font-mono font-bold text-primary">{task.agentName}</span> : <span className="text-muted-foreground italic">Unassigned</span>}
                    <span className="font-mono text-muted-foreground">{task.progress || 0}%</span>
                  </div>
                  <div className="h-1.5 bg-background rounded-full overflow-hidden border border-card-border">
                    <div className={cn("h-full transition-all duration-500", task.status === 'completed' ? "bg-green-500" : task.status === 'failed' ? "bg-destructive" : (task.status as string) === 'interrupted' ? "bg-amber-500" : "bg-primary")} style={{ width: `${task.progress || 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}