import { Link, useLocation } from "wouter";
import { Activity, LayoutGrid, Terminal, Settings as SettingsIcon, ShieldAlert, Clock, MessageSquare } from "lucide-react";
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
    { href: "/", icon: MessageSquare, label: "Chat", hint: "Talk to the agent swarm" },
    { href: "/swarm", icon: Activity, label: "Swarm", hint: "Live swarm visualization & command center" },
    { href: "/tasks", icon: LayoutGrid, label: "Tasks", hint: "Work the agents are running" },
    { href: "/agents", icon: Terminal, label: "Agents", hint: "The six CLAW agents and their tools" },
    { href: "/cron", icon: Clock, label: "Cron", hint: "Scheduled, recurring jobs" },
    { href: "/settings", icon: SettingsIcon, label: "Settings", hint: "Operator login, vault & integrations" },
  ];

  const paused = swarmStatus?.paused;

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans">
      {/* Far-left navigation rail */}
      <div className="w-[88px] flex-shrink-0 bg-card border-r border-card-border flex flex-col items-center py-4 z-20">
        {/* Brand */}
        <Link href="/" data-testid="link-home-logo">
          <div className="flex flex-col items-center gap-1.5 mb-5 cursor-pointer group">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_15px_rgba(0,255,255,0.15)] transition-transform group-hover:scale-105">
              <ShieldAlert className="w-6 h-6 text-primary" />
            </div>
            <span className="text-[10px] font-bold tracking-[0.18em] text-foreground/80 leading-none">OPENCLAW</span>
          </div>
        </Link>

        <div className="w-10 h-px bg-card-border mb-3" />

        {/* Primary navigation — icon + visible label */}
        <nav className="flex flex-col gap-1.5 flex-1 w-full items-center px-2" aria-label="Primary">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} data-testid={`nav-item-${item.label.toLowerCase()}`}>
                <div
                  title={item.hint}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative group w-full flex flex-col items-center gap-1 rounded-xl py-2 cursor-pointer transition-all duration-200",
                    isActive
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-card-border/60 hover:text-foreground",
                  )}
                >
                  {/* Active indicator */}
                  <span
                    className={cn(
                      "absolute -left-2 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-primary transition-all duration-300",
                      isActive ? "h-7 opacity-100" : "h-0 opacity-0",
                    )}
                  />
                  <item.icon className="w-[22px] h-[22px]" strokeWidth={1.75} />
                  <span className="text-[10px] font-semibold tracking-wide leading-none">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Swarm status — dot + readable label */}
        {swarmStatus && (
          <Link href="/" data-testid="swarm-status-indicator">
            <div
              title={paused ? "Swarm is paused — resume it from the command bar" : "Swarm is active"}
              className="mt-auto flex flex-col items-center gap-1.5 px-2 py-2 rounded-xl cursor-pointer hover:bg-card-border/60 transition-colors"
            >
              <span
                className={cn(
                  "w-2.5 h-2.5 rounded-full shadow-[0_0_10px_currentColor]",
                  paused ? "bg-muted-foreground" : "bg-primary animate-pulse",
                )}
              />
              <span
                className={cn(
                  "text-[9px] font-bold tracking-wider leading-none",
                  paused ? "text-muted-foreground" : "text-primary",
                )}
              >
                {paused ? "PAUSED" : "ACTIVE"}
              </span>
            </div>
          </Link>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex min-w-0 overflow-hidden relative z-10">{children}</div>
    </div>
  );
}
