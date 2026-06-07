import { useState } from "react";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { LeftPanel } from "@/components/dashboard/LeftPanel";
import { SwarmCanvas } from "@/components/dashboard/SwarmCanvas";
import { ChatStream } from "@/components/dashboard/ChatStream";
import { AgentInspector } from "@/components/dashboard/AgentInspector";
import { CommandBar } from "@/components/dashboard/CommandBar";
import { SteelBrowser } from "@/components/dashboard/SteelBrowser";

export default function Dashboard() {
  const [activeChannelId, setActiveChannelId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"canvas" | "chat" | "browser">("canvas");
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const views: { id: typeof viewMode; label: string }[] = [
    { id: "canvas", label: "Swarm" },
    { id: "chat", label: "Chat" },
    { id: "browser", label: "Steel" },
  ];

  return (
    <div className="flex w-full h-full relative overflow-hidden bg-background">
      {/* Background grid texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
        backgroundImage: 'linear-gradient(to right, #888 1px, transparent 1px), linear-gradient(to bottom, #888 1px, transparent 1px)',
        backgroundSize: '40px 40px'
      }} />

      <LeftPanel
        activeChannelId={activeChannelId}
        setActiveChannelId={setActiveChannelId}
        viewMode={viewMode}
        setViewMode={setViewMode}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Mobile top bar — panel toggle + view switcher (hidden on md+) */}
        <div className="md:hidden flex items-center gap-2 px-3 h-12 shrink-0 border-b border-card-border bg-card/80 backdrop-blur">
          <button onClick={() => setPanelOpen(true)} aria-label="Open channels & agents" className="p-2 -ml-2 text-muted-foreground hover:text-foreground">
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1 flex bg-background border border-card-border p-0.5 rounded-lg gap-0.5">
            {views.map((v) => (
              <button
                key={v.id}
                onClick={() => setViewMode(v.id)}
                className={cn(
                  "flex-1 text-[11px] font-bold px-2 py-1.5 rounded-md transition-all",
                  viewMode === v.id ? "bg-primary/20 text-primary" : "text-muted-foreground",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 relative min-h-0">
          {viewMode === "canvas" && <SwarmCanvas onAgentClick={setSelectedAgentId} />}
          {viewMode === "chat" && <ChatStream channelId={activeChannelId} />}
          {viewMode === "browser" && <SteelBrowser />}
        </div>

        <CommandBar activeChannelId={activeChannelId} />
      </div>

      <AgentInspector
        agentId={selectedAgentId}
        onClose={() => setSelectedAgentId(null)}
      />
    </div>
  );
}
