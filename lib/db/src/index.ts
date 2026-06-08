import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Pool sizing matters: orchestration runs in-process and fire-and-forget, so a
// single goal can hold several connections (CLAW tool loops writing tool_calls,
// messages, tasks) at once. With the pg default of max:10, concurrent polling
// reads (the dashboard hits /messages, /commands, /agents every few seconds)
// starve and hang past the client timeout — surfacing as empty/dropped
// responses. Give it real headroom and a connection-acquire timeout so a busy
// moment fails fast with an error the caller can retry, instead of hanging.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 20),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
export const db = drizzle(pool, { schema });

export * from "./schema";
