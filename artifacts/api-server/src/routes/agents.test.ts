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
  description: "Lead agent",
  status: "idle",
  color: "#00e5ff",
  avatarInitials: "AB",
  model: "x-ai/grok-4.3",
  contextUsed: 0,
  contextMax: 128000,
  capabilities: [],
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

beforeEach(() => {
  resetDbMock();
});

describe("GET /api/agents", () => {
  it("returns 200 with a list of agents (dates serialized)", async () => {
    queueDbResults([sampleAgent]);
    const res = await request(app).get("/api/agents");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(1);
    expect(res.body[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns 500 when the database fails", async () => {
    queueDbResults(new Error("db down"));
    const res = await request(app).get("/api/agents");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to list agents" });
  });
});

describe("POST /api/agents", () => {
  it("returns 201 with the created agent", async () => {
    queueDbResults([sampleAgent]);
    const res = await request(app)
      .post("/api/agents")
      .send({ name: "ABBY", role: "Orchestrator", color: "#00e5ff" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("ABBY");
    expect(res.body.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("returns 400 for invalid agent data", async () => {
    const res = await request(app).post("/api/agents").send({ role: "Orchestrator" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid agent data" });
  });

  it("returns 500 when the insert fails", async () => {
    queueDbResults(new Error("insert failed"));
    const res = await request(app)
      .post("/api/agents")
      .send({ name: "ABBY", role: "Orchestrator", color: "#00e5ff" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to create agent" });
  });
});

describe("GET /api/agents/:agentId", () => {
  it("returns 200 with the agent", async () => {
    queueDbResults([sampleAgent]);
    const res = await request(app).get("/api/agents/1");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await request(app).get("/api/agents/abc");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid ID" });
  });

  it("returns 404 when the agent is not found", async () => {
    queueDbResults([]);
    const res = await request(app).get("/api/agents/999");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Agent not found" });
  });

  it("returns 500 when the lookup fails", async () => {
    queueDbResults(new Error("select failed"));
    const res = await request(app).get("/api/agents/1");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to get agent" });
  });
});

describe("PATCH /api/agents/:agentId", () => {
  it("returns 200 with the updated agent", async () => {
    queueDbResults([{ ...sampleAgent, status: "thinking" }]);
    const res = await request(app).patch("/api/agents/1").send({ status: "thinking" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("thinking");
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await request(app).patch("/api/agents/abc").send({ status: "thinking" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid ID" });
  });

  it("returns 400 for an invalid status", async () => {
    const res = await request(app).patch("/api/agents/1").send({ status: "bogus" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid status" });
  });

  it("returns 404 when the agent is not found", async () => {
    queueDbResults([]);
    const res = await request(app).patch("/api/agents/999").send({ status: "thinking" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Agent not found" });
  });

  it("returns 500 when the update fails", async () => {
    queueDbResults(new Error("update failed"));
    const res = await request(app).patch("/api/agents/1").send({ status: "thinking" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to update agent" });
  });
});
