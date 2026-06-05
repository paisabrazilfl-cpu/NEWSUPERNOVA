import { Settings as SettingsIcon } from "lucide-react";

export default function Settings() {
  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden relative">
      <div className="p-8 border-b border-card-border relative z-10 flex items-center gap-4">
        <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center border border-muted-border">
          <SettingsIcon className="w-6 h-6 text-muted-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">SYSTEM SETTINGS</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure global swarm parameters.</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 relative z-10 flex items-center justify-center">
        <div className="text-center text-muted-foreground font-mono uppercase tracking-widest text-sm opacity-50">
          <SettingsIcon className="w-12 h-12 mx-auto mb-4 opacity-50 animate-[spin_10s_linear_infinite]" />
          Settings module locked.
          <br/>Insufficient operator clearance.
        </div>
      </div>
    </div>
  );
}