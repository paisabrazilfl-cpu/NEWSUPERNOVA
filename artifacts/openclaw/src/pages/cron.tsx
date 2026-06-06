import { useState } from "react";
import { Clock, Plus, Play, Pause, Trash2, Zap, CheckCircle, AlertCircle, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface CronJob {
  id: number;
  agentId: number;
  name: string;
  schedule: string;
  task: string;
  payload?: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  lastResult?: string;
  createdAt: string;
}

const AGENT_INFO: Record<number, { name: string; color: string; initials: string }> = {
  1: { name: "ABBY",    color: "#00e5ff", initials: "AB" },
  2: { name: "FORGE",   color: "#bf00ff", initials: "FG" },
  3: { name: "CRAWLER", color: "#0066ff", initials: "CR" },
  4: { name: "VAULT",   color: "#00cc88", initials: "VT" },
  5: { name: "WIRE",    color: "#ff6b00", initials: "WR" },
  6: { name: "MR.NICE", color: "#ff2d78", initials: "MN" },
};

const PRESET_SCHEDULES = [
  { label: "Every minute",   value: "* * * * *" },
  { label: "Every 5 min",    value: "*/5 * * * *" },
  { label: "Every 15 min",   value: "*/15 * * * *" },
  { label: "Every 30 min",   value: "*/30 * * * *" },
  { label: "Every hour",     value: "0 * * * *" },
  { label: "Every 6 hours",  value: "0 */6 * * *" },
  { label: "Daily midnight", value: "0 0 * * *" },
  { label: "Weekly Monday",  value: "0 9 * * 1" },
];

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([
    {
      id: 1, agentId: 2, name: "Build Health Check", schedule: "*/5 * * * *",
      task: "exec: pnpm run typecheck --workspace @workspace/api-server",
      enabled: true, runCount: 47, lastRunAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      nextRunAt: new Date(Date.now() + 5 * 60_000).toISOString(), createdAt: new Date(Date.now() - 86400_000).toISOString(),
    },
    {
      id: 2, agentId: 3, name: "Crawl OpenClaw Releases", schedule: "0 */6 * * *",
      task: "web_search: site:github.com/openclaw/openclaw/releases latest",
      enabled: true, runCount: 12, lastRunAt: new Date(Date.now() - 90 * 60_000).toISOString(),
      nextRunAt: new Date(Date.now() + 270 * 60_000).toISOString(), createdAt: new Date(Date.now() - 86400_000 * 2).toISOString(),
    },
    {
      id: 3, agentId: 4, name: "Index Agent Sessions", schedule: "0 * * * *",
      task: "memory_lancedb: upsert collection=agent_sessions source=all_sessions",
      enabled: true, runCount: 8, lastRunAt: new Date(Date.now() - 30 * 60_000).toISOString(),
      nextRunAt: new Date(Date.now() + 30 * 60_000).toISOString(), createdAt: new Date(Date.now() - 86400_000 * 3).toISOString(),
    },
    {
      id: 4, agentId: 5, name: "Gmail Sync", schedule: "*/15 * * * *",
      task: "web_fetch: https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread",
      enabled: false, runCount: 33, lastRunAt: new Date(Date.now() - 20 * 60_000).toISOString(),
      nextRunAt: undefined, createdAt: new Date(Date.now() - 86400_000).toISOString(),
    },
    {
      id: 5, agentId: 5, name: "n8n Workflow Status", schedule: "*/5 * * * *",
      task: "web_fetch: https://n8n.abbyclaw.io/api/v1/workflows?active=true",
      enabled: true, runCount: 142, lastRunAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      nextRunAt: new Date(Date.now() + 5 * 60_000).toISOString(), createdAt: new Date(Date.now() - 86400_000 * 5).toISOString(),
    },
  ]);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    agentId: 2,
    name: "",
    schedule: "*/5 * * * *",
    task: "",
    payload: "",
  });
  const [triggeringId, setTriggeringId] = useState<number | null>(null);

  const toggle = (id: number) => {
    setJobs(j => j.map(job => job.id === id ? { ...job, enabled: !job.enabled } : job));
  };

  const remove = (id: number) => {
    setJobs(j => j.filter(job => job.id !== id));
  };

  const trigger = async (id: number) => {
    setTriggeringId(id);
    await new Promise(r => setTimeout(r, 800));
    setJobs(j => j.map(job => job.id === id ? {
      ...job,
      runCount: job.runCount + 1,
      lastRunAt: new Date().toISOString(),
    } : job));
    setTriggeringId(null);
  };

  const addJob = () => {
    if (!form.name.trim() || !form.task.trim()) return;
    const newJob: CronJob = {
      id: Date.now(),
      agentId: form.agentId,
      name: form.name,
      schedule: form.schedule,
      task: form.task,
      payload: form.payload || undefined,
      enabled: true,
      runCount: 0,
      nextRunAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    setJobs(j => [newJob, ...j]);
    setForm({ agentId: 2, name: "", schedule: "*/5 * * * *", task: "", payload: "" });
    setShowForm(false);
  };

  const activeCount  = jobs.filter(j => j.enabled).length;
  const pausedCount  = jobs.filter(j => !j.enabled).length;
  const totalRuns    = jobs.reduce((s, j) => s + j.runCount, 0);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-primary">ABBY</span>
            <span className="text-muted-foreground font-normal mx-2">→</span>
            <span>Cron Scheduler</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1 font-mono">ABBY schedules recurring tasks across the swarm</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-bold hover:bg-primary/20 transition-all shadow-[0_0_10px_rgba(0,229,255,0.1)]"
        >
          <Plus className="w-4 h-4" /> NEW JOB
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Active", value: activeCount,  color: "#00e5ff", icon: Activity },
          { label: "Paused", value: pausedCount,  color: "#71717a", icon: Pause },
          { label: "Total Runs", value: totalRuns, color: "#bf00ff", icon: CheckCircle },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center"
                 style={{ backgroundColor: `${color}15`, border: `1px solid ${color}30` }}>
              <Icon className="w-5 h-5" style={{ color }} />
            </div>
            <div>
              <div className="text-2xl font-bold font-mono" style={{ color }}>{value}</div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* New Job Form */}
      {showForm && (
        <div className="bg-card border border-primary/30 rounded-xl p-5 shadow-[0_0_20px_rgba(0,229,255,0.08)] space-y-4">
          <div className="text-sm font-bold text-primary uppercase tracking-widest flex items-center gap-2">
            <Plus className="w-4 h-4" /> Schedule New Job for ABBY
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Assign to Agent</label>
              <select
                value={form.agentId}
                onChange={e => setForm(f => ({ ...f, agentId: Number(e.target.value) }))}
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              >
                {Object.entries(AGENT_INFO).map(([id, info]) => (
                  <option key={id} value={id}>{info.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Job Name</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Daily GitHub Sync"
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Schedule</label>
            <div className="flex gap-2 flex-wrap mb-2">
              {PRESET_SCHEDULES.map(p => (
                <button
                  key={p.value}
                  onClick={() => setForm(f => ({ ...f, schedule: p.value }))}
                  className={cn(
                    "text-[10px] font-mono px-2 py-1 rounded border transition-all",
                    form.schedule === p.value
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "border-card-border text-muted-foreground hover:border-primary/30 hover:text-foreground"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              value={form.schedule}
              onChange={e => setForm(f => ({ ...f, schedule: e.target.value }))}
              placeholder="* * * * *"
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Task (ABBYCLAW tool call)</label>
            <input
              value={form.task}
              onChange={e => setForm(f => ({ ...f, task: e.target.value }))}
              placeholder="exec: pnpm run build  |  web_search: github releases  |  memory_lancedb: upsert ..."
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button
              onClick={addJob}
              disabled={!form.name.trim() || !form.task.trim()}
              className="px-5 py-2 rounded-xl bg-primary text-black text-sm font-bold disabled:opacity-40 transition-all shadow-[0_0_10px_rgba(0,229,255,0.3)]"
            >
              Schedule Job
            </button>
          </div>
        </div>
      )}

      {/* Jobs List */}
      <div className="space-y-3">
        {jobs.map(job => {
          const info = AGENT_INFO[job.agentId] ?? AGENT_INFO[1];
          const isTriggering = triggeringId === job.id;
          return (
            <div
              key={job.id}
              className={cn(
                "bg-card border rounded-xl p-4 transition-all",
                job.enabled ? "border-card-border" : "border-card-border/40 opacity-60"
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Agent badge */}
                  <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-mono font-bold"
                       style={{ backgroundColor: `${info.color}20`, color: info.color, border: `1px solid ${info.color}40` }}>
                    {info.initials}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{job.name}</span>
                      <span className={cn(
                        "text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wider",
                        job.enabled ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-zinc-500 border-zinc-700 bg-zinc-800/50"
                      )}>
                        {job.enabled ? "ACTIVE" : "PAUSED"}
                      </span>
                      <span className="text-[9px] text-muted-foreground/50 font-mono">→ {info.name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <code className="text-[10px] font-mono text-primary/80 bg-primary/5 px-1.5 py-0.5 rounded">
                        {job.schedule}
                      </code>
                      <span className="text-[10px] text-muted-foreground truncate max-w-xs">{job.task}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/50 font-mono">
                      {job.lastRunAt && <span>last: {format(new Date(job.lastRunAt), "HH:mm:ss")}</span>}
                      {job.nextRunAt && job.enabled && <span>next: {format(new Date(job.nextRunAt), "HH:mm:ss")}</span>}
                      <span className="text-muted-foreground/30">{job.runCount} runs</span>
                    </div>
                  </div>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => trigger(job.id)}
                    disabled={isTriggering}
                    title="Trigger now"
                    className="w-7 h-7 rounded-lg border border-card-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-all flex items-center justify-center"
                  >
                    {isTriggering
                      ? <Activity className="w-3.5 h-3.5 animate-pulse text-primary" />
                      : <Zap className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => toggle(job.id)}
                    title={job.enabled ? "Pause" : "Resume"}
                    className="w-7 h-7 rounded-lg border border-card-border text-muted-foreground hover:text-foreground hover:border-card-border/80 transition-all flex items-center justify-center"
                  >
                    {job.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                  </button>
                  <button
                    onClick={() => remove(job.id)}
                    title="Delete"
                    className="w-7 h-7 rounded-lg border border-card-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-all flex items-center justify-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
