/**
 * OPENCLAW OMEGA — Replit-managed social connectors.
 *
 * Each "main platform" is wired to its OFFICIAL API through Replit's connector
 * proxy. The operator authorizes their own account once via OAuth (handled by
 * Replit); we then fetch a fresh, short-lived access token at request time and
 * use it only inside the outbound API call.
 *
 * SECURITY: tokens are never persisted by us, never logged, and never returned
 * to the model — `callPlatformApi` strips any token value the API echoes back
 * before the response is handed to an agent. This is the safe, ToS-compliant
 * alternative to driving a browser with a username/password.
 */

export type AuthStyle = "bearer" | "query";

export interface PlatformDef {
  /** Tool-facing platform key. */
  key: string;
  /** `connector_names` value understood by the Replit connector proxy. */
  connectorName: string;
  /** Official API base URL, no trailing slash. */
  apiBase: string;
  displayName: string;
  /** How the access token is attached to the request. */
  authStyle: AuthStyle;
  /** Headers some APIs require (e.g. Reddit's mandatory User-Agent). */
  extraHeaders?: Record<string, string>;
  /** Official API reference documentation URL. */
  docsUrl: string;
  /** Developer portal / app console where the operator sets up & authorizes access. */
  consoleUrl: string;
}

/**
 * The "main platforms" that expose a first-party account API as a Replit
 * connector. LinkedIn is intentionally absent — it has no first-party account
 * connector in the catalog (only third-party prospecting tools).
 */
export const PLATFORMS: Record<string, PlatformDef> = {
  instagram: {
    key: "instagram",
    connectorName: "instagram",
    apiBase: "https://graph.instagram.com",
    displayName: "Instagram",
    authStyle: "bearer",
    docsUrl: "https://developers.facebook.com/docs/instagram-platform",
    consoleUrl: "https://developers.facebook.com/apps",
  },
  facebook: {
    key: "facebook",
    connectorName: "facebook",
    apiBase: "https://graph.facebook.com/v21.0",
    displayName: "Facebook",
    authStyle: "bearer",
    docsUrl: "https://developers.facebook.com/docs/graph-api",
    consoleUrl: "https://developers.facebook.com/apps",
  },
  x: {
    key: "x",
    connectorName: "x",
    apiBase: "https://api.x.com/2",
    displayName: "X (Twitter)",
    authStyle: "bearer",
    docsUrl: "https://developer.x.com/en/docs/x-api",
    consoleUrl: "https://developer.x.com/en/portal/dashboard",
  },
  reddit: {
    key: "reddit",
    connectorName: "reddit",
    apiBase: "https://oauth.reddit.com",
    displayName: "Reddit",
    authStyle: "bearer",
    extraHeaders: { "User-Agent": "openclaw-omega/1.0 (by OPENCLAW OMEGA swarm)" },
    docsUrl: "https://www.reddit.com/dev/api",
    consoleUrl: "https://www.reddit.com/prefs/apps",
  },
  youtube: {
    key: "youtube",
    connectorName: "youtube",
    apiBase: "https://www.googleapis.com/youtube/v3",
    displayName: "YouTube",
    authStyle: "bearer",
    docsUrl: "https://developers.google.com/youtube/v3/docs",
    consoleUrl: "https://console.cloud.google.com/apis/library/youtube.googleapis.com",
  },
  tiktok: {
    key: "tiktok",
    connectorName: "tiktok-personal",
    apiBase: "https://open.tiktokapis.com/v2",
    displayName: "TikTok",
    authStyle: "bearer",
    docsUrl: "https://developers.tiktok.com/doc/overview",
    consoleUrl: "https://developers.tiktok.com/apps",
  },
};

export function getPlatform(key: string): PlatformDef | undefined {
  return PLATFORMS[key.toLowerCase().trim()];
}

export function platformKeys(): string[] {
  return Object.keys(PLATFORMS);
}

function readAccessToken(settings: unknown): string | null {
  if (!settings || typeof settings !== "object") return null;
  const s = settings as Record<string, unknown>;
  if (typeof s["access_token"] === "string") return s["access_token"];
  const oauth = s["oauth"];
  if (oauth && typeof oauth === "object") {
    const creds = (oauth as Record<string, unknown>)["credentials"];
    if (creds && typeof creds === "object") {
      const t = (creds as Record<string, unknown>)["access_token"];
      if (typeof t === "string") return t;
    }
  }
  return null;
}

/**
 * Fetch a live access token for a connector from the Replit connector proxy.
 * Throws a human-readable error if the proxy is unavailable or the platform has
 * not been authorized yet.
 */
export async function getConnectorAccessToken(connectorName: string): Promise<string> {
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  if (!hostname) {
    throw new Error("connector proxy is unavailable in this environment.");
  }
  const identity = process.env["REPL_IDENTITY"];
  const renewal = process.env["WEB_REPL_RENEWAL"];
  const xReplitToken = identity ? `repl ${identity}` : renewal ? `depl ${renewal}` : null;
  if (!xReplitToken) {
    throw new Error("connector proxy auth is unavailable in this environment.");
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=${encodeURIComponent(connectorName)}`,
      { headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken }, signal: ctrl.signal },
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new Error(`connector proxy returned ${res.status}.`);
  }
  const data = (await res.json()) as { items?: Array<{ settings?: unknown }> };
  const token = readAccessToken(data.items?.[0]?.settings);
  if (!token) {
    throw new Error("not connected — authorize this platform first (Settings → Integrations).");
  }
  return token;
}

/** True if the platform currently has a usable authorized connection. */
export async function isPlatformConnected(platform: PlatformDef): Promise<boolean> {
  try {
    await getConnectorAccessToken(platform.connectorName);
    return true;
  } catch {
    return false;
  }
}

export interface PlatformApiResult {
  status: number;
  statusText: string;
  body: string;
}

/**
 * Make an authenticated call to a platform's official API. The token is fetched
 * fresh, attached per the platform's auth style, and scrubbed from the response
 * body before returning.
 */
export async function callPlatformApi(opts: {
  platform: PlatformDef;
  method: string;
  path: string;
  query?: Record<string, string>;
  body?: string;
}): Promise<PlatformApiResult> {
  const token = await getConnectorAccessToken(opts.platform.connectorName);
  const path = opts.path.startsWith("/") ? opts.path : `/${opts.path}`;
  const url = new URL(opts.platform.apiBase + path);

  // Defense-in-depth: never let a crafted path escape the official host.
  const expectedHost = new URL(opts.platform.apiBase).host;
  if (url.host !== expectedHost) {
    throw new Error(`path must stay on ${expectedHost}.`);
  }

  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(opts.platform.extraHeaders ?? {}),
  };
  if (opts.platform.authStyle === "bearer") {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    url.searchParams.set("access_token", token);
  }

  const method = opts.method.toUpperCase();
  const init: RequestInit = { method, headers };
  if (opts.body != null && opts.body !== "" && method !== "GET" && method !== "DELETE") {
    headers["Content-Type"] = "application/json";
    init.body = opts.body;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url.toString(), { ...init, signal: ctrl.signal });
    const text = await r.text();
    const safe = token ? text.split(token).join("[redacted-token]") : text;
    return { status: r.status, statusText: r.statusText, body: safe };
  } finally {
    clearTimeout(timer);
  }
}
