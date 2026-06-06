import { Link, useLocation } from "wouter";
import { Activity, LayoutGrid, Terminal, Settings as SettingsIcon, ShieldAlert, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetSwarmStatus } from "@workspace/api-client-react";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSwarmStatusQueryKey } from "@workspace/api-client-react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  
  const { data: swarmStatus } = useGetSwarmStatus();

  // Auto-poll swarm status every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getGetSwarmStatusQueryKey() });
    }, 5000);
    return () => clearInterval(interval);
  }, [queryClient]);

  const navItems = [
    { href: "/", icon: Activity, label: "SWARM" },
    { href: "/tasks", icon: LayoutGrid, label: "TASKS" },
    { href: "/agents", icon: Terminal, label: "AGENTS" },
    { href: "/cron", icon: Clock, label: "CRON" },
    { href: "/settings", icon: SettingsIcon, label: "SETTINGS" },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans">
      {/* Far-left rail */}
      <div className="w-[72px] flex-shrink-0 bg-card border-r border-card-border flex flex-col items-center py-4 z-20">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6 border border-primary/20 shadow-[0_0_15px_rgba(0,255,255,0.15)] cursor-pointer" data-testid="link-home-logo">
          <ShieldAlert className="w-6 h-6 text-primary" />
        </div>
        
        <div className="w-8 h-[2px] bg-card-border rounded-full mb-4"></div>

        <nav className="flex flex-col gap-3 flex-1 w-full items-center">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} data-testid={`nav-item-${item.label.toLowerCase()}`}>
                <div className="relative group w-12 h-12 flex items-center justify-center cursor-pointer">
                  {/* Active Indicator */}
                  <div 
                    className={cn(
                      "absolute left-0 w-1 bg-primary rounded-r-full transition-all duration-300",
                      isActive ? "h-8 opacity-100" : "h-0 opacity-0 group-hover:h-4 group-hover:opacity-50"
                    )}
                  />
                  
                  <div 
                    className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300",
                      isActive 
                        ? "bg-primary/20 text-primary rounded-xl" 
                        : "bg-transparent text-muted-foreground hover:bg-card-border hover:text-foreground hover:rounded-xl"
                    )}
                  >
                    <item.icon className="w-6 h-6" strokeWidth={1.5} />
                  </div>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col items-center gap-2">
          {swarmStatus && (
            <div 
              className="w-10 h-10 rounded-full border border-card-border bg-card flex items-center justify-center" 
              title={swarmStatus.paused ? "Swarm Paused" : "Swarm Active"}
              data-testid="swarm-status-indicator"
            >
              <div className={cn(
                "w-3 h-3 rounded-full shadow-[0_0_10px_currentColor]",
                swarmStatus.paused ? "bg-muted-foreground shadow-muted" : "bg-primary shadow-primary animate-pulse"
              )} />
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex min-w-0 overflow-hidden relative z-10">
        {children}
      </div>
    </div>
  );
}