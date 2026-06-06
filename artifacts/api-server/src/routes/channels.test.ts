import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("../test/dbMock");
  return { ...actual, db: mockDb };
});

import app from "../app";
import { queueDbResults, resetDbMock } from "../test/dbMock";

const sampleChannel = {
  id: 1,
  name: "general",
  type: "general",
  description: null,
  unreadCount: 0,
  lastActivity: new Date("2026-01-02T00:00:00.000Z"),
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

const sampleMessage = {
  id: 1,
  channelId: 1,
  agentId: 1,
  agentName: "ABBY",
  agentColor: "#00e5ff",
  content: "hello",
  messageType: "user",
  metadata: null,
  timestamp: new Date("2026-01-03T00:00:00.000Z"),
};

beforeEach(() => {
  resetDbMock();
});

describe("GET /api/channels", () => {
  it("returns 200 with channels (dates serialized)", async () => {
    queueDbResults([sampleChannel]);
    const res = await request(app).get("/api/channels");
    expect(res.status).toBe(200);
    expect(res.body[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(res.body[0].lastActivity).toBe("2026-01-02T00:00:00.000Z");
  });

  it("returns 500 when the database fails", async () => {
    queueDbResults(new Error("db down"));
    const res = await request(app).get("/api/channels");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to list channels" });
  });
});

describe("POST /api/channels", () => {
  it("returns 201 with the created channel", async () => {
    queueDbResults([sampleChannel]);
    const res = await request(app).post("/api/channels").send({ name: "general" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("general");
  });

  it("returns 400 for invalid channel data", async () => {
    const res = await request(app).post("/api/channels").send({ type: "general" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid channel data" });
  });

  it("returns 500 when the insert fails", async () => {
    queueDbResults(new Error("insert failed"));
    const res = await request(app).post("/api/channels").send({ name: "general" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to create channel" });
  });
});

describe("GET /api/channels/:channelId/messages", () => {
  it("returns 200 with messages (dates serialized)", async () => {
    queueDbResults([sampleMessage]);
    const res = await request(app).get("/api/channels/1/messages");
    expect(res.status).toBe(200);
    expect(res.body[0].timestamp).toBe("2026-01-03T00:00:00.000Z");
  });

  it("returns 400 for a non-numeric channel id", async () => {
    const res = await request(app).get("/api/channels/abc/messages");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid channel ID" });
  });

  it("returns 500 when the lookup fails", async () => {
    queueDbResults(new Error("select failed"));
    const res = await request(app).get("/api/channels/1/messages");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to list messages" });
  });
});

describe("POST /api/channels/:channelId/messages", () => {
  it("returns 201 with the created message", async () => {
    // insert message returning, then update channel lastActivity
    queueDbResults([sampleMessage], []);
    const res = await request(app)
      .post("/api/channels/1/messages")
      .send({ content: "hello", agentName: "ABBY" });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe("hello");
    expect(res.body.timestamp).toBe("2026-01-03T00:00:00.000Z");
  });

  it("returns 400 for a non-numeric channel id", async () => {
    const res = await request(app)
      .post("/api/channels/abc/messages")
      .send({ content: "hello" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid channel ID" });
  });

  it("returns 400 for invalid message data", async () => {
    const res = await request(app)
      .post("/api/channels/1/messages")
      .send({ agentName: "ABBY" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid message data" });
  });

  it("returns 500 when the insert fails", async () => {
    queueDbResults(new Error("insert failed"));
    const res = await request(app)
      .post("/api/channels/1/messages")
      .send({ content: "hello" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to send message" });
  });
});
