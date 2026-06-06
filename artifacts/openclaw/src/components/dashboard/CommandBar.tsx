import { useState, useCallback } from "react";
import { useGetSwarmStatus, usePauseSwarm, useResumeSwarm, useListAgents, useSendMessage, getListMessagesQueryKey } from "@workspace/api-client-react";
import { Send, Pause, Play, Globe, AtSign, Zap, ChevronDown, BrainCircuit, Loader, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { useAiStream } from "@/hooks/useAiStream";

type TabMode = "chat" | "command";

const COMMAND_PRESETS = [
  "exec: pnpm run build",
  "exec: pnpm run typecheck",
  "web_search: github.com/openclaw latest release",
  "web_fetch: https://api.abbyclaw.io/status",
  "steel_browser: launch session=persistent",
  "steel_scrape: url=https://github.com/trending",
  "steel_screenshot: url=https://dashboard.abbyclaw.io fullPage=true",
  "steel_pdf: url=https://docs.abbyclaw.io",
  "browser: navigate https://dashboard.abbyclaw.io",
  "memory_lancedb: query collection=sessions limit=10",
  "firecrawl: scrape https://github.com/openclaw",
  "n8n_trigger: workflow_id=health-check",
];

const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

interface CommandBarProps {
  activeChannelId: number | null;
}

export function CommandBar({ activeChannelId }: CommandBarProps) {
  const [tab, setTab] = useState<TabMode>("chat");

  // ── Chat state ──────────────────────────────────────────────────────────
  const [content, setContent] = useState("");
  const [routingMode, setRoutingMode] = useState<"global" | "targeted">("global");
  const [targetAgentId, setTargetAgentId] = useState<number | null>(null);
  const [aiEnabled, setAiEnabled] = useState(true);

  // ── ABBY command state ──────────────────────────────────────────────────
  const [cmdTarget, setCmdTarget] = useState<number | "all">("all");
  const [cmdText, setCmdText] = useState("");
  const [cmdPayload, setCmdPayload] = useState("");
  const [cmdPriority, setCmdPriority] = useState<typeof PRIORITIES[number]>("normal");
  const [cmdStatus, setCmdStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [showPresets, setShowPresets] = useState(false);

  const { data: swarmStatus } = useGetSwarmStatus();
  const { data: agents = [] } = useListAgents();
  const pauseSwarm = usePauseSwarm();
  const resumeSwarm = useResumeSwarm();
  const sendMessage = useSendMessage();
  const queryClient = useQueryClient();

  // ── AI Streaming ────────────────────────────────────────────────────────
  const onAiComplete = useCallback((agentId: number | null) => {
    if (activeChannelId) {
      // Give a beat for the DB write to finish, then refresh messages
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(activeChannelId) });
      }, 400);
    }
  }, [activeChannelId, queryClient]);

  const ai = useAiStream(onAiComplete);

  const handleChatSend = () => {
    if (!content.trim() || !activeChannelId) return;
    const msg = content.trim();
    setContent("");

    // 1. Save user message
    sendMessage.mutate(
      {
        data: {
          content: msg,
          messageType: "user",
          ...(routingMode === "targeted" && targetAgentId ? { targetAgentId } : {}),
        },
        channelId: activeChannelId,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(activeChannelId) });
          // 2. Trigger AI response if enabled
          if (aiEnabled) {
            const agentId = routingMode === "targeted" ? targetAgentId : null; // null → defaults to ABBY
            ai.send({ message: msg, agentId, channelId: activeChannelId });
          }
        },
      }
    );
  };

  const handleChatKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); }
  };

  const handleAbbyCommand = async () => {
    if (!cmdText.trim()) return;
    setCmdStatus("sending");
    try {
      const body: Record<string, unknown> = { command: cmdText, priority: cmdPriority };
      if (cmdTarget !== "all") body.toAgentId = cmdTarget;
      if (cmdPayload.trim()) body.payload = cmdPayload;
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setCmdStatus("sent");
      setCmdText("");
      setCmdPayload("");
      setTimeout(() => setCmdStatus("idle"), 2500);
    } catch {
      setCmdStatus("error");
      setTimeout(() => setCmdStatus("idle"), 3000);
    }
  };

  const handleCmdKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAbbyCommand(); }
  };

  const toggleSwarm = () => {
    if (swarmStatus?.paused) resumeSwarm.mutate(undefined as unknown as void);
    else pauseSwarm.mutate(undefined as unknown as void);
  };

  const targetAgent = agents.find(a => a.id === targetAgentId);
  const respondingAgent = ai.agentId ? agents.find(a => a.id === ai.agentId) : null;

  return (
    <div className="p-4 bg-background border-t border-card-border relative z-20">

      {/* ── Streaming indicator banner ────────────────────────────────── */}
      {(ai.streaming || (ai.tokens && !ai.streaming)) && (
        <div className="max-w-4xl mx-auto mb-2">
          <div
            className="rounded-xl border px-4 py-2.5 flex items-start gap-3 relative overflow-hidden"
            style={{
              backgroundColor: `${respondingAgent?.color ?? "#00e5ff"}12`,
              borderColor: `${respondingAgent?.color ?? "#00e5ff"}30`,
            }}
          >
            {/* Neon glow line */}
            <div className="absolute top-0 left-0 right-0 h-px"
              style={{ backgroundColor: respondingAgent?.color ?? "#00e5ff", opacity: 0.5 }} />

            <div className="flex items-center gap-2 shrink-0 pt-0.5">
              {ai.streaming ? (
                <Loader className="w-3.5 h-3.5 animate-spin" style={{ color: respondingAgent?.color ?? "#00e5ff" }} />
              ) : (
                <BrainCircuit className="w-3.5 h-3.5" style={{ color: respondingAgent?.color ?? "#00e5ff" }} />
              )}
              <span className="text-[10px] font-bold uppercase tracking-widest font-mono"
                    style={{ color: respondingAgent?.color ?? "#00e5ff" }}>
                {ai.streaming ? (respondingAgent?.name ?? "AI") : (respondingAgent?.name ?? "AI")}
              </span>
              {ai.model && (
                <span className="text-[9px] font-mono text-muted-foreground/50 px-1.5 py-0.5 rounded border border-card-border">
                  {ai.model}
                </span>
              )}
            </div>

            <div className="flex-1 text-xs text-muted-foreground leading-relaxed font-mono min-w-0 max-h-20 overflow-y-auto scrollbar-thin">
              {ai.tokens}
              {ai.streaming && <span className="inline-block w-1.5 h-3.5 bg-current ml-0.5 animate-pulse align-text-bottom" style={{ color: respondingAgent?.color ?? "#00e5ff" }} />}
            </div>

            <button
              onClick={ai.streaming ? ai.cancel : ai.clear}
              className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors mt-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Error banner ──────────────────────────────────────────────── */}
      {ai.error && (
        <div className="max-w-4xl mx-auto mb-2">
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-2 text-xs font-mono text-red-400 flex items-center justify-between">
            <span>✗ AI error: {ai.error.slice(0, 120)}</span>
            <button onClick={ai.clear}><X className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto flex items-end gap-3">
        {/* Swarm Control */}
        <button
          onClick={toggleSwarm}
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

        {/* Input Box */}
        <div className="flex-1 bg-card/50 backdrop-blur-sm border border-card-border rounded-xl focus-within:border-primary/50 focus-within:shadow-[0_0_10px_rgba(0,255,255,0.1)] transition-all overflow-hidden flex flex-col">

          {/* Tab / mode bar */}
          <div className="flex items-center px-3 py-1.5 border-b border-card-border/50 bg-background/50 gap-1 flex-wrap">
            <button
              onClick={() => setTab("chat")}
              className={cn(
                "text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-md flex items-center gap-1.5 transition-colors",
                tab === "chat" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              data-testid="tab-chat"
            >
              <Globe className="w-3 h-3" /> CHAT
            </button>
            <button
              onClick={() => setTab("command")}
              className={cn(
                "text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-md flex items-center gap-1.5 transition-colors",
                tab === "command"
                  ? "bg-[#bf00ff]/20 text-[#bf00ff] border border-[#bf00ff]/30"
                  : "text-muted-foreground hover:text-foreground"
              )}
              data-testid="tab-command"
            >
              <Zap className="w-3 h-3" /> ABBY COMMAND
            </button>

            {tab === "chat" && (
              <>
                <div className="w-px h-3 bg-card-border mx-1" />
                <button
                  className={cn(
                    "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md transition-all",
                    routingMode === "global" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground opacity-60"
                  )}
                  onClick={() => { setRoutingMode("global"); setTargetAgentId(null); }}
                  data-testid="mode-global"
                >ALL</button>
                {agents.map(agent => (
                  <button
                    key={agent.id}
                    className={cn(
                      "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md flex items-center gap-1 transition-all",
                      routingMode === "targeted" && targetAgentId === agent.id ? "text-black shadow-[0_0_8px_currentColor]" : "bg-transparent opacity-50 hover:opacity-100"
                    )}
                    style={{
                      backgroundColor: routingMode === "targeted" && targetAgentId === agent.id ? agent.color : "transparent",
                      color: routingMode === "targeted" && targetAgentId === agent.id ? "#000" : agent.color,
                    }}
                    onClick={() => { setRoutingMode("targeted"); setTargetAgentId(agent.id); }}
                    data-testid={`mode-targeted-${agent.id}`}
                  >
                    <AtSign className="w-2.5 h-2.5" /> {agent.name}
                  </button>
                ))}

                {/* AI toggle */}
                <div className="ml-auto flex items-center gap-1.5">
                  <button
                    onClick={() => setAiEnabled(v => !v)}
                    className={cn(
                      "flex items-center gap-1.5 text-[9px] font-mono uppercase px-2 py-0.5 rounded-md border transition-all",
                      aiEnabled
                        ? "bg-[#00e5ff]/10 border-[#00e5ff]/30 text-[#00e5ff]"
                        : "border-card-border text-muted-foreground/50 hover:text-muted-foreground"
                    )}
                    title="Toggle AI auto-response"
                  >
                    <BrainCircuit className="w-3 h-3" />
                    {aiEnabled ? "AI ON" : "AI OFF"}
                  </button>
                  {routingMode === "targeted" && targetAgent && (
                    <span className="text-[9px] font-mono text-muted-foreground/50 px-1.5 py-0.5 rounded border border-card-border">
                      {targetAgent.model}
                    </span>
                  )}
                  {routingMode === "global" && (
                    <span className="text-[9px] font-mono text-muted-foreground/50 px-1.5 py-0.5 rounded border border-card-border">
                      x-ai/grok-4.3
                    </span>
                  )}
                </div>
              </>
            )}

            {tab === "command" && (
              <>
                <div className="w-px h-3 bg-card-border mx-1" />
                <select
                  value={String(cmdTarget)}
                  onChange={e => setCmdTarget(e.target.value === "all" ? "all" : Number(e.target.value))}
                  className="text-[10px] font-mono font-bold uppercase bg-background border border-card-border rounded-md px-2 py-0.5 text-foreground focus:outline-none focus:border-[#bf00ff]/50 cursor-pointer"
                >
                  <option value="all">→ ALL AGENTS</option>
                  {agents.map(a => <option key={a.id} value={a.id}>→ {a.name}</option>)}
                </select>
                {PRIORITIES.map(p => (
                  <button
                    key={p}
                    onClick={() => setCmdPriority(p)}
                    className={cn(
                      "text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border transition-all",
                      cmdPriority === p
                        ? p === "urgent" ? "bg-red-500/20 border-red-500/50 text-red-400"
                          : p === "high" ? "bg-orange-500/20 border-orange-500/50 text-orange-400"
                          : p === "low" ? "bg-zinc-700/40 border-zinc-600 text-zinc-400"
                          : "bg-[#bf00ff]/20 border-[#bf00ff]/50 text-[#bf00ff]"
                        : "border-card-border text-muted-foreground hover:text-foreground"
                    )}
                  >{p}</button>
                ))}
              </>
            )}
          </div>

          {/* ── CHAT ─────────────────────────────────────────────────────── */}
          {tab === "chat" && (
            <div className="flex items-end p-2 gap-2">
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                onKeyDown={handleChatKey}
                placeholder={
                  routingMode === "global"
                    ? aiEnabled ? "Message ABBY & the swarm (AI will respond)..." : "Broadcast to swarm..."
                    : aiEnabled
                      ? `Message @${targetAgent?.name ?? "agent"} — ${targetAgent?.model ?? "AI"} will respond...`
                      : "Message to selected agent..."
                }
                className="flex-1 bg-transparent border-none focus:ring-0 resize-none h-10 py-2 px-2 text-sm placeholder:text-muted-foreground/50 scrollbar-thin"
                data-testid="input-command"
              />
              <button
                onClick={handleChatSend}
                disabled={!content.trim() || !activeChannelId || sendMessage.isPending || ai.streaming}
                className={cn(
                  "h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-all",
                  content.trim() && activeChannelId && !ai.streaming
                    ? "bg-primary text-primary-foreground shadow-[0_0_10px_rgba(0,255,255,0.4)]"
                    : "bg-card border border-card-border text-muted-foreground opacity-50"
                )}
                data-testid="btn-send-command"
              >
                {ai.streaming ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4 ml-0.5" />}
              </button>
            </div>
          )}

          {/* ── ABBY COMMAND ─────────────────────────────────────────────── */}
          {tab === "command" && (
            <div className="flex flex-col gap-1.5 p-2">
              <div className="relative">
                <button
                  onClick={() => setShowPresets(v => !v)}
                  className="text-[9px] font-mono text-muted-foreground/50 flex items-center gap-1 hover:text-muted-foreground transition-colors px-2 pt-1"
                >
                  ABBYCLAW PRESETS <ChevronDown className="w-3 h-3" />
                </button>
                {showPresets && (
                  <div className="absolute bottom-full left-0 mb-1 bg-card border border-[#bf00ff]/20 rounded-lg p-1.5 flex flex-col gap-0.5 z-50 min-w-[340px] shadow-xl">
                    {COMMAND_PRESETS.map(p => (
                      <button
                        key={p}
                        onClick={() => { setCmdText(p); setShowPresets(false); }}
                        className="text-[10px] font-mono text-left px-2 py-1 rounded hover:bg-[#bf00ff]/10 hover:text-[#bf00ff] text-muted-foreground transition-colors"
                      >{p}</button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1 flex flex-col gap-1">
                  <input
                    value={cmdText}
                    onChange={e => setCmdText(e.target.value)}
                    onKeyDown={handleCmdKey}
                    placeholder="exec: …  |  web_search: …  |  browser: …  |  steel_scrape: …"
                    className="bg-transparent border-none focus:ring-0 h-9 py-2 px-2 text-sm font-mono placeholder:text-muted-foreground/40 text-[#bf00ff]/90 w-full"
                    data-testid="input-abby-command"
                  />
                  <input
                    value={cmdPayload}
                    onChange={e => setCmdPayload(e.target.value)}
                    placeholder="payload (optional JSON or args)"
                    className="bg-transparent border-none focus:ring-0 h-6 py-1 px-2 text-xs font-mono placeholder:text-muted-foreground/25 text-muted-foreground w-full"
                  />
                </div>
                <button
                  onClick={handleAbbyCommand}
                  disabled={!cmdText.trim() || cmdStatus === "sending"}
                  className={cn(
                    "h-10 w-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-all border",
                    cmdStatus === "sent"    ? "bg-green-500/20 border-green-500/30 text-green-400"
                    : cmdStatus === "error"  ? "bg-red-500/20 border-red-500/30 text-red-400"
                    : cmdStatus === "sending"? "bg-[#bf00ff]/10 border-[#bf00ff]/30 text-[#bf00ff] animate-pulse"
                    : cmdText.trim()         ? "bg-[#bf00ff]/20 border-[#bf00ff]/40 text-[#bf00ff] shadow-[0_0_10px_rgba(191,0,255,0.3)] hover:bg-[#bf00ff]/30"
                    :                         "bg-card border-card-border text-muted-foreground opacity-40"
                  )}
                  data-testid="btn-send-abby-command"
                >
                  <Zap className="w-4 h-4" />
                </button>
              </div>
              {cmdStatus === "sent" && (
                <div className="text-[10px] text-green-400 font-mono px-2">
                  ✓ Dispatched → {cmdTarget === "all" ? "all agents" : agents.find(a => a.id === cmdTarget)?.name}
                </div>
              )}
              {cmdStatus === "error" && (
                <div className="text-[10px] text-red-400 font-mono px-2">
                  ✗ Dispatch failed — check API server
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
