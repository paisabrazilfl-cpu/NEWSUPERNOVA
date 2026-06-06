import { useState } from "react";
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
      />
      
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <div className="flex-1 relative">
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