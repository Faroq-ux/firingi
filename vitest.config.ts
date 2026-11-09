import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws outside React Server Components; it is a no-op in tests.
      "server-only": path.resolve(__dirname, "tests/stubs/empty.ts"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Integration tests share one Postgres database; run files sequentially.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 120000,
  },
});
