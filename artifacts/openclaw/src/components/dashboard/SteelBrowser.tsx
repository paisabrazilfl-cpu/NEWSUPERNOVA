import { useState, useRef, useEffect } from "react";
import { Globe, Plus, Trash2, RefreshCw, Camera, FileText, X, ExternalLink, Wifi, WifiOff, Copy, ChevronRight, Loader } from "lucide-react";
import { resolveApiUrl } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

interface SteelSession {
  id: string;
  status: string;
  createdAt: string;
  duration: number;
  eventCount: number;
  timeout: number;
  creditsUsed: number;
  debugUrl: string;
  sessionViewerUrl: string;
  websocketUrl: string;
}

interface ScrapeResult {
  url: string;
  title?: string;
  content?: string;
  html?: string;
  links?: string[];
  error?: string;
}

/** Coerce any value to a displayable string (Steel may return objects). */
function asText(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return (
      asText(o["markdown"]) ??
      asText(o["text"]) ??
      asText(o["content"]) ??
      asText(o["html"]) ??
      JSON.stringify(v)
    );
  }
  return String(v);
}

/**
 * Steel's /scrape response shape varies: `content` may be a plain string OR an
 * object like { html, markdown, text }. Flatten it to strings so React never
 * tries to render a raw object (which throws "objects are not valid as a child").
 */
function normalizeScrape(data: unknown, fallbackUrl: string): ScrapeResult {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d["error"] === "string") {
    return { url: (d["url"] as string) ?? fallbackUrl, error: d["error"] as string };
  }
  const links = Array.isArray(d["links"])
    ? (d["links"] as unknown[]).map(asText).filter((s): s is string => !!s)
    : undefined;
  return {
    url: (d["url"] as string) ?? fallbackUrl,
    title: asText(d["title"]),
    content: asText(d["content"]) ?? asText(d["markdown"]) ?? asText(d["html"]),
    html: asText(d["html"]),
    ...(links && links.length ? { links } : {}),
  };
}

export function SteelBrowser() {
  const [sessions, setSessions] = useState<SteelSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [navUrl, setNavUrl] = useState("");
  const [scrapeResult, setScrapeResult] = useState<ScrapeResult | null>(null);
  const [scraping, setScraping] = useState(false);
  const [screenshotting, setScreenshotting] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<"live" | "scrape" | "screenshot">("live");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  /** Measure the panel so the remote browser viewport matches its container. */
  function measureViewport() {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { width: 1280, height: 800 };
    // Subtract the tab bar (~33px) + live status bar (~33px) above the iframe.
    return { width: Math.round(rect.width), height: Math.max(1, Math.round(rect.height - 66)) };
  }

  const activeSession = sessions.find(s => s.id === activeSessionId);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    try {
      const r = await fetch(resolveApiUrl("/api/steel/sessions"));
      const data = await r.json();
      setSessions(data.sessions ?? []);
    } catch {
      // silently fail
    }
  }

  async function createSession() {
    setLoading(true);
    try {
      const r = await fetch(resolveApiUrl("/api/steel/sessions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionTimeout: 600000, dimensions: measureViewport() }),
      });
      const session: SteelSession = await r.json();
      setSessions(prev => [session, ...prev]);
      setActiveSessionId(session.id);
    } finally {
      setLoading(false);
    }
  }

  async function releaseSession(id: string) {
    try {
      await fetch(resolveApiUrl(`/api/steel/sessions/${id}`), { method: "DELETE" });
      setSessions(prev => prev.filter(s => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(sessions.find(s => s.id !== id)?.id ?? null);
      }
    } catch {
      // silently fail
    }
  }

  async function handleScrape() {
    if (!navUrl.trim()) return;
    setScraping(true);
    setScrapeResult(null);
    try {
      const r = await fetch(resolveApiUrl("/api/steel/scrape"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: navUrl,
          sessionId: activeSessionId ?? undefined,
        }),
      });
      const data = await r.json();
      setScrapeResult(normalizeScrape(data, navUrl));
      setTab("scrape");
    } catch (err) {
      setScrapeResult({ url: navUrl, error: String(err) });
    } finally {
      setScraping(false);
    }
  }

  async function handleScreenshot() {
    if (!navUrl.trim()) return;
    setScreenshotting(true);
    setScreenshotUrl(null);
    try {
      const r = await fetch(resolveApiUrl("/api/steel/screenshot"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: navUrl,
          fullPage: true,
          sessionId: activeSessionId ?? undefined,
        }),
      });
      if (r.headers.get("content-type")?.includes("image")) {
        const blob = await r.blob();
        setScreenshotUrl(URL.createObjectURL(blob));
        setTab("screenshot");
      } else {
        const data = await r.json();
        if (data.screenshot) {
          setScreenshotUrl(`data:image/png;base64,${data.screenshot}`);
          setTab("screenshot");
        } else if (data.url) {
          setScreenshotUrl(data.url);
          setTab("screenshot");
        }
      }
    } finally {
      setScreenshotting(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-background">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-card-border bg-card/50 shrink-0">
        <div className="flex items-center gap-2 text-[#0066ff]">
          <Globe className="w-4 h-4" />
          <span className="text-sm font-bold uppercase tracking-widest">STEEL BROWSER</span>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-[#0066ff]/30 bg-[#0066ff]/10 text-[#0066ff]/80">CRAWLER</span>
        </div>
        <div className="flex-1" />
        {/* Session pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {sessions.map(s => (
            <div
              key={s.id}
              onClick={() => setActiveSessionId(s.id)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-mono cursor-pointer transition-all group",
                s.id === activeSessionId
                  ? "bg-[#0066ff]/20 border-[#0066ff]/40 text-[#0066ff]"
                  : "bg-card border-card-border text-muted-foreground hover:border-[#0066ff]/30"
              )}
            >
              <div className={cn("w-1.5 h-1.5 rounded-full", s.status === "live" ? "bg-green-400 animate-pulse" : "bg-zinc-500")} />
              <span>{s.id.slice(0, 8)}…</span>
              <button
                onClick={e => { e.stopPropagation(); releaseSession(s.id); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 ml-1"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={createSession}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0066ff]/10 border border-[#0066ff]/30 text-[#0066ff] text-[10px] font-bold hover:bg-[#0066ff]/20 transition-all disabled:opacity-50"
        >
          {loading ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          LAUNCH
        </button>
        <button onClick={loadSessions} className="w-7 h-7 rounded-lg border border-card-border text-muted-foreground hover:text-foreground transition-all flex items-center justify-center">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* URL Bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-card-border bg-background/80 shrink-0">
        <div className="flex-1 flex items-center gap-2 bg-card border border-card-border rounded-lg px-3 focus-within:border-[#0066ff]/40 transition-all">
          {activeSession ? (
            <Wifi className="w-3.5 h-3.5 text-green-400 shrink-0" />
          ) : (
            <WifiOff className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
          )}
          <input
            value={navUrl}
            onChange={e => setNavUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleScrape()}
            placeholder="https://example.com — press Enter to scrape"
            className="flex-1 bg-transparent h-9 text-sm font-mono focus:outline-none placeholder:text-muted-foreground/40"
          />
          {navUrl && (
            <button onClick={() => setNavUrl("")} className="text-muted-foreground/50 hover:text-muted-foreground">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={handleScrape}
          disabled={!navUrl.trim() || scraping}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0066ff]/10 border border-[#0066ff]/30 text-[#0066ff] text-[10px] font-bold hover:bg-[#0066ff]/20 transition-all disabled:opacity-40"
        >
          {scraping ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
          SCRAPE
        </button>
        <button
          onClick={handleScreenshot}
          disabled={!navUrl.trim() || screenshotting}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-card border border-card-border text-muted-foreground text-[10px] font-bold hover:text-foreground hover:border-card-border/80 transition-all disabled:opacity-40"
        >
          {screenshotting ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
          SHOT
        </button>
      </div>

      {/* Content tabs + body */}
      <div ref={contentRef} className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="flex items-center gap-1 px-4 pt-2 border-b border-card-border shrink-0">
          {[
            { id: "live" as const, label: "LIVE VIEW", icon: Globe },
            { id: "scrape" as const, label: "SCRAPED", icon: FileText },
            { id: "screenshot" as const, label: "SCREENSHOT", icon: Camera },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 border-b-2 -mb-px transition-all",
                tab === id
                  ? "border-[#0066ff] text-[#0066ff]"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-3 h-3" /> {label}
            </button>
          ))}
        </div>

        {/* ── LIVE VIEW ──────────────────────────────────────────────────── */}
        {tab === "live" && (
          <div className="flex-1 overflow-hidden">
            {activeSession ? (
              <div className="h-full flex flex-col">
                <div className="flex items-center gap-2 px-4 py-2 bg-zinc-950/60 border-b border-card-border text-[10px] font-mono text-muted-foreground shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span>SESSION {activeSession.id.slice(0, 12)}…</span>
                  <span className="text-zinc-600">|</span>
                  <span>credits: {activeSession.creditsUsed}</span>
                  <span className="text-zinc-600">|</span>
                  <span>timeout: {Math.round(activeSession.timeout / 60000)}m</span>
                  <div className="flex-1" />
                  <a
                    href={activeSession.sessionViewerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[#0066ff]/70 hover:text-[#0066ff] transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" /> STEEL VIEWER
                  </a>
                  <button
                    onClick={() => copyToClipboard(activeSession.websocketUrl)}
                    className="flex items-center gap-1 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    title="Copy WebSocket URL"
                  >
                    <Copy className="w-3 h-3" /> WS URL
                  </button>
                </div>
                <div className="flex-1 bg-zinc-950">
                  <iframe
                    ref={iframeRef}
                    src={activeSession.debugUrl}
                    className="w-full h-full border-0"
                    title="Steel browser live view"
                    sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                  />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center h-full">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-[#0066ff]/10 border border-[#0066ff]/20 flex items-center justify-center">
                    <Globe className="w-8 h-8 text-[#0066ff]/50" />
                  </div>
                  <div>
                    <div className="font-bold text-lg text-muted-foreground">No active sessions</div>
                    <div className="text-sm text-muted-foreground/50 mt-1 font-mono">Launch a browser session to start browsing</div>
                  </div>
                  <button
                    onClick={createSession}
                    disabled={loading}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0066ff]/20 border border-[#0066ff]/40 text-[#0066ff] font-bold hover:bg-[#0066ff]/30 transition-all shadow-[0_0_15px_rgba(0,102,255,0.2)] disabled:opacity-50"
                  >
                    {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    LAUNCH STEEL BROWSER
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── SCRAPE OUTPUT ─────────────────────────────────────────────── */}
        {tab === "scrape" && (
          <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-3">
            {!scrapeResult ? (
              <div className="text-muted-foreground/40 text-center py-12 text-xs">Enter a URL and press SCRAPE to extract content</div>
            ) : scrapeResult.error ? (
              <div className="text-red-400 text-xs p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                ✗ {scrapeResult.error}
              </div>
            ) : (
              <>
                {scrapeResult.title && (
                  <div className="flex items-start gap-2">
                    <span className="text-[#0066ff]/60 text-[10px] uppercase shrink-0 pt-0.5">TITLE</span>
                    <span className="text-foreground font-sans font-semibold">{scrapeResult.title}</span>
                  </div>
                )}
                {scrapeResult.url && (
                  <div className="flex items-center gap-2">
                    <span className="text-[#0066ff]/60 text-[10px] uppercase shrink-0">URL</span>
                    <a href={scrapeResult.url} target="_blank" rel="noopener noreferrer"
                       className="text-[#0066ff]/70 hover:text-[#0066ff] text-xs truncate transition-colors">
                      {scrapeResult.url}
                    </a>
                  </div>
                )}
                {scrapeResult.content && (
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase text-muted-foreground/50 flex items-center gap-2">
                      <span>CONTENT</span>
                      <button onClick={() => copyToClipboard(scrapeResult.content ?? "")}
                              className="text-muted-foreground/30 hover:text-muted-foreground transition-colors">
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap bg-zinc-950/60 rounded-lg p-3 border border-card-border max-h-96 overflow-y-auto scrollbar-thin">
                      {scrapeResult.content}
                    </div>
                  </div>
                )}
                {scrapeResult.links && scrapeResult.links.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[10px] uppercase text-muted-foreground/50">LINKS ({scrapeResult.links.length})</div>
                    <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto scrollbar-thin">
                      {scrapeResult.links.slice(0, 30).map((l, i) => (
                        <a key={i} href={l} target="_blank" rel="noopener noreferrer"
                           className="text-[10px] text-[#0066ff]/60 hover:text-[#0066ff] truncate transition-colors">
                          {l}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── SCREENSHOT ────────────────────────────────────────────────── */}
        {tab === "screenshot" && (
          <div className="flex-1 overflow-y-auto p-4">
            {!screenshotUrl ? (
              <div className="text-muted-foreground/40 text-center py-12 text-xs font-mono">Enter a URL and press SHOT to capture a screenshot</div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-muted-foreground/50">{navUrl}</span>
                  <a href={screenshotUrl} download="screenshot.png"
                     className="text-[10px] text-[#0066ff]/70 hover:text-[#0066ff] font-mono transition-colors flex items-center gap-1">
                    <FileText className="w-3 h-3" /> SAVE
                  </a>
                </div>
                <img src={screenshotUrl} alt="screenshot" className="w-full rounded-lg border border-card-border" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
