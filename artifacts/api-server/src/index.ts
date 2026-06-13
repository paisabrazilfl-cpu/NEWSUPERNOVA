import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./migrate";
import { loadVaultIntoEnv } from "./lib/vaultEnv";
import { startKeepAlive } from "./lib/keepAlive";
import { reconcileStaleWork } from "./orchestrator";
import { integrationStatus } from "./lib/integrations";
import { startScheduler } from "./lib/scheduler";
import { copyLegacyData } from "./lib/legacyCopy";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const REQUIRED_KEYS = ["NVIDIA_API_KEY", "STEEL_API_KEY", "FIRECRAWL_API_KEY"] as const;
const missingKeys = REQUIRED_KEYS.filter((k) => !process.env[k]);
if (missingKeys.length > 0) {
  logger.warn(
    { missingKeys },
    "Missing API key env vars — AI chat and browser tool routes will fail at runtime",
  );
}

// Surface which optional third-party integrations are wired (booleans only —
// no secret values are ever logged). Logged after the vault→env load below so it
// reflects keys saved in the in-app Settings/Vault, not just Render env vars.
function logIntegrations(): void {
  const integrations = integrationStatus();
  logger.info(
    {
      configured: integrations.filter((i) => i.configured).map((i) => i.key),
      notConfigured: integrations.filter((i) => !i.configured).map((i) => i.key),
    },
    "Third-party integrations status",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

runMigrations()
  // One-time copy from a legacy DB (only when LEGACY_DATABASE_URL is set). Runs
  // BEFORE the vault load so any copied vault secrets are picked up this boot.
  // Non-fatal: a copy failure never blocks startup.
  .then(() => copyLegacyData().catch((e) => logger.error({ err: String(e) }, "legacy copy crashed (non-fatal)")))
  // Activate integrations from keys saved in the in-app vault (env vars still win).
  .then(() => loadVaultIntoEnv())
  .then(() => logIntegrations())
  .then(() => reconcileStaleWork())
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
      startKeepAlive();
      startScheduler();
    });
  });
