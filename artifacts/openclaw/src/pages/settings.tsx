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
  Globe,
  LogIn,
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
  resolveApiUrl,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
  const deleteSecret = useDeleteVaultSecret({
    mutation: {
      onSuccess: () => { invalidate(); toast.success("Secret deleted."); },
      onError: () => toast.error("Couldn't delete secret."),
    },
  });
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
          toast.success("Secret encrypted & stored.");
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
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
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

      {/* Section sub-nav — Composio ("Connect Apps") is a first-class, permanent tab here. */}
      <div className="sticky top-0 z-20 border-b border-card-border bg-background/90 backdrop-blur px-4 sm:px-8">
        <div className="max-w-3xl mx-auto flex gap-1 overflow-x-auto py-2">
          {[
            { id: "integrations", label: "Integrations" },
            { id: "social", label: "Social" },
            { id: "connect-apps", label: "Connect Apps" },
            { id: "website-logins", label: "Website Logins" },
            { id: "vault", label: "Vault" },
          ].map((s) => (
            <button
              key={s.id}
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              data-testid={`settings-tab-${s.id}`}
              className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border/50 transition-colors"
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8 relative z-10">
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Third-party integration status */}
          <div id="integrations" className="scroll-mt-20"><IntegrationsStatus /></div>

          {/* Official social integrations */}
          <div id="social" className="scroll-mt-20"><SocialIntegrations /></div>

          {/* Composio — connect SaaS apps (Gmail, Slack, GitHub, …). First-class, permanent. */}
          <div id="connect-apps" className="scroll-mt-20"><ComposioIntegrations /></div>

          {/* Website Logins — store a site's login so the Steel browser fallback can sign in. */}
          <div id="website-logins" className="scroll-mt-20">
            <SiteLogins
              secrets={secrets}
              onSave={(slug, email, password, site, url) =>
                Promise.all([
                  setSecret.mutateAsync({ data: { name: `${slug}_EMAIL`, value: email, description: `Website login for ${site}${url ? ` (${url})` : ""}` } }),
                  setSecret.mutateAsync({ data: { name: `${slug}_PASSWORD`, value: password, description: `Website login password for ${site}` } }),
                ]).then(() => invalidate())
              }
              onRemove={(slug) =>
                Promise.all([
                  deleteSecret.mutateAsync({ name: `${slug}_EMAIL` }),
                  deleteSecret.mutateAsync({ name: `${slug}_PASSWORD` }),
                ]).then(() => invalidate())
              }
            />
          </div>

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
            id="vault"
            onSubmit={handleSubmit}
            className="scroll-mt-20 rounded-lg border border-card-border bg-card p-6 space-y-4"
          >
            <div className="flex items-center gap-2 text-foreground font-semibold">
              <Plus className="w-4 h-4 text-[#00e5ff]" />
              Add / Update Secret
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Store API keys and other secrets here. To save a <span className="text-foreground">website login</span> for
              the browser fallback, use the <span className="text-foreground">Website Logins</span> tab above — it sets
              this up for you. Values are encrypted and never shown to the agents.
            </p>

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

interface IntegrationItem {
  key: string;
  name: string;
  category: string;
  configured: boolean;
  envVar: string;
}

function IntegrationsStatus() {
  const { data, isLoading, isError, refetch } = useQuery<{
    integrations: IntegrationItem[];
    configuredCount: number;
    total: number;
  }>({
    queryKey: ["integrations-status"],
    queryFn: async () => {
      const r = await fetch(resolveApiUrl("/api/integrations"));
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  const items = data?.integrations ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center border border-muted-border shrink-0">
          <Plug className="w-5 h-5 text-[#00e5ff]" />
        </div>
        <div className="flex-1">
          <h2 className="text-lg font-bold tracking-tight text-foreground">Integrations</h2>
          <p className="text-xs text-muted-foreground">
            Which third-party providers are configured on the server.
            {data && (
              <span className="ml-1 font-mono text-foreground/70">{data.configuredCount}/{data.total} active</span>
            )}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          title="Refresh"
          className="w-9 h-9 rounded-md border border-muted-border text-muted-foreground hover:text-foreground hover:border-card-border/80 transition-colors flex items-center justify-center"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground font-mono opacity-50">Loading integration status…</div>
      ) : isError ? (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <ShieldAlert className="w-5 h-5 text-destructive shrink-0" />
          <span className="text-muted-foreground">Couldn't reach the integrations endpoint.</span>
          <button onClick={() => refetch()} className="ml-auto text-xs underline text-foreground hover:text-primary">Retry</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {items.map((it) => (
            <div
              key={it.key}
              className="flex items-center gap-3 rounded-lg border border-card-border bg-card/50 px-3 py-2.5"
              title={`Set via ${it.envVar}`}
            >
              <span
                className={cn(
                  "w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_8px_currentColor]",
                  it.configured ? "bg-green-400 text-green-400" : "bg-zinc-600 text-transparent shadow-none",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground truncate">{it.name}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{it.category}</div>
              </div>
              <span
                className={cn(
                  "text-[10px] font-mono font-bold uppercase tracking-wider shrink-0",
                  it.configured ? "text-green-400" : "text-muted-foreground/40",
                )}
              >
                {it.configured ? "On" : "Off"}
              </span>
            </div>
          ))}
        </div>
      )}
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

/**
 * Website Logins — a first-class, guided way to store a site's login so the
 * Steel browser fallback (browser_login) can sign in for the operator. A single
 * "site + email + password" entry is stored as the NAME_EMAIL / NAME_PASSWORD
 * vault pair the swarm references by name.
 */
function SiteLogins({
  secrets,
  onSave,
  onRemove,
}: {
  secrets: Array<{ id?: number | string; name: string; description?: string | null }>;
  onSave: (slug: string, email: string, password: string, site: string, url: string) => Promise<unknown>;
  onRemove: (slug: string) => Promise<unknown>;
}) {
  const [site, setSite] = useState("");
  const [url, setUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const slug = site.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  // Existing site logins = every NAME_EMAIL that has a matching NAME_PASSWORD.
  const logins = secrets
    .filter((s) => /_EMAIL$/.test(s.name) && secrets.some((p) => p.name === s.name.replace(/_EMAIL$/, "_PASSWORD")))
    .map((s) => ({ base: s.name.replace(/_EMAIL$/, ""), desc: s.description ?? "" }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!slug) { setError("Enter a site name."); return; }
    if (!email.trim() || !password) { setError("Email/username and password are required."); return; }
    setSaving(true);
    try {
      await onSave(slug, email.trim(), password, site.trim(), url.trim());
      setSite(""); setUrl(""); setEmail(""); setPassword("");
      toast.success(`Saved login for ${slug} — the swarm can now sign in to this site.`);
    } catch {
      setError("Couldn't save the login. Check the server logs.");
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full bg-background border border-muted-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[#00e5ff] transition-colors";

  return (
    <section className="rounded-lg border border-card-border bg-card p-6 space-y-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-muted border border-muted-border flex items-center justify-center shrink-0">
          <Globe className="w-5 h-5 text-[#00e5ff]" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-foreground">Website Logins</h2>
          <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
            For a site with <span className="text-foreground">no connected API</span>, save your login here and the swarm
            signs in for you with a Steel browser when you ask it to do something there. Credentials are encrypted and
            never shown to the agents. For Gmail/Google, use <span className="text-foreground">Connect Apps</span> (OAuth) instead.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-mono">Site name</label>
            <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="My Site" className={inputCls} />
            {slug && <p className="text-[11px] text-muted-foreground font-mono">stored as {slug}_EMAIL / {slug}_PASSWORD</p>}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-mono">Login URL <span className="opacity-50">(optional)</span></label>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mysite.com/login" className={`${inputCls} font-mono`} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-mono">Email / username</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" placeholder="you@example.com" className={inputCls} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-mono">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="••••••••••••" className={`${inputCls} font-mono`} />
          </div>
        </div>
        {error && <p className="text-sm text-[#ff2d78]">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 border border-[#00e5ff]/50 text-[#00e5ff] rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          <LogIn className="w-4 h-4" />
          {saving ? "Encrypting…" : "Save login"}
        </button>
      </form>

      {logins.length > 0 && (
        <div className="space-y-2 pt-2">
          <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono">Saved logins ({logins.length})</div>
          {logins.map((l) => (
            <div key={l.base} className="flex items-center gap-4 rounded-lg border border-card-border bg-card px-4 py-3">
              <Globe className="w-4 h-4 text-[#00e5ff] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm text-foreground truncate">{l.base}</div>
                <div className="text-xs text-muted-foreground truncate">{l.desc || `${l.base}_EMAIL · ${l.base}_PASSWORD`}</div>
              </div>
              <button
                onClick={() => onRemove(l.base).then(() => toast.success(`Removed ${l.base} login.`)).catch(() => toast.error("Couldn't remove login."))}
                title="Remove login"
                className="text-muted-foreground hover:text-[#ff2d78] transition-colors shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// Popular Composio toolkits offered as one-click connect chips. Any other app
// can be connected by typing its slug.
const POPULAR_TOOLKITS = ["gmail", "slack", "github", "notion", "googlecalendar", "googlesheets", "linear", "discord"];

interface ComposioConnection {
  id: string;
  toolkit: string;
  status: string;
}

// Authenticated fetch to an operator-gated endpoint. credentials:"include" sends
// the httpOnly session cookie (same-origin in prod, cross-origin in dev).
async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(resolveApiUrl(path), { ...init, credentials: "include" });
}

function ComposioIntegrations() {
  const [slug, setSlug] = useState("");
  const [connecting, setConnecting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<{ connections: ComposioConnection[] }>({
    queryKey: ["composio-connections"],
    retry: false,
    queryFn: async () => {
      const r = await authedFetch("/api/integrations/composio/connections");
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      return r.json();
    },
  });

  const notConfigured = isError && /not configured/i.test(error instanceof Error ? error.message : "");
  const connections = data?.connections ?? [];
  const statusFor = (toolkit: string) =>
    connections.find((c) => c.toolkit.toLowerCase() === toolkit.toLowerCase())?.status ?? null;

  const connect = async (toolkit: string) => {
    const t = toolkit.trim().toLowerCase();
    if (!t) return;
    setConnecting(t);
    try {
      const r = await authedFetch("/api/integrations/composio/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkit: t }),
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string; redirectUrl?: string | null; status?: string };
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      if (body.redirectUrl) {
        window.open(body.redirectUrl, "_blank", "noopener,noreferrer");
        toast.success(`Authorize ${t} in the new tab, then hit Refresh.`);
      } else {
        toast.success(`${t}: ${body.status ?? "initiated"}`);
      }
      setSlug("");
      setTimeout(() => refetch(), 1500);
    } catch (e) {
      toast.error(`Connect failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setConnecting(null);
    }
  };

  const removeConnection = async (c: ComposioConnection) => {
    if (!window.confirm(`Delete the ${c.toolkit} connection (${c.id})? You can re-connect it any time.`)) return;
    setDeleting(c.id);
    try {
      const r = await authedFetch(`/api/integrations/composio/connections/${encodeURIComponent(c.id)}`, {
        method: "DELETE",
      });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      toast.success(`Deleted ${c.toolkit} connection.`);
      refetch();
    } catch (e) {
      toast.error(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDeleting(null);
    }
  };

  const StatusBadge = ({ status }: { status: string | null }) => {
    if (status === "ACTIVE")
      return (
        <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-[#00cc88] bg-[#00cc88]/10 border border-[#00cc88]/40 rounded px-1.5 py-0.5">
          <Check className="w-3 h-3" /> Connected
        </span>
      );
    if (status)
      return (
        <span className="text-[10px] font-mono uppercase tracking-wider text-[#f59e0b] bg-[#f59e0b]/10 border border-[#f59e0b]/40 rounded px-1.5 py-0.5">
          {status === "INITIATED" ? "Awaiting approval" : status}
        </span>
      );
    return null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-muted rounded-lg flex items-center justify-center border border-muted-border shrink-0">
          <Plug className="w-5 h-5 text-[#bf00ff]" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-foreground">CONNECT APPS (COMPOSIO)</h2>
          <p className="text-sm text-muted-foreground">
            Authorize SaaS apps so agents can act on them with{" "}
            <code className="px-1 py-0.5 rounded bg-muted text-[#bf00ff] font-mono text-xs">composio_action</code>.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching || notConfigured}
          title="Refresh connection status"
          className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-[#bf00ff] border border-muted-border hover:border-[#bf00ff]/50 rounded-md px-3 py-2 transition-colors disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {notConfigured ? (
        <div className="flex gap-3 rounded-lg border border-muted-border bg-card/50 p-4 text-sm text-muted-foreground">
          <ShieldAlert className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <span>
            Composio isn't configured. Add <code className="px-1 py-0.5 rounded bg-muted text-foreground font-mono text-xs">COMPOSIO_API_KEY</code>{" "}
            (Settings → vault or the server env), then refresh.
          </span>
        </div>
      ) : (
        <>
          <div className="flex gap-3 rounded-lg border border-[#bf00ff]/30 bg-[#bf00ff]/5 p-4">
            <ShieldCheck className="w-5 h-5 text-[#bf00ff] shrink-0 mt-0.5" />
            <div className="text-sm text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">Connect</span> opens the app's OAuth screen in a new
              tab. Approve access there, then <span className="font-semibold text-foreground">Refresh</span> — the
              status flips to Connected. Tokens are held by Composio and never exposed to the agents.
            </div>
          </div>

          {/* Quick-connect chips */}
          <div className="flex flex-wrap gap-2">
            {POPULAR_TOOLKITS.map((t) => {
              const status = statusFor(t);
              return (
                <button
                  key={t}
                  onClick={() => connect(t)}
                  disabled={connecting === t || status === "ACTIVE"}
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-mono rounded-md px-3 py-1.5 border transition-colors disabled:opacity-60",
                    status === "ACTIVE"
                      ? "text-[#00cc88] border-[#00cc88]/40 bg-[#00cc88]/10"
                      : "text-foreground border-muted-border hover:border-[#bf00ff]/50 hover:text-[#bf00ff]",
                  )}
                >
                  {status === "ACTIVE" ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                  {t}
                </button>
              );
            })}
          </div>

          {/* Any-app connect by slug */}
          <div className="flex gap-2">
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && connect(slug)}
              placeholder="other app slug, e.g. airtable, hubspot, jira"
              className="flex-1 bg-background border border-muted-border rounded-md px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:border-[#bf00ff] transition-colors"
            />
            <button
              onClick={() => connect(slug)}
              disabled={!slug.trim() || connecting === slug.trim().toLowerCase()}
              className="flex items-center gap-1.5 bg-[#bf00ff]/10 hover:bg-[#bf00ff]/20 border border-[#bf00ff]/50 text-[#bf00ff] rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-colors disabled:opacity-50 shrink-0"
            >
              <ExternalLink className="w-4 h-4" />
              Connect
            </button>
          </div>

          {/* Existing connections */}
          {isLoading ? (
            <div className="text-sm text-muted-foreground font-mono opacity-50">Loading connections…</div>
          ) : connections.length === 0 ? (
            <div className="rounded-lg border border-dashed border-muted-border p-6 text-center text-sm text-muted-foreground font-mono opacity-60">
              No connected apps yet. Pick one above to connect.
            </div>
          ) : (
            <div className="space-y-2">
              {connections.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-4 rounded-lg border border-card-border bg-card px-4 py-3"
                >
                  <Plug className="w-4 h-4 text-[#bf00ff] shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">{c.toolkit}</span>
                      <StatusBadge status={c.status} />
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{c.id}</p>
                  </div>
                  <button
                    onClick={() => removeConnection(c)}
                    disabled={deleting === c.id}
                    title={`Delete ${c.toolkit} connection`}
                    className="shrink-0 p-2 rounded-md border border-card-border text-muted-foreground hover:text-[#ff3355] hover:border-[#ff3355]/50 transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
