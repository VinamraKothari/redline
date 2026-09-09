import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  retries: 0,
  // each review spawns a headless Chromium on the server for its preview; keep the load sane
  workers: 2,
  // Proxied pages take a few seconds to render when several tests run at once.
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3123",
    viewport: { width: 1600, height: 1000 },
    trace: "retain-on-failure",
    // The sandbox ships a pinned Chromium; use it instead of downloading one.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
  },
  reporter: [["list"]],
});
