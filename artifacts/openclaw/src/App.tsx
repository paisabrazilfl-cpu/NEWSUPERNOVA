import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Lock, ShieldAlert } from "lucide-react";
import { useGetAuthStatus, getGetAuthStatusQueryKey, useLogin } from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";
import ChatPage from "@/pages/chat";
import Dashboard from "@/pages/dashboard";
import Agents from "@/pages/agents";
import Tasks from "@/pages/tasks";
import Settings from "@/pages/settings";
import CronPage from "@/pages/cron";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={ChatPage} />
        <Route path="/chat" component={ChatPage} />
        <Route path="/swarm" component={Dashboard} />
        <Route path="/agents" component={Agents} />
        <Route path="/tasks" component={Tasks} />
        <Route path="/cron" component={CronPage} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

/**
 * Whole-app operator gate. The backend now requires an operator session for all
 * state-changing/data routes, so the dashboard must sign in once; the session
 * cookie then authorizes every same-origin API call. Without this gate the app
 * would render but every data call would 401.
 */
function AuthGate({ children }: { children: React.ReactNode }) {
  const { data: auth, isLoading } = useGetAuthStatus();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-sm text-muted-foreground font-mono opacity-50">Checking session…</div>
      </div>
    );
  }
  if (!auth?.authenticated) return <OperatorGate />;
  return <>{children}</>;
}

function OperatorGate() {
  const qc = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin({
    mutation: {
      onSuccess: () => qc.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() }),
      onError: () => setError("Invalid operator password."),
    },
  });
  return (
    <div className="flex items-center justify-center h-screen bg-background p-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!password) { setError("Enter the operator password."); return; }
          login.mutate({ data: { password } });
        }}
        className="w-full max-w-sm rounded-lg border border-card-border bg-card p-8 space-y-6"
      >
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 bg-muted rounded-lg flex items-center justify-center border border-muted-border">
            <ShieldAlert className="w-7 h-7 text-[#d97757]" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">OPERATOR SIGN-IN</h1>
            <p className="text-sm text-muted-foreground mt-1">Abby AI is restricted to authorized operators.</p>
          </div>
        </div>
        <input
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••••••"
          className="w-full bg-background border border-muted-border rounded-md px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:border-[#d97757] transition-colors"
        />
        {error && <p className="text-sm text-[#ff2d78]">{error}</p>}
        <button
          type="submit"
          disabled={login.isPending}
          className="btn-3d w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold uppercase tracking-wider"
        >
          <Lock className="w-4 h-4" />
          {login.isPending ? "Authenticating…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthGate>
            <Router />
          </AuthGate>
        </WouterRouter>
        <Toaster />
        <SonnerToaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
