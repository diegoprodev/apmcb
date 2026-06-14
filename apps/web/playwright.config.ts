import { defineConfig, devices } from "@playwright/test";

/**
 * APMCB Playwright Configuration
 *
 * Default target: https://apmcb.pages.dev (CF Pages production)
 * Override:
 *   E2E_BASE_URL=https://staging.apmcb.pages.dev npx playwright test
 *   E2E_BASE_URL=http://localhost:3000              npx playwright test
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : 4,

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://apmcb.pages.dev",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // ── Core smoke: Chrome only (fast CI) ──────────────────────────────────
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/apmcb.spec.ts"],
    },

    // ── Mobile viewport regression ─────────────────────────────────────────
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 14"] },
      testMatch: ["e2e/apmcb.spec.ts"],
    },

    // ── Full suite: smoke + CRUD + regressão + armeiro ────────────────────
    {
      name: "suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: [
        "e2e/smoke.spec.ts",
        "e2e/crud-arsenal.spec.ts",
        "e2e/crud-usuarios.spec.ts",
        "e2e/crud-saidas.spec.ts",
        "e2e/crud-usuarios-create.spec.ts",
        "e2e/regression.spec.ts",
        "e2e/armeiro-cadastro.spec.ts",
        "e2e/auth-reset.spec.ts",
        "e2e/notifications-enhanced.spec.ts",
      ],
    },

    // ── Stress suite (desktop only, more workers) ──────────────────────────
    {
      name: "stress",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/stress.spec.ts"],
      workers: 1,
      retries: 0,
    },
  ],

  // Timeout per test (stress tests may run longer)
  timeout: 60_000,

  // Output artefacts
  outputDir: "test-results",
});
