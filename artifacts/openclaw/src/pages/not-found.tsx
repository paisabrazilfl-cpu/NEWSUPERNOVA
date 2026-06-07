import { Link } from "wouter";
import { AlertTriangle, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex-1 min-h-screen w-full flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md text-center">
        <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/30 flex items-center justify-center mx-auto mb-5">
          <AlertTriangle className="h-7 w-7 text-destructive" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page doesn't exist in the command center.
        </p>
        <Link href="/">
          <button className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-bold hover:bg-primary/20 transition-all">
            <ArrowLeft className="w-4 h-4" /> Back to the swarm
          </button>
        </Link>
      </div>
    </div>
  );
}
