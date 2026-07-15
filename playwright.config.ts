import { defineConfig, devices } from "@playwright/test";

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  use: {
    baseURL: appUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev",
    url: appUrl,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
