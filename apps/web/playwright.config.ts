import { defineConfig, devices } from "@playwright/test";
import { config as loadEnv } from "dotenv";

// Load .env.test so harness helpers (supabaseAdmin, bffCall) have their vars
loadEnv({ path: ".env.test", override: false });

/**
 * APMCB Playwright Configuration
 *
 * Default target: https://apmcb.pages.dev (CF Pages production)
 * Override:
 *   E2E_BASE_URL=https://staging.apmcb.pages.dev npx playwright test
 *   E2E_BASE_URL=http://localhost:3000              npx playwright test
 */
export default defineConfig({
  globalSetup: "./e2e/global-setup.ts",
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // 2 workers globais reduz contention quando múltiplos projetos usam os mesmos usuários de DB
  workers: process.env.CI ? 2 : 2,

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
    // ── Core smoke: Chrome only ────────────────────────────────────────────
    // mobile-safari removido do run principal: apmcb.spec.ts usa seletores
    // que falham no WebKit consistentemente (163 hard-fails no full run).
    // Rodar isolado se necessário: pnpm exec playwright test --project=mobile-safari
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/apmcb.spec.ts"],
    },

    // ── Full suite: smoke + CRUD + regressão + Reserva de Armamento ────────────────────
    // invite-activate.spec.ts removido daqui — já tem projeto dedicado invite-suite.
    // Duplicar em dois projetos paralelos causa contention nos tokens Supabase do mesmo usuário.
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
        "e2e/reserva-cadastro.spec.ts",
        "e2e/auth-reset.spec.ts",
        "e2e/notifications-enhanced.spec.ts",
        "e2e/criar-login-real.spec.ts",
        "e2e/totp-ui-confirm.spec.ts",
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

    // ── SSA suite: TOTP + Request + Approval flows ─────────────────────────
    // workers: 1 porque testes compartilham estado do usuário cadete no DB
    {
      name: "ssa-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: [
        "e2e/ssa-totp.spec.ts",
        "e2e/ssa-request.spec.ts",
        "e2e/ssa-approval.spec.ts",
      ],
      workers: 1,
      retries: 2,
      timeout: 150_000,
    },

    // ── SSA stress: race conditions, consistency, full E2E flows ──────────
    {
      name: "ssa-stress",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/ssa-stress.spec.ts"],
      workers: 1,
      retries: 0,
      timeout: 120_000,
    },

    // ── Status + Detail suite: status management + saída detail sheet ────────
    // workers: 1 para evitar race conditions ao alterar registration_status
    {
      name: "status-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/status-detail.spec.ts"],
      workers: 1,
      retries: 2,
      timeout: 90_000,
    },

    // ── Invite + Account Activation suite ─────────────────────────────────
    // workers: 1 — generateLink() para o mesmo usuário em paralelo invalida tokens anteriores no Supabase
    {
      name: "invite-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/invite-activate.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Rate limit validation: sliding-window BFF middleware ───────────────
    // workers: 1 para evitar que testes paralelos consumam cota uns dos outros
    {
      name: "rate-limit",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/rate-limit.spec.ts"],
      workers: 1,
      retries: 0,
      timeout: 30_000,
    },

    // ── Nexus super-admin: 2FA login gate + API authorization ──────────────
    {
      name: "nexus-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/nexus.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Multi-tenant Slice 1A: TT01-TT14 ─────────────────────────────────
    // workers: 1 — testes de constraint e audit_log compartilham estado no DB
    {
      name: "multitenant-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/multitenant.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 90_000,
    },

    // ── RBAC Enterprise Fase 2: PT01-PT08 + SEC-2-* ───────────────────────
    // workers: 1 — cria usuários temporários; paralelo causaria conflicts no DB
    {
      name: "rbac-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/rbac.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Audit Events Fase 3: AT01-AT05 + SEC-3-* ─────────────────────────
    // workers: 1 — hash chain é sequencial; paralelo quebraria a cadeia de hashes
    {
      name: "audit-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/audit-events.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Assinatura Eletrônica Fase 4: SIG01-SIG06 ─────────────────────────
    // workers: 1 — TOTP anti-replay bloqueia uso paralelo do mesmo código
    {
      name: "signature-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/signatures.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 90_000,
    },
  ],

  // Timeout per test (stress tests may run longer)
  timeout: 60_000,

  // Output artefacts
  outputDir: "test-results",
});
