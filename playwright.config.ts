import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3123",
    viewport: { width: 1600, height: 1000 },
    trace: "retain-on-failure",
    // The sandbox ships a pinned Chromium; use it instead of downloading one.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
  },
  reporter: [["list"]],
});
