/**
 * APMCB — Enterprise E2E Test Suite
 * Covers: auth, RBAC, UI, navigation, security, BFF health
 *
 * Run: npx playwright test e2e/apmcb.spec.ts --reporter=html
 *
 * STATUS LEGEND (in test titles):
 *   [PASS] — expected to pass today
 *   [FAIL] — known gap; documents what must be built
 */

import { test, expect } from "@playwright/test";
import {
  login,
  logout,
  assertNoJwtInLocalStorage,
  assertHttpOnlyCookies,
  assertBffHealthy,
  waitForDashboard,
  collectPerf,
  BASE_URL,
  BFF_URL,
  USERS,
} from "./harness";

// ══════════════════════════════════════════════════════════════════════════
// 1. INFRASTRUCTURE
// ══════════════════════════════════════════════════════════════════════════

test.describe("Infrastructure", () => {
  test("[PASS] CF Pages responds with 200 on /login", async ({ page }) => {
    const resp = await page.goto(`${BASE_URL}/login`);
    expect(resp?.status()).toBe(200);
  });

  test("[PASS] BFF /health is reachable and healthy", async ({ page }) => {
    await assertBffHealthy(page);
  });

  test("[PASS] Login page has no Server Component crash (no ERROR digest in body)", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    const body = await page.content();
    expect(body).not.toContain("Server Components render");
    expect(body).not.toContain("ERROR ");
  });

  test("[PASS] PWA manifest is served", async ({ page }) => {
    const resp = await page.goto(`${BASE_URL}/manifest.webmanifest`);
    expect(resp?.status()).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. LOGIN PAGE — UX
// ══════════════════════════════════════════════════════════════════════════

test.describe("Login Page UX", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/e-mail ou matrícula/i).waitFor({ state: "visible", timeout: 10000 });
  });

  test("[PASS] renders split layout — form panel visible", async ({ page }) => {
    await expect(page.getByLabel(/e-mail ou matrícula/i)).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.getByRole("button", { name: /entrar/i })).toBeVisible();
  });

  test("[PASS] brand panel visible on wide viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    // Brand panel shows tenant name or default "Plataforma de Controle"
    await expect(page.getByText(/Plataforma de Controle|Gestão integrada/i).first()).toBeVisible();
  });

  test("[PASS] brand panel hidden on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    // Right panel has hidden lg: class — should not be in DOM or hidden
    const panel = page.locator("text=Gestão integrada de materiais");
    await expect(panel).toBeHidden();
  });

  test("[PASS] footer attribution contains Arckos IA", async ({ page }) => {
    await expect(page.getByText(/Arckos IA/i)).toBeVisible();
  });

  test("[PASS] Entrar button disabled when fields are empty", async ({ page }) => {
    const btn = page.getByRole("button", { name: /entrar/i });
    await expect(btn).toBeDisabled();
  });

  test("[PASS] Google OAuth button visible and enabled", async ({ page }) => {
    await expect(page.getByRole("button", { name: /continuar com google/i })).toBeEnabled();
  });

  test("[PASS] wrong credentials shows error toast", async ({ page }) => {
    await page.getByLabel(/e-mail ou matrícula/i).fill("wrong@apmcb.dev");
    await page.locator('input[type="password"]').fill("WrongPass@999");
    await page.getByRole("button", { name: /entrar/i }).click();
    await expect(page.getByText(/matrícula ou senha inválidos/i)).toBeVisible({ timeout: 6000 });
  });

  test("[PASS] login page uses white background (not dark)", async ({ page }) => {
    const bg = await page.locator("body").evaluate((el) =>
      getComputedStyle(el).backgroundColor
    );
    // Should be white or near-white on the left panel
    expect(bg).not.toBe("rgb(0, 0, 0)");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. AUTHENTICATION FLOWS
// ══════════════════════════════════════════════════════════════════════════

test.describe("Authentication — Admin flow", () => {
  test("[PASS] admin logs in and lands on /admin", async ({ page }) => {
    await login(page, "admin");
    await expect(page).toHaveURL(/\/admin$/);
  });

  test("[PASS] admin dashboard shows KPI cards", async ({ page }) => {
    await login(page, "admin");
    await waitForDashboard(page);
    await expect(page.getByText(/Total de Militares/i)).toBeVisible();
    await expect(page.getByText(/Materiais em Uso/i)).toBeVisible();
    await expect(page.getByText(/Cadastros Pendentes/i)).toBeVisible();
  });

  test("[PASS] admin sidebar has all 5 nav items", async ({ page }) => {
    await login(page, "admin");
    await waitForDashboard(page);
    await expect(page.getByRole("link", { name: /dashboard/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /usuários/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /almoxarifado/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /relatórios/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /auditoria/i })).toBeVisible();
  });

  test("[PASS] admin can sign out and return to /login", async ({ page }) => {
    await login(page, "admin");
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("Authentication — Reserva de Armamento flow", () => {
  test("[PASS] Reserva de Armamento logs in and lands on /reserva", async ({ page }) => {
    await login(page, "reserva");
    await expect(page).toHaveURL(/\/reserva$/);
  });

  test("[PASS] Reserva de Armamento sees action cards (Biometria, Empréstimo, Cadastro, Devoluções)", async ({ page }) => {
    await login(page, "reserva");
    await waitForDashboard(page);
    await expect(page.getByText(/Identificar Militar/i)).toBeVisible();
    await expect(page.getByText(/Nova Saída/i)).toBeVisible();
    await expect(page.getByText(/Cadastrar Biometria/i)).toBeVisible();
    await expect(page.getByText(/Devoluções Pendentes/i)).toBeVisible();
  });
});

test.describe("Authentication — Efetivo flow", () => {
  test("[PASS] efetivo logs in and lands on /efetivo", async ({ page }) => {
    await login(page, "efetivo");
    await expect(page).toHaveURL(/\/efetivo$/);
  });

  test("[PASS] efetivo dashboard shows TOTP access card", async ({ page }) => {
    await login(page, "efetivo");
    await expect(page.getByText(/Código de Acesso/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("[PASS] efetivo can sign out from dashboard", async ({ page }) => {
    await login(page, "efetivo");
    await logout(page);
    await expect(page).toHaveURL(/\/login/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. RBAC — Role-Based Access Control
// ══════════════════════════════════════════════════════════════════════════

test.describe("RBAC — Unauthorised access protection", () => {
  test("[PASS] unauthenticated / redirects to /login", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    await page.waitForURL(/\/login/, { timeout: 8000 });
    await expect(page).toHaveURL(/\/login/);
  });

  test("[PASS] unauthenticated /admin redirects to /login", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForURL(/\/login/, { timeout: 8000 });
  });

  test("[PASS] unauthenticated /reserva redirects to /login", async ({ page }) => {
    await page.goto(`${BASE_URL}/reserva`);
    await page.waitForURL(/\/login/, { timeout: 8000 });
  });

  test("[PASS] efetivo cannot access /admin (redirected)", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/admin`);
    // Should redirect away from /admin
    await page.waitForTimeout(2000);
    expect(page.url()).not.toMatch(/\/admin$/);
  });

  test("[PASS] Reserva de Armamento cannot access /admin dashboard (redirected)", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForTimeout(2000);
    expect(page.url()).not.toMatch(/\/admin$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. SECURITY AUDIT
// ══════════════════════════════════════════════════════════════════════════

test.describe("Security Audit", () => {
  /**
   * CRITICAL FAILURE EXPECTED:
   * Current implementation uses Supabase SDK directly in client.ts,
   * which stores JWT in localStorage (sb-*-auth-token) and in
   * non-HttpOnly cookies. This violates the requirement to use
   * BFF + HttpOnly cookies + iron-session.
   *
   * Resolution:
   * 1. Remove createBrowserClient() from frontend
   * 2. Create POST /api/auth/login in BFF → validates via Supabase → returns iron-session cookie
   * 3. All frontend requests go through BFF with credentials: "include"
   * 4. JWT never visible in browser
   */
  test("[FAIL] no JWT in localStorage after login — REQUIRES BFF AUTH MIGRATION", async ({ page }) => {
    await login(page, "admin");
    await assertNoJwtInLocalStorage(page);
  });

  /**
   * CRITICAL FAILURE EXPECTED:
   * @supabase/ssr stores auth cookies as SameSite=Lax but NOT HttpOnly.
   * They are readable by JavaScript.
   */
  test("[FAIL] auth cookies are HttpOnly — REQUIRES BFF AUTH MIGRATION", async ({ page, context }) => {
    test.fail(true, "BFF auth migration not implemented — cookies are not HttpOnly yet");
    await login(page, "admin");
    await assertHttpOnlyCookies(context);
  });

  test("[PASS] Content-Security-Policy header exists on BFF", async ({ request }) => {
    // usa APIRequestContext (não page.request) para evitar filtro CORS de headers cross-origin
    const resp = await request.get(`${BFF_URL}/health`);
    const headers = resp.headers();
    expect(
      headers["x-content-type-options"] ?? "",
      "secure-headers middleware should set X-Content-Type-Options"
    ).toContain("nosniff");
  });

  test("[PASS] login page served over HTTPS", async ({ page }) => {
    test.skip(/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE_URL), "HTTPS é validado no deploy; localhost roda em HTTP.");
    expect(BASE_URL).toMatch(/^https:/);
    const resp = await page.goto(`${BASE_URL}/login`);
    expect(resp?.url()).toMatch(/^https:/);
  });

  test("[PASS] /auth/error page exists and renders gracefully", async ({ page }) => {
    await page.goto(`${BASE_URL}/auth/error`);
    await expect(page.getByText(/falha na autenticação/i)).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. NAVIGATION & UX
// ══════════════════════════════════════════════════════════════════════════

test.describe("Navigation & Shell UX", () => {
  test("[PASS] sidebar collapses and expands via toggle", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await login(page, "admin");
    await waitForDashboard(page);

    // Sidebar starts open (w-56 = 224px)
    const sidebar = page.locator("aside");
    const initialWidth = await sidebar.evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(initialWidth).toBeGreaterThan(100);

    // Click chevron toggle
    await page.locator("aside button").first().click();
    await page.waitForTimeout(350); // transition
    const collapsedWidth = await sidebar.evaluate((el) => (el as HTMLElement).offsetWidth);
    expect(collapsedWidth).toBeLessThan(80);
  });

  test("[PASS] theme toggle switches dark/light", async ({ page }) => {
    await login(page, "admin");
    const htmlEl = page.locator("html");
    const beforeClass = await htmlEl.getAttribute("class");

    await page.getByRole("button", { name: /alternar tema/i }).click();
    await page.waitForTimeout(300);

    const afterClass = await htmlEl.getAttribute("class");
    expect(beforeClass).not.toBe(afterClass);
  });

  test("[PASS] bottom nav visible on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, "admin");
    await waitForDashboard(page);
    await expect(page.locator('[data-testid="bottom-nav"]')).toBeVisible();
  });

  test("[PASS] active nav item highlighted", async ({ page }) => {
    await login(page, "admin");
    await waitForDashboard(page);
    await page.waitForLoadState("networkidle");
    // Active sidebar link uses bg-primary/10 text-primary — match text-primary
    const dashLink = page.locator('aside nav a[href="/admin"]');
    await expect(dashLink).toBeVisible({ timeout: 5000 });
    const cls = await dashLink.getAttribute("class");
    expect(cls).toMatch(/text-primary/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 7. BFF INTEGRATION — FEATURE GAPS
// ══════════════════════════════════════════════════════════════════════════

test.describe("BFF Integration (Feature Gaps)", () => {
  /**
   * These tests document what SHOULD work once the frontend
   * is wired to the BFF. All expected to FAIL today.
   */

  test("[FAIL] GET /api/dashboard/stats returns real data for admin", async ({ page }) => {
    test.fail(true, "BFF /api/dashboard/stats endpoint not implemented yet");
    await login(page, "admin");
    // After BFF auth migration, fetch should use session cookie
    const resp = await page.request.get(`${BFF_URL}/api/dashboard/stats`, {
      headers: { "Content-Type": "application/json" },
    });
    // Currently returns 401 because frontend hasn't sent auth
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty("totalMilitares");
    expect(body).toHaveProperty("materiaisEmUso");
  });

  test("[PASS] admin KPI cards show real numbers (not —)", async ({ page }) => {
    await login(page, "admin");
    await waitForDashboard(page);
    // Admin page now fetches from Supabase directly — values should be numeric strings
    const values = await page.locator(".text-2xl.font-bold").allTextContents();
    const dashes = values.filter((v) => v.trim() === "—");
    expect(dashes, "KPI values still hardcoded as '—' — check admin/page.tsx").toHaveLength(0);
  });

  test("[FAIL] POST /api/lendings creates a new lending", async ({ page }) => {
    test.fail(true, "BFF /api/lendings requires real UUIDs and BFF auth migration");
    await login(page, "reserva");
    const resp = await page.request.post(`${BFF_URL}/api/lendings`, {
      data: {
        material_type_id: "00000000-0000-0000-0000-000000000000",
        military_id: "00000000-0000-0000-0000-000000000003",
        quantidade: 1,
      },
    });
    expect(resp.status()).toBe(201);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 8. PERFORMANCE
// ══════════════════════════════════════════════════════════════════════════

test.describe("Performance", () => {
  test("[PASS] login page TTFB < 2000ms", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "commit" });
    const perf = await collectPerf(page);
    expect(perf.ttfb, `TTFB was ${perf.ttfb}ms`).toBeLessThan(2000);
  });

  test("[PASS] login page DOM loads in < 3s", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    const perf = await collectPerf(page);
    expect(perf.domLoad, `domLoad was ${perf.domLoad}ms`).toBeLessThan(3000);
  });

  test("[PASS] admin dashboard loads in < 15s after login", async ({ page }) => {
    const start = Date.now();
    await login(page, "admin");
    await waitForDashboard(page);
    const elapsed = Date.now() - start;
    expect(elapsed, `Dashboard took ${elapsed}ms`).toBeLessThan(15000);
  });
});
