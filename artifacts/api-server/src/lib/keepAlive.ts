import { logger } from "./logger";

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes — under Render's 15-min idle window

function resolveBaseUrl(): string | undefined {
  const explicit = process.env["KEEP_ALIVE_URL"];
  if (explicit && explicit.trim().length > 0) {
    return explicit.trim();
  }
  // Render automatically injects RENDER_EXTERNAL_URL for web services
  const renderUrl = process.env["RENDER_EXTERNAL_URL"];
  if (renderUrl && renderUrl.trim().length > 0) {
    return renderUrl.trim();
  }
  return undefined;
}

function resolveIntervalMs(): number {
  const raw = process.env["KEEP_ALIVE_INTERVAL_MS"];
  if (!raw) return DEFAULT_INTERVAL_MS;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed <= 0) {
    logger.warn(
      { raw },
      "Invalid KEEP_ALIVE_INTERVAL_MS — falling back to default 10 minutes",
    );
    return DEFAULT_INTERVAL_MS;
  }
  return parsed;
}

/**
 * Periodically pings this service's own public health endpoint so that
 * Render (free/starter tier) does not spin the instance down after idle.
 * A self-ping counts as inbound HTTP traffic and resets the idle timer.
 *
 * Only active in production and only when a public URL is resolvable.
 */
export function startKeepAlive(): void {
  if (process.env["NODE_ENV"] !== "production") {
    return;
  }
  if (process.env["KEEP_ALIVE_DISABLED"] === "true") {
    logger.info("Keep-alive self-ping disabled via KEEP_ALIVE_DISABLED");
    return;
  }

  const baseUrl = resolveBaseUrl();
  if (!baseUrl) {
    logger.warn(
      "Keep-alive self-ping not started — set RENDER_EXTERNAL_URL or KEEP_ALIVE_URL to enable it",
    );
    return;
  }

  const intervalMs = resolveIntervalMs();
  const target = `${baseUrl.replace(/\/$/, "")}/api/healthz`;

  const ping = async (): Promise<void> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(target, {
        method: "GET",
        signal: controller.signal,
        headers: { "user-agent": "newsupernova-keepalive" },
      });
      if (!res.ok) {
        logger.warn({ status: res.status, target }, "Keep-alive ping non-OK");
      } else {
        logger.debug({ target }, "Keep-alive ping ok");
      }
    } catch (err) {
      logger.warn({ err, target }, "Keep-alive ping failed");
    } finally {
      clearTimeout(timeout);
    }
  };

  const timer = setInterval(() => {
    void ping();
  }, intervalMs);
  // Do not keep the event loop alive solely for the keep-alive timer
  timer.unref();

  logger.info(
    { target, intervalMs },
    "Keep-alive self-ping started — preventing Render cold starts",
  );
}
