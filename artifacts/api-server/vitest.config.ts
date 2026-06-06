import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      LOG_LEVEL: "silent",
    },
  },
});
