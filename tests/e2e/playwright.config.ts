import { defineConfig, devices } from "@playwright/test";

/**
 * Drives the real frontend against the real Gateway and real services —
 * no API mocking anywhere (per instruction). Requires the Docker Compose
 * stack to already be running; see tests/e2e/README.md.
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: process.env.FRONTEND_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  reporter: [["list"]],
});
