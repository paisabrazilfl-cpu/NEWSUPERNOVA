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

// Slate workspace: channel rail · canvas over tabbed logs/browser/dispatch ·
// telemetry drawer. Robust flex sizing (NOT a rigid %-grid) so it never crushes
// the canvas or overflows on phones; tabs absorb the variable space.
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
      <LeftPanel
        activeChannelId={activeChannelId}
        setActiveChannelId={setActiveChannelId}
        viewMode={viewMode}
        setViewMode={setViewMode}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
      />

      <main className="flex-1 flex flex-col min-w-0 min-h-0 relative z-10 overflow-hidden">
        {/* System header */}
        <header className="flex h-12 sm:h-14 shrink-0 items-center justify-between gap-3 px-3 sm:px-6 border-b border-card-border bg-background/70 backdrop-blur-md">
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

        {/* Workspace: canvas (fixed, never a sliver) + tabs (fill the rest) */}
        <div className="flex-1 flex flex-col min-h-0 gap-3 p-3 sm:p-4 overflow-hidden">
          {/* TOP — spatial swarm canvas */}
          <section className="relative shrink-0 h-[32vh] min-h-[180px] sm:h-[40vh] overflow-hidden rounded-xl border border-card-border bg-card/30">
            <div className="absolute inset-0 pointer-events-none opacity-30 [background-size:18px_18px] bg-[radial-gradient(hsl(var(--card-border))_1px,transparent_1px)]" />
            <div className="w-full h-full">
              <SwarmCanvas onAgentClick={setSelectedAgentId} />
            </div>
          </section>

          {/* BOTTOM — tabbed text / browser / dispatch panes (fills remaining height) */}
          <section className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-card-border bg-card/50">
            <Tabs defaultValue="logs" className="flex-1 flex flex-col min-h-0">
              <div className="flex shrink-0 items-center justify-between px-3 sm:px-4 border-b border-card-border bg-card/30">
                <TabsList className="h-11 gap-3 sm:gap-4 bg-transparent p-0">
                  <TabsTrigger value="logs" className={tabBase}>💬 Live Logs</TabsTrigger>
                  <TabsTrigger value="browser" className={tabBase}>🌐 Browser</TabsTrigger>
                  <TabsTrigger value="dispatch" className={tabBase}>⚡ Dispatch</TabsTrigger>
                </TabsList>
                <div className="hidden md:flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  <span>SANDBOX:</span>
                  <span className="text-foreground/70">oc-node-00</span>
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

        {/* Idle starter cues (auto-hide once agents work) → prefill dispatch */}
        <SwarmIdleHint onPick={setDispatchDraft} />
        {/* Direct dispatch into the real engine while you watch */}
        <SwarmDispatch channelId={activeChannelId} value={dispatchDraft} onChange={setDispatchDraft} />
      </main>

      {/* Telemetry inspector — slides in when a node is selected */}
      <AgentInspector agentId={selectedAgentId} onClose={() => setSelectedAgentId(null)} />
    </div>
  );
}
