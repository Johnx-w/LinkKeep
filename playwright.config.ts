import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { existsSync } from "node:fs";

const webkitExecutable = process.platform === "win32" ? path.resolve("artifacts/browsers/webkit-2336/Playwright.exe") : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./artifacts/playwright",
  reporter: [["list"], ["json", { outputFile: "artifacts/e2e-results.json" }], ["html", { outputFolder: "artifacts/playwright-report", open: "never" }]],
  use: {
    baseURL: "https://127.0.0.1:3443",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "https://127.0.0.1:3443/api/health",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", testMatch: "home.spec.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-safari", testMatch: "home.spec.ts", use: { ...devices["iPhone 13"], ...(webkitExecutable && existsSync(webkitExecutable) ? { launchOptions: { executablePath: webkitExecutable } } : {}) } },
    { name: "api", testMatch: "api.spec.ts" },
  ],
});
