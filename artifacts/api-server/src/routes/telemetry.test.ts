import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("../test/dbMock");
  return { ...actual, db: mockDb };
});

import app from "../app";
import { queueDbResults, resetDbMock } from "../test/dbMock";

const sampleAgent = {
  id: 1,
  name: "ABBY",
  role: "Orchestrator",
  description: null,
  status: "idle",
  color: "#00e5ff",
  avatarInitials: "AB",
  model: "x-ai/grok-4.3",
  contextUsed: 1000,
  contextMax: 128000,
  capabilities: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const sampleMonologue = {
  id: 1,
  agentId: 1,
  content: "thinking...",
  timestamp: new Date("2026-01-02T00:00:00.000Z"),
};

const sampleToolCall = {
  id: 1,
  agentId: 1,
  toolName: "search",
  status: "completed",
  startedAt: new Date("2026-01-02T00:00:00.000Z"),
  completedAt: new Date("2026-01-02T00:01:00.000Z"),
};

const sampleTask = {
  id: 1,
  title: "Crawl site",
  description: null,
  agentId: 1,
  agentName: "ABBY",
  status: "queued",
  priority: "medium",
  progress: 0,
  channelId: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  completedAt: null,
};

beforeEach(() => {
  resetDbMock();
});

describe("GET /api/agents/:agentId/telemetry", () => {
  it("returns 200 with telemetry payload", async () => {
    // agent lookup, monologue, tool calls
    queueDbResults([sampleAgent], [sampleMonologue], [sampleToolCall]);
    const res = await request(app).get("/api/agents/1/telemetry");
    expect(res.status).toBe(200);
    expect(res.body.agentId).toBe(1);
    expect(res.body.monologue[0].timestamp).toBe("2026-01-02T00:00:00.000Z");
    expect(res.body.toolCalls[0].completedAt).toBe("2026-01-02T00:01:00.000Z");
    expect(res.body.contextUsed).toBe(1000);
    expect(res.body.contextMax).toBe(128000);
  });

  it("returns 400 for a non-numeric agent id", async () => {
    const res = await request(app).get("/api/agents/abc/telemetry");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid agent ID" });
  });

  it("returns 404 when the agent is not found", async () => {
    queueDbResults([]);
    const res = await request(app).get("/api/agents/999/telemetry");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Agent not found" });
  });

  it("returns 500 when a query fails", async () => {
    queueDbResults(new Error("select failed"));
    const res = await request(app).get("/api/agents/1/telemetry");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to get telemetry" });
  });
});

describe("GET /api/agents/:agentId/tasks", () => {
  it("returns 200 with the agent's tasks", async () => {
    queueDbResults([sampleTask]);
    const res = await request(app).get("/api/agents/1/tasks");
    expect(res.status).toBe(200);
    expect(res.body[0].title).toBe("Crawl site");
    expect(res.body[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns 400 for a non-numeric agent id", async () => {
    const res = await request(app).get("/api/agents/abc/tasks");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid agent ID" });
  });

  it("returns 500 when the query fails", async () => {
    queueDbResults(new Error("select failed"));
    const res = await request(app).get("/api/agents/1/tasks");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to get agent tasks" });
  });
});
