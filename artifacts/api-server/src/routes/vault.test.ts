import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  const { mockDb } = await import("../test/dbMock");
  return { ...actual, db: mockDb };
});

import app from "../app";
import { queueDbResults, resetDbMock } from "../test/dbMock";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  resetDbMock();
  process.env["SESSION_SECRET"] = "test-session-secret";
  process.env["OPERATOR_PASSWORD"] = "hunter2";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** Log in and return the session cookie string for authenticated requests. */
async function loginCookie(): Promise<string> {
  const res = await request(app).post("/api/auth/login").send({ password: "hunter2" });
  expect(res.status).toBe(200);
  const setCookie = res.headers["set-cookie"];
  return Array.isArray(setCookie) ? setCookie[0] : (setCookie as unknown as string);
}

describe("vault auth gating", () => {
  it("rejects anonymous GET /api/vault with 401 and discloses no secret names", async () => {
    const res = await request(app).get("/api/vault");
    expect(res.status).toBe(401);
    expect(res.body).not.toHaveProperty("0");
    expect(JSON.stringify(res.body)).not.toContain("name");
  });

  it("rejects anonymous PUT /api/vault with 401", async () => {
    const res = await request(app).put("/api/vault").send({ name: "X", value: "y" });
    expect(res.status).toBe(401);
  });

  it("rejects anonymous DELETE /api/vault/:name with 401", async () => {
    const res = await request(app).delete("/api/vault/X");
    expect(res.status).toBe(401);
  });

  it("rejects a forged/garbage session token with 401", async () => {
    const res = await request(app)
      .get("/api/vault")
      .set("Cookie", "openclaw_session=not.a.valid.token");
    expect(res.status).toBe(401);
  });

  it("allows GET /api/vault once signed in", async () => {
    const cookie = await loginCookie();
    queueDbResults([
      {
        id: 1,
        name: "OPENAI_API_KEY",
        description: null,
        ciphertext: "x",
        iv: "y",
        authTag: "z",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    const res = await request(app).get("/api/vault").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("OPENAI_API_KEY");
    // Encrypted material is never exposed.
    expect(res.body[0]).not.toHaveProperty("ciphertext");
  });
});

describe("operator auth routes", () => {
  it("rejects login with a wrong password", async () => {
    const res = await request(app).post("/api/auth/login").send({ password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("reports authenticated=false for anonymous /api/auth/me", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  it("reports authenticated=true after login", async () => {
    const cookie = await loginCookie();
    const res = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(res.body.authenticated).toBe(true);
  });

  it("fails closed when OPERATOR_PASSWORD is unset", async () => {
    delete process.env["OPERATOR_PASSWORD"];
    const res = await request(app).post("/api/auth/login").send({ password: "anything" });
    expect(res.status).toBe(401);
  });
});
