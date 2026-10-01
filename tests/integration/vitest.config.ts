import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.ts"],
    globalSetup: ["./globalSetup.ts"],
    // These hit a real running Docker Compose stack over real HTTP
    // (registration, file upload, Cloudinary round-trip) — slower and
    // less parallel-safe than in-process unit tests by nature.
    testTimeout: 20000,
    fileParallelism: false,
  },
});
