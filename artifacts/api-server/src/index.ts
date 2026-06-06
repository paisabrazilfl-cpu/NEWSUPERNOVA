import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "./migrate";
import { logConfig, getConfig } from "./lib/config";
import { initOpenClawConnector } from "./lib/openclaw-connector";
import { initMemoryStore } from "./lib/memory-store";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Log configuration on startup
logConfig();
const config = getConfig();

// Initialize BOS-OMEGA connector if API key is available
if (config.openclawApiKey) {
  try {
    const connector = initOpenClawConnector(config.openclawApiKey);
    connector.testConnection().then(connected => {
      if (connected) {
        logger.info("Connected to BOS-OMEGA");
      } else {
        logger.warn("Failed to connect to BOS-OMEGA");
      }
    });
  } catch (err) {
    logger.warn({ err }, "BOS-OMEGA connector init failed");
  }
} else {
  logger.info("OPENCLAW_API_KEY not set - BOS-OMEGA integration disabled");
}

runMigrations().then(async () => {
  try {
    await initMemoryStore();
  } catch (err) {
    logger.warn({ err }, "Memory store init failed — persistent RAG disabled");
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
  });
});
