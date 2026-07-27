import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

loadEnv({
  path: process.env.E2E_ENV_FILE ?? ".env.test",
  override: false,
});

export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  testDir: "./e2e",
  testMatch: ["profile-photo-network.spec.ts"],
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.E2E_BASE_URL ?? "https://apmcb.pmpb.online",
    trace: "retain-on-failure",
  },
});
