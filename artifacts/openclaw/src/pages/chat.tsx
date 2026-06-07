import { useEffect, useRef, useState } from "react";
import {
  useListChannels,
  useCreateChannel,
  useListMessages,
  useSendMessage,
  getListChannelsQueryKey,
  getListMessagesQueryKey,
  resolveApiUrl,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAiStream } from "@/hooks/useAiStream";
import { MessageContent } from "@/components/chat/MessageContent";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Plus, Send, Paperclip, X, Menu, Download, Trash2, Pencil, Check,
  MessageSquare, Bot, AlertTriangle, Loader2, Sparkles,
} from "lucide-react";

// NOTE: there is no file-storage backend. The attach button is a real UI (select,
// preview, remove) but on send we only note the filename inline so it shows in
// history. Wire a real upload endpoint here when one exists.
interface Attachment { name: string; size: number; }

export default function ChatPage() {
  const qc = useQueryClient();
  const { data: channels = [], isLoading: channelsLoading } = useListChannels({
    query: { refetchInterval: 8000, queryKey: getListChannelsQueryKey() },
  });

  const [activeId, setActiveId] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    if (activeId == null && channels.length) setActiveId(channels[0].id);
  }, [channels, activeId]);

  const activeChannel = channels.find((c) => c.id === activeId) ?? null;

  const { data: messages = [], isLoading: msgsLoading, isError: msgsError, refetch: refetchMsgs } =
    useListMessages(activeId ?? 0, {
      query: { enabled: activeId != null, refetchInterval: 4000, queryKey: getListMessagesQueryKey(activeId ?? 0) },
    });

  const ai = useAiStream(() => {
    if (activeId) setTimeout(() => qc.invalidateQueries({ queryKey: getListMessagesQueryKey(activeId) }), 400);
  });

  const sendMessage = useSendMessage();
  const createChannel = useCreateChannel({
    mutation: {
      onSuccess: (ch) => {
        qc.invalidateQueries({ queryKey: getListChannelsQueryKey() });
        setActiveId(ch.id);
        setSidebarOpen(false);
      },
      onError: () => toast.error("Couldn't start a new chat."),
    },
  });

  // ── Composer ──────────────────────────────────────────────────────────────
  const [text, setText] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };
  useEffect(autoGrow, [text]);

  // Auto-scroll to newest content (and while streaming).
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, ai.tokens, ai.streaming]);

  const send = () => {
    const body = text.trim();
    if ((!body && !attachment) || activeId == null || ai.streaming) return;
    const composed = attachment
      ? `${body}${body ? "\n\n" : ""}📎 Attached: ${attachment.name} _(file upload backend not yet wired)_`
      : body;
    setText("");
    setAttachment(null);
    requestAnimationFrame(autoGrow);
    sendMessage.mutate(
      { data: { content: composed, messageType: "user" }, channelId: activeId },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListMessagesQueryKey(activeId) });
          ai.send({ message: composed, agentId: null, channelId: activeId });
        },
        onError: () => toast.error("Couldn't send your message. Try again."),
      },
    );
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setAttachment({ name: f.name, size: f.size });
    e.target.value = "";
  };

  // ── Conversation actions ────────────────────────────────────────────────
  const newChat = () =>
    createChannel.mutate({ data: { name: `New chat`, type: "general" } });

  const renameChannel = async (id: number, name: string) => {
    if (!name.trim()) return;
    try {
      const r = await fetch(resolveApiUrl(`/api/channels/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!r.ok) throw new Error();
      qc.invalidateQueries({ queryKey: getListChannelsQueryKey() });
    } catch {
      toast.error("Rename failed.");
    } finally {
      setEditingId(null);
    }
  };

  const deleteChannel = async (id: number) => {
    try {
      const r = await fetch(resolveApiUrl(`/api/channels/${id}`), { method: "DELETE" });
      if (!r.ok) throw new Error();
      const remaining = channels.filter((c) => c.id !== id);
      if (activeId === id) setActiveId(remaining[0]?.id ?? null);
      qc.invalidateQueries({ queryKey: getListChannelsQueryKey() });
      toast.success("Conversation deleted.");
    } catch {
      toast.error("Delete failed.");
    }
  };

  const exportConvo = (fmt: "txt" | "json") => {
    setExportOpen(false);
    if (!messages.length) { toast("Nothing to export yet."); return; }
    const rows = messages.map((m) => ({
      role: m.messageType === "user" ? "user" : (m.agentName || "assistant"),
      content: m.content,
      at: m.timestamp,
    }));
    const blob =
      fmt === "json"
        ? new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" })
        : new Blob([rows.map((r) => `### ${r.role} · ${new Date(r.at).toLocaleString()}\n${r.content}\n`).join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(activeChannel?.name || "conversation").replace(/\s+/g, "-").toLowerCase()}.${fmt}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visibleMessages = messages.filter((m) => (m.content ?? "").trim().length > 0);

  return (
    <div className="flex w-full h-full bg-background text-foreground overflow-hidden">
      {/* ── Conversation sidebar (drawer on mobile) ── */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 bg-black/50 z-30" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}
      <aside
        className={cn(
          "w-72 shrink-0 bg-card/60 border-r border-card-border flex flex-col z-40",
          "md:static md:translate-x-0 transition-transform duration-200",
          "fixed inset-y-0 left-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
        aria-label="Conversations"
      >
        <div className="p-3">
          <button
            onClick={newChat}
            disabled={createChannel.isPending}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-primary/15 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/25 transition-colors"
          >
            <Plus className="w-4 h-4" /> New chat
          </button>
        </div>
        <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">Conversations</div>
        <nav className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
          {channelsLoading ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">Loading…</div>
          ) : channels.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No conversations yet.</div>
          ) : (
            channels.map((c) => {
              const active = c.id === activeId;
              return (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors",
                    active ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-card-border/50 hover:text-foreground",
                  )}
                  onClick={() => { setActiveId(c.id); setSidebarOpen(false); }}
                >
                  <MessageSquare className={cn("w-4 h-4 shrink-0", active ? "text-primary" : "")} />
                  {editingId === c.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => { if (e.key === "Enter") renameChannel(c.id, editName); if (e.key === "Escape") setEditingId(null); }}
                      onBlur={() => renameChannel(c.id, editName)}
                      className="flex-1 min-w-0 bg-background border border-card-border rounded px-1.5 py-0.5 text-sm focus:outline-none focus:border-primary/50"
                      aria-label="Conversation name"
                    />
                  ) : (
                    <span className="flex-1 min-w-0 truncate text-sm">{c.name}</span>
                  )}
                  <div className={cn("flex items-center gap-0.5 shrink-0", active ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
                    {editingId === c.id ? (
                      <button onClick={(e) => { e.stopPropagation(); renameChannel(c.id, editName); }} aria-label="Save name" className="p-1 hover:text-primary">
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setEditName(c.name); }} aria-label="Rename conversation" className="p-1 hover:text-foreground">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); deleteChannel(c.id); }} aria-label="Delete conversation" className="p-1 hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </nav>
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-14 shrink-0 border-b border-card-border flex items-center gap-3 px-4">
          <button onClick={() => setSidebarOpen(true)} aria-label="Open conversations" className="md:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Bot className="w-5 h-5 text-primary shrink-0" />
            <h1 className="text-sm font-semibold truncate">{activeChannel?.name ?? "OpenClaw"}</h1>
          </div>
          <div className="relative">
            <button
              onClick={() => setExportOpen((v) => !v)}
              aria-label="Export conversation"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-card-border/50 transition-colors"
            >
              <Download className="w-4 h-4" /> <span className="hidden sm:inline">Export</span>
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 mt-1 w-40 rounded-lg border border-card-border bg-popover shadow-xl z-20 overflow-hidden">
                  <button onClick={() => exportConvo("txt")} className="w-full text-left px-3 py-2 text-sm hover:bg-card-border/50">Download .txt</button>
                  <button onClick={() => exportConvo("json")} className="w-full text-left px-3 py-2 text-sm hover:bg-card-border/50">Download .json</button>
                </div>
              </>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
            {activeId == null && !channelsLoading ? (
              <EmptyState onNew={newChat} />
            ) : msgsLoading ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading conversation…
              </div>
            ) : msgsError ? (
              <div className="flex flex-col items-center py-20 gap-3 text-center">
                <AlertTriangle className="w-7 h-7 text-destructive" />
                <span className="text-sm text-muted-foreground">Couldn't load this conversation.</span>
                <button onClick={() => refetchMsgs()} className="px-4 py-1.5 rounded-lg border border-card-border text-sm hover:border-primary/40">Retry</button>
              </div>
            ) : visibleMessages.length === 0 && !ai.streaming ? (
              <EmptyConversation onPrompt={(p) => { setText(p); taRef.current?.focus(); }} />
            ) : (
              visibleMessages.map((m) => <MessageRow key={m.id} message={m} />)
            )}

            {/* Live streaming reply */}
            {ai.streaming && (
              <div className="flex gap-3">
                <Avatar name={ai.agentName ?? "ABBY"} color="#22d3ee" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground mb-1">{ai.agentName ?? "ABBY"}</div>
                  {ai.tokens ? (
                    <MessageContent content={ai.tokens} />
                  ) : (
                    <TypingDots />
                  )}
                </div>
              </div>
            )}
            {ai.error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                {ai.error.includes("402") || /credit/i.test(ai.error)
                  ? "The model provider is out of credits. Add credits or configure a fallback model."
                  : `Something went wrong: ${ai.error.slice(0, 160)}`}
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-card-border bg-background">
          <div className="max-w-3xl mx-auto px-4 py-3">
            {attachment && (
              <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-card-border bg-card px-2.5 py-1.5 text-sm">
                <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="truncate max-w-[200px]">{attachment.name}</span>
                <button onClick={() => setAttachment(null)} aria-label="Remove attachment" className="text-muted-foreground hover:text-destructive">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-card-border bg-card px-3 py-2 focus-within:border-primary/50 transition-colors">
              <input ref={fileRef} type="file" className="hidden" onChange={onPickFile} aria-hidden="true" />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={activeId == null}
                aria-label="Attach a file"
                className="p-2 text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
              >
                <Paperclip className="w-5 h-5" />
              </button>
              <textarea
                ref={taRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                disabled={activeId == null}
                aria-label="Message"
                placeholder={ai.streaming ? "Waiting for the response…" : "Message the swarm…  (Enter to send, Shift+Enter for a new line)"}
                className="flex-1 min-w-0 resize-none bg-transparent py-2 text-[15px] leading-relaxed focus:outline-none placeholder:text-muted-foreground/60 max-h-[200px]"
              />
              <button
                onClick={send}
                disabled={(!text.trim() && !attachment) || activeId == null || ai.streaming}
                aria-label="Send message"
                className="p-2.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity shrink-0"
              >
                {ai.streaming ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground/60 text-center mt-2">
              OpenClaw routes your message to ABBY, who orchestrates the agent swarm.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function Avatar({ name, color }: { name: string; color: string }) {
  const initials = name.split(/[\s.]+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  return (
    <div
      className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center text-xs font-bold"
      style={{ backgroundColor: `${color}22`, color, border: `1px solid ${color}44` }}
    >
      {initials || "AI"}
    </div>
  );
}

function MessageRow({ message: m }: { message: { messageType: string; content: string; agentName?: string | null; agentColor?: string | null } }) {
  if (m.messageType === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/15 border border-primary/20 px-4 py-2.5">
          <MessageContent content={m.content} />
        </div>
      </div>
    );
  }
  if (m.messageType === "system") {
    return (
      <div className="flex justify-center">
        <div className="text-xs text-muted-foreground bg-card/60 border border-card-border rounded-full px-3 py-1">{m.content}</div>
      </div>
    );
  }
  const color = m.agentColor || "#22d3ee";
  const isTool = m.messageType === "tool_output";
  return (
    <div className="flex gap-3">
      <Avatar name={m.agentName || "Assistant"} color={color} />
      <div className="min-w-0 flex-1">
        <div className="text-xs text-muted-foreground mb-1">{m.agentName || "Assistant"}</div>
        {isTool ? (
          <div className="rounded-lg border border-card-border bg-card/50 px-3 py-2 font-mono text-[13px] text-muted-foreground whitespace-pre-wrap break-words overflow-x-auto">
            {m.content}
          </div>
        ) : (
          <MessageContent content={m.content} />
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 py-2" aria-label="Assistant is typing">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Sparkles className="w-7 h-7 text-primary" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">Welcome to OpenClaw</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">Start a conversation and the AI agent swarm will research, browse, run code, and report back.</p>
      </div>
      <button onClick={onNew} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/15 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/25 transition-colors">
        <Plus className="w-4 h-4" /> New chat
      </button>
    </div>
  );
}

function EmptyConversation({ onPrompt }: { onPrompt: (p: string) => void }) {
  const prompts = [
    "Research the top 3 open-source AI agent frameworks and compare them",
    "Scrape news.ycombinator.com and list the top 5 stories",
    "Write and run a Python script that prints the first 20 primes",
  ];
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-5">
      <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
        <Bot className="w-6 h-6 text-primary" />
      </div>
      <div>
        <h2 className="text-base font-semibold">How can the swarm help?</h2>
        <p className="text-sm text-muted-foreground mt-1">Ask anything, or try one of these:</p>
      </div>
      <div className="w-full max-w-md space-y-2">
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onPrompt(p)}
            className="w-full text-left text-sm rounded-xl border border-card-border bg-card/50 px-4 py-3 hover:border-primary/40 hover:bg-card transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
