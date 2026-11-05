import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real app in a browser. A run takes ~31s of real time (the server simulates
// the transcode), so the timeouts are generous. Reuses a dev server already on :3000 if there is one.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 45_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/signin",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
