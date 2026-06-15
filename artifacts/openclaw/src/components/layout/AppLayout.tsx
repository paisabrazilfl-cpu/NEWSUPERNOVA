import { Link, useLocation } from "wouter";
import { Activity, LayoutGrid, Terminal, Settings as SettingsIcon, ShieldAlert, Clock, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { RelayBanner, RelayRailIndicator } from "./RelayIndicator";
import { useGetSwarmStatus } from "@workspace/api-client-react";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetSwarmStatusQueryKey } from "@workspace/api-client-react";

const navItems = [
  { href: "/", icon: MessageSquare, label: "Chat", hint: "Talk to the agent swarm" },
  { href: "/swarm", icon: Activity, label: "Swarm", hint: "Live swarm visualization & command center" },
  { href: "/tasks", icon: LayoutGrid, label: "Tasks", hint: "Work the agents are running" },
  { href: "/agents", icon: Terminal, label: "Agents", hint: "The six CLAW agents and their tools" },
  { href: "/cron", icon: Clock, label: "Scheduled", hint: "Scheduled, recurring jobs" },
  { href: "/settings", icon: SettingsIcon, label: "Settings", hint: "Operator login, vault & integrations" },
];

function isActive(location: string, href: string) {
  return location === href || (href !== "/" && location.startsWith(href));
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const { data: swarmStatus } = useGetSwarmStatus();

  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: getGetSwarmStatusQueryKey() });
    }, 5000);
    return () => clearInterval(interval);
  }, [queryClient]);

  const paused = swarmStatus?.paused;

  return (
    // Column on mobile (content + bottom tab bar) → row on md+ (side rail + content).
    <div className="flex flex-col md:flex-row h-screen w-full bg-background text-foreground overflow-hidden font-sans">
      {/* ── Side rail (tablet / desktop) ── */}
      <div className="hidden md:flex w-[88px] flex-shrink-0 bg-card border-r border-card-border flex-col items-center py-4 z-20">
        <Link href="/" data-testid="link-home-logo">
          <div className="flex flex-col items-center gap-1.5 mb-5 cursor-pointer group">
            <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_15px_rgba(217,119,87,0.15)] transition-transform group-hover:scale-105">
              <ShieldAlert className="w-6 h-6 text-primary" />
            </div>
            <span className="text-[10px] font-bold tracking-[0.18em] text-foreground/80 leading-none">OPENCLAW</span>
          </div>
        </Link>

        <div className="w-10 h-px bg-card-border mb-3" />

        <nav className="flex flex-col gap-1.5 flex-1 w-full items-center px-2" aria-label="Primary">
          {navItems.map((item) => {
            const active = isActive(location, item.href);
            return (
              <Link key={item.href} href={item.href} data-testid={`nav-item-${item.label.toLowerCase()}`}>
                <div
                  title={item.hint}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative group w-full flex flex-col items-center gap-1 rounded-xl py-2 cursor-pointer transition-all duration-200",
                    active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-card-border/60 hover:text-foreground",
                  )}
                >
                  <span className={cn("absolute -left-2 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-primary transition-all duration-300", active ? "h-7 opacity-100" : "h-0 opacity-0")} />
                  <item.icon className="w-[22px] h-[22px]" strokeWidth={1.75} />
                  <span className="text-[10px] font-semibold tracking-wide leading-none">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <RelayRailIndicator />

        {swarmStatus && (
          <Link href="/" data-testid="swarm-status-indicator">
            <div
              title={paused ? "Swarm is paused" : "Swarm is active"}
              className="mt-auto flex flex-col items-center gap-1.5 px-2 py-2 rounded-xl cursor-pointer hover:bg-card-border/60 transition-colors"
            >
              <span className={cn("w-2.5 h-2.5 rounded-full shadow-[0_0_10px_currentColor]", paused ? "bg-muted-foreground" : "bg-primary animate-pulse")} />
              <span className={cn("text-[9px] font-bold tracking-wider leading-none", paused ? "text-muted-foreground" : "text-primary")}>{paused ? "PAUSED" : "ACTIVE"}</span>
            </div>
          </Link>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden relative z-10">
        {/* Floating relay cue — announces when the partner swarm (T800-AURA) is working. */}
        <RelayBanner />
        {children}
      </div>

      {/* ── Bottom tab bar (mobile) — in normal flow, so it never overlaps content ── */}
      <nav className="md:hidden flex-shrink-0 flex items-stretch border-t border-card-border bg-card z-20" aria-label="Primary">
        {navItems.map((item) => {
          const active = isActive(location, item.href);
          return (
            <Link key={item.href} href={item.href} data-testid={`tab-${item.label.toLowerCase()}`} className="flex-1">
              <div
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative h-16 flex flex-col items-center justify-center gap-1 transition-colors",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <span className={cn("absolute top-0 left-1/2 -translate-x-1/2 h-0.5 rounded-b-full bg-primary transition-all", active ? "w-8 opacity-100" : "w-0 opacity-0")} />
                <item.icon className="w-[22px] h-[22px]" strokeWidth={1.75} />
                <span className="text-[10px] font-semibold leading-none">{item.label}</span>
              </div>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
