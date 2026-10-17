import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ quiet: true });

/**
 * Two modes:
 * - Default: starts its own dev server on E2E_PORT (3101) against the
 *   disposable DATABASE_URL_E2E database, which global-setup resets and seeds.
 * - E2E_BASE_URL=http://host:port: tests an already running deployment (e.g.
 *   the Docker stack seeded with the demo profile); nothing is reset.
 */
const externalBaseUrl = process.env.E2E_BASE_URL;
const PORT = Number(process.env.E2E_PORT ?? 3101);
const baseURL = externalBaseUrl ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: externalBaseUrl ? undefined : "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: `npx next dev -p ${PORT}`,
        url: `${baseURL}/api/health`,
        // Never reuse a server that might be pointed at the development database.
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          DATABASE_URL: process.env.DATABASE_URL_E2E ?? "",
          BETTER_AUTH_URL: baseURL,
          APP_URL: baseURL,
        },
      },
});
