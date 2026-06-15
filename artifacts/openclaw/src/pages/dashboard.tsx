import { useState } from "react";
import { Menu } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LeftPanel } from "@/components/dashboard/LeftPanel";
import { SwarmCanvas } from "@/components/dashboard/SwarmCanvas";
import { ChatStream } from "@/components/dashboard/ChatStream";
import { AgentInspector } from "@/components/dashboard/AgentInspector";
import { SwarmStatusStrip } from "@/components/dashboard/SwarmStatusStrip";
import { SwarmIdleHint } from "@/components/dashboard/SwarmIdleHint";
import { SwarmDispatch } from "@/components/dashboard/SwarmDispatch";
import { SteelBrowser } from "@/components/dashboard/SteelBrowser";
import { DispatchPanel } from "@/components/dashboard/DispatchPanel";

// Cyber-Minimal Slate 3-column workspace: channel rail · split workspace
// (40% spatial canvas / 60% tabbed text+browser) · telemetry inspector drawer.
// All surfaces are theme-token driven (slate dark) so child modules stay
// consistent; the real, data-wired components are preserved (no stubs).
export default function Dashboard() {
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"canvas" | "chat" | "browser" | "dispatch">("canvas");
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dispatchDraft, setDispatchDraft] = useState("");

  const tabBase =
    "h-11 rounded-none border-b-2 border-transparent bg-transparent px-1 text-xs font-medium text-muted-foreground transition-all data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground";

  return (
    <div className="flex w-full h-full relative overflow-hidden bg-background text-foreground">
      {/* Channel / agent rail (own responsive drawer on mobile) */}
      <LeftPanel
        activeChannelId={activeChannelId}
        setActiveChannelId={setActiveChannelId}
        viewMode={viewMode}
        setViewMode={setViewMode}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
      />

      {/* ── WORKSPACE ENGINE ── */}
      <main className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* System header */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 sm:px-6 border-b border-card-border bg-background/70 backdrop-blur-md">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setPanelOpen(true)}
              aria-label="Open channels & agents"
              className="md:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground"
            >
              <Menu className="w-5 h-5" />
            </button>
            <span className="text-sm font-semibold tracking-tight text-foreground truncate">Swarm Operating Shell</span>
          </div>
          <SwarmStatusStrip />
        </header>

        {/* Dynamic multi-window split: 40% canvas / 60% tabs */}
        <div className="flex-1 grid grid-rows-[40%_60%] gap-4 p-3 sm:p-4 overflow-hidden min-h-0">
          {/* TOP — spatial swarm canvas */}
          <section className="relative overflow-hidden rounded-xl border border-card-border bg-card/30 min-h-0">
            <div className="absolute top-3 left-4 z-10 flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Live Swarm Canvas</span>
            </div>
            <div className="absolute inset-0 pointer-events-none opacity-40 [background-size:16px_16px] bg-[radial-gradient(hsl(var(--card-border))_1px,transparent_1px)]" />
            <div className="w-full h-full">
              <SwarmCanvas onAgentClick={setSelectedAgentId} />
            </div>
          </section>

          {/* BOTTOM — tabbed text / browser / dispatch panes */}
          <section className="flex flex-col overflow-hidden rounded-xl border border-card-border bg-card/50 min-h-0">
            <Tabs defaultValue="logs" className="flex-1 flex flex-col min-h-0">
              <div className="flex shrink-0 items-center justify-between px-4 border-b border-card-border bg-card/30">
                <TabsList className="h-11 gap-4 bg-transparent p-0">
                  <TabsTrigger value="logs" className={tabBase}>💬 Live Logs</TabsTrigger>
                  <TabsTrigger value="browser" className={tabBase}>🌐 Steel Browser</TabsTrigger>
                  <TabsTrigger value="dispatch" className={tabBase}>⚡ Dispatch</TabsTrigger>
                </TabsList>
                <div className="hidden sm:flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  <span>SANDBOX:</span>
                  <span className="text-foreground/70">oc-node-00-runtime</span>
                </div>
              </div>
              <TabsContent value="logs" className="m-0 flex-1 min-h-0 overflow-hidden">
                <div className="h-full w-full overflow-hidden"><ChatStream channelId={activeChannelId} /></div>
              </TabsContent>
              <TabsContent value="browser" className="m-0 flex-1 min-h-0 overflow-hidden">
                <div className="h-full w-full flex flex-col overflow-hidden"><SteelBrowser /></div>
              </TabsContent>
              <TabsContent value="dispatch" className="m-0 flex-1 min-h-0 overflow-hidden">
                <div className="h-full w-full overflow-hidden"><DispatchPanel /></div>
              </TabsContent>
            </Tabs>
          </section>
        </div>

        {/* Idle onboarding cue (self-removes once agents work) → prefills dispatch */}
        <SwarmIdleHint onPick={setDispatchDraft} />
        {/* Direct dispatch into the real engine while you watch */}
        <SwarmDispatch channelId={activeChannelId} value={dispatchDraft} onChange={setDispatchDraft} />
      </main>

      {/* Telemetry inspector — slides in when a node is selected */}
      <AgentInspector agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} />
    </div>
  );
}
