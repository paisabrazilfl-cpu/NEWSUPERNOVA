import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./migrate";
import { startKeepAlive } from "./lib/keepAlive";
import { reconcileStaleWork } from "./orchestrator";
import { integrationStatus } from "./lib/integrations";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const REQUIRED_KEYS = ["OPENROUTER_API_KEY", "STEEL_API_KEY", "FIRECRAWL_API_KEY"] as const;
const missingKeys = REQUIRED_KEYS.filter((k) => !process.env[k]);
if (missingKeys.length > 0) {
  logger.warn(
    { missingKeys },
    "Missing API key env vars — AI chat and browser tool routes will fail at runtime",
  );
}

// Surface which optional third-party integrations are wired (booleans only —
// no secret values are ever logged).
const integrations = integrationStatus();
logger.info(
  {
    configured: integrations.filter((i) => i.configured).map((i) => i.key),
    notConfigured: integrations.filter((i) => !i.configured).map((i) => i.key),
  },
  "Third-party integrations status",
);

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

runMigrations()
  .then(() => reconcileStaleWork())
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }

      logger.info({ port }, "Server listening");
      startKeepAlive();
    });
  });
