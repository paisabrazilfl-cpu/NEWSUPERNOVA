/**
 * BOS-OMEGA Connector
 * Connects BOS-AURA to the real OpenClaw runtime (BOS-OMEGA)
 */

interface OpenClawConfig {
  endpoint: string;      // BOS-OMEGA API endpoint
  apiKey: string;        // API key for auth
}

interface OpenClawMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface OpenClawResponse {
  id: string;
  choices: { message: { content: string } }[];
  model: string;
}

const DEFAULT_ENDPOINT = process.env.OPENCLAW_ENDPOINT || "https://api.openclaw.ai";

class OpenClawConnector {
  private config: OpenClawConfig;
  private connected: boolean = false;

  constructor(config: OpenClawConfig) {
    this.config = config;
  }

  private getHeaders() {
    return {
      "Authorization": `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.endpoint}/health`, {
        method: "GET",
        headers: this.getHeaders(),
      });
      this.connected = response.ok;
      return this.connected;
    } catch {
      this.connected = false;
      return false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Send a message to BOS-OMEGA and get response
   */
  async chat(message: string, model?: string): Promise<string> {
    const response = await fetch(`${this.config.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: model || "openai/gpt-4o",
        messages: [{ role: "user", content: message }],
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenClaw API error: ${response.status}`);
    }

    const data = await response.json() as OpenClawResponse;
    return data.choices?.[0]?.message?.content || "";
  }

  /**
   * Spawn a dedicated sub-agent for a task
   */
  async spawnAgent(name: string, systemPrompt: string, model?: string): Promise<string> {
    const response = await fetch(`${this.config.endpoint}/agents/spawn`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        name,
        systemPrompt,
        model: model || "openai/gpt-4o",
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to spawn agent: ${response.status}`);
    }

    const data = await response.json() as { agentId: string };
    return data.agentId;
  }

  /**
   * Send message to specific agent
   */
  async sendToAgent(agentId: string, message: string): Promise<string> {
    const response = await fetch(`${this.config.endpoint}/agents/${agentId}/chat`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      throw new Error(`Agent communication error: ${response.status}`);
    }

    const data = await response.json() as { response: string };
    return data.response;
  }

  /**
   * List active agents in BOS-OMEGA
   */
  async listAgents(): Promise<{ id: string; name: string; status: string }[]> {
    const response = await fetch(`${this.config.endpoint}/agents`, {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Failed to list agents: ${response.status}`);
    }

    const data = await response.json() as { agents: { id: string; name: string; status: string }[] };
    return data.agents;
  }
}

// Singleton instance
let connector: OpenClawConnector | null = null;

export function initOpenClawConnector(apiKey?: string): OpenClawConnector {
  const key = apiKey || process.env.OPENCLAW_API_KEY;
  if (!key) {
    throw new Error("OPENCLAW_API_KEY is required");
  }
  
  connector = new OpenClawConnector({
    endpoint: DEFAULT_ENDPOINT,
    apiKey: key,
  });
  
  return connector;
}

export function getOpenClawConnector(): OpenClawConnector | null {
  return connector;
}

export { OpenClawConnector };
