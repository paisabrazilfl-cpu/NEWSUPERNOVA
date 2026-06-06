/**
 * BOS-AURA Configuration
 * Environment variables and runtime config
 */

export interface AppConfig {
  openrouterApiKey: string | undefined;
  openclawApiKey: string | undefined;
  openclawEndpoint: string;
  neurobuddyApiKey: string | undefined;
  neurobuddyBaseUrl: string;
  steelApiKey: string | undefined;
  port: number;
  nodeEnv: string;
}

export function getConfig(): AppConfig {
  return {
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    openclawApiKey: process.env.OPENCLAW_API_KEY,
    openclawEndpoint: process.env.OPENCLAW_ENDPOINT || "https://api.openclaw.ai",
    neurobuddyApiKey: process.env.NEUROBUDDY_API_KEY,
    neurobuddyBaseUrl: process.env.NEUROBUDDY_BASE_URL || "https://neurobuddy-wg8b.onrender.com/api/external/v1",
    steelApiKey: process.env.STEEL_API_KEY,
    port: parseInt(process.env.PORT || "3000", 10),
    nodeEnv: process.env.NODE_ENV || "development",
  };
}

export function logConfig() {
  const cfg = getConfig();
  console.log("=== BOS-AURA Configuration ===");
  console.log("NODE_ENV:", cfg.nodeEnv);
  console.log("PORT:", cfg.port);
  console.log("OPENROUTER_API_KEY:", cfg.openrouterApiKey ? "***set***" : "***missing***");
  console.log("OPENCLAW_API_KEY:", cfg.openclawApiKey ? "***set***" : "***missing***");
  console.log("OPENCLAW_ENDPOINT:", cfg.openclawEndpoint);
  console.log("NEUROBUDDY_API_KEY:", cfg.neurobuddyApiKey ? "***set***" : "***missing***");
  console.log("NEUROBUDDY_BASE_URL:", cfg.neurobuddyBaseUrl);
  console.log("STEEL_API_KEY:", cfg.steelApiKey ? "***set***" : "***missing***");
  console.log("==============================");
}

export const config = getConfig();
