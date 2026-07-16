import { defineConfig, devices } from "@playwright/test";

const appUrl = process.env.APP_URL ?? "http://localhost:3000";
const isCi = process.env.CI === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  // The browser scenarios deliberately exercise one persistent demo tenant and
  // verify cross-feature state transitions. Running files concurrently lets one
  // scenario revoke, refresh or replace state while another is asserting it.
  // Serialize the suite instead of weakening assertions or hiding failures.
  workers: isCi ? 1 : undefined,
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
    command: isCi ? "pnpm exec next start" : "pnpm dev",
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
