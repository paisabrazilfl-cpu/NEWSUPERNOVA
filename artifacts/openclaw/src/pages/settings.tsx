import { useState } from "react";
import {
  KeyRound,
  Lock,
  Plus,
  Trash2,
  ShieldCheck,
  Copy,
  Check,
  LogOut,
  ShieldAlert,
  Plug,
  BookOpen,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import {
  useListVaultSecrets,
  useSetVaultSecret,
  useDeleteVaultSecret,
  getListVaultSecretsQueryKey,
  useGetAuthStatus,
  getGetAuthStatusQueryKey,
  useListSocialPlatforms,
  getListSocialPlatformsQueryKey,
  useLogin,
  useLogout,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Settings() {
  const { data: auth, isLoading: authLoading } = useGetAuthStatus();

  if (authLoading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-background">
        <div className="text-sm text-muted-foreground font-mono opacity-50">Checking session…</div>
      </div>
    );
  }

  if (!auth?.authenticated) {
    return <OperatorLogin />;
  }

  return <VaultPanel />;
}

function OperatorLogin() {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const login = useLogin({
    mutation: {
      onSuccess: () => {
        setPassword("");
        queryClient.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListVaultSecretsQueryKey() });
      },
      onError: () => setError("Invalid operator password."),
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password) {
      setError("Enter the operator password.");
      return;
    }
    login.mutate({ data: { password } });
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden relative">
      <div className="flex-1 flex items-center justify-center p-8 relative z-10">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm rounded-lg border border-card-border bg-card p-8 space-y-6"
        >
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 bg-muted rounded-lg flex items-center justify-center border border-muted-border">
              <ShieldAlert className="w-7 h-7 text-[#bf00ff]" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">OPERATOR SIGN-IN</h1>
              <p className="text-sm text-muted-foreground mt-1">
                The secrets vault is restricted to authorized operators.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
              Operator Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••••••"
              className="w-full bg-background border border-muted-border rounded-md px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:border-[#bf00ff] transition-colors"
            />
          </div>

          {error && <p className="text-sm text-[#ff2d78]">{error}</p>}

          <button
            type="submit"
            disabled={login.isPending}
            className="w-full flex items-center justify-center gap-2 bg-[#bf00ff]/10 hover:bg-[#bf00ff]/20 border border-[#bf00ff]/50 text-[#bf00ff] rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-colors disabled:opacity-50"
          >
            <Lock className="w-4 h-4" />
            {login.isPending ? "Authenticating…" : "Unlock Vault"}
          </button>
        </form>
      </div>
    </div>
  );
}

function VaultPanel() {
  const queryClient = useQueryClient();
  const { data: secrets = [], isLoading } = useListVaultSecrets();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListVaultSecretsQueryKey() });

  const setSecret = useSetVaultSecret({ mutation: { onSuccess: invalidate } });
  const deleteSecret = useDeleteVaultSecret({ mutation: { onSuccess: invalidate } });
  const logout = useLogout({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() });
        queryClient.removeQueries({ queryKey: getListVaultSecretsQueryKey() });
      },
    },
  });

  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const nameValid = /^[A-Za-z0-9_\-]+$/.test(name);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !value.trim()) {
      setError("Name and value are required.");
      return;
    }
    if (!nameValid) {
      setError("Name may only contain letters, numbers, underscores, and dashes.");
      return;
    }
    setSecret.mutate(
      { data: { name: name.trim(), value, description: description.trim() || undefined } },
      {
        onSuccess: () => {
          setName("");
          setValue("");
          setDescription("");
        },
        onError: () => setError("Failed to store secret. Check the server logs."),
      },
    );
  };

  const copyPlaceholder = (secretName: string) => {
    void navigator.clipboard.writeText(`{{secret:${secretName}}}`);
    setCopied(secretName);
    setTimeout(() => setCopied((c) => (c === secretName ? null : c)), 1500);
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden relative">
      <div className="p-8 border-b border-card-border relative z-10 flex items-center gap-4">
        <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center border border-muted-border">
          <KeyRound className="w-6 h-6 text-[#00e5ff]" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">SECRETS VAULT</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Encrypted at rest. Write-only — values are never displayed back, even to operators.
          </p>
        </div>
        <button
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          title="Sign out"
          className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-[#ff2d78] border border-muted-border hover:border-[#ff2d78]/50 rounded-md px-3 py-2 transition-colors disabled:opacity-50"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-8 relative z-10">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Official social integrations */}
          <SocialIntegrations />

          {/* Security notice */}
          <div className="flex gap-3 rounded-lg border border-[#bf00ff]/30 bg-[#bf00ff]/5 p-4">
            <ShieldCheck className="w-5 h-5 text-[#bf00ff] shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground leading-relaxed">
              <p className="text-foreground font-semibold mb-1">How agents use secrets</p>
              Reference a stored secret anywhere a command or tool argument accepts text using
              <code className="mx-1 px-1.5 py-0.5 rounded bg-muted text-[#00e5ff] font-mono text-xs">
                {"{{secret:NAME}}"}
              </code>
              . The raw value is injected only at the moment of use — it is never sent to the model,
              logged, or shown in telemetry. Never paste secrets into chat.
            </div>
          </div>

          {/* Add form */}
          <form
            onSubmit={handleSubmit}
            className="rounded-lg border border-card-border bg-card p-6 space-y-4"
          >
            <div className="flex items-center gap-2 text-foreground font-semibold">
              <Plus className="w-4 h-4 text-[#00e5ff]" />
              Add / Update Secret
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                  Name
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="OPENAI_API_KEY"
                  className="w-full bg-background border border-muted-border rounded-md px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:border-[#00e5ff] transition-colors"
                />
                {name && !nameValid && (
                  <p className="text-xs text-[#ff2d78]">Letters, numbers, _ and - only.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                  Description <span className="opacity-50">(optional)</span>
                </label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Used by CRAWLER for API access"
                  className="w-full bg-background border border-muted-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[#00e5ff] transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-mono">
                Value
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="••••••••••••••••••••"
                className="w-full bg-background border border-muted-border rounded-md px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:border-[#00e5ff] transition-colors"
              />
            </div>

            {error && <p className="text-sm text-[#ff2d78]">{error}</p>}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={setSecret.isPending}
                className="flex items-center gap-2 bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 border border-[#00e5ff]/50 text-[#00e5ff] rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-colors disabled:opacity-50"
              >
                <Lock className="w-4 h-4" />
                {setSecret.isPending ? "Encrypting…" : "Encrypt & Store"}
              </button>
            </div>
          </form>

          {/* Secrets list */}
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">
              Stored Secrets {secrets.length > 0 && `(${secrets.length})`}
            </div>

            {isLoading ? (
              <div className="text-sm text-muted-foreground font-mono opacity-50">Loading vault…</div>
            ) : secrets.length === 0 ? (
              <div className="rounded-lg border border-dashed border-muted-border p-8 text-center text-sm text-muted-foreground font-mono opacity-50">
                <Lock className="w-8 h-8 mx-auto mb-3 opacity-50" />
                Vault is empty. Stored secrets stay encrypted on the server.
              </div>
            ) : (
              <div className="space-y-2">
                {secrets.map((secret) => (
                  <div
                    key={secret.id}
                    className="flex items-center gap-4 rounded-lg border border-card-border bg-card px-4 py-3 group"
                  >
                    <KeyRound className="w-4 h-4 text-[#00e5ff] shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-foreground truncate">{secret.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">••••••••</span>
                      </div>
                      {secret.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {secret.description}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={() => copyPlaceholder(secret.name)}
                      title="Copy placeholder"
                      className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-[#00e5ff] transition-colors shrink-0"
                    >
                      {copied === secret.name ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" /> {"{{secret:…}}"}
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => deleteSecret.mutate({ name: secret.name })}
                      disabled={deleteSecret.isPending}
                      title="Delete secret"
                      className="text-muted-foreground hover:text-[#ff2d78] transition-colors shrink-0 disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SocialIntegrations() {
  const queryClient = useQueryClient();
  const { data: platforms = [], isLoading, isFetching } = useListSocialPlatforms();

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListSocialPlatformsQueryKey() });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center border border-muted-border shrink-0">
          <Plug className="w-5 h-5 text-[#00cc88]" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-foreground">OFFICIAL API INTEGRATIONS</h2>
          <p className="text-sm text-muted-foreground">
            Authorize your own accounts via each platform's official API — agents call them with{" "}
            <code className="px-1 py-0.5 rounded bg-muted text-[#00cc88] font-mono text-xs">social_api</code>.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={isFetching}
          title="Refresh connection status"
          className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-[#00cc88] border border-muted-border hover:border-[#00cc88]/50 rounded-md px-3 py-2 transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="flex gap-3 rounded-lg border border-[#00cc88]/30 bg-[#00cc88]/5 p-4">
        <ShieldCheck className="w-5 h-5 text-[#00cc88] shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground leading-relaxed">
          <p className="text-foreground font-semibold mb-1">The safe, legal way</p>
          <span className="font-semibold text-foreground">Connect</span> opens the platform's developer
          console where you authorize your own account and obtain API access.{" "}
          <span className="font-semibold text-foreground">Docs</span> opens the exact official API
          reference. Access tokens are managed by Replit's connector proxy — fetched only at call time,
          never stored here and never shown to the agents.
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground font-mono opacity-50">Loading integrations…</div>
      ) : (
        <div className="space-y-2">
          {platforms.map((p) => (
            <div
              key={p.key}
              className="flex items-center gap-4 rounded-lg border border-card-border bg-card px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">{p.displayName}</span>
                  {p.connected ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[#00cc88] bg-[#00cc88]/10 border border-[#00cc88]/40 rounded px-1.5 py-0.5">
                      <Check className="w-3 h-3" /> Connected
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground bg-muted border border-muted-border rounded px-1.5 py-0.5">
                      Not connected
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{p.apiBase}</p>
              </div>

              <a
                href={p.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={p.docsUrl}
                className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-[#00e5ff] border border-muted-border hover:border-[#00e5ff]/50 rounded-md px-3 py-1.5 transition-colors shrink-0"
              >
                <BookOpen className="w-3.5 h-3.5" /> Docs
              </a>

              <a
                href={p.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={p.consoleUrl}
                className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-[#00cc88] hover:text-[#00cc88] bg-[#00cc88]/10 hover:bg-[#00cc88]/20 border border-[#00cc88]/50 rounded-md px-3 py-1.5 transition-colors shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Connect
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
