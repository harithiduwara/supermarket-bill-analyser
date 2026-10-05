import { defineConfig, devices } from "@playwright/test";

const ci = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: ci ? 1 : 0,
  workers: ci ? 2 : undefined,
  reporter: ci ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    // PW_CHROMIUM_PATH lets a sandbox with a pre-installed browser skip the download.
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined, args: ["--no-sandbox"] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec/ },
    {
      name: "phone",
      // 360 px wide: the smallest phone width the requirements (US-19) commit to.
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 } },
      testMatch: /mobile\.spec/,
    },
  ],
  // Tests run against the production build (the CSP only exists there). Run `npm run build` first.
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !ci,
    timeout: 60_000,
  },
});
