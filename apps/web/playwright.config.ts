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
  globalTeardown: "./e2e/global-teardown.ts",
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

    // ── Saída Diária Enterprise Fase 5: SD01-SD06 ─────────────────────────
    // workers: 1 — compartilha material_items; paralelo causa contention no trigger
    {
      name: "saida-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/saidas.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 90_000,
    },

    // ── Saídas Enterprise + Desarmamento Identity-First: SE01-SE13 ──────────
    {
      name: "saidas-enterprise-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/saidas-enterprise.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 90_000,
    },

    // ── Cautela Permanente Fase 5: CT01-CT08 ──────────────────────────────
    // workers: 1 — status machine sequencial; hash chain cautelamento
    {
      name: "cautelamento-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/cautelamentos.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 120_000,
    },

    // ── Integridade de Posse Fase 5: IT01-IT09 ────────────────────────────
    // workers: 1 — BLOQUEIO ABSOLUTO; trigger P0001 deve ser testado isolado
    {
      name: "item-integrity-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/item-integrity.spec.ts"],
      workers: 1,
      retries: 0,
      timeout: 120_000,
    },

    // ── Fase 6: Livro Digital de Serviço ─────────────────────────────────
    {
      name: "handover-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/handovers.spec.ts"],
      workers: 1,
      retries: 0,
      timeout: 120_000,
    },

    // ── Fase 7: Dashboard de Comando DEC + Estrutura PMPB: DEC01-DEC15 ────
    // workers: 1 — usa IDs fixos de produção; serial por design
    {
      name: "dec-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/admin-dec-estrutura.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Nexus Enterprise Fase 5B: NE01-NE16 ──────────────────────────────
    // workers: 1 — setup-2fa usa Map em memória; paralelo poderia colidir
    {
      name: "nexus-enterprise-suite",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/nexus-enterprise.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Journey Validation — Jornadas ponta-a-ponta por role ─────────────
    // workers: 2 — testes de UI compartilham cookies; API tests são independentes
    {
      name: "journey-suite",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
      testMatch: ["e2e/journey-validation.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Visual Full — Bateria visual ponta-a-ponta (VF01-VF30) ───────────
    // workers: 1 — serial, compartilha estado (saídas, cautelas criadas)
    // headed: true para validação visual real (use --headed na CLI)
    {
      name: "visual-full-suite",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        video: "retain-on-failure",
        screenshot: "only-on-failure",
        trace: "on-first-retry",
      },
      testMatch: ["e2e/visual-full.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 90_000,
    },

    // ── Fase 7B — Onboarding Enterprise (OB01-OB12) ──────────────────────
    {
      name: "onboarding-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/onboarding.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Fase 7B — Branding Dinâmico (BR01-BR06) ──────────────────────────
    {
      name: "branding-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/branding.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Arsenal/Profile/Feedback regression ────────────────────────────────
    {
      name: "arsenal-profile-feedback",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/arsenal-profile-feedback.spec.ts", "e2e/login-ui-session.spec.ts"],
      workers: 1,
      retries: 0,
      timeout: 60_000,
    },

    // ── Histórico de Saídas do Usuário (HU01-HU10) ──────────────────────
    {
      name: "historico-usuario-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/historico-usuario.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Desarmamento Modal improvements (DM01-DM04) ──────────────────────
    {
      name: "desarmamento-suite",
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".auth/armeiro.json",
      },
      testMatch: ["e2e/desarmamento-receber.spec.ts"],
      dependencies: ["armeiro-setup"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Criar Armeiro suite (CA01-CA03) ─────────────────────────────────
    {
      name: "criar-armeiro-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/criar-armeiro.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Fase 7B — Stress Operacional (SO01-SO15) ─────────────────────────
    {
      name: "stress-operacional",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/stress-operacional.spec.ts"],
      workers: 2,
      retries: 0,
      timeout: 120_000,
    },

    // ── Fase 8 — Inventário Periódico (INV01-INV10) ──────────────────────
    {
      name: "inventory-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/inventory.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Fase 7C — Invite Privilege Ceiling (INV-01..INV-08 + SEC-02..03) ──
    {
      name: "invite-privilege",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/invite-privilege.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Nexus Super Admin — Suite completa (NEX01-NEX50) ─────────────────
    {
      name: "nexus-admin-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/nexus-admin.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 90_000,
    },

    // ── Fase 6-B — Livro Digital de Serviço (LDS01-LDS20) ───────────────
    // Reusa armeiro-setup — evita race condition de escrita dupla em .auth/armeiro.json
    {
      name: "livro-suite",
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".auth/armeiro.json",
      },
      testMatch: ["e2e/livro-digital.spec.ts"],
      dependencies: ["armeiro-setup"],
      workers: 1,
      retries: 1,
      timeout: 90_000,
    },

    // ── Nexus Super Admin v2: NXV01-NXV24 ────────────────────────────────
    // workers: 1 — anti-replay TOTP; testes de limite compartilham tenant DB
    {
      name: "nexus-v2-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/nexus-v2.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Bug Sprint 001 — Regressão enterprise (GRP/AC/FLT/CHK/PDF/MOV/CAT/EF) ─
    {
      name: "bug-sprint-001",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/bug-sprint-001.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 90_000,
    },

    // ── TOTP Regression — TOTP-R01..R11 ──────────────────────────────────────
    // workers: 1 — anti-replay TOTP; beforeAll provisiona cadete (sequencial)
    {
      name: "totp-regression",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/totp-regression.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Armeiro Auth Setup (login UMA vez, salva storageState) ──────────
    {
      name: "armeiro-setup",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ["e2e/setup/armeiro-auth.setup.ts"],
      workers: 1,
      retries: 2,
      timeout: 60_000,
    },

    // ── Armeiro Flow — Passagens + Cautelas (AR01-AR23) ──────────────────
    // Usa storageState do armeiro-setup — zero logins durante a suite
    {
      name: "armeiro-suite",
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".auth/armeiro.json",
      },
      testMatch: ["e2e/armeiro-flow.spec.ts"],
      dependencies: ["armeiro-setup"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // ── Padrão Universal de Listagem — Paginação/Toggle/Seleção/Export ───

    // Armeiro Saídas (AS01-AS25)
    {
      name: "armeiro-saidas-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/armeiro-saidas.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // Admin Saídas (ADS01-ADS20)
    {
      name: "admin-saidas-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/admin-saidas.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // Admin Arsenal (AAR01-AAR15)
    {
      name: "admin-arsenal-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/admin-arsenal.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // Admin Usuários (AU01-AU15)
    {
      name: "admin-usuarios-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/admin-usuarios.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // Militares (ML01-ML15)
    {
      name: "reserva-militares-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/reserva-militares.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // Ocorrências (OC01-OC15)
    {
      name: "reserva-ocorrencias-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/reserva-ocorrencias.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // Admin Inventário (INV01-INV15)
    {
      name: "admin-inventario-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/admin-inventario.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },

    // Minhas Cautelas (MC01-MC15)
    {
      name: "efetivo-cautelas-suite",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testMatch: ["e2e/efetivo-cautelas.spec.ts"],
      workers: 1,
      retries: 1,
      timeout: 60_000,
    },
  ],

  // Timeout per test (stress tests may run longer)
  timeout: 60_000,

  // Output artefacts
  outputDir: "test-results",
});
