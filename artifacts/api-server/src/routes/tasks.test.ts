import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("../test/dbMock");
  return { ...actual, db: mockDb };
});

import app from "../app";
import { queueDbResults, resetDbMock } from "../test/dbMock";

const sampleTask = {
  id: 1,
  title: "Crawl site",
  description: null,
  agentId: 3,
  agentName: "CRAWLER",
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

describe("GET /api/tasks", () => {
  it("returns 200 with tasks (dates serialized)", async () => {
    queueDbResults([sampleTask]);
    const res = await request(app).get("/api/tasks");
    expect(res.status).toBe(200);
    expect(res.body[0].createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(res.body[0].completedAt).toBeNull();
  });

  it("returns 500 when the database fails", async () => {
    queueDbResults(new Error("db down"));
    const res = await request(app).get("/api/tasks");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to list tasks" });
  });
});

describe("POST /api/tasks", () => {
  it("returns 201 with the created task", async () => {
    queueDbResults([sampleTask]);
    const res = await request(app).post("/api/tasks").send({ title: "Crawl site" });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Crawl site");
  });

  it("returns 400 for invalid task data", async () => {
    const res = await request(app).post("/api/tasks").send({ description: "no title" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid task data" });
  });

  it("returns 500 when the insert fails", async () => {
    queueDbResults(new Error("insert failed"));
    const res = await request(app).post("/api/tasks").send({ title: "Crawl site" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to create task" });
  });
});

describe("PATCH /api/tasks/:taskId", () => {
  it("returns 200 with the updated task", async () => {
    queueDbResults([{ ...sampleTask, status: "running", progress: 50 }]);
    const res = await request(app)
      .patch("/api/tasks/1")
      .send({ status: "running", progress: 50 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("running");
    expect(res.body.progress).toBe(50);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = await request(app).patch("/api/tasks/abc").send({ status: "running" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid task ID" });
  });

  it("returns 400 for an invalid status", async () => {
    const res = await request(app).patch("/api/tasks/1").send({ status: "bogus" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Invalid status" });
  });

  it("returns 404 when the task is not found", async () => {
    queueDbResults([]);
    const res = await request(app).patch("/api/tasks/999").send({ status: "running" });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Task not found" });
  });

  it("returns 500 when the update fails", async () => {
    queueDbResults(new Error("update failed"));
    const res = await request(app).patch("/api/tasks/1").send({ status: "running" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Failed to update task" });
  });
});
