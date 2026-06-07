import { useState } from "react";
import { Plus, Play, Pause, Trash2, Zap, CheckCircle, Activity, AlertTriangle, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { resolveApiUrl } from "@workspace/api-client-react";
import { toast } from "sonner";

interface CronJob {
  id: number;
  agentId: number;
  name: string;
  schedule: string;
  task: string;
  payload?: string | null;
  enabled: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  runCount: number;
  lastResult?: string | null;
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

const CRON_KEY = ["cron-jobs"];

async function fetchJobs(): Promise<CronJob[]> {
  const r = await fetch(resolveApiUrl("/api/cron"));
  if (!r.ok) throw new Error(`Failed to load cron jobs (HTTP ${r.status})`);
  return r.json();
}

async function postJson(url: string, method: string, body?: unknown) {
  const r = await fetch(resolveApiUrl(url), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${r.status}`);
  }
  return r.status === 204 ? null : r.json();
}

export default function CronPage() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: CRON_KEY });

  const { data: jobs = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: CRON_KEY,
    queryFn: fetchJobs,
    refetchInterval: 10_000,
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ agentId: 2, name: "", schedule: "*/5 * * * *", task: "", payload: "" });
  const [triggeringId, setTriggeringId] = useState<number | null>(null);

  const createJob = useMutation({
    mutationFn: (body: Record<string, unknown>) => postJson("/api/cron", "POST", body),
    onSuccess: () => {
      toast.success("Job scheduled — the swarm will run it on schedule.");
      setForm({ agentId: 2, name: "", schedule: "*/5 * * * *", task: "", payload: "" });
      setShowForm(false);
      invalidate();
    },
    onError: (e: unknown) => toast.error(`Couldn't schedule job: ${e instanceof Error ? e.message : String(e)}`),
  });

  const toggleJob = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => postJson(`/api/cron/${id}`, "PATCH", { enabled }),
    onSuccess: () => invalidate(),
    onError: (e: unknown) => toast.error(`Update failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  const removeJob = useMutation({
    mutationFn: (id: number) => postJson(`/api/cron/${id}`, "DELETE"),
    onSuccess: () => { toast.success("Job deleted."); invalidate(); },
    onError: (e: unknown) => toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`),
  });

  const trigger = async (id: number) => {
    setTriggeringId(id);
    try {
      await postJson(`/api/cron/${id}/trigger`, "POST");
      toast.success("Triggered — running now. Watch the Swarm feed.");
      setTimeout(invalidate, 1500);
    } catch (e) {
      toast.error(`Trigger failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTriggeringId(null);
    }
  };

  const submit = () => {
    if (!form.name.trim() || !form.task.trim()) return;
    createJob.mutate({
      agentId: form.agentId,
      name: form.name.trim(),
      schedule: form.schedule.trim(),
      task: form.task.trim(),
      ...(form.payload.trim() ? { payload: form.payload.trim() } : {}),
    });
  };

  const activeCount = jobs.filter((j) => j.enabled).length;
  const pausedCount = jobs.filter((j) => !j.enabled).length;
  const totalRuns = jobs.reduce((s, j) => s + j.runCount, 0);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Scheduled jobs</h1>
          <p className="text-sm text-muted-foreground mt-1">Tasks the swarm runs automatically, on a schedule.</p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-bold hover:bg-primary/20 transition-all shadow-[0_0_10px_rgba(0,229,255,0.1)]"
          data-testid="button-new-cron"
        >
          <Plus className="w-4 h-4" /> NEW JOB
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Active", value: activeCount, color: "#00e5ff", icon: Activity },
          { label: "Paused", value: pausedCount, color: "#71717a", icon: Pause },
          { label: "Total Runs", value: totalRuns, color: "#bf00ff", icon: CheckCircle },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${color}15`, border: `1px solid ${color}30` }}>
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
            <Plus className="w-4 h-4" /> Schedule a new job
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Assign to agent</label>
              <select
                value={form.agentId}
                onChange={(e) => setForm((f) => ({ ...f, agentId: Number(e.target.value) }))}
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              >
                {Object.entries(AGENT_INFO).map(([id, info]) => (
                  <option key={id} value={id}>{info.name}{Number(id) === 1 ? " (orchestrates the whole swarm)" : ""}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Job name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Daily AI news brief"
                className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Schedule</label>
            <div className="flex gap-2 flex-wrap mb-2">
              {PRESET_SCHEDULES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setForm((f) => ({ ...f, schedule: p.value }))}
                  className={cn(
                    "text-[11px] font-mono px-2 py-1 rounded border transition-all",
                    form.schedule === p.value
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "border-card-border text-muted-foreground hover:border-primary/30 hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <input
              value={form.schedule}
              onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
              placeholder="* * * * *"
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm font-mono text-foreground focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Task (plain English — ABBY dispatches it)</label>
            <input
              value={form.task}
              onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))}
              placeholder="e.g. Search the web for today's AI news and post a 3-bullet brief"
              className="w-full bg-background border border-card-border rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
            />
          </div>
          <div className="flex gap-3 justify-end pt-1">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            <button
              onClick={submit}
              disabled={!form.name.trim() || !form.task.trim() || createJob.isPending}
              className="px-5 py-2 rounded-xl bg-primary text-black text-sm font-bold disabled:opacity-40 transition-all shadow-[0_0_10px_rgba(0,229,255,0.3)] flex items-center gap-2"
            >
              {createJob.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Schedule job
            </button>
          </div>
        </div>
      )}

      {/* Jobs List */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="text-sm font-mono">Loading scheduled jobs…</span>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <AlertTriangle className="w-7 h-7 text-destructive" />
          <span className="text-sm text-muted-foreground">Couldn't load cron jobs.</span>
          <button onClick={() => refetch()} className="px-4 py-1.5 rounded-lg border border-card-border text-sm text-foreground hover:border-primary/40 transition-all">
            Retry
          </button>
        </div>
      ) : jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Clock className="w-8 h-8 text-muted-foreground/40" />
          <div className="text-sm text-muted-foreground">No scheduled jobs yet.</div>
          <div className="text-xs text-muted-foreground/60 max-w-sm">
            Create a job to have the swarm run a task on a recurring schedule — e.g. a daily news brief or an hourly site check.
          </div>
          <button onClick={() => setShowForm(true)} className="mt-1 flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-bold hover:bg-primary/20 transition-all">
            <Plus className="w-4 h-4" /> Create your first job
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const info = AGENT_INFO[job.agentId] ?? AGENT_INFO[1];
            const isTriggering = triggeringId === job.id;
            return (
              <div key={job.id} className={cn("bg-card border rounded-xl p-4 transition-all", job.enabled ? "border-card-border" : "border-card-border/40 opacity-60")}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-mono font-bold" style={{ backgroundColor: `${info.color}20`, color: info.color, border: `1px solid ${info.color}40` }}>
                      {info.initials}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm">{job.name}</span>
                        <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border uppercase tracking-wider", job.enabled ? "text-green-400 border-green-500/30 bg-green-500/10" : "text-zinc-500 border-zinc-700 bg-zinc-800/50")}>
                          {job.enabled ? "ACTIVE" : "PAUSED"}
                        </span>
                        <span className="text-[10px] text-muted-foreground/60 font-mono">→ {info.name}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <code className="text-[11px] font-mono text-primary/80 bg-primary/5 px-1.5 py-0.5 rounded">{job.schedule}</code>
                        <span className="text-[11px] text-muted-foreground truncate max-w-xs">{job.task}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground/70 font-mono">
                        {job.lastRunAt && <span>last: {format(new Date(job.lastRunAt), "HH:mm:ss")}</span>}
                        {job.nextRunAt && job.enabled && <span>next: {format(new Date(job.nextRunAt), "HH:mm:ss")}</span>}
                        <span className="text-muted-foreground/40">{job.runCount} runs</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => trigger(job.id)} disabled={isTriggering} title="Trigger now" className="w-7 h-7 rounded-lg border border-card-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-all flex items-center justify-center">
                      {isTriggering ? <Activity className="w-3.5 h-3.5 animate-pulse text-primary" /> : <Zap className="w-3.5 h-3.5" />}
                    </button>
                    <button onClick={() => toggleJob.mutate({ id: job.id, enabled: !job.enabled })} title={job.enabled ? "Pause" : "Resume"} className="w-7 h-7 rounded-lg border border-card-border text-muted-foreground hover:text-foreground hover:border-card-border/80 transition-all flex items-center justify-center">
                      {job.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                    </button>
                    <button onClick={() => removeJob.mutate(job.id)} title="Delete" className="w-7 h-7 rounded-lg border border-card-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-all flex items-center justify-center">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {isFetching && <div className="text-center text-[10px] text-muted-foreground/40 font-mono">syncing…</div>}
        </div>
      )}
    </div>
  );
}
