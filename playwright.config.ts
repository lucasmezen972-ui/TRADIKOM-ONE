import { defineConfig, devices } from "@playwright/test";

const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const isCi = process.env.CI === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  reporter: isCi
    ? [
        ["line"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ]
    : "list",
  use: {
    baseURL: appUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: isCi ? "retain-on-failure" : "off",
  },
  webServer: {
    command: "pnpm dev",
    url: appUrl,
    reuseExistingServer: !isCi,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
