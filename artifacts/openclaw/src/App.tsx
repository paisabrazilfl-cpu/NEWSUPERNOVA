import { AppLayout } from "@/components/layout/AppLayout";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
        <SonnerToaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
